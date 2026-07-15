/**
 * DSA Search Term Fencing
 *
 * Dynamic Search Ads are great at finding queries you didn't think of — and
 * just as good at quietly taking over queries your keyword campaigns already
 * serve. When both serve the same search term you pay twice to compete with
 * yourself, and reporting splits across campaigns. This script fences the
 * DSA side: search terms that appear in both a keyword campaign and a DSA
 * campaign are added as negative exact keywords to the DSA ad groups that
 * matched them — unless DSA gets the term at a cheaper CPC, in which case it
 * keeps it.
 *
 * How a search term is fenced:
 *   1. Search terms from DSA campaigns and from keyword (non-DSA) campaigns
 *      are collected over the lookback window.
 *   2. With GROUP_BY_COUNTRY enabled, terms only overlap when both campaigns
 *      target the same country — a Greek and a Cypriot campaign can share
 *      terms without fencing each other.
 *   3. An overlapping term is skipped when it is already a negative, when
 *      either side has no CPC to compare, or when the DSA side's average CPC
 *      is lower (DSA earns the term).
 *   4. Everything else is added as a negative exact match ([term]) to every
 *      DSA ad group that matched the term.
 *
 * Setup:
 *   1. Review CONFIG below — DSA_CAMPAIGN_PATTERN must match how your DSA
 *      campaigns are named.
 *   2. Run with PREVIEW_MODE: true first. Read the execution summary in the
 *      logs; nothing is changed in the account.
 *   3. Set PREVIEW_MODE: false and schedule (weekly is a good cadence for
 *      search term data).
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

    // How to recognise DSA campaigns by name (case-insensitive substring).
    DSA_CAMPAIGN_PATTERN: 'DSA',

    // Keyword-side campaigns whose name contains any of these substrings are
    // ignored (their terms never fence the DSA side).
    CAMPAIGN_EXCLUDE_PATTERNS: ['SHOPPING', 'PMAX'],

    // How many days of search term data to analyse (ending yesterday).
    LOOKBACK_DAYS: 30,

    // Ignore keyword-side search terms with fewer impressions than this.
    MIN_SEARCH_TERM_IMPRESSIONS: 10,

    // Only fence when both campaigns target the same country. Disable in
    // single-market accounts to skip the geo lookups entirely. Campaigns
    // targeting several countries are grouped under one of them.
    GROUP_BY_COUNTRY: true,

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
    const fencer = new DsaFencer(startTime);
    fencer.fence();
}

function validateConfig() {
    if (!CONFIG.DSA_CAMPAIGN_PATTERN) {
        throw new Error('DSA_CAMPAIGN_PATTERN must be set - the script needs to ' +
            'recognise your DSA campaigns by name.');
    }
}

function DsaFencer(startTime) {

    const negativeKeywords = new NegativeKeywordBatch();

    this.fence = function () {
        const dateFrom = formattedDate(-CONFIG.LOOKBACK_DAYS);
        const dateTo = formattedDate(-1);
        // '' groups everything together when country grouping is off.
        const countryByCampaignName = CONFIG.GROUP_BY_COUNTRY ? mapCampaignCountries() : {};

        // DSA search terms grouped by country, holding CPC and the ad groups
        // that matched each term.
        const dsaTermsByCountry = {};
        // Existing negative texts per DSA ad group id.
        const dsaNegativeTexts = {};

        const counters = {
            dsaTerms: 0, dsaNegatives: 0, keywordTerms: 0, overlaps: 0,
            skipLength: 0, skipExists: 0, skipNoCpc: 0, skipDsaCheaper: 0,
            termsFenced: 0, negativesQueued: 0,
            timedOut: false,
        };

        Logger.log('Collecting DSA search terms (' + dateFrom + ' to ' + dateTo + ')...');
        const dsaTermRows = AdsApp.search(
            'SELECT campaign.name, ad_group.id, search_term_view.search_term, ' +
            'metrics.impressions, metrics.average_cpc ' +
            'FROM search_term_view ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            'AND ad_group.status IN (\'ENABLED\', \'PAUSED\') ' +
            'AND campaign.name REGEXP_MATCH \'(?i).*' + escapeForRegexp(CONFIG.DSA_CAMPAIGN_PATTERN) + '.*\' ' +
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
                // Rows are impression-sorted, so the first occurrence carries
                // the term's most representative CPC.
                dsaTermsByCountry[country][term] = {
                    averageCpc: row.metrics.averageCpc,
                    adGroupIds: [],
                };
            }
            dsaTermsByCountry[country][term].adGroupIds.push(row.adGroup.id);
        }

        Logger.log('Collecting existing DSA negatives...');
        const negativeRows = AdsApp.search(
            'SELECT ad_group.id, ad_group_criterion.keyword.text ' +
            'FROM ad_group_criterion ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            'AND ad_group.status IN (\'ENABLED\', \'PAUSED\') ' +
            'AND campaign.name REGEXP_MATCH \'(?i).*' + escapeForRegexp(CONFIG.DSA_CAMPAIGN_PATTERN) + '.*\' ' +
            'AND ad_group_criterion.type = \'KEYWORD\' ' +
            'AND ad_group_criterion.negative = true');
        while (negativeRows.hasNext()) {
            const row = negativeRows.next();
            if (row.adGroupCriterion.keyword === undefined) {
                continue;
            }
            counters.dsaNegatives++;
            const adGroupId = row.adGroup.id;
            if (!dsaNegativeTexts[adGroupId]) {
                dsaNegativeTexts[adGroupId] = {};
            }
            dsaNegativeTexts[adGroupId][row.adGroupCriterion.keyword.text] = true;
        }

        Logger.log('Checking keyword campaign search terms for overlaps...');
        const keywordTermRows = AdsApp.search(
            'SELECT campaign.name, search_term_view.search_term, metrics.average_cpc ' +
            'FROM search_term_view ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            'AND ad_group.status IN (\'ENABLED\', \'PAUSED\') ' +
            'AND campaign.name NOT REGEXP_MATCH \'(?i).*' + escapeForRegexp(CONFIG.DSA_CAMPAIGN_PATTERN) + '.*\' ' +
            buildCampaignExcludeFilter() +
            'AND metrics.impressions >= ' + CONFIG.MIN_SEARCH_TERM_IMPRESSIONS + ' ' +
            'AND segments.date BETWEEN \'' + dateFrom + '\' AND \'' + dateTo + '\' ' +
            'ORDER BY metrics.impressions DESC');

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
                    ' DSA ad group(s) (keyword CPC ' + row.metrics.averageCpc +
                    ' <= DSA CPC ' + dsaTerm.averageCpc + ')');
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

        logSummary(counters, dateFrom, dateTo);
    };

    /**
     * Maps each enabled campaign's name to the country code of its (first)
     * positive location target. Only the geo target constants actually used
     * by campaigns are resolved.
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

    function logSummary(counters, dateFrom, dateTo) {
        const preview = CONFIG.PREVIEW_MODE ? ' (PREVIEW MODE - nothing was changed)' : '';
        Logger.log([
            '',
            '========== Execution Summary' + preview + ' ==========',
            'Window: ' + dateFrom + ' to ' + dateTo,
            'DSA search terms collected: ' + counters.dsaTerms +
            ' | existing DSA negatives: ' + counters.dsaNegatives,
            'Keyword campaign terms analysed: ' + counters.keywordTerms +
            ' (>= ' + CONFIG.MIN_SEARCH_TERM_IMPRESSIONS + ' impressions)',
            'Overlapping terms: ' + counters.overlaps,
            'Skipped:',
            '  ' + counters.skipLength + ' too long (> ' + CONFIG.MAX_TERM_WORDS +
            ' words or > ' + CONFIG.MAX_TERM_CHARS + ' chars)',
            '  ' + counters.skipExists + ' already fully fenced',
            '  ' + counters.skipNoCpc + ' without comparable CPCs',
            '  ' + counters.skipDsaCheaper + ' cheaper in DSA (DSA keeps them)',
            (counters.timedOut ? 'Stopped early near the execution time limit.' : ''),
            'Terms ' + (CONFIG.PREVIEW_MODE ? 'that would be fenced' : 'fenced') + ': ' +
            counters.termsFenced + ' (' + counters.negativesQueued +
            ' negatives across DSA ad groups)',
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
