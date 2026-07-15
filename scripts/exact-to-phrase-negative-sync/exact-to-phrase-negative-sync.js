/**
 * Exact-to-Phrase Negative Sync
 *
 * In a mirrored Exact/Phrase (alpha/beta) search structure, the Phrase
 * campaign exists to discover new queries — not to compete with the Exact
 * campaign for traffic you already own. Without fencing, the phrase keywords
 * happily match the exact terms too, splitting traffic and muddying per-term
 * data. This script builds the fence: every eligible keyword in an Exact
 * campaign is added as a negative exact keyword to its mirrored Phrase ad
 * group, so exact traffic stays exact.
 *
 * How campaigns and ad groups are paired:
 *   1. A campaign whose name contains EXACT_PATTERN is paired with the
 *      campaign whose name is identical except PHRASE_PATTERN replaces
 *      EXACT_PATTERN.
 *   2. Ad groups are paired by having the same name in both campaigns.
 *   3. Every ELIGIBLE positive keyword in an enabled Exact campaign/ad group
 *      that is not yet a negative in the pair Phrase ad group is added there
 *      as a negative exact match ([keyword]).
 *
 * Only serving keywords are fenced: paused campaigns, paused ad groups and
 * non-eligible keywords are ignored, so pausing an exact keyword lets the
 * phrase side pick the traffic back up on the next runs of your negative
 * cleanup. Campaigns or ad groups without a pair are reported in the
 * execution summary, not treated as errors.
 *
 * Setup:
 *   1. Review CONFIG below — the CAMPAIGNS patterns must match your Exact and
 *      Phrase campaign naming convention.
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
    // false: create negative keywords.
    PREVIEW_MODE: true,

    // How to recognise your campaign pairs by name (case-sensitive
    // substrings). 'Brand - Exact' pairs with 'Brand - PH' when the patterns
    // are ' - Exact' and ' - PH'. Campaigns matching neither pattern are
    // ignored. Ad groups whose name contains any ADGROUP_EXCLUDE_PATTERNS
    // entry (e.g. DSA ad groups) are skipped on both sides.
    CAMPAIGNS: {
        EXACT_PATTERN: ' - Exact',
        PHRASE_PATTERN: ' - PH',
        ADGROUP_EXCLUDE_PATTERNS: ['DSA'],
    },

    // Stop analysing this many milliseconds after the script starts, leaving
    // time to commit pending negatives before the 30-minute hard limit.
    MAX_RUNTIME_MS: 27 * 60 * 1000,
};

function main() {
    validateConfig();

    const startTime = Date.now();
    const syncroniser = new NegativeFenceBuilder(startTime);
    syncroniser.syncronise();
}

function validateConfig() {
    if (!CONFIG.CAMPAIGNS.EXACT_PATTERN || !CONFIG.CAMPAIGNS.PHRASE_PATTERN) {
        throw new Error('Both CAMPAIGNS.EXACT_PATTERN and CAMPAIGNS.PHRASE_PATTERN must be set - ' +
            'the script pairs campaigns by swapping one pattern for the other.');
    }
    if (CONFIG.CAMPAIGNS.EXACT_PATTERN === CONFIG.CAMPAIGNS.PHRASE_PATTERN) {
        throw new Error('CAMPAIGNS.EXACT_PATTERN and PHRASE_PATTERN must differ.');
    }
}

function NegativeFenceBuilder(startTime) {

    const negativeKeywords = new NegativeKeywordBatch();

    this.syncronise = function () {
        const adGroupExcludeFilter = buildAdGroupExcludeFilter();

        // Phrase ad group ids by campaign name and ad group name, to resolve
        // where each exact ad group's negatives belong.
        const phraseAdGroupIdsByCampaignAndAdGroupName = {};
        // Existing negative keyword texts per phrase ad group id.
        const existingNegativeTexts = {};

        const counters = {
            phraseAdGroups: 0, exactKeywords: 0, existingNegatives: 0,
            campaignsWithoutPair: 0, adGroupsWithoutPair: 0,
            skipNotKeyword: 0,
            alreadyFenced: 0, added: 0,
            timedOut: false,
        };
        const unpairedCampaigns = [];

        Logger.log('Collecting phrase ad groups...');
        const phraseAdGroupRows = AdsApp.search(
            'SELECT campaign.name, ad_group.id, ad_group.name ' +
            'FROM ad_group ' +
            'WHERE campaign.status IN (\'ENABLED\', \'PAUSED\') ' +
            'AND ad_group.status IN (\'ENABLED\', \'PAUSED\') ' +
            adGroupExcludeFilter);
        while (phraseAdGroupRows.hasNext()) {
            const row = phraseAdGroupRows.next();
            const campaignName = row.campaign.name;
            if (campaignName.indexOf(CONFIG.CAMPAIGNS.PHRASE_PATTERN) === -1) {
                continue;
            }
            if (!phraseAdGroupIdsByCampaignAndAdGroupName[campaignName]) {
                phraseAdGroupIdsByCampaignAndAdGroupName[campaignName] = {};
            }
            phraseAdGroupIdsByCampaignAndAdGroupName[campaignName][row.adGroup.name] = row.adGroup.id;
            counters.phraseAdGroups++;
        }

        Logger.log('Collecting existing negatives in phrase ad groups...');
        const negativeRows = AdsApp.search(
            'SELECT campaign.name, ad_group.id, ad_group_criterion.keyword.text ' +
            'FROM ad_group_criterion ' +
            'WHERE campaign.status IN (\'ENABLED\', \'PAUSED\') ' +
            'AND ad_group.status IN (\'ENABLED\', \'PAUSED\') ' +
            'AND ad_group_criterion.status IN (\'ENABLED\', \'PAUSED\') ' +
            adGroupExcludeFilter +
            'AND ad_group_criterion.type = \'KEYWORD\' ' +
            'AND ad_group_criterion.negative = true');
        while (negativeRows.hasNext()) {
            const row = negativeRows.next();
            if (row.campaign.name.indexOf(CONFIG.CAMPAIGNS.PHRASE_PATTERN) === -1) {
                continue;
            }
            if (row.adGroupCriterion.keyword === undefined) {
                continue;
            }
            const adGroupId = row.adGroup.id;
            if (!existingNegativeTexts[adGroupId]) {
                existingNegativeTexts[adGroupId] = {};
            }
            existingNegativeTexts[adGroupId][row.adGroupCriterion.keyword.text] = true;
            counters.existingNegatives++;
        }

        Logger.log('Fencing eligible exact keywords...');
        const exactKeywordRows = AdsApp.search(
            'SELECT campaign.name, ad_group.id, ad_group.name, ' +
            'ad_group_criterion.keyword.text ' +
            'FROM ad_group_criterion ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            'AND ad_group.status = \'ENABLED\' ' +
            'AND ad_group_criterion.status IN (\'ENABLED\', \'PAUSED\') ' +
            adGroupExcludeFilter +
            'AND ad_group_criterion.type = \'KEYWORD\' ' +
            'AND ad_group_criterion.negative = false ' +
            'AND ad_group_criterion.system_serving_status = \'ELIGIBLE\'');
        while (exactKeywordRows.hasNext()) {
            const row = exactKeywordRows.next();
            const campaignName = row.campaign.name;
            if (campaignName.indexOf(CONFIG.CAMPAIGNS.EXACT_PATTERN) === -1) {
                continue;
            }
            counters.exactKeywords++;

            if (row.adGroupCriterion.keyword === undefined) {
                counters.skipNotKeyword++;
                continue;
            }
            const keywordText = row.adGroupCriterion.keyword.text;

            const pairCampaignName = campaignName.replace(
                CONFIG.CAMPAIGNS.EXACT_PATTERN, CONFIG.CAMPAIGNS.PHRASE_PATTERN);
            const pairAdGroups = phraseAdGroupIdsByCampaignAndAdGroupName[pairCampaignName];
            if (!pairAdGroups) {
                if (unpairedCampaigns.indexOf(campaignName) === -1) {
                    unpairedCampaigns.push(campaignName);
                    counters.campaignsWithoutPair++;
                    Logger.log('No pair campaign found for "' + campaignName +
                        '" (expected "' + pairCampaignName + '")');
                }
                continue;
            }
            const pairAdGroupId = pairAdGroups[row.adGroup.name];
            if (!pairAdGroupId) {
                counters.adGroupsWithoutPair++;
                continue;
            }

            const pairNegatives = existingNegativeTexts[pairAdGroupId];
            if (pairNegatives && pairNegatives[keywordText]) {
                counters.alreadyFenced++;
                continue;
            }

            negativeKeywords.add(pairAdGroupId, keywordText);
            counters.added++;
            Logger.log('Queueing negative [' + keywordText + '] for "' + pairCampaignName +
                '" > "' + row.adGroup.name + '"');

            if (Date.now() - startTime > CONFIG.MAX_RUNTIME_MS) {
                counters.timedOut = true;
                Logger.log('Approaching the execution time limit - committing what was analysed so far.');
                break;
            }
        }

        negativeKeywords.flush();

        logSummary(counters);
    };

    function buildAdGroupExcludeFilter() {
        let filter = '';
        for (const pattern of CONFIG.CAMPAIGNS.ADGROUP_EXCLUDE_PATTERNS) {
            filter += 'AND ad_group.name NOT REGEXP_MATCH \'(?i).*' + escapeForRegexp(pattern) + '.*\' ';
        }
        return filter;
    }

    function logSummary(counters) {
        const preview = CONFIG.PREVIEW_MODE ? ' (PREVIEW MODE - nothing was changed)' : '';
        Logger.log([
            '',
            '========== Execution Summary' + preview + ' ==========',
            'Phrase ad groups collected: ' + counters.phraseAdGroups +
            ' | existing negatives in them: ' + counters.existingNegatives,
            'Eligible exact keywords analysed: ' + counters.exactKeywords,
            'Pairing issues:',
            '  ' + counters.campaignsWithoutPair + ' exact campaigns without a phrase pair',
            '  ' + counters.adGroupsWithoutPair + ' exact keywords in ad groups without a same-name pair',
            'Skipped: ' + counters.skipNotKeyword + ' criteria without keyword text',
            'Already fenced: ' + counters.alreadyFenced,
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

function escapeForRegexp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&');
}
