/**
 * Search Term Auto Expander
 *
 * Finds high-performing search terms (near-exact close variants) in your Exact
 * and Phrase search campaigns and adds them as proper positive keywords, so you
 * regain bid and URL control over queries Google is already matching loosely.
 *
 * How a search term qualifies:
 *   1. It triggered a keyword in an Exact or Phrase campaign as a NEAR_EXACT
 *      close variant and has at least MIN_SEARCH_TERM_CLICKS clicks.
 *   2. Its text is similar enough to the trigger keyword (Levenshtein-based
 *      similarity after removing FILTER_WORDS and ignoring word order).
 *   3. Its average CPC is high enough relative to the trigger keyword's CPC.
 *   4. It captured a large enough share of the trigger keyword's clicks.
 *
 * Qualifying terms are added to the same ad group with the campaign's match
 * type (exact or phrase), inheriting the trigger keyword's CPC bid (when set at
 * keyword level) and final URL. New keywords are labeled so you can review or
 * undo every addition. Optionally, terms that look like typos (via the Google
 * Custom Search spell checker) get an extra label instead of being skipped —
 * typo traffic is often cheap and worth keeping under control.
 *
 * Setup:
 *   1. Review CONFIG below — especially CAMPAIGNS patterns, which tell the
 *      script how to recognise your Exact and Phrase campaigns by name.
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
    // false: create keywords and labels.
    PREVIEW_MODE: true,

    // How many days of search term data to analyse (ending yesterday).
    LOOKBACK_DAYS: 30,

    // Ignore search terms with fewer clicks than this in the lookback window.
    MIN_SEARCH_TERM_CLICKS: 5,

    // How to recognise your campaigns by name (case-insensitive substrings).
    // A campaign containing EXACT_PATTERN gets exact-match additions; one
    // containing PHRASE_PATTERN gets phrase-match additions. Campaigns whose
    // name contains any EXCLUDE_PATTERNS entry are ignored entirely.
    CAMPAIGNS: {
        EXACT_PATTERN: ' - Exact',
        PHRASE_PATTERN: ' - PH',
        EXCLUDE_PATTERNS: ['DISPLAY', 'SHOPPING', 'PMAX', 'DSA'],
    },

    // Inclusion thresholds per campaign type. A search term must beat ALL
    // three to be added:
    //   MIN_SIMILARITY:   0..1 — how close the term's text must be to the
    //                     trigger keyword (1 = identical after normalisation)
    //   MIN_RELATIVE_CPC: term avg. CPC / keyword avg. CPC must exceed this
    //   MIN_CLICK_SHARE:  term clicks / keyword clicks must exceed this
    THRESHOLDS: {
        EXACT: { MIN_SIMILARITY: 0.7, MIN_RELATIVE_CPC: 0.7, MIN_CLICK_SHARE: 0.1 },
        PHRASE: { MIN_SIMILARITY: 0.7, MIN_RELATIVE_CPC: 0.7, MIN_CLICK_SHARE: 0.1 },
    },

    // Words removed from both the search term and the keyword before
    // similarity is calculated, e.g. brand names, "buy", "cheap", colours.
    FILTER_WORDS: [],

    // Labels applied to created keywords. Created automatically if missing.
    LABELS: {
        ADDED: 'Auto Expand: Added',
        TYPO: 'Auto Expand: Typo',
    },

    // Search terms longer than this are skipped (Google Ads keyword limits).
    MAX_TERM_WORDS: 10,
    MAX_TERM_CHARS: 80,

    // Optional typo detection through the Google Custom Search JSON API's
    // spell correction. Requires your own CSE id and API key:
    //   https://developers.google.com/custom-search/v1/introduction
    TYPO_CHECK: {
        ENABLED: false,
        CSE_ID: '',
        API_KEY: '',
        // Google domain and language of your market, e.g. 'gr' / 'el'.
        GOOGLEHOST: 'com',
        LANG: 'en',
    },

    // Stop analysing this many milliseconds after the script starts, leaving
    // time to commit pending keywords before the 30-minute hard limit.
    MAX_RUNTIME_MS: 27 * 60 * 1000,
};

const MATCH_TYPES = {
    EXACT: 'EXACT',
    PHRASE: 'PHRASE',
};

function main() {
    validateConfig();

    const startTime = Date.now();
    const expander = new AutoExpander(startTime);
    expander.expand();
}

function validateConfig() {
    if (CONFIG.TYPO_CHECK.ENABLED && (!CONFIG.TYPO_CHECK.CSE_ID || !CONFIG.TYPO_CHECK.API_KEY)) {
        throw new Error('TYPO_CHECK is enabled but CSE_ID or API_KEY is empty. ' +
            'Fill both in or set TYPO_CHECK.ENABLED to false.');
    }
    if (!CONFIG.CAMPAIGNS.EXACT_PATTERN && !CONFIG.CAMPAIGNS.PHRASE_PATTERN) {
        throw new Error('At least one of CAMPAIGNS.EXACT_PATTERN / PHRASE_PATTERN must be set.');
    }
}

function AutoExpander(startTime) {

    const regularKeywords = new KeywordBatch([CONFIG.LABELS.ADDED]);
    const typoKeywords = new KeywordBatch([CONFIG.LABELS.ADDED, CONFIG.LABELS.TYPO]);

    this.expand = function () {
        const dateFrom = formattedDate(-CONFIG.LOOKBACK_DAYS);
        const dateTo = formattedDate(-1);
        const campaignFilter = buildCampaignNameFilter();

        // Stats of every active keyword, keyed by criterion id, so each search
        // term can be compared against the keyword that triggered it.
        const keywordStatsByCriterionId = {};
        // Existing keyword texts per ad group, to avoid duplicate additions.
        const existingKeywordTexts = {};

        const counters = {
            searchTerms: 0, activeKeywords: 0, allKeywords: 0,
            exactTerms: 0, phraseTerms: 0,
            skipLength: 0, skipExists: 0, skipSimilarity: 0,
            skipRelativeCpc: 0, skipClickShare: 0, skipNoTrigger: 0,
            addedRegular: 0, addedTypo: 0,
            timedOut: false,
        };

        Logger.log('Collecting active keyword stats (' + dateFrom + ' to ' + dateTo + ')...');
        const keywordRows = AdsApp.search(
            'SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ' +
            'ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ' +
            'ad_group_criterion.keyword.match_type, keyword_view.resource_name, ' +
            'metrics.clicks, metrics.average_cpc, ' +
            'ad_group_criterion.effective_cpc_bid_micros, ad_group_criterion.effective_cpc_bid_source, ' +
            'ad_group_criterion.final_urls ' +
            'FROM keyword_view ' +
            'WHERE campaign.status IN (\'ENABLED\', \'PAUSED\') ' +
            'AND ad_group.status IN (\'ENABLED\', \'PAUSED\') ' +
            campaignFilter +
            'AND metrics.impressions > 0 ' +
            'AND segments.date BETWEEN \'' + dateFrom + '\' AND \'' + dateTo + '\'');
        while (keywordRows.hasNext()) {
            const row = keywordRows.next();
            const criterionId = row.keywordView.resourceName.split('/')[3];
            keywordStatsByCriterionId[criterionId] = row;
            counters.activeKeywords++;
        }

        Logger.log('Collecting existing keywords per ad group...');
        const existingRows = AdsApp.search(
            'SELECT campaign.id, ad_group.id, ad_group_criterion.keyword.text ' +
            'FROM ad_group_criterion ' +
            'WHERE campaign.status IN (\'ENABLED\', \'PAUSED\') ' +
            'AND ad_group.status IN (\'ENABLED\', \'PAUSED\') ' +
            'AND ad_group_criterion.status IN (\'ENABLED\', \'PAUSED\') ' +
            campaignFilter +
            'AND ad_group_criterion.type = \'KEYWORD\' ' +
            'AND ad_group_criterion.negative = false');
        while (existingRows.hasNext()) {
            const row = existingRows.next();
            const adGroupId = row.adGroup.id;
            if (!existingKeywordTexts[adGroupId]) {
                existingKeywordTexts[adGroupId] = {};
            }
            existingKeywordTexts[adGroupId][row.adGroupCriterion.keyword.text] = true;
            counters.allKeywords++;
        }

        Logger.log('Analysing search terms...');
        const termRows = AdsApp.search(
            'SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ' +
            'search_term_view.search_term, segments.keyword.ad_group_criterion, ' +
            'metrics.clicks, metrics.average_cpc ' +
            'FROM search_term_view ' +
            'WHERE campaign.status IN (\'ENABLED\', \'PAUSED\') ' +
            'AND ad_group.status IN (\'ENABLED\', \'PAUSED\') ' +
            campaignFilter +
            'AND metrics.clicks >= ' + CONFIG.MIN_SEARCH_TERM_CLICKS + ' ' +
            'AND segments.search_term_match_type = \'NEAR_EXACT\' ' +
            'AND segments.date BETWEEN \'' + dateFrom + '\' AND \'' + dateTo + '\'');

        while (termRows.hasNext()) {
            const termRow = termRows.next();
            counters.searchTerms++;

            const campaignName = termRow.campaign.name;
            const adGroupId = termRow.adGroup.id;
            const termText = termRow.searchTermView.searchTerm;

            // The campaign name determines the match type of the new keyword.
            let matchType;
            if (containsIgnoreCase(campaignName, CONFIG.CAMPAIGNS.EXACT_PATTERN)) {
                matchType = MATCH_TYPES.EXACT;
                counters.exactTerms++;
            } else if (containsIgnoreCase(campaignName, CONFIG.CAMPAIGNS.PHRASE_PATTERN)) {
                matchType = MATCH_TYPES.PHRASE;
                counters.phraseTerms++;
            } else {
                continue;
            }

            if (termText.split(' ').length > CONFIG.MAX_TERM_WORDS ||
                termText.length > CONFIG.MAX_TERM_CHARS) {
                counters.skipLength++;
                continue;
            }

            if (existingKeywordTexts[adGroupId] && existingKeywordTexts[adGroupId][termText]) {
                counters.skipExists++;
                continue;
            }

            const criterionId = termRow.segments.keyword.adGroupCriterion.split('/')[3];
            const triggerRow = keywordStatsByCriterionId[criterionId];
            if (!triggerRow) {
                // Trigger keyword had no impressions in the window or is outside
                // the analysed campaigns; without its stats there is no baseline.
                counters.skipNoTrigger++;
                continue;
            }

            const triggerText = triggerRow.adGroupCriterion.keyword.text;
            const similarity = keywordSimilarity(termText, triggerText);
            if (similarity <= CONFIG.THRESHOLDS[matchType].MIN_SIMILARITY) {
                counters.skipSimilarity++;
                continue;
            }

            const relativeCpc = termRow.metrics.averageCpc / triggerRow.metrics.averageCpc;
            if (relativeCpc <= CONFIG.THRESHOLDS[matchType].MIN_RELATIVE_CPC) {
                counters.skipRelativeCpc++;
                continue;
            }

            const clickShare = termRow.metrics.clicks / triggerRow.metrics.clicks;
            if (clickShare <= CONFIG.THRESHOLDS[matchType].MIN_CLICK_SHARE) {
                counters.skipClickShare++;
                continue;
            }

            // Inherit the trigger keyword's bid only when it is set at keyword
            // level; otherwise leave the ad group default in charge.
            let cpcBid = 0;
            if (triggerRow.adGroupCriterion.effectiveCpcBidSource === 'AD_GROUP_CRITERION') {
                cpcBid = round(triggerRow.adGroupCriterion.effectiveCpcBidMicros / 1000000, 2);
            }
            const finalUrls = triggerRow.adGroupCriterion.finalUrls;
            const finalUrl = (finalUrls && finalUrls.length > 0) ? finalUrls[0] : '';

            const isTypo = CONFIG.TYPO_CHECK.ENABLED && looksLikeTypo(termText);
            const batch = isTypo ? typoKeywords : regularKeywords;
            batch.add(adGroupId, termText, matchType, cpcBid, finalUrl);
            if (isTypo) {
                counters.addedTypo++;
            } else {
                counters.addedRegular++;
            }
            Logger.log('Queueing [' + matchType + '] "' + termText + '" (from keyword "' +
                triggerText + '", similarity ' + round(similarity, 2) + ', relative CPC ' +
                round(relativeCpc, 2) + ', click share ' + round(clickShare, 2) + ')');

            if (Date.now() - startTime > CONFIG.MAX_RUNTIME_MS) {
                counters.timedOut = true;
                Logger.log('Approaching the execution time limit - committing what was analysed so far.');
                break;
            }
        }

        if (!CONFIG.PREVIEW_MODE && (counters.addedRegular + counters.addedTypo) > 0) {
            ensureLabels();
        }
        regularKeywords.flush();
        typoKeywords.flush();

        logSummary(counters, dateFrom, dateTo);
    };

    /**
     * Normalises both texts (filter words removed, whitespace collapsed,
     * lowercased, tokens sorted so word order is ignored), then converts the
     * Levenshtein distance into a 0..1 similarity relative to keyword length.
     */
    function keywordSimilarity(termText, keywordText) {
        const term = normalizeForComparison(termText);
        const keyword = normalizeForComparison(keywordText);
        if (keyword.length === 0) {
            return 0;
        }
        return 1 - levenshtein(term, keyword) / keyword.length;
    }

    function normalizeForComparison(text) {
        let padded = ' ' + text.toLowerCase() + ' ';
        for (const word of CONFIG.FILTER_WORDS) {
            padded = padded.replace(' ' + word.toLowerCase() + ' ', ' ');
        }
        return padded.trim().replace(/\s+/g, ' ').split(' ').sort().join('');
    }

    /**
     * Asks the Google Custom Search API for a spell correction; a correction
     * that differs after whitespace removal marks the term as a typo.
     */
    function looksLikeTypo(termText) {
        const correction = getSpellCorrection(termText);
        if (correction === undefined) {
            return false;
        }
        const distance = levenshtein(termText.replace(/ /g, ''), correction.replace(/ /g, ''));
        return (1 - distance / correction.length).toFixed(2) != 1;
    }

    function getSpellCorrection(query) {
        const params = 'cx=' + CONFIG.TYPO_CHECK.CSE_ID +
            '&key=' + CONFIG.TYPO_CHECK.API_KEY +
            '&googlehost=' + CONFIG.TYPO_CHECK.GOOGLEHOST +
            '&gl=' + CONFIG.TYPO_CHECK.LANG +
            '&q=' + encodeURIComponent(query) + '&alt=json&num=1';
        let response;
        try {
            response = JSON.parse(UrlFetchApp
                .fetch('https://www.googleapis.com/customsearch/v1?' + params)
                .getContentText());
        } catch (e) {
            Logger.log('Typo check failed for "' + query + '" (' + e.message +
                ') - treating as not a typo.');
            return undefined;
        }
        if (response.spelling === undefined) {
            return undefined;
        }
        return response.spelling.correctedQuery.replace(',', ' ').replace('.', ' ');
    }

    function ensureLabels() {
        const wanted = [CONFIG.LABELS.ADDED, CONFIG.LABELS.TYPO];
        const existing = {};
        const labelIterator = AdsApp.labels().get();
        while (labelIterator.hasNext()) {
            existing[labelIterator.next().getName()] = true;
        }
        for (const name of wanted) {
            if (!existing[name]) {
                AdsApp.createLabel(name);
            }
        }
    }

    function buildCampaignNameFilter() {
        let filter = '';
        for (const pattern of CONFIG.CAMPAIGNS.EXCLUDE_PATTERNS) {
            filter += 'AND campaign.name NOT REGEXP_MATCH \'(?i).*' + escapeForRegexp(pattern) + '.*\' ';
        }
        return filter;
    }

    function logSummary(counters, dateFrom, dateTo) {
        const preview = CONFIG.PREVIEW_MODE ? ' (PREVIEW MODE - nothing was changed)' : '';
        Logger.log([
            '',
            '========== Execution Summary' + preview + ' ==========',
            'Window: ' + dateFrom + ' to ' + dateTo,
            'Active keywords collected: ' + counters.activeKeywords +
            ' (account total analysed: ' + counters.allKeywords + ')',
            'Search terms analysed: ' + counters.searchTerms +
            ' (>= ' + CONFIG.MIN_SEARCH_TERM_CLICKS + ' clicks, NEAR_EXACT)',
            '  In exact campaigns: ' + counters.exactTerms +
            ' | in phrase campaigns: ' + counters.phraseTerms,
            'Skipped:',
            '  ' + counters.skipLength + ' too long (> ' + CONFIG.MAX_TERM_WORDS +
            ' words or > ' + CONFIG.MAX_TERM_CHARS + ' chars)',
            '  ' + counters.skipExists + ' already exist as keywords',
            '  ' + counters.skipNoTrigger + ' without trigger keyword stats',
            '  ' + counters.skipSimilarity + ' below similarity threshold',
            '  ' + counters.skipRelativeCpc + ' below relative CPC threshold',
            '  ' + counters.skipClickShare + ' below click share threshold',
            (counters.timedOut ? 'Stopped early near the execution time limit.' : ''),
            'Keywords ' + (CONFIG.PREVIEW_MODE ? 'that would be added' : 'added') + ': ' +
            counters.addedRegular + ' regular, ' + counters.addedTypo + ' typos',
            '====================================================',
        ].join('\n'));
    }
}

/**
 * Collects keywords and creates them in batches, applying labels to each
 * successfully created keyword. In PREVIEW_MODE nothing is written.
 */
function KeywordBatch(labelNames) {
    const BATCH_SIZE = 5000;
    let adGroupIds = [];
    let keywordsByAdGroup = {};

    this.add = function (adGroupId, keywordText, matchType, cpcBid, finalUrl) {
        if (!keywordsByAdGroup[adGroupId]) {
            keywordsByAdGroup[adGroupId] = [];
        }
        keywordsByAdGroup[adGroupId].push({
            text: keywordText,
            matchType: matchType,
            cpcBid: cpcBid,
            finalUrl: finalUrl,
        });
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
        const operations = [];
        const uniqueAdGroupIds = adGroupIds.filter(function (v, i, a) {
            return a.indexOf(v) === i;
        });

        const adGroups = AdsApp.adGroups().withIds(uniqueAdGroupIds).get();
        while (adGroups.hasNext()) {
            const adGroup = adGroups.next();
            const pending = keywordsByAdGroup[adGroup.getId()];
            const seen = {};
            for (const keyword of pending) {
                if (seen[keyword.text]) {
                    continue;
                }
                seen[keyword.text] = true;

                const builder = adGroup.newKeywordBuilder()
                    .withText(decorateKeywordText(keyword.text, keyword.matchType));
                if (keyword.cpcBid > 0) {
                    builder.withCpc(keyword.cpcBid);
                }
                if (keyword.finalUrl) {
                    builder.withFinalUrl(keyword.finalUrl);
                }
                operations.push(builder.build());
            }
        }

        for (const operation of operations) {
            if (operation.isSuccessful()) {
                const created = operation.getResult();
                for (const labelName of labelNames) {
                    created.applyLabel(labelName);
                }
            } else {
                Logger.log('Keyword creation failed: ' + JSON.stringify(operation.getErrors()));
            }
        }
    }

    function decorateKeywordText(text, matchType) {
        if (matchType === MATCH_TYPES.EXACT) {
            return '[' + text + ']';
        }
        if (matchType === MATCH_TYPES.PHRASE) {
            return '"' + text + '"';
        }
        return text;
    }
}

function formattedDate(daysShift) {
    const date = new Date();
    date.setDate(date.getDate() + daysShift);
    return Utilities.formatDate(date, AdsApp.currentAccount().getTimeZone(), 'yyyy-MM-dd');
}

function containsIgnoreCase(haystack, needle) {
    return Boolean(needle) && haystack.toLowerCase().indexOf(needle.toLowerCase()) !== -1;
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
