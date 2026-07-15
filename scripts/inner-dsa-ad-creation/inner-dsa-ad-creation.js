/**
 * Inner DSA Ad Creation
 *
 * In a layered DSA structure (see docs/DSA-LAYERING.md) every keyword
 * campaign carries an inner DSA ad group - and a DSA ad group without ads
 * serves nothing. Writing DSA descriptions per campaign by hand doesn't
 * scale, and it doesn't need to: the campaign's responsive search ads
 * already carry proven copy. This script builds the DSA ads from it - each
 * inner DSA ad group gets dynamic search ads whose two description lines
 * come from the campaign's own RSA descriptions, in both orders (an A/B of
 * line order for free), with the new ads' status mirroring the majority
 * status of the source RSAs.
 *
 * How an inner DSA ad group is filled:
 *   1. The campaign's enabled/paused RSAs contribute their distinct
 *      descriptions, in order of appearance. DESCRIPTION_PICKS selects
 *      which two become the DSA's lines (default: the 3rd and 4th - in our
 *      structure the first two are offer lines that age badly, the later
 *      ones are evergreen).
 *   2. With CREATE_BOTH_ORDERS, two ads are created (lines 3-4 and 4-3);
 *      Google's rotation decides which order wins.
 *   3. VARIANT_LABELS optionally splits the source RSAs into copy variants
 *      (e.g. 'Ad Text: Sales' / 'Ad Text: Normal'), producing one DSA pair
 *      per variant, each mirroring its own variant's majority status.
 *   4. Ad groups whose existing DSA ads already carry a planned
 *      description pair are skipped - reruns never duplicate.
 *
 * All changes go through one bulk mutate with partial failure.
 *
 * Setup:
 *   1. Review CONFIG below - DSA_ADGROUP_PATTERN must match how your inner
 *      DSA ad groups are named.
 *   2. Run with PREVIEW_MODE: true first. Read the plan in the logs;
 *      nothing is changed in the account.
 *   3. Set PREVIEW_MODE: false and run (or schedule to cover new
 *      campaigns automatically).
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
    // false: create the DSA ads.
    PREVIEW_MODE: true,

    // How to recognise the inner DSA ad groups by name (case-insensitive
    // substring).
    DSA_ADGROUP_PATTERN: 'DSA',

    // Campaigns whose name contains any of these are skipped entirely
    // (incl. outer catch-all DSA campaigns).
    CAMPAIGN_EXCLUDE_PATTERNS: ['DSA', 'SHOPPING', 'PMAX'],

    // Which of the campaign's distinct RSA descriptions (1-based, in order
    // of appearance) become the DSA's two lines.
    DESCRIPTION_PICKS: [3, 4],

    // Also create the reversed-order ad - a free A/B test of line order.
    CREATE_BOTH_ORDERS: true,

    // Optional ad label names splitting the source RSAs into copy variants;
    // each variant yields its own DSA pair. Empty: all RSAs form one pool.
    VARIANT_LABELS: [],

    // New DSA ads mirror the majority status of their source RSAs
    // (ENABLED when at least half are enabled). false: always PAUSED.
    MIRROR_SOURCE_STATUS: true,
};

function main() {
    validateConfig();

    const creator = new InnerDsaAdCreator();
    creator.create();
}

function validateConfig() {
    if (!CONFIG.DSA_ADGROUP_PATTERN) {
        throw new Error('DSA_ADGROUP_PATTERN must be set - the script needs to ' +
            'recognise the inner DSA ad groups by name.');
    }
    if (CONFIG.DESCRIPTION_PICKS.length !== 2 ||
        CONFIG.DESCRIPTION_PICKS[0] < 1 || CONFIG.DESCRIPTION_PICKS[1] < 1) {
        throw new Error('DESCRIPTION_PICKS must be two 1-based positions, e.g. [3, 4].');
    }
}

function InnerDsaAdCreator() {

    const DEFAULT_VARIANT = 'all';

    this.create = function () {
        const counters = {
            dsaAdGroups: 0, noCopy: 0,
            planned: 0, alreadyExists: 0, created: 0, failed: 0,
        };
        const operations = [];

        // Per campaign and variant: distinct RSA descriptions in order of
        // appearance + enabled/total counts for the status mirror.
        const copyByCampaign = collectRsaCopy();
        // Existing DSA description pairs per ad group, for dedup.
        const existingPairs = collectExistingDsaPairs();

        Logger.log('Planning DSA ads for inner DSA ad groups...');
        const adGroupRows = AdsApp.search(
            'SELECT campaign.id, campaign.name, ad_group.name, ad_group.resource_name, ' +
            'ad_group.id ' +
            'FROM ad_group ' +
            'WHERE campaign.status IN (\'ENABLED\', \'PAUSED\') ' +
            'AND ad_group.status IN (\'ENABLED\', \'PAUSED\') ' +
            buildCampaignExcludeFilter() +
            'AND ad_group.name REGEXP_MATCH \'(?i).*' +
            escapeForRegexp(CONFIG.DSA_ADGROUP_PATTERN) + '.*\'');

        while (adGroupRows.hasNext()) {
            const row = adGroupRows.next();
            counters.dsaAdGroups++;
            const variants = copyByCampaign[row.campaign.id];
            if (!variants) {
                counters.noCopy++;
                Logger.log(row.campaign.name + ': no RSA descriptions found - skipped.');
                continue;
            }

            for (const variant in variants) {
                const pool = variants[variant];
                const first = pool.descriptions[CONFIG.DESCRIPTION_PICKS[0] - 1];
                const second = pool.descriptions[CONFIG.DESCRIPTION_PICKS[1] - 1];
                if (!first || !second) {
                    counters.noCopy++;
                    Logger.log(row.campaign.name + ' [' + variant + ']: fewer than ' +
                        CONFIG.DESCRIPTION_PICKS[1] + ' distinct RSA descriptions - skipped.');
                    continue;
                }

                const status = (CONFIG.MIRROR_SOURCE_STATUS &&
                    pool.enabled / pool.total >= 0.5) ? 'ENABLED' : 'PAUSED';
                const orders = CONFIG.CREATE_BOTH_ORDERS ?
                    [[first, second], [second, first]] : [[first, second]];

                for (const pair of orders) {
                    counters.planned++;
                    const pairKey = pair[0] + '#' + pair[1];
                    const adGroupPairs = existingPairs[row.adGroup.id] || {};
                    if (adGroupPairs[pairKey]) {
                        counters.alreadyExists++;
                        continue;
                    }
                    counters.created++;
                    Logger.log(row.campaign.name + ' > ' + row.adGroup.name +
                        ' [' + variant + ']: + DSA (' + status + ') "' + pair[0] +
                        '" / "' + pair[1] + '"');
                    operations.push({
                        adGroupAdOperation: {
                            create: {
                                adGroup: row.adGroup.resourceName,
                                status: status,
                                ad: {
                                    type: 'EXPANDED_DYNAMIC_SEARCH_AD',
                                    expandedDynamicSearchAd: {
                                        description: pair[0],
                                        description2: pair[1],
                                    },
                                },
                            },
                        },
                    });
                }
            }
        }

        if (!CONFIG.PREVIEW_MODE && operations.length > 0) {
            Logger.log('Applying ' + operations.length + ' operations...');
            const results = AdsApp.mutateAll(operations, { partialFailure: true });
            for (const result of results) {
                if (!result.isSuccessful()) {
                    counters.failed++;
                    counters.created--;
                    Logger.log('Ad creation failed: ' + JSON.stringify(result.getErrorMessages()));
                }
            }
        }

        logSummary(counters);
    };

    /**
     * Distinct RSA descriptions per campaign and variant, in order of
     * appearance, with enabled/total ad counts for the status mirror.
     */
    function collectRsaCopy() {
        const copyByCampaign = {};
        const rows = AdsApp.search(
            'SELECT campaign.id, ad_group_ad.status, ad_group_ad.labels, ' +
            'ad_group_ad.ad.responsive_search_ad.descriptions ' +
            'FROM ad_group_ad ' +
            'WHERE campaign.status IN (\'ENABLED\', \'PAUSED\') ' +
            'AND ad_group.status IN (\'ENABLED\', \'PAUSED\') ' +
            'AND ad_group_ad.status IN (\'ENABLED\', \'PAUSED\') ' +
            buildCampaignExcludeFilter() +
            'AND ad_group.name NOT REGEXP_MATCH \'(?i).*' +
            escapeForRegexp(CONFIG.DSA_ADGROUP_PATTERN) + '.*\' ' +
            'AND ad_group_ad.ad.type = \'RESPONSIVE_SEARCH_AD\'');
        while (rows.hasNext()) {
            const row = rows.next();
            const variant = resolveVariant(row.adGroupAd.labels || []);
            if (variant === undefined) {
                continue;
            }
            const campaignId = row.campaign.id;
            if (!copyByCampaign[campaignId]) {
                copyByCampaign[campaignId] = {};
            }
            if (!copyByCampaign[campaignId][variant]) {
                copyByCampaign[campaignId][variant] = { descriptions: [], enabled: 0, total: 0 };
            }
            const pool = copyByCampaign[campaignId][variant];
            for (const description of row.adGroupAd.ad.responsiveSearchAd.descriptions || []) {
                if (pool.descriptions.indexOf(description.text) === -1) {
                    pool.descriptions.push(description.text);
                }
            }
            pool.total++;
            if (row.adGroupAd.status === 'ENABLED') {
                pool.enabled++;
            }
        }
        return copyByCampaign;
    }

    /**
     * The variant an RSA belongs to: the first VARIANT_LABELS entry found
     * among its labels, the shared pool when no variants are configured,
     * undefined (excluded) when variants are configured but none matches.
     */
    function resolveVariant(labelResourceNamesOrNames) {
        if (CONFIG.VARIANT_LABELS.length === 0) {
            return DEFAULT_VARIANT;
        }
        // GAQL returns label resource names; ad label NAMES are matched by
        // suffix-insensitive containment against configured names resolved
        // once below.
        for (const label of CONFIG.VARIANT_LABELS) {
            const resources = variantLabelResources()[label];
            if (!resources) {
                continue;
            }
            for (const labelRef of labelResourceNamesOrNames) {
                if (resources[labelRef]) {
                    return label;
                }
            }
        }
        return undefined;
    }

    let cachedVariantResources = null;
    function variantLabelResources() {
        if (cachedVariantResources) {
            return cachedVariantResources;
        }
        cachedVariantResources = {};
        const rows = AdsApp.search(
            'SELECT label.resource_name, label.name FROM label');
        while (rows.hasNext()) {
            const row = rows.next();
            const name = row.label.name;
            if (CONFIG.VARIANT_LABELS.indexOf(name) !== -1) {
                if (!cachedVariantResources[name]) {
                    cachedVariantResources[name] = {};
                }
                cachedVariantResources[name][row.label.resourceName] = true;
            }
        }
        return cachedVariantResources;
    }

    /**
     * Existing DSA description pairs per inner DSA ad group.
     */
    function collectExistingDsaPairs() {
        const pairs = {};
        const rows = AdsApp.search(
            'SELECT ad_group.id, ad_group_ad.ad.expanded_dynamic_search_ad.description, ' +
            'ad_group_ad.ad.expanded_dynamic_search_ad.description2 ' +
            'FROM ad_group_ad ' +
            'WHERE campaign.status IN (\'ENABLED\', \'PAUSED\') ' +
            'AND ad_group.status IN (\'ENABLED\', \'PAUSED\') ' +
            'AND ad_group_ad.status IN (\'ENABLED\', \'PAUSED\') ' +
            buildCampaignExcludeFilter() +
            'AND ad_group.name REGEXP_MATCH \'(?i).*' +
            escapeForRegexp(CONFIG.DSA_ADGROUP_PATTERN) + '.*\' ' +
            'AND ad_group_ad.ad.type = \'EXPANDED_DYNAMIC_SEARCH_AD\'');
        while (rows.hasNext()) {
            const row = rows.next();
            const edsa = row.adGroupAd.ad.expandedDynamicSearchAd;
            if (!edsa) {
                continue;
            }
            const adGroupId = row.adGroup.id;
            if (!pairs[adGroupId]) {
                pairs[adGroupId] = {};
            }
            pairs[adGroupId][edsa.description + '#' + edsa.description2] = true;
        }
        return pairs;
    }

    function buildCampaignExcludeFilter() {
        let filter = '';
        for (const pattern of CONFIG.CAMPAIGN_EXCLUDE_PATTERNS) {
            filter += 'AND campaign.name NOT REGEXP_MATCH \'(?i).*' + escapeForRegexp(pattern) + '.*\' ';
        }
        return filter;
    }

    function logSummary(counters) {
        const preview = CONFIG.PREVIEW_MODE ? ' (PREVIEW MODE - nothing was changed)' : '';
        Logger.log([
            '',
            '========== Execution Summary' + preview + ' ==========',
            'Inner DSA ad groups found: ' + counters.dsaAdGroups +
            ' | without usable RSA copy: ' + counters.noCopy,
            'Ads planned: ' + counters.planned +
            ' | already existing: ' + counters.alreadyExists,
            'Ads ' + (CONFIG.PREVIEW_MODE ? 'that would be created' : 'created') + ': ' +
            counters.created +
            (counters.failed > 0 ? ' | FAILED: ' + counters.failed : ''),
            '====================================================',
        ].join('\n'));
    }
}

function escapeForRegexp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&');
}
