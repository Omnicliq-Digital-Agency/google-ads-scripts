/**
 * Competitor Query Fencing
 *
 * Unless you deliberately bid on competitor names, searches like
 * "competitor-brand + your product" are expensive clicks with terrible
 * intent: the searcher wants them, not you. Those queries slip in through
 * phrase and broad matching, one impression at a time, in every ad group.
 * This script fences them: every search term containing a competitor brand
 * becomes a negative exact keyword in the ad group that matched it.
 *
 * How a search term is fenced:
 *   1. Competitor names come from CONFIG.COMPETITORS and/or a shared
 *      negative keyword list you maintain in the account
 *      (COMPETITOR_LIST_NAME) - the list does not need to be attached to
 *      any campaign; it is read as a name registry.
 *   2. Search terms from enabled keyword campaigns are matched on word
 *      boundaries, so 'ikea' matches 'ikea sofa' but not 'bikeatlas'.
 *   3. Campaigns matching COMPETITOR_CAMPAIGN_PATTERN are skipped entirely -
 *      that is where you bid on competitors on purpose.
 *   4. Matching terms not already negated are added as negative exact
 *      ([term]) to their ad group.
 *
 * Setup:
 *   1. Fill in COMPETITORS below, or set COMPETITOR_LIST_NAME to a shared
 *      negative keyword list holding one competitor name per entry.
 *   2. Run with PREVIEW_MODE: true first. Read the execution summary in the
 *      logs; nothing is changed in the account.
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

    // Competitor brand names (case-insensitive, matched on word boundaries).
    COMPETITORS: [],

    // Optional: also read competitor names from this shared negative keyword
    // list (Tools -> Shared library -> Negative keyword lists). Lets you
    // maintain the registry in the UI instead of editing the script.
    COMPETITOR_LIST_NAME: '',

    // Campaigns whose name contains any of these substrings are skipped -
    // put your intentional competitor-bidding campaigns here.
    COMPETITOR_CAMPAIGN_PATTERN: ['Competitor'],

    // Campaigns whose name contains any of these are also skipped (channels
    // where ad-group keyword negatives don't apply the same way).
    CAMPAIGN_EXCLUDE_PATTERNS: ['SHOPPING', 'PMAX', 'DSA'],

    // How many days of search term data to analyse (ending yesterday).
    LOOKBACK_DAYS: 30,

    // Ignore search terms with fewer impressions than this.
    MIN_SEARCH_TERM_IMPRESSIONS: 1,

    // Search terms longer than this are skipped (Google Ads keyword limits).
    MAX_TERM_WORDS: 10,
    MAX_TERM_CHARS: 80,

    // Stop analysing this many milliseconds after the script starts, leaving
    // time to commit pending negatives before the 30-minute hard limit.
    MAX_RUNTIME_MS: 27 * 60 * 1000,
};

function main() {
    validateConfig();

    const startTime = Date.now();
    const fencer = new CompetitorFencer(startTime);
    fencer.fence();
}

function validateConfig() {
    if (CONFIG.COMPETITORS.length === 0 && !CONFIG.COMPETITOR_LIST_NAME) {
        throw new Error('No competitors configured - fill in COMPETITORS or ' +
            'COMPETITOR_LIST_NAME.');
    }
}

function CompetitorFencer(startTime) {

    const negativeKeywords = new NegativeKeywordBatch();

    this.fence = function () {
        const dateFrom = formattedDate(-CONFIG.LOOKBACK_DAYS);
        const dateTo = formattedDate(-1);

        const competitors = collectCompetitors();
        Logger.log(competitors.length + ' competitor names loaded.');

        // Existing negative texts per ad group id.
        const existingNegativeTexts = {};

        const counters = {
            terms: 0, withCompetitor: 0,
            skipLength: 0, skipExists: 0,
            added: 0,
            timedOut: false,
        };

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
            const adGroupId = row.adGroup.id;
            if (!existingNegativeTexts[adGroupId]) {
                existingNegativeTexts[adGroupId] = {};
            }
            existingNegativeTexts[adGroupId][row.adGroupCriterion.keyword.text] = true;
        }

        Logger.log('Analysing search terms (' + dateFrom + ' to ' + dateTo + ')...');
        const termRows = AdsApp.search(
            'SELECT campaign.name, ad_group.id, ad_group.name, ' +
            'search_term_view.search_term ' +
            'FROM search_term_view ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            'AND ad_group.status = \'ENABLED\' ' +
            buildCampaignExcludeFilter() +
            'AND metrics.impressions >= ' + CONFIG.MIN_SEARCH_TERM_IMPRESSIONS + ' ' +
            'AND segments.date BETWEEN \'' + dateFrom + '\' AND \'' + dateTo + '\'');

        while (termRows.hasNext()) {
            const row = termRows.next();
            counters.terms++;
            const term = row.searchTermView.searchTerm;
            const adGroupId = row.adGroup.id;

            if (term.split(' ').length > CONFIG.MAX_TERM_WORDS ||
                term.length > CONFIG.MAX_TERM_CHARS) {
                counters.skipLength++;
                continue;
            }

            const competitor = findCompetitor(term, competitors);
            if (!competitor) {
                continue;
            }
            counters.withCompetitor++;

            if (existingNegativeTexts[adGroupId] && existingNegativeTexts[adGroupId][term]) {
                counters.skipExists++;
                continue;
            }

            negativeKeywords.add(adGroupId, term);
            counters.added++;
            Logger.log('Fencing "' + term + '" (competitor: ' + competitor + ') in "' +
                row.campaign.name + '" > "' + row.adGroup.name + '"');

            if (Date.now() - startTime > CONFIG.MAX_RUNTIME_MS) {
                counters.timedOut = true;
                Logger.log('Approaching the execution time limit - committing what was analysed so far.');
                break;
            }
        }

        negativeKeywords.flush();

        logSummary(counters, competitors.length, dateFrom, dateTo);
    };

    /**
     * Merges CONFIG.COMPETITORS with the entries of the optional shared
     * negative keyword list, lowercased and deduplicated.
     */
    function collectCompetitors() {
        const seen = {};
        const competitors = [];
        const register = function (name) {
            const clean = String(name).toLowerCase().trim();
            if (clean && !seen[clean]) {
                seen[clean] = true;
                competitors.push(clean);
            }
        };

        for (const name of CONFIG.COMPETITORS) {
            register(name);
        }

        if (CONFIG.COMPETITOR_LIST_NAME) {
            const lists = AdsApp.negativeKeywordLists()
                .withCondition('Name = \'' + CONFIG.COMPETITOR_LIST_NAME + '\'')
                .get();
            if (!lists.hasNext()) {
                throw new Error('Shared negative keyword list "' +
                    CONFIG.COMPETITOR_LIST_NAME + '" was not found.');
            }
            const entries = lists.next().negativeKeywords().get();
            while (entries.hasNext()) {
                // Strip match type punctuation so list entries can be any type.
                register(entries.next().getText().replace(/^["\[]|["\]]$/g, ''));
            }
        }

        return competitors;
    }

    /**
     * Returns the first competitor appearing in the term on word boundaries
     * ('ikea' matches 'ikea sofa', not 'bikeatlas'), or undefined.
     */
    function findCompetitor(term, competitors) {
        const padded = ' ' + term.toLowerCase() + ' ';
        for (const competitor of competitors) {
            if (padded.indexOf(' ' + competitor + ' ') !== -1) {
                return competitor;
            }
        }
        return undefined;
    }

    function buildCampaignExcludeFilter() {
        let filter = '';
        const patterns = CONFIG.COMPETITOR_CAMPAIGN_PATTERN
            .concat(CONFIG.CAMPAIGN_EXCLUDE_PATTERNS);
        for (const pattern of patterns) {
            filter += 'AND campaign.name NOT REGEXP_MATCH \'(?i).*' + escapeForRegexp(pattern) + '.*\' ';
        }
        return filter;
    }

    function logSummary(counters, competitorCount, dateFrom, dateTo) {
        const preview = CONFIG.PREVIEW_MODE ? ' (PREVIEW MODE - nothing was changed)' : '';
        Logger.log([
            '',
            '========== Execution Summary' + preview + ' ==========',
            'Window: ' + dateFrom + ' to ' + dateTo,
            'Competitor names: ' + competitorCount,
            'Search terms analysed: ' + counters.terms +
            ' (>= ' + CONFIG.MIN_SEARCH_TERM_IMPRESSIONS + ' impressions)',
            'Containing a competitor: ' + counters.withCompetitor,
            'Skipped:',
            '  ' + counters.skipLength + ' too long (> ' + CONFIG.MAX_TERM_WORDS +
            ' words or > ' + CONFIG.MAX_TERM_CHARS + ' chars)',
            '  ' + counters.skipExists + ' already exist as negatives',
            (counters.timedOut ? 'Stopped early near the execution time limit.' : ''),
            'Negative exact keywords ' + (CONFIG.PREVIEW_MODE ? 'that would be added' : 'added') +
            ': ' + counters.added,
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
