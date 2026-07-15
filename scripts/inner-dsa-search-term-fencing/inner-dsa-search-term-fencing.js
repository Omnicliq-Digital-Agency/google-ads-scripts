/**
 * Inner DSA Search Term Fencing
 *
 * In a layered DSA structure (see docs/DSA-LAYERING.md) every keyword
 * campaign carries an inner DSA ad group that catches the campaign's
 * long-tail queries. The inner DSA earns its keep on queries the keywords
 * DON'T cover - so when a query serves from both the keyword ad groups and
 * the inner DSA, the DSA is cannibalising, not catching. This script fences
 * it: search terms served by keyword ad groups become negative exact
 * keywords in the inner DSA ad groups that also matched them - with two
 * deliberate exceptions.
 *
 * The exceptions:
 *   - Cheaper in DSA: when the inner DSA gets the term at a lower CPC than
 *     the keyword side, it keeps the term.
 *   - Competitor terms: queries containing a competitor brand stay with
 *     the DSA - keyword campaigns don't bid on competitors, so the inner
 *     DSA is exactly where that traffic belongs. The registry comes from
 *     CONFIG.COMPETITORS and/or a shared negative keyword list.
 *
 * With GROUP_BY_COUNTRY, terms only overlap when both campaigns target the
 * same country.
 *
 * Setup:
 *   1. Review CONFIG below - DSA_ADGROUP_PATTERN must match how your inner
 *      DSA ad groups are named.
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

    // How to recognise the inner DSA ad groups by name (case-insensitive
    // substring).
    DSA_ADGROUP_PATTERN: 'DSA',

    // Campaigns whose name contains any of these are skipped entirely
    // (incl. outer catch-all DSA campaigns - those are handled by the
    // dsa-search-term-fencing script).
    CAMPAIGN_EXCLUDE_PATTERNS: ['DSA', 'SHOPPING', 'PMAX'],

    // Competitor terms stay with the DSA. Names are matched on word
    // boundaries, case-insensitively; the optional shared negative keyword
    // list is read purely as a registry.
    COMPETITORS: [],
    COMPETITOR_LIST_NAME: '',

    // How many days of search term data to analyse (ending yesterday).
    LOOKBACK_DAYS: 30,

    // Ignore keyword-side search terms with fewer impressions than this.
    MIN_SEARCH_TERM_IMPRESSIONS: 10,

    // Only fence when both campaigns target the same country. Disable in
    // single-market accounts to skip the geo lookups entirely.
    GROUP_BY_COUNTRY: true,

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
    const fencer = new InnerDsaFencer(startTime);
    fencer.fence();
}

function validateConfig() {
    if (!CONFIG.DSA_ADGROUP_PATTERN) {
        throw new Error('DSA_ADGROUP_PATTERN must be set - the script needs to ' +
            'recognise the inner DSA ad groups by name.');
    }
}

function InnerDsaFencer(startTime) {

    const negativeKeywords = new NegativeKeywordBatch();

    this.fence = function () {
        const dateFrom = formattedDate(-CONFIG.LOOKBACK_DAYS);
        const dateTo = formattedDate(-1);
        const competitors = collectCompetitors();
        const countryByCampaignName = CONFIG.GROUP_BY_COUNTRY ? mapCampaignCountries() : {};

        // Inner DSA search terms grouped by country, holding per-term CPC
        // and every inner DSA ad group that matched it.
        const dsaTermsByCountry = {};
        // Existing negative texts per inner DSA ad group id.
        const dsaNegativeTexts = {};

        const counters = {
            dsaTerms: 0, dsaNegatives: 0, keywordTerms: 0, overlaps: 0,
            skipLength: 0, skipExists: 0, skipNoCpc: 0, skipDsaCheaper: 0,
            skipCompetitor: 0,
            termsFenced: 0, negativesQueued: 0,
            timedOut: false,
        };

        Logger.log('Collecting inner DSA search terms (' + dateFrom + ' to ' + dateTo + ')...');
        const dsaTermRows = AdsApp.search(
            'SELECT campaign.name, ad_group.id, search_term_view.search_term, ' +
            'metrics.impressions, metrics.average_cpc ' +
            'FROM search_term_view ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            'AND ad_group.status IN (\'ENABLED\', \'PAUSED\') ' +
            buildCampaignExcludeFilter() +
            'AND ad_group.name REGEXP_MATCH \'(?i).*' +
            escapeForRegexp(CONFIG.DSA_ADGROUP_PATTERN) + '.*\' ' +
            'AND metrics.impressions >= 1 ' +
            'AND segments.date BETWEEN \'' + dateFrom + '\' AND \'' + dateTo + '\' ' +
            'ORDER BY metrics.impressions DESC');
        while (dsaTermRows.hasNext()) {
            const row = dsaTermRows.next();
            counters.dsaTerms++;
            const country = countryByCampaignName[row.campaign.name] || '';
            const term = row.searchTermView.searchTerm;
            if (!dsaTermsByCountry[country]) {
                dsaTermsByCountry[country] = {};
            }
            if (!dsaTermsByCountry[country][term]) {
                dsaTermsByCountry[country][term] = {
                    averageCpc: row.metrics.averageCpc,
                    adGroupIds: [],
                };
            }
            dsaTermsByCountry[country][term].adGroupIds.push(row.adGroup.id);
        }

        Logger.log('Collecting existing inner DSA negatives...');
        const negativeRows = AdsApp.search(
            'SELECT ad_group.id, ad_group_criterion.keyword.text ' +
            'FROM ad_group_criterion ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            'AND ad_group.status IN (\'ENABLED\', \'PAUSED\') ' +
            buildCampaignExcludeFilter() +
            'AND ad_group.name REGEXP_MATCH \'(?i).*' +
            escapeForRegexp(CONFIG.DSA_ADGROUP_PATTERN) + '.*\' ' +
            'AND ad_group_criterion.type = \'KEYWORD\' ' +
            'AND ad_group_criterion.negative = true');
        while (negativeRows.hasNext()) {
            const row = negativeRows.next();
            if (row.adGroupCriterion.keyword === undefined) {
                continue;
            }
            counters.dsaNegatives++;
            if (!dsaNegativeTexts[row.adGroup.id]) {
                dsaNegativeTexts[row.adGroup.id] = {};
            }
            dsaNegativeTexts[row.adGroup.id][row.adGroupCriterion.keyword.text] = true;
        }

        Logger.log('Checking keyword ad group search terms for overlaps...');
        const keywordTermRows = AdsApp.search(
            'SELECT campaign.name, search_term_view.search_term, metrics.average_cpc ' +
            'FROM search_term_view ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            'AND ad_group.status = \'ENABLED\' ' +
            buildCampaignExcludeFilter() +
            'AND ad_group.name NOT REGEXP_MATCH \'(?i).*' +
            escapeForRegexp(CONFIG.DSA_ADGROUP_PATTERN) + '.*\' ' +
            'AND metrics.impressions >= ' + CONFIG.MIN_SEARCH_TERM_IMPRESSIONS + ' ' +
            'AND segments.date BETWEEN \'' + dateFrom + '\' AND \'' + dateTo + '\'');

        const fencedPerGroup = {};
        while (keywordTermRows.hasNext()) {
            const row = keywordTermRows.next();
            counters.keywordTerms++;
            const term = row.searchTermView.searchTerm;

            if (term.split(' ').length > CONFIG.MAX_TERM_WORDS ||
                term.length > CONFIG.MAX_TERM_CHARS) {
                counters.skipLength++;
                continue;
            }

            const country = countryByCampaignName[row.campaign.name] || '';
            const dsaTerm = dsaTermsByCountry[country] && dsaTermsByCountry[country][term];
            if (!dsaTerm) {
                continue;
            }
            counters.overlaps++;

            if (findCompetitor(term, competitors)) {
                counters.skipCompetitor++;
                continue;
            }
            if (!dsaTerm.averageCpc || !row.metrics.averageCpc) {
                counters.skipNoCpc++;
                continue;
            }
            if (dsaTerm.averageCpc < row.metrics.averageCpc) {
                counters.skipDsaCheaper++;
                continue;
            }

            let queuedAny = false;
            for (const adGroupId of dsaTerm.adGroupIds) {
                if (fencedPerGroup[adGroupId + '|' + term]) {
                    continue;
                }
                if (dsaNegativeTexts[adGroupId] && dsaNegativeTexts[adGroupId][term]) {
                    continue;
                }
                fencedPerGroup[adGroupId + '|' + term] = true;
                negativeKeywords.add(adGroupId, term);
                counters.negativesQueued++;
                queuedAny = true;
            }
            if (queuedAny) {
                counters.termsFenced++;
                Logger.log('Fencing "' + term + '" out of ' + dsaTerm.adGroupIds.length +
                    ' inner DSA ad group(s)');
            } else {
                counters.skipExists++;
            }

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
     * Merges CONFIG.COMPETITORS with the optional shared-list registry,
     * lowercased and deduplicated.
     */
    function collectCompetitors() {
        const seen = {};
        const competitors = [];
        const register = function (name) {
            const clean = String(name).replace(/^["\[]|["\]]$/g, '').toLowerCase().trim();
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
                register(entries.next().getText());
            }
        }

        return competitors;
    }

    function findCompetitor(term, competitors) {
        const padded = ' ' + term.toLowerCase() + ' ';
        for (const competitor of competitors) {
            if (padded.indexOf(' ' + competitor + ' ') !== -1) {
                return competitor;
            }
        }
        return undefined;
    }

    /**
     * Maps each enabled campaign's name to the country code of its (first)
     * positive location target, resolving only the geo target constants
     * campaigns actually use.
     */
    function mapCampaignCountries() {
        const geoResourceByCampaignName = {};
        const usedGeoResources = {};
        const targetRows = AdsApp.search(
            'SELECT campaign.name, campaign_criterion.location.geo_target_constant ' +
            'FROM campaign_criterion ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            'AND campaign_criterion.type = \'LOCATION\' ' +
            'AND campaign_criterion.negative = \'false\'');
        while (targetRows.hasNext()) {
            const row = targetRows.next();
            const resource = row.campaignCriterion.location.geoTargetConstant;
            if (geoResourceByCampaignName[row.campaign.name] === undefined) {
                geoResourceByCampaignName[row.campaign.name] = resource;
                usedGeoResources[resource] = true;
            }
        }

        const resources = Object.keys(usedGeoResources);
        const countryByResource = {};
        if (resources.length > 0) {
            const geoRows = AdsApp.search(
                'SELECT geo_target_constant.resource_name, geo_target_constant.country_code ' +
                'FROM geo_target_constant ' +
                'WHERE geo_target_constant.resource_name IN (\'' + resources.join('\', \'') + '\')');
            while (geoRows.hasNext()) {
                const row = geoRows.next();
                countryByResource[row.geoTargetConstant.resourceName] =
                    row.geoTargetConstant.countryCode;
            }
        }

        const countryByCampaignName = {};
        for (const campaignName in geoResourceByCampaignName) {
            countryByCampaignName[campaignName] =
                countryByResource[geoResourceByCampaignName[campaignName]] || '';
        }
        return countryByCampaignName;
    }

    function buildCampaignExcludeFilter() {
        let filter = '';
        for (const pattern of CONFIG.CAMPAIGN_EXCLUDE_PATTERNS) {
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
            'Inner DSA terms collected: ' + counters.dsaTerms +
            ' | existing inner DSA negatives: ' + counters.dsaNegatives,
            'Competitor names: ' + competitorCount,
            'Keyword ad group terms analysed: ' + counters.keywordTerms +
            ' (>= ' + CONFIG.MIN_SEARCH_TERM_IMPRESSIONS + ' impressions)',
            'Overlapping terms: ' + counters.overlaps,
            'Skipped:',
            '  ' + counters.skipLength + ' too long (> ' + CONFIG.MAX_TERM_WORDS +
            ' words or > ' + CONFIG.MAX_TERM_CHARS + ' chars)',
            '  ' + counters.skipCompetitor + ' contain a competitor (DSA keeps them)',
            '  ' + counters.skipExists + ' already fully fenced',
            '  ' + counters.skipNoCpc + ' without comparable CPCs',
            '  ' + counters.skipDsaCheaper + ' cheaper in DSA (DSA keeps them)',
            (counters.timedOut ? 'Stopped early near the execution time limit.' : ''),
            'Terms ' + (CONFIG.PREVIEW_MODE ? 'that would be fenced' : 'fenced') + ': ' +
            counters.termsFenced + ' (' + counters.negativesQueued +
            ' negatives across inner DSA ad groups)',
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
