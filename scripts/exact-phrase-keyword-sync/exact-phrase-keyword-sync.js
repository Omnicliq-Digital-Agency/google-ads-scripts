/**
 * Exact-Phrase Keyword Sync
 *
 * If you split your search campaigns into Exact and Phrase mirrors (the
 * classic alpha/beta structure), the two sides drift apart over time: a
 * keyword added to the Exact campaign never makes it into the Phrase mirror,
 * and vice versa. This script keeps the pair in sync — every keyword present
 * on one side is created on the other side with the mirror's match type.
 *
 * How campaigns and ad groups are paired:
 *   1. A campaign whose name contains EXACT_PATTERN is paired with the
 *      campaign whose name is identical except PHRASE_PATTERN replaces
 *      EXACT_PATTERN (and vice versa).
 *   2. Ad groups are paired by having the same name in both campaigns.
 *   3. Keywords are compared by text: a keyword missing from its pair ad
 *      group is created there — as phrase match when syncing Exact -> Phrase,
 *      as exact match when syncing Phrase -> Exact — inheriting the source
 *      keyword's final URL. Bids are left to the target ad group's default.
 *
 * Keywords containing any STOP_WORDS entry are never synced. Campaigns or ad
 * groups without a pair are reported in the execution summary, not treated as
 * errors. Created keywords are labeled so every addition can be reviewed or
 * rolled back with a label filter.
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
    // false: create keywords and labels.
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

    // A keyword containing any of these words or phrases (substring match,
    // case-sensitive) is never synced to its pair ad group.
    STOP_WORDS: [],

    // Label applied to created keywords. Created automatically if missing.
    LABELS: {
        SYNCED: 'Keyword Sync: Added',
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
    const syncroniser = new ExactPhraseSyncroniser(startTime);
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

function ExactPhraseSyncroniser(startTime) {

    const syncedKeywords = new KeywordBatch([CONFIG.LABELS.SYNCED]);

    this.syncronise = function () {
        const adGroupExcludeFilter = buildAdGroupExcludeFilter();

        // Ad group ids by campaign name and ad group name, to resolve pairs.
        const adGroupIdsByCampaignAndAdGroupName = {};
        // The pair ad group id for every ad group id that has one.
        const pairAdGroupIdByAdGroupId = {};
        // Existing keyword texts per ad group id, to avoid duplicates.
        const existingKeywordTexts = {};

        const counters = {
            adGroups: 0, keywords: 0,
            campaignsWithoutPair: 0, adGroupsWithoutPair: 0, campaignsWithoutType: 0,
            skipStopWord: 0, skipUnpaired: 0, skipNotKeyword: 0,
            addedToPhrase: 0, addedToExact: 0,
            alreadyInPhrase: 0, alreadyInExact: 0,
            timedOut: false,
        };
        const unpairedReports = [];

        Logger.log('Collecting ad groups...');
        const adGroupRows = AdsApp.search(
            'SELECT campaign.id, campaign.name, ad_group.id, ad_group.name ' +
            'FROM ad_group ' +
            'WHERE campaign.status IN (\'ENABLED\', \'PAUSED\') ' +
            'AND ad_group.status IN (\'ENABLED\', \'PAUSED\') ' +
            adGroupExcludeFilter);
        const collectedAdGroups = [];
        while (adGroupRows.hasNext()) {
            const row = adGroupRows.next();
            const campaignName = row.campaign.name;
            if (campaignSide(campaignName) === undefined) {
                continue;
            }
            if (!adGroupIdsByCampaignAndAdGroupName[campaignName]) {
                adGroupIdsByCampaignAndAdGroupName[campaignName] = {};
            }
            adGroupIdsByCampaignAndAdGroupName[campaignName][row.adGroup.name] = row.adGroup.id;
            collectedAdGroups.push(row);
            counters.adGroups++;
        }

        Logger.log('Resolving campaign and ad group pairs...');
        for (const row of collectedAdGroups) {
            const campaignName = row.campaign.name;
            const side = campaignSide(campaignName);
            const pairCampaignName = (side === MATCH_TYPES.EXACT) ?
                campaignName.replace(CONFIG.CAMPAIGNS.EXACT_PATTERN, CONFIG.CAMPAIGNS.PHRASE_PATTERN) :
                campaignName.replace(CONFIG.CAMPAIGNS.PHRASE_PATTERN, CONFIG.CAMPAIGNS.EXACT_PATTERN);

            const pairAdGroups = adGroupIdsByCampaignAndAdGroupName[pairCampaignName];
            if (!pairAdGroups) {
                if (unpairedReports.indexOf(pairCampaignName) === -1) {
                    unpairedReports.push(pairCampaignName);
                    counters.campaignsWithoutPair++;
                    Logger.log('No pair campaign found for "' + campaignName +
                        '" (expected "' + pairCampaignName + '")');
                }
                continue;
            }
            const pairAdGroupId = pairAdGroups[row.adGroup.name];
            if (!pairAdGroupId) {
                counters.adGroupsWithoutPair++;
                Logger.log('No ad group named "' + row.adGroup.name + '" in pair campaign "' +
                    pairCampaignName + '"');
                continue;
            }
            pairAdGroupIdByAdGroupId[row.adGroup.id] = pairAdGroupId;
        }

        Logger.log('Collecting existing keywords...');
        const keywordRows = AdsApp.search(
            'SELECT campaign.name, ad_group.id, ad_group_criterion.keyword.text, ' +
            'ad_group_criterion.final_urls ' +
            'FROM ad_group_criterion ' +
            'WHERE campaign.status IN (\'ENABLED\', \'PAUSED\') ' +
            'AND ad_group.status IN (\'ENABLED\', \'PAUSED\') ' +
            'AND ad_group_criterion.status IN (\'ENABLED\', \'PAUSED\') ' +
            adGroupExcludeFilter +
            'AND ad_group_criterion.type = \'KEYWORD\' ' +
            'AND ad_group_criterion.negative = false');
        const collectedKeywords = [];
        while (keywordRows.hasNext()) {
            const row = keywordRows.next();
            if (campaignSide(row.campaign.name) === undefined) {
                continue;
            }
            if (row.adGroupCriterion.keyword === undefined) {
                counters.skipNotKeyword++;
                continue;
            }
            const adGroupId = row.adGroup.id;
            if (!existingKeywordTexts[adGroupId]) {
                existingKeywordTexts[adGroupId] = {};
            }
            existingKeywordTexts[adGroupId][row.adGroupCriterion.keyword.text] = true;
            collectedKeywords.push(row);
            counters.keywords++;
        }

        Logger.log('Syncing keywords to their pair ad groups...');
        for (const row of collectedKeywords) {
            const side = campaignSide(row.campaign.name);
            const keywordText = row.adGroupCriterion.keyword.text;

            const pairAdGroupId = pairAdGroupIdByAdGroupId[row.adGroup.id];
            if (!pairAdGroupId) {
                counters.skipUnpaired++;
                continue;
            }

            if (containsStopWord(keywordText)) {
                counters.skipStopWord++;
                continue;
            }

            const pairTexts = existingKeywordTexts[pairAdGroupId];
            if (pairTexts && pairTexts[keywordText]) {
                if (side === MATCH_TYPES.EXACT) {
                    counters.alreadyInPhrase++;
                } else {
                    counters.alreadyInExact++;
                }
                continue;
            }

            const pairMatchType = (side === MATCH_TYPES.EXACT) ? MATCH_TYPES.PHRASE : MATCH_TYPES.EXACT;
            const finalUrls = row.adGroupCriterion.finalUrls;
            const finalUrl = (finalUrls && finalUrls.length > 0) ? finalUrls[0] : '';

            syncedKeywords.add(pairAdGroupId, keywordText, pairMatchType, 0, finalUrl);
            if (pairMatchType === MATCH_TYPES.PHRASE) {
                counters.addedToPhrase++;
            } else {
                counters.addedToExact++;
            }
            Logger.log('Queueing [' + pairMatchType + '] "' + keywordText + '" (from "' +
                row.campaign.name + '" > "' + row.adGroup.name + '")');

            if (Date.now() - startTime > CONFIG.MAX_RUNTIME_MS) {
                counters.timedOut = true;
                Logger.log('Approaching the execution time limit - committing what was analysed so far.');
                break;
            }
        }

        if (!CONFIG.PREVIEW_MODE && (counters.addedToPhrase + counters.addedToExact) > 0) {
            ensureLabels();
        }
        syncedKeywords.flush();

        logSummary(counters);
    };

    // EXACT when the campaign name matches the exact pattern, PHRASE for the
    // phrase pattern, undefined for campaigns outside the pairing scheme.
    function campaignSide(campaignName) {
        if (campaignName.indexOf(CONFIG.CAMPAIGNS.EXACT_PATTERN) !== -1) {
            return MATCH_TYPES.EXACT;
        }
        if (campaignName.indexOf(CONFIG.CAMPAIGNS.PHRASE_PATTERN) !== -1) {
            return MATCH_TYPES.PHRASE;
        }
        return undefined;
    }

    function containsStopWord(keywordText) {
        for (const stopWord of CONFIG.STOP_WORDS) {
            if (keywordText.indexOf(stopWord) !== -1) {
                return true;
            }
        }
        return false;
    }

    function ensureLabels() {
        const existing = {};
        const labelIterator = AdsApp.labels().get();
        while (labelIterator.hasNext()) {
            existing[labelIterator.next().getName()] = true;
        }
        if (!existing[CONFIG.LABELS.SYNCED]) {
            AdsApp.createLabel(CONFIG.LABELS.SYNCED);
        }
    }

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
            'Ad groups collected: ' + counters.adGroups +
            ' | keywords collected: ' + counters.keywords,
            'Pairing issues:',
            '  ' + counters.campaignsWithoutPair + ' campaigns without a pair campaign',
            '  ' + counters.adGroupsWithoutPair + ' ad groups without a same-name pair',
            'Skipped:',
            '  ' + counters.skipNotKeyword + ' criteria without keyword text',
            '  ' + counters.skipUnpaired + ' keywords in unpaired campaigns/ad groups',
            '  ' + counters.skipStopWord + ' keywords containing a stop word',
            'Already in sync: ' + counters.alreadyInPhrase + ' in phrase, ' +
            counters.alreadyInExact + ' in exact',
            (counters.timedOut ? 'Stopped early near the execution time limit.' : ''),
            'Keywords ' + (CONFIG.PREVIEW_MODE ? 'that would be added' : 'added') + ': ' +
            counters.addedToPhrase + ' to phrase campaigns, ' +
            counters.addedToExact + ' to exact campaigns',
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

function escapeForRegexp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&');
}
