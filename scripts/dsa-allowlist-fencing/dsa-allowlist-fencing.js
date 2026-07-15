/**
 * DSA Allowlist Fencing
 *
 * A branded campaign's DSA ad group has one job: catch brand-related
 * queries the keywords missed. But DSA doesn't know your brand list - it
 * matches on pages, so generic queries leak in and spend the branded
 * budget on traffic that belongs elsewhere. This script fences the DSA ad
 * groups of your targeted campaigns to an allowlist: search terms that do
 * NOT contain any allowed term become negative exact keywords in the ad
 * group that matched them.
 *
 * How a search term is judged:
 *   1. Search terms of DSA ad groups (DSA_ADGROUP_PATTERN) inside
 *      campaigns matching ALL of TARGET_CAMPAIGN_PATTERNS are collected
 *      over the lookback window.
 *   2. A term containing any allowlist entry on word boundaries survives
 *      ('nike shoes' survives with 'nike' allowed; 'bikeatlas' does not
 *      make 'ikea' match).
 *   3. Everything else becomes a negative exact ([term]) in its ad group,
 *      unless already negated.
 *
 * The allowlist lives in CONFIG.ALLOWED_TERMS and/or a shared negative
 * keyword list used purely as a registry (ALLOWLIST_NAME) - maintained in
 * the UI, never attached to campaigns.
 *
 * This is the ad-group-level sibling of shopping-allowlist-fencing (which
 * fences whole shopping campaigns at campaign level).
 *
 * Setup:
 *   1. Set TARGET_CAMPAIGN_PATTERNS and fill the allowlist.
 *   2. Run with PREVIEW_MODE: true first. Read the execution summary in
 *      the logs; nothing is changed in the account.
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

    // A campaign must contain ALL of these name substrings to be fenced
    // (e.g. ['Brands'] for your branded campaigns).
    TARGET_CAMPAIGN_PATTERNS: ['Brands'],

    // How to recognise the DSA ad groups inside those campaigns by name
    // (case-insensitive substring).
    DSA_ADGROUP_PATTERN: 'DSA',

    // Terms allowed to trigger the fenced ad groups (case-insensitive,
    // word-boundary matched).
    ALLOWED_TERMS: [],

    // Optional: also read allowed terms from this shared negative keyword
    // list, used purely as a registry (do not attach it to campaigns).
    ALLOWLIST_NAME: '',

    // How many days of search term data to analyse (ending yesterday).
    LOOKBACK_DAYS: 30,

    // Ignore search terms with fewer impressions than this.
    MIN_SEARCH_TERM_IMPRESSIONS: 5,

    // Search terms longer than this are skipped (Google Ads keyword limits).
    MAX_TERM_WORDS: 10,
    MAX_TERM_CHARS: 80,

    // Stop analysing this many milliseconds after the script starts,
    // leaving time to commit pending negatives before the 30-minute limit.
    MAX_RUNTIME_MS: 27 * 60 * 1000,
};

function main() {
    validateConfig();

    const startTime = Date.now();
    const fencer = new AllowlistFencer(startTime);
    fencer.fence();
}

function validateConfig() {
    if (CONFIG.TARGET_CAMPAIGN_PATTERNS.length === 0) {
        throw new Error('TARGET_CAMPAIGN_PATTERNS must identify the campaigns to fence.');
    }
    if (!CONFIG.DSA_ADGROUP_PATTERN) {
        throw new Error('DSA_ADGROUP_PATTERN must be set.');
    }
    if (CONFIG.ALLOWED_TERMS.length === 0 && !CONFIG.ALLOWLIST_NAME) {
        throw new Error('No allowlist configured - fill in ALLOWED_TERMS or ALLOWLIST_NAME. ' +
            'An empty allowlist would negate every search term.');
    }
}

function AllowlistFencer(startTime) {

    const negativeKeywords = new NegativeKeywordBatch();

    this.fence = function () {
        const dateFrom = formattedDate(-CONFIG.LOOKBACK_DAYS);
        const dateTo = formattedDate(-1);

        const allowlist = collectAllowlist();
        Logger.log(allowlist.length + ' allowlist entries loaded.');

        // Existing negative texts per fenced ad group id.
        const existingNegatives = {};

        const counters = {
            terms: 0, allowed: 0,
            skipLength: 0, skipExists: 0,
            added: 0,
            timedOut: false,
        };

        Logger.log('Collecting existing negatives in the fenced ad groups...');
        const negativeRows = AdsApp.search(
            'SELECT ad_group.id, ad_group_criterion.keyword.text ' +
            'FROM ad_group_criterion ' +
            'WHERE campaign.status IN (\'ENABLED\', \'PAUSED\') ' +
            'AND ad_group.status IN (\'ENABLED\', \'PAUSED\') ' +
            buildCampaignIncludeFilter() +
            buildAdGroupIncludeFilter() +
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

        Logger.log('Judging DSA search terms (' + dateFrom + ' to ' + dateTo + ')...');
        const termRows = AdsApp.search(
            'SELECT campaign.name, ad_group.id, ad_group.name, ' +
            'search_term_view.search_term ' +
            'FROM search_term_view ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            'AND ad_group.status = \'ENABLED\' ' +
            buildCampaignIncludeFilter() +
            buildAdGroupIncludeFilter() +
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
            if (isAllowed(term, allowlist)) {
                counters.allowed++;
                continue;
            }
            if (existingNegatives[adGroupId] && existingNegatives[adGroupId][term]) {
                counters.skipExists++;
                continue;
            }
            if (!existingNegatives[adGroupId]) {
                existingNegatives[adGroupId] = {};
            }
            existingNegatives[adGroupId][term] = true;

            negativeKeywords.add(adGroupId, term);
            counters.added++;
            Logger.log('Fencing "' + term + '" in "' + row.campaign.name + '" > "' +
                row.adGroup.name + '"');

            if (Date.now() - startTime > CONFIG.MAX_RUNTIME_MS) {
                counters.timedOut = true;
                Logger.log('Approaching the execution time limit - committing what was analysed so far.');
                break;
            }
        }

        negativeKeywords.flush();

        logSummary(counters, allowlist.length, dateFrom, dateTo);
    };

    function collectAllowlist() {
        const seen = {};
        const allowlist = [];
        const register = function (text) {
            const clean = String(text).replace(/^["\[]|["\]]$/g, '').toLowerCase().trim();
            if (clean && !seen[clean]) {
                seen[clean] = true;
                allowlist.push(clean);
            }
        };

        for (const term of CONFIG.ALLOWED_TERMS) {
            register(term);
        }

        if (CONFIG.ALLOWLIST_NAME) {
            const lists = AdsApp.negativeKeywordLists()
                .withCondition('Name = \'' + CONFIG.ALLOWLIST_NAME + '\'')
                .get();
            if (!lists.hasNext()) {
                throw new Error('Allowlist "' + CONFIG.ALLOWLIST_NAME + '" was not found.');
            }
            const entries = lists.next().negativeKeywords().get();
            while (entries.hasNext()) {
                register(entries.next().getText());
            }
        }

        return allowlist;
    }

    function isAllowed(term, allowlist) {
        const padded = ' ' + term.toLowerCase() + ' ';
        for (const entry of allowlist) {
            if (padded.indexOf(' ' + entry + ' ') !== -1) {
                return true;
            }
        }
        return false;
    }

    function buildCampaignIncludeFilter() {
        let filter = '';
        for (const pattern of CONFIG.TARGET_CAMPAIGN_PATTERNS) {
            filter += 'AND campaign.name REGEXP_MATCH \'(?i).*' + escapeForRegexp(pattern) + '.*\' ';
        }
        return filter;
    }

    function buildAdGroupIncludeFilter() {
        return 'AND ad_group.name REGEXP_MATCH \'(?i).*' +
            escapeForRegexp(CONFIG.DSA_ADGROUP_PATTERN) + '.*\' ';
    }

    function logSummary(counters, allowlistCount, dateFrom, dateTo) {
        const preview = CONFIG.PREVIEW_MODE ? ' (PREVIEW MODE - nothing was changed)' : '';
        Logger.log([
            '',
            '========== Execution Summary' + preview + ' ==========',
            'Window: ' + dateFrom + ' to ' + dateTo,
            'Allowlist entries: ' + allowlistCount,
            'DSA search terms analysed: ' + counters.terms +
            ' (>= ' + CONFIG.MIN_SEARCH_TERM_IMPRESSIONS + ' impressions)',
            'Allowed through: ' + counters.allowed,
            'Skipped:',
            '  ' + counters.skipLength + ' too long (> ' + CONFIG.MAX_TERM_WORDS +
            ' words or > ' + CONFIG.MAX_TERM_CHARS + ' chars)',
            '  ' + counters.skipExists + ' already negated',
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
