/**
 * Cross Ad Group Query Fencing
 *
 * When the same search query serves from two ad groups, they bid against
 * each other's history: the query's data splits, the less relevant ad often
 * wins impressions, and neither ad group learns. This script routes every
 * shared query to a single owner - the ad group whose trigger keyword is
 * most similar to the query - and fences it off everywhere else with a
 * negative exact keyword.
 *
 * How a query is routed:
 *   1. Search terms with at least MIN_QUERY_CLICKS clicks are collected
 *      with the keyword that triggered them, per ad group.
 *   2. A term serving from two or more ad groups is a conflict. Each ad
 *      group is scored by the similarity between its trigger keyword and
 *      the term (word-order-insensitive Levenshtein); highest similarity
 *      wins, ties break by clicks, then conversions.
 *   3. Losing ad groups get the term as a negative exact ([term]) - unless
 *      the term earns more than MAX_CLICKS_AUTO_FENCE clicks there, in
 *      which case it is only reported: rerouting that much traffic is a
 *      human decision.
 *
 * Setup:
 *   1. Review CONFIG below.
 *   2. Run with PREVIEW_MODE: true first. Read the conflicts and planned
 *      negatives in the logs; nothing is changed in the account.
 *   3. Set PREVIEW_MODE: false and schedule (weekly).
 *
 * @author Dimitris Bachtsevanis <db@omnicliq.com> (Omnicliq)
 *
 * Copyright 2026 Omnicliq
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const CONFIG = {
    // true: analyse and log only, change nothing in the account.
    // false: create negative keywords.
    PREVIEW_MODE: true,

    // Who receives the digest of fenced queries and the high-traffic
    // conflicts left for manual review. Empty = no email.
    RECIPIENT_EMAILS: [],

    // How many days of search term data to analyse (ending yesterday).
    LOOKBACK_DAYS: 30,

    // Ignore search terms with fewer clicks than this (per ad group).
    MIN_QUERY_CLICKS: 2,

    // A losing ad group where the term still earned more clicks than this
    // is reported instead of fenced - that much traffic moves only by a
    // human decision.
    MAX_CLICKS_AUTO_FENCE: 50,

    // Campaigns whose name contains any of these are skipped (channels
    // where trigger keywords don't exist or negatives work differently).
    CAMPAIGN_EXCLUDE_PATTERNS: ['SHOPPING', 'PMAX', 'DSA'],

    // Search terms longer than this are skipped (Google Ads keyword limits).
    MAX_TERM_WORDS: 10,
    MAX_TERM_CHARS: 80,

    // Stop analysing this many milliseconds after the script starts,
    // leaving time to commit pending negatives before the 30-minute limit.
    MAX_RUNTIME_MS: 27 * 60 * 1000,
};

function main() {
    const startTime = Date.now();
    const fencer = new QueryRouter(startTime);
    fencer.route();
}

function QueryRouter(startTime) {

    const negativeKeywords = new NegativeKeywordBatch();

    this.route = function () {
        const dateFrom = formattedDate(-CONFIG.LOOKBACK_DAYS);
        const dateTo = formattedDate(-1);

        // term -> array of {campaign, adGroupName, adGroupId, keyword,
        //                   clicks, conversions, similarity}
        const instancesByTerm = {};
        // Existing negative texts per ad group id.
        const existingNegatives = {};

        const counters = {
            terms: 0, conflicts: 0,
            skipLength: 0, skipExists: 0,
            fenced: 0, reported: 0,
            timedOut: false,
        };
        const manualReview = [];
        const fencedLog = [];

        Logger.log('Collecting existing negatives...');
        const negativeRows = AdsApp.search(
            'SELECT ad_group.id, ad_group_criterion.keyword.text ' +
            'FROM ad_group_criterion ' +
            'WHERE campaign.status IN (\'ENABLED\', \'PAUSED\') ' +
            'AND ad_group.status IN (\'ENABLED\', \'PAUSED\') ' +
            'AND ad_group_criterion.type = \'KEYWORD\' ' +
            'AND ad_group_criterion.negative = true');
        while (negativeRows.hasNext()) {
            const row = negativeRows.next();
            if (row.adGroupCriterion.keyword === undefined) {
                continue;
            }
            if (!existingNegatives[row.adGroup.id]) {
                existingNegatives[row.adGroup.id] = {};
            }
            existingNegatives[row.adGroup.id][row.adGroupCriterion.keyword.text] = true;
        }

        Logger.log('Collecting search terms (' + dateFrom + ' to ' + dateTo + ')...');
        const termRows = AdsApp.search(
            'SELECT campaign.name, ad_group.id, ad_group.name, ' +
            'search_term_view.search_term, segments.keyword.info.text, ' +
            'metrics.clicks, metrics.conversions ' +
            'FROM search_term_view ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            'AND ad_group.status = \'ENABLED\' ' +
            buildCampaignExcludeFilter() +
            'AND metrics.clicks >= ' + CONFIG.MIN_QUERY_CLICKS + ' ' +
            'AND segments.date BETWEEN \'' + dateFrom + '\' AND \'' + dateTo + '\'');

        while (termRows.hasNext()) {
            const row = termRows.next();
            counters.terms++;
            const term = row.searchTermView.searchTerm;

            if (term.split(' ').length > CONFIG.MAX_TERM_WORDS ||
                term.length > CONFIG.MAX_TERM_CHARS) {
                counters.skipLength++;
                continue;
            }
            const keyword = row.segments.keyword && row.segments.keyword.info &&
                row.segments.keyword.info.text;
            if (!keyword) {
                continue;
            }

            if (!instancesByTerm[term]) {
                instancesByTerm[term] = [];
            }
            instancesByTerm[term].push({
                campaign: row.campaign.name,
                adGroupName: row.adGroup.name,
                adGroupId: row.adGroup.id,
                keyword: keyword,
                clicks: parseInt(row.metrics.clicks, 10) || 0,
                conversions: Number(row.metrics.conversions) || 0,
                similarity: similarity(term, keyword),
            });
        }

        Logger.log('Routing conflicting queries...');
        for (const term in instancesByTerm) {
            // A term can repeat per ad group across keywords; keep the best
            // instance per ad group before judging the conflict.
            const byAdGroup = {};
            for (const instance of instancesByTerm[term]) {
                const existing = byAdGroup[instance.adGroupId];
                if (!existing || instance.similarity > existing.similarity) {
                    byAdGroup[instance.adGroupId] = instance;
                }
            }
            const instances = [];
            for (const adGroupId in byAdGroup) {
                instances.push(byAdGroup[adGroupId]);
            }
            if (instances.length < 2) {
                continue;
            }
            counters.conflicts++;

            instances.sort(function (a, b) {
                return (b.similarity - a.similarity) ||
                    (b.clicks - a.clicks) ||
                    (b.conversions - a.conversions);
            });
            const winner = instances[0];
            Logger.log('Conflict "' + term + '": winner "' + winner.adGroupName +
                '" (keyword "' + winner.keyword + '", similarity ' + winner.similarity + ')');

            for (let i = 1; i < instances.length; i++) {
                const loser = instances[i];
                if (existingNegatives[loser.adGroupId] &&
                    existingNegatives[loser.adGroupId][term]) {
                    counters.skipExists++;
                    continue;
                }
                if (loser.clicks > CONFIG.MAX_CLICKS_AUTO_FENCE) {
                    counters.reported++;
                    manualReview.push('  "' + term + '" in ' + loser.campaign + ' > ' +
                        loser.adGroupName + ' (' + loser.clicks + ' clicks) - winner: ' +
                        winner.campaign + ' > ' + winner.adGroupName);
                    continue;
                }
                negativeKeywords.add(loser.adGroupId, term);
                counters.fenced++;
                fencedLog.push('  "' + term + '" fenced in ' + loser.campaign + ' > ' +
                    loser.adGroupName + ' -> owned by ' + winner.adGroupName);
                Logger.log('  Fencing out of "' + loser.adGroupName + '" (similarity ' +
                    loser.similarity + ' vs ' + winner.similarity + ')');
            }

            if (Date.now() - startTime > CONFIG.MAX_RUNTIME_MS) {
                counters.timedOut = true;
                Logger.log('Approaching the execution time limit - committing what was analysed so far.');
                break;
            }
        }

        negativeKeywords.flush();

        if (!CONFIG.PREVIEW_MODE && CONFIG.RECIPIENT_EMAILS.length > 0 &&
            (fencedLog.length > 0 || manualReview.length > 0)) {
            sendDigest(fencedLog, manualReview);
        }

        logSummary(counters, dateFrom, dateTo);
    };

    /**
     * Word-order-insensitive Levenshtein similarity between term and the
     * keyword that triggered it, 0..1.
     */
    function similarity(term, keyword) {
        const a = normalize(term);
        const b = normalize(keyword);
        if (b.length === 0) {
            return 0;
        }
        return round(1 - levenshtein(a, b) / Math.max(a.length, b.length), 2);
    }

    function normalize(text) {
        return text.toLowerCase().replace(/[+."\[\]]/g, '')
            .replace(/\s+/g, ' ').trim().split(' ').sort().join('');
    }

    function buildCampaignExcludeFilter() {
        let filter = '';
        for (const pattern of CONFIG.CAMPAIGN_EXCLUDE_PATTERNS) {
            filter += 'AND campaign.name NOT REGEXP_MATCH \'(?i).*' + escapeForRegexp(pattern) + '.*\' ';
        }
        return filter;
    }

    function sendDigest(fencedLog, manualReview) {
        const accountName = AdsApp.currentAccount().getName();
        const lines = ['Cross ad group query routing in ' + accountName + ':', ''];
        if (fencedLog.length > 0) {
            lines.push('Fenced (' + fencedLog.length + '):');
            lines.push.apply(lines, fencedLog);
            lines.push('');
        }
        if (manualReview.length > 0) {
            lines.push('Left for manual review - too much traffic to reroute automatically (' +
                manualReview.length + '):');
            lines.push.apply(lines, manualReview);
        }

        MailApp.sendEmail(
            CONFIG.RECIPIENT_EMAILS.join(','),
            'Query routing in ' + accountName + ': ' + fencedLog.length + ' fenced, ' +
            manualReview.length + ' for review',
            lines.join('\n'));
    }

    function logSummary(counters, dateFrom, dateTo) {
        const preview = CONFIG.PREVIEW_MODE ? ' (PREVIEW MODE - nothing was changed)' : '';
        Logger.log([
            '',
            '========== Execution Summary' + preview + ' ==========',
            'Window: ' + dateFrom + ' to ' + dateTo,
            'Search term rows analysed: ' + counters.terms +
            ' (>= ' + CONFIG.MIN_QUERY_CLICKS + ' clicks)',
            'Queries serving from 2+ ad groups: ' + counters.conflicts,
            'Skipped: ' + counters.skipLength + ' too long, ' +
            counters.skipExists + ' already negated',
            'Left for manual review (> ' + CONFIG.MAX_CLICKS_AUTO_FENCE + ' clicks): ' +
            counters.reported,
            (counters.timedOut ? 'Stopped early near the execution time limit.' : ''),
            'Negative exact keywords ' + (CONFIG.PREVIEW_MODE ? 'that would be added' : 'added') +
            ': ' + counters.fenced,
            '====================================================',
        ].join('\n'));
    }
}

/**
 * Collects negative keywords and creates them in batches as negative exact
 * match in their target ad groups. In PREVIEW_MODE nothing is written.
 */
function NegativeKeywordBatch() {
    const BATCH_SIZE = 5000;
    let adGroupIds = [];
    let keywordsByAdGroup = {};

    this.add = function (adGroupId, keywordText) {
        if (!keywordsByAdGroup[adGroupId]) {
            keywordsByAdGroup[adGroupId] = [];
        }
        keywordsByAdGroup[adGroupId].push(keywordText);
        adGroupIds.push(adGroupId);
        if (adGroupIds.length >= BATCH_SIZE) {
            this.flush();
        }
    };

    this.flush = function () {
        if (!CONFIG.PREVIEW_MODE && adGroupIds.length > 0) {
            commit();
        }
        adGroupIds = [];
        keywordsByAdGroup = {};
    };

    function commit() {
        const uniqueAdGroupIds = adGroupIds.filter(function (v, i, a) {
            return a.indexOf(v) === i;
        });

        const adGroups = AdsApp.adGroups().withIds(uniqueAdGroupIds).get();
        while (adGroups.hasNext()) {
            const adGroup = adGroups.next();
            const pending = keywordsByAdGroup[adGroup.getId()];
            const seen = {};
            for (const keywordText of pending) {
                if (seen[keywordText]) {
                    continue;
                }
                seen[keywordText] = true;
                adGroup.createNegativeKeyword('[' + keywordText + ']');
            }
        }
    }
}

function formattedDate(daysShift) {
    const date = new Date();
    date.setDate(date.getDate() + daysShift);
    return Utilities.formatDate(date, AdsApp.currentAccount().getTimeZone(), 'yyyy-MM-dd');
}

function escapeForRegexp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&');
}

function round(value, decimals) {
    return Number(Math.round(value + 'e' + decimals) + 'e-' + decimals);
}

function levenshtein(a, b) {
    if (a.length === 0) { return b.length; }
    if (b.length === 0) { return a.length; }
    let previous = [];
    let current = [];
    for (let j = 0; j <= b.length; j++) {
        previous[j] = j;
    }
    for (let i = 1; i <= a.length; i++) {
        current[0] = i;
        for (let j = 1; j <= b.length; j++) {
            const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
            current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, substitution);
        }
        const swap = previous;
        previous = current;
        current = swap;
    }
    return previous[b.length];
}
