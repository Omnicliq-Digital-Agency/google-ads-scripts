/**
 * Inner DSA Target Sync
 *
 * In a layered DSA structure (see docs/DSA-LAYERING.md) every keyword
 * campaign carries one inner DSA ad group that targets exactly the landing
 * pages the campaign's keywords advertise - catching the campaign's
 * long-tail queries with the campaign's own budget and targeting. That only
 * works while the DSA ad group's webpage targets mirror the campaign's real
 * landing pages, and keywords change weekly. This script keeps the mirror:
 * every run it derives each campaign's landing page set and reconciles the
 * inner DSA ad group's URL targets against it - adding what's missing,
 * removing what no longer belongs.
 *
 * How an inner DSA ad group is synced:
 *   1. Ad groups whose name matches DSA_ADGROUP_PATTERN inside keyword
 *      campaigns are the sync targets.
 *   2. The campaign's landing pages come from its keywords' final URLs;
 *      campaigns whose keywords carry no URLs fall back to the ads' final
 *      URLs.
 *   3. Each URL becomes a positive webpage target (URL EQUALS). Existing
 *      targets not in the set are removed; URLs blocked by a negative
 *      webpage target are left alone and counted (the negative wins - it
 *      was put there for a reason).
 *
 * All changes go through one bulk mutate with partial failure, so a single
 * bad URL doesn't sink the run.
 *
 * Setup:
 *   1. Review CONFIG below - DSA_ADGROUP_PATTERN must match how your inner
 *      DSA ad groups are named.
 *   2. Run with PREVIEW_MODE: true first. Read the planned additions and
 *      removals in the logs; nothing is changed in the account.
 *   3. Set PREVIEW_MODE: false and schedule (daily or weekly, matching how
 *      often your keywords change).
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
    // false: apply the additions and removals.
    PREVIEW_MODE: true,

    // How to recognise the inner DSA ad groups by name (case-insensitive
    // substring). Their campaigns are the keyword campaigns being mirrored.
    DSA_ADGROUP_PATTERN: 'DSA',

    // Campaigns whose name contains any of these are skipped entirely
    // (incl. your outer catch-all DSA campaigns - they use page feeds or
    // broad rules, not synced URL lists).
    CAMPAIGN_EXCLUDE_PATTERNS: ['DSA', 'SHOPPING', 'PMAX'],

    // Remove positive targets whose URL is no longer among the campaign's
    // landing pages. Disable to make the sync add-only.
    REMOVE_STALE_TARGETS: true,

    // Which entity statuses contribute landing pages.
    INCLUDE_PAUSED_SOURCES: false,
};

function main() {
    validateConfig();

    const sync = new InnerDsaTargetSync();
    sync.run();
}

function validateConfig() {
    if (!CONFIG.DSA_ADGROUP_PATTERN) {
        throw new Error('DSA_ADGROUP_PATTERN must be set - the script needs to ' +
            'recognise the inner DSA ad groups by name.');
    }
}

function InnerDsaTargetSync() {

    this.run = function () {
        const counters = {
            dsaAdGroups: 0, noSourceUrls: 0,
            wanted: 0, alreadyTargeted: 0, blockedByNegative: 0,
            additions: 0, removals: 0, failed: 0,
        };
        const operations = [];

        // Existing webpage criteria of the inner DSA ad groups, per campaign.
        const existing = collectExistingTargets();
        // Landing pages per campaign: keyword URLs preferred, ad URLs fallback.
        const keywordUrls = collectFinalUrls('ad_group_criterion',
            'AND ad_group_criterion.type = \'KEYWORD\' AND ad_group_criterion.negative = false ');
        const adUrls = collectFinalUrls('ad_group_ad', '');

        Logger.log('Reconciling inner DSA ad groups...');
        const adGroupRows = AdsApp.search(
            'SELECT campaign.id, campaign.name, ad_group.name, ad_group.resource_name ' +
            'FROM ad_group ' +
            'WHERE campaign.status IN (\'ENABLED\', \'PAUSED\') ' +
            'AND ad_group.status IN (\'ENABLED\', \'PAUSED\') ' +
            buildCampaignExcludeFilter() +
            'AND ad_group.name REGEXP_MATCH \'(?i).*' +
            escapeForRegexp(CONFIG.DSA_ADGROUP_PATTERN) + '.*\'');

        while (adGroupRows.hasNext()) {
            const row = adGroupRows.next();
            counters.dsaAdGroups++;
            const campaignId = row.campaign.id;

            const wantedUrls = keywordUrls[campaignId] || adUrls[campaignId];
            if (!wantedUrls) {
                counters.noSourceUrls++;
                Logger.log(row.campaign.name + ': no keyword or ad final URLs found - skipped.');
                continue;
            }
            const state = existing[campaignId] || { positives: {}, negatives: {} };

            for (const url in wantedUrls) {
                counters.wanted++;
                if (state.positives[url]) {
                    counters.alreadyTargeted++;
                    delete state.positives[url];
                    continue;
                }
                if (state.negatives[url]) {
                    counters.blockedByNegative++;
                    continue;
                }
                counters.additions++;
                Logger.log(row.campaign.name + ' > ' + row.adGroup.name + ': + ' + url);
                operations.push({
                    adGroupCriterionOperation: {
                        create: {
                            adGroup: row.adGroup.resourceName,
                            status: 'ENABLED',
                            negative: false,
                            webpage: {
                                conditions: [{ operand: 'URL', operator: 'EQUALS', argument: url }],
                                criterionName: url,
                            },
                        },
                    },
                });
            }

            // Whatever is left in state.positives is no longer advertised.
            if (CONFIG.REMOVE_STALE_TARGETS) {
                for (const url in state.positives) {
                    counters.removals++;
                    Logger.log(row.campaign.name + ' > ' + row.adGroup.name + ': - ' + url);
                    operations.push({
                        adGroupCriterionOperation: { remove: state.positives[url] },
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
                    Logger.log('Operation failed: ' + JSON.stringify(result.getErrorMessages()));
                }
            }
        }

        logSummary(counters);
    };

    /**
     * Existing webpage criteria (URL EQUALS) of the inner DSA ad groups,
     * split into positives (url -> resource name, for removal) and
     * negatives (url -> true) per campaign.
     */
    function collectExistingTargets() {
        const existing = {};
        const rows = AdsApp.search(
            'SELECT campaign.id, ad_group_criterion.resource_name, ' +
            'ad_group_criterion.negative, ad_group_criterion.webpage.conditions ' +
            'FROM ad_group_criterion ' +
            'WHERE campaign.status IN (\'ENABLED\', \'PAUSED\') ' +
            'AND ad_group.status IN (\'ENABLED\', \'PAUSED\') ' +
            'AND ad_group_criterion.status = \'ENABLED\' ' +
            buildCampaignExcludeFilter() +
            'AND ad_group.name REGEXP_MATCH \'(?i).*' +
            escapeForRegexp(CONFIG.DSA_ADGROUP_PATTERN) + '.*\' ' +
            'AND ad_group_criterion.type = \'WEBPAGE\'');
        while (rows.hasNext()) {
            const row = rows.next();
            const conditions = row.adGroupCriterion.webpage.conditions;
            if (!conditions || conditions.length === 0) {
                continue;
            }
            const url = conditions[0].argument;
            const campaignId = row.campaign.id;
            if (!existing[campaignId]) {
                existing[campaignId] = { positives: {}, negatives: {} };
            }
            if (row.adGroupCriterion.negative) {
                existing[campaignId].negatives[url] = true;
            } else {
                existing[campaignId].positives[url] = row.adGroupCriterion.resourceName;
            }
        }
        return existing;
    }

    /**
     * Final URLs per campaign from one resource (keywords or ads), taken
     * from outside the inner DSA ad groups.
     */
    function collectFinalUrls(resource, extraCondition) {
        const statusField = resource === 'ad_group_ad' ?
            'ad_group_ad.status' : 'ad_group_criterion.status';
        const urlField = resource === 'ad_group_ad' ?
            'ad_group_ad.ad.final_urls' : 'ad_group_criterion.final_urls';
        const statusCondition = CONFIG.INCLUDE_PAUSED_SOURCES ?
            'IN (\'ENABLED\', \'PAUSED\')' : '= \'ENABLED\'';

        const urlsByCampaign = {};
        const rows = AdsApp.search(
            'SELECT campaign.id, ' + urlField + ' ' +
            'FROM ' + resource + ' ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            'AND ad_group.status = \'ENABLED\' ' +
            'AND ' + statusField + ' ' + statusCondition + ' ' +
            buildCampaignExcludeFilter() +
            'AND ad_group.name NOT REGEXP_MATCH \'(?i).*' +
            escapeForRegexp(CONFIG.DSA_ADGROUP_PATTERN) + '.*\' ' +
            extraCondition);
        while (rows.hasNext()) {
            const row = rows.next();
            const finalUrls = (resource === 'ad_group_ad' ?
                row.adGroupAd.ad.finalUrls : row.adGroupCriterion.finalUrls) || [];
            if (finalUrls.length === 0) {
                continue;
            }
            const campaignId = row.campaign.id;
            if (!urlsByCampaign[campaignId]) {
                urlsByCampaign[campaignId] = {};
            }
            urlsByCampaign[campaignId][finalUrls[0].split('?')[0]] = true;
        }
        return urlsByCampaign;
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
            ' | without source URLs: ' + counters.noSourceUrls,
            'Landing pages wanted: ' + counters.wanted,
            '  Already targeted: ' + counters.alreadyTargeted +
            ' | blocked by a negative target: ' + counters.blockedByNegative,
            'Targets ' + (CONFIG.PREVIEW_MODE ? 'that would be' : '') + ' added: ' +
            counters.additions + ', removed: ' + counters.removals +
            (counters.failed > 0 ? ', FAILED: ' + counters.failed : ''),
            '====================================================',
        ].join('\n'));
    }
}

function escapeForRegexp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&');
}
