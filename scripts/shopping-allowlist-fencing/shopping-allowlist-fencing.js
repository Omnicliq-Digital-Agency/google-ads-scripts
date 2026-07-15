/**
 * Shopping Allowlist Fencing
 *
 * A themed shopping campaign - brand terms, a product line, a category -
 * only stays themed if you keep fencing it. Product ads match whatever
 * Google decides is relevant, so off-theme queries leak in daily and drag
 * the campaign's ROAS with them. This script automates the fence: every
 * search term that does not match your allowlist becomes a negative exact
 * keyword, and when the campaign's negative capacity fills up, the overflow
 * goes into auto-created shared negative keyword lists attached to the same
 * campaigns.
 *
 * How a search term is judged:
 *   1. Search terms of the target campaigns (TARGET_CAMPAIGN_PATTERNS) are
 *      collected over the lookback window.
 *   2. A term matching the allowlist survives. With MATCH_MODE 'CONTAINS'
 *      (default) it survives when it contains any allowlist entry on word
 *      boundaries; with 'EXACT' it must equal an entry.
 *   3. Everything else becomes a negative exact ([term]) on the campaign -
 *      or, when the campaign's negative keyword capacity is exhausted, on a
 *      'PREFIX (n)' shared list that the script creates and attaches
 *      automatically.
 *
 * The allowlist lives in CONFIG.ALLOWED_TERMS and/or a shared negative
 * keyword list used purely as a registry (ALLOWLIST_NAME) - maintained in
 * the UI, never attached to campaigns.
 *
 * Setup:
 *   1. Set TARGET_CAMPAIGN_PATTERNS to identify the fenced campaigns, and
 *      fill the allowlist.
 *   2. Run with PREVIEW_MODE: true first. Read the execution summary in the
 *      logs; nothing is changed in the account.
 *   3. Set PREVIEW_MODE: false and schedule (daily or weekly).
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
    // false: create negative keywords and overflow lists.
    PREVIEW_MODE: true,

    // Name substrings identifying the shopping campaigns to fence. A
    // campaign must contain ALL patterns (e.g. ['SHOPPING', 'Brands']).
    TARGET_CAMPAIGN_PATTERNS: ['SHOPPING', 'Brands'],

    // Terms that are allowed to trigger the campaigns (case-insensitive).
    ALLOWED_TERMS: [],

    // Optional: also read allowed terms from this shared negative keyword
    // list, used purely as a registry maintained in the UI (do not attach
    // it to campaigns).
    ALLOWLIST_NAME: '',

    // 'CONTAINS': a term survives when it contains any allowlist entry on
    // word boundaries ('nike shoes' survives with 'nike' allowed).
    // 'EXACT': a term survives only when it equals an entry.
    MATCH_MODE: 'CONTAINS',

    // Overflow lists are named '<PREFIX> (1)', '<PREFIX> (2)', ...
    OVERFLOW_LIST_PREFIX: 'Allowlist Fence',

    // Google Ads capacity limits the fence works within.
    CAMPAIGN_NEGATIVE_CAPACITY: 10000,
    LIST_CAPACITY: 5000,

    // How many days of search term data to analyse (ending yesterday).
    LOOKBACK_DAYS: 30,

    // Ignore search terms with fewer impressions than this.
    MIN_SEARCH_TERM_IMPRESSIONS: 1,

    // Search terms longer than this are skipped (Google Ads keyword limits).
    MAX_TERM_WORDS: 10,
    MAX_TERM_CHARS: 80,

    // Stop analysing this many milliseconds after the script starts.
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
    if (CONFIG.ALLOWED_TERMS.length === 0 && !CONFIG.ALLOWLIST_NAME) {
        throw new Error('No allowlist configured - fill in ALLOWED_TERMS or ALLOWLIST_NAME. ' +
            'An empty allowlist would negate every search term.');
    }
    if (CONFIG.MATCH_MODE !== 'CONTAINS' && CONFIG.MATCH_MODE !== 'EXACT') {
        throw new Error('MATCH_MODE must be \'CONTAINS\' or \'EXACT\'.');
    }
}

function AllowlistFencer(startTime) {

    this.fence = function () {
        const dateFrom = formattedDate(-CONFIG.LOOKBACK_DAYS);
        const dateTo = formattedDate(-1);

        const allowlist = collectAllowlist();
        Logger.log(allowlist.length + ' allowlist entries loaded.');

        const targetCampaigns = getTargetCampaigns();
        if (targetCampaigns.length === 0) {
            Logger.log('No enabled campaigns match TARGET_CAMPAIGN_PATTERNS ' +
                JSON.stringify(CONFIG.TARGET_CAMPAIGN_PATTERNS) + '. Exiting.');
            return;
        }

        // All texts already negated - on the campaigns or on overflow lists.
        const existingNegatives = collectExistingNegatives();

        const counters = {
            terms: 0, allowed: 0,
            skipLength: 0, skipExists: 0,
            toCampaign: 0, toList: 0, listsCreated: 0,
            timedOut: false,
        };

        // campaign id -> terms to negate there.
        const termsByCampaignId = {};

        Logger.log('Analysing search terms (' + dateFrom + ' to ' + dateTo + ')...');
        const termRows = AdsApp.search(
            'SELECT campaign.id, campaign.name, search_term_view.search_term ' +
            'FROM search_term_view ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            buildCampaignIncludeFilter() +
            'AND metrics.impressions >= ' + CONFIG.MIN_SEARCH_TERM_IMPRESSIONS + ' ' +
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

            if (isAllowed(term, allowlist)) {
                counters.allowed++;
                continue;
            }

            if (existingNegatives[term]) {
                counters.skipExists++;
                continue;
            }
            existingNegatives[term] = true;

            const campaignId = row.campaign.id;
            if (!termsByCampaignId[campaignId]) {
                termsByCampaignId[campaignId] = [];
            }
            termsByCampaignId[campaignId].push(term);
            Logger.log('Fencing "' + term + '" out of "' + row.campaign.name + '"');

            if (Date.now() - startTime > CONFIG.MAX_RUNTIME_MS) {
                counters.timedOut = true;
                Logger.log('Approaching the execution time limit - committing what was analysed so far.');
                break;
            }
        }

        commit(targetCampaigns, termsByCampaignId, counters);

        logSummary(counters, allowlist.length, dateFrom, dateTo);
    };

    /**
     * Adds each campaign's terms as negative exact: campaign first while it
     * has capacity, then the newest overflow list, creating new lists (and
     * attaching them to every target campaign) as they fill up.
     */
    function commit(targetCampaigns, termsByCampaignId, counters) {
        const overflow = new OverflowLists(targetCampaigns, counters);

        for (const campaign of targetCampaigns) {
            const terms = termsByCampaignId[campaign.getId()];
            if (!terms) {
                continue;
            }
            let campaignAllowance = CONFIG.CAMPAIGN_NEGATIVE_CAPACITY -
                countCampaignNegatives(campaign.getId());

            for (const term of terms) {
                if (campaignAllowance > 0) {
                    if (!CONFIG.PREVIEW_MODE) {
                        campaign.createNegativeKeyword('[' + term + ']');
                    }
                    campaignAllowance--;
                    counters.toCampaign++;
                } else {
                    overflow.add(term);
                    counters.toList++;
                }
            }
        }
    }

    /**
     * Manages '<PREFIX> (n)' shared lists: fills the newest one, creates and
     * attaches the next when it is full.
     */
    function OverflowLists(targetCampaigns, counters) {
        let index = 0;
        let allowance = 0;
        let currentList = null;

        const existing = AdsApp.negativeKeywordLists()
            .withCondition('Name CONTAINS \'' + CONFIG.OVERFLOW_LIST_PREFIX + '\'')
            .orderBy('Name ASC')
            .get();
        while (existing.hasNext()) {
            const list = existing.next();
            index++;
            currentList = list;
            allowance = CONFIG.LIST_CAPACITY - list.negativeKeywords().get().totalNumEntities();
        }

        this.add = function (term) {
            if (CONFIG.PREVIEW_MODE) {
                return;
            }
            if (allowance <= 0) {
                createNextList();
            }
            currentList.addNegativeKeyword('[' + term + ']');
            allowance--;
        };

        function createNextList() {
            index++;
            const operation = AdsApp.newNegativeKeywordListBuilder()
                .withName(CONFIG.OVERFLOW_LIST_PREFIX + ' (' + index + ')')
                .build();
            if (!operation.isSuccessful()) {
                throw new Error('Could not create overflow list: ' +
                    JSON.stringify(operation.getErrors()));
            }
            currentList = operation.getResult();
            allowance = CONFIG.LIST_CAPACITY;
            counters.listsCreated++;
            for (const campaign of targetCampaigns) {
                campaign.addNegativeKeywordList(currentList);
            }
            Logger.log('Created and attached overflow list "' + currentList.getName() + '"');
        }
    }

    function getTargetCampaigns() {
        let selector = AdsApp.shoppingCampaigns()
            .withCondition('Status = \'ENABLED\'');
        for (const pattern of CONFIG.TARGET_CAMPAIGN_PATTERNS) {
            selector = selector.withCondition('Name CONTAINS \'' + pattern + '\'');
        }
        const campaigns = [];
        const iterator = selector.get();
        while (iterator.hasNext()) {
            campaigns.push(iterator.next());
        }
        return campaigns;
    }

    function collectExistingNegatives() {
        const existing = {};

        const negativeRows = AdsApp.search(
            'SELECT campaign.name, campaign_criterion.keyword.text ' +
            'FROM campaign_criterion ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            buildCampaignIncludeFilter() +
            'AND campaign_criterion.type = \'KEYWORD\' ' +
            'AND campaign_criterion.negative = true');
        while (negativeRows.hasNext()) {
            const row = negativeRows.next();
            if (row.campaignCriterion.keyword !== undefined) {
                existing[stripMatchType(row.campaignCriterion.keyword.text)] = true;
            }
        }

        const lists = AdsApp.negativeKeywordLists()
            .withCondition('Name CONTAINS \'' + CONFIG.OVERFLOW_LIST_PREFIX + '\'')
            .get();
        while (lists.hasNext()) {
            const entries = lists.next().negativeKeywords().get();
            while (entries.hasNext()) {
                existing[stripMatchType(entries.next().getText())] = true;
            }
        }

        return existing;
    }

    function countCampaignNegatives(campaignId) {
        const rows = AdsApp.search(
            'SELECT campaign_criterion.keyword.text ' +
            'FROM campaign_criterion ' +
            'WHERE campaign.id = ' + campaignId + ' ' +
            'AND campaign_criterion.type = \'KEYWORD\' ' +
            'AND campaign_criterion.negative = true');
        let count = 0;
        while (rows.hasNext()) {
            rows.next();
            count++;
        }
        return count;
    }

    function collectAllowlist() {
        const seen = {};
        const allowlist = [];
        const register = function (text) {
            const clean = stripMatchType(String(text)).toLowerCase().trim();
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
        const lower = term.toLowerCase();
        if (CONFIG.MATCH_MODE === 'EXACT') {
            return allowlist.indexOf(lower) !== -1;
        }
        const padded = ' ' + lower + ' ';
        for (const entry of allowlist) {
            if (padded.indexOf(' ' + entry + ' ') !== -1) {
                return true;
            }
        }
        return false;
    }

    function stripMatchType(text) {
        return text.replace(/^["\[]|["\]]$/g, '');
    }

    function buildCampaignIncludeFilter() {
        let filter = '';
        for (const pattern of CONFIG.TARGET_CAMPAIGN_PATTERNS) {
            filter += 'AND campaign.name REGEXP_MATCH \'(?i).*' + escapeForRegexp(pattern) + '.*\' ';
        }
        return filter;
    }

    function logSummary(counters, allowlistCount, dateFrom, dateTo) {
        const preview = CONFIG.PREVIEW_MODE ? ' (PREVIEW MODE - nothing was changed)' : '';
        Logger.log([
            '',
            '========== Execution Summary' + preview + ' ==========',
            'Window: ' + dateFrom + ' to ' + dateTo,
            'Allowlist entries: ' + allowlistCount + ' (' + CONFIG.MATCH_MODE + ' matching)',
            'Search terms analysed: ' + counters.terms +
            ' (>= ' + CONFIG.MIN_SEARCH_TERM_IMPRESSIONS + ' impressions)',
            'Allowed through: ' + counters.allowed,
            'Skipped:',
            '  ' + counters.skipLength + ' too long (> ' + CONFIG.MAX_TERM_WORDS +
            ' words or > ' + CONFIG.MAX_TERM_CHARS + ' chars)',
            '  ' + counters.skipExists + ' already negated',
            (counters.timedOut ? 'Stopped early near the execution time limit.' : ''),
            'Negatives ' + (CONFIG.PREVIEW_MODE ? 'that would be added' : 'added') + ': ' +
            counters.toCampaign + ' on campaigns, ' + counters.toList +
            ' on overflow lists (' + counters.listsCreated + ' new lists)',
            '====================================================',
        ].join('\n'));
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
