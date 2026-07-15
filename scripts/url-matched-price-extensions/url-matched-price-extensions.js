/**
 * URL-Matched Price Extensions
 *
 * Price extensions lift CTR, but maintaining them by hand across dozens of
 * ad groups is the kind of chore that quietly stops happening. This script
 * maintains them for you: you declare price sets keyed by landing page URL,
 * and every ad group whose responsive search ad points at that URL gets the
 * matching price extension — created, updated in place, or removed when it
 * no longer qualifies.
 *
 * How an ad group is processed:
 *   1. The final URL of its enabled responsive search ads is looked up in
 *      CONFIG.PRICE_SETS.
 *   2. Match with 3-8 price items -> the ad group's price extension is
 *      created, or diff-updated: unchanged items are left alone, changed
 *      items are replaced, items no longer in the set are removed.
 *   3. Match with fewer than 3 items (Google's minimum) -> any existing
 *      price extension is removed until the set grows back.
 *   4. No match -> the ad group is left untouched.
 *
 * Update-in-place matters: replacing a whole extension resets its
 * performance history, so the script only rebuilds from scratch when it has
 * to (no extension yet, or more than one).
 *
 * Setup:
 *   1. Fill in CONFIG.PRICE_SETS with your landing pages and price items.
 *      Tip: generate this block from your product feed or pricing sheet.
 *   2. Run with PREVIEW_MODE: true first. Read the execution summary in the
 *      logs; nothing is changed in the account.
 *   3. Set PREVIEW_MODE: false and schedule (daily, or as often as your
 *      prices change).
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
    // false: create, update and remove price extensions.
    PREVIEW_MODE: true,

    // Price sets keyed by landing page URL (compared against the first
    // final URL of each ad group's responsive search ads, query string
    // ignored). TYPE is one of Google's price extension types (SERVICES,
    // PRODUCT_CATEGORIES, LOCATIONS, BRANDS, EVENTS, ...); LANGUAGE is a
    // two-letter code. Every ITEMS entry needs 3 to 8 members; headers are
    // limited to 25 characters by Google.
    PRICE_SETS: {
        'https://www.example.com/services': {
            TYPE: 'SERVICES',
            LANGUAGE: 'en',
            CURRENCY: 'EUR',
            ITEMS: [
                { HEADER: 'Basic', DESCRIPTION: 'Starter package', AMOUNT: 99, URL: 'https://www.example.com/services/basic' },
                { HEADER: 'Pro', DESCRIPTION: 'Most popular', AMOUNT: 199, URL: 'https://www.example.com/services/pro' },
                { HEADER: 'Enterprise', DESCRIPTION: 'Full service', AMOUNT: 499, URL: 'https://www.example.com/services/enterprise' },
            ],
        },
    },

    // Only process campaigns whose name contains this substring. Leave
    // empty to process all enabled search campaigns.
    CAMPAIGN_NAME_FILTER: '',

    // Campaigns whose name contains any of these substrings are skipped.
    CAMPAIGN_EXCLUDE_PATTERNS: ['DSA', 'SHOPPING', 'PMAX'],

    // Stop processing this many milliseconds after the script starts.
    MAX_RUNTIME_MS: 27 * 60 * 1000,
};

function main() {
    validateConfig();

    const startTime = Date.now();
    const maintainer = new PriceExtensionMaintainer(startTime);
    maintainer.maintain();
}

function validateConfig() {
    const urls = Object.keys(CONFIG.PRICE_SETS);
    if (urls.length === 0) {
        throw new Error('CONFIG.PRICE_SETS is empty - declare at least one landing page.');
    }
    for (const url of urls) {
        const set = CONFIG.PRICE_SETS[url];
        if (!set.TYPE || !set.LANGUAGE || !set.CURRENCY) {
            throw new Error('Price set for ' + url + ' is missing TYPE, LANGUAGE or CURRENCY.');
        }
        if (!set.ITEMS || set.ITEMS.length > 8) {
            throw new Error('Price set for ' + url + ' must have at most 8 ITEMS ' +
                '(sets with fewer than 3 remove the extension).');
        }
        for (const item of set.ITEMS || []) {
            if (!item.HEADER || !item.DESCRIPTION || !(item.AMOUNT > 0) || !item.URL) {
                throw new Error('Every ITEMS entry for ' + url +
                    ' needs HEADER, DESCRIPTION, AMOUNT > 0 and URL.');
            }
            if (item.HEADER.length > 25) {
                throw new Error('Header "' + item.HEADER + '" exceeds Google\'s ' +
                    '25-character limit.');
            }
        }
    }
}

function PriceExtensionMaintainer(startTime) {

    this.maintain = function () {
        const counters = {
            adGroups: 0, matched: 0, noMatch: 0,
            created: 0, updated: 0, unchanged: 0, removedLow: 0,
            timedOut: false,
        };

        // One RSA row per ad group is enough - the first final URL decides.
        Logger.log('Collecting ad groups with responsive search ads...');
        const priceSetByAdGroupId = {};
        const rows = AdsApp.search(
            'SELECT campaign.name, ad_group.id, ad_group_ad.ad.final_urls ' +
            'FROM ad_group_ad ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            'AND ad_group.status = \'ENABLED\' ' +
            'AND ad_group_ad.status = \'ENABLED\' ' +
            'AND ad_group_ad.ad.type = \'RESPONSIVE_SEARCH_AD\'');
        while (rows.hasNext()) {
            const row = rows.next();
            if (!campaignQualifies(row.campaign.name)) {
                continue;
            }
            const adGroupId = row.adGroup.id;
            if (priceSetByAdGroupId[adGroupId] !== undefined) {
                continue;
            }
            counters.adGroups++;

            const finalUrls = row.adGroupAd.ad.finalUrls || [];
            const url = (finalUrls[0] || '').split('?')[0];
            const priceSet = CONFIG.PRICE_SETS[url];
            if (priceSet) {
                priceSetByAdGroupId[adGroupId] = priceSet;
                counters.matched++;
            } else {
                priceSetByAdGroupId[adGroupId] = null;
                counters.noMatch++;
            }
        }

        const targetAdGroupIds = [];
        for (const adGroupId in priceSetByAdGroupId) {
            if (priceSetByAdGroupId[adGroupId]) {
                targetAdGroupIds.push(adGroupId);
            }
        }

        Logger.log('Maintaining price extensions on ' + targetAdGroupIds.length + ' ad groups...');
        const adGroups = AdsApp.adGroups().withIds(targetAdGroupIds).get();
        while (adGroups.hasNext()) {
            const adGroup = adGroups.next();
            const priceSet = priceSetByAdGroupId[adGroup.getId()];

            const outcome = syncPriceExtension(adGroup, priceSet);
            counters[outcome]++;
            Logger.log(adGroup.getName() + ' (' + adGroup.getId() + '): ' + outcome);

            if (Date.now() - startTime > CONFIG.MAX_RUNTIME_MS) {
                counters.timedOut = true;
                Logger.log('Approaching the execution time limit - stopping here; ' +
                    'the next run continues.');
                break;
            }
        }

        logSummary(counters);
    };

    /**
     * Brings one ad group's price extension in line with its price set.
     * Returns the outcome: 'created', 'updated', 'unchanged' or 'removedLow'.
     */
    function syncPriceExtension(adGroup, priceSet) {
        const existing = adGroup.extensions().prices().get();

        // Fewer than Google's 3-item minimum: the extension cannot exist.
        if (priceSet.ITEMS.length < 3) {
            if (!CONFIG.PREVIEW_MODE) {
                while (existing.hasNext()) {
                    adGroup.removePrice(existing.next());
                }
            }
            return 'removedLow';
        }

        // Exactly one existing extension: diff-update it in place to keep
        // its performance history.
        if (existing.totalNumEntities() === 1) {
            return diffUpdate(adGroup, existing.next(), priceSet) ? 'updated' : 'unchanged';
        }

        // None or several: clear and rebuild from scratch.
        if (!CONFIG.PREVIEW_MODE) {
            while (existing.hasNext()) {
                adGroup.removePrice(existing.next());
            }
            const builder = AdsApp.extensions().newPriceBuilder()
                .withPriceType(priceSet.TYPE)
                .withLanguage(priceSet.LANGUAGE);
            for (const item of priceSet.ITEMS) {
                builder.addPriceItem(buildPriceItem(item, priceSet.CURRENCY));
            }
            adGroup.addPrice(builder.build().getResult());
        }
        return 'created';
    }

    /**
     * Replaces changed items and removes stale ones, leaving matching items
     * untouched. Returns whether anything changed.
     */
    function diffUpdate(adGroup, priceExtension, priceSet) {
        const wantedByHeader = {};
        for (const item of priceSet.ITEMS) {
            wantedByHeader[item.HEADER] = item;
        }

        const existingItems = priceExtension.getPriceItems();
        let activeCount = existingItems.length;
        let changed = false;

        for (const existingItem of existingItems) {
            const wanted = wantedByHeader[existingItem.getHeader()];

            if (wanted) {
                const same = existingItem.getDescription() === wanted.DESCRIPTION &&
                    existingItem.getAmount() === wanted.AMOUNT &&
                    existingItem.getFinalUrl() === wanted.URL;
                if (same) {
                    delete wantedByHeader[existingItem.getHeader()];
                    continue;
                }
                if (!CONFIG.PREVIEW_MODE) {
                    existingItem.remove();
                    priceExtension.addPriceItem(buildPriceItem(wanted, priceSet.CURRENCY));
                }
                delete wantedByHeader[existingItem.getHeader()];
                changed = true;
            } else {
                // Item is no longer in the set; dropping below 3 active
                // items is not allowed, so then the extension goes entirely
                // and the next run rebuilds it.
                if (activeCount <= 3) {
                    if (!CONFIG.PREVIEW_MODE) {
                        adGroup.removePrice(priceExtension);
                    }
                    return true;
                }
                if (!CONFIG.PREVIEW_MODE) {
                    existingItem.remove();
                }
                activeCount--;
                changed = true;
            }
        }

        // Headers in the set but not yet on the extension.
        for (const header in wantedByHeader) {
            if (!CONFIG.PREVIEW_MODE) {
                priceExtension.addPriceItem(
                    buildPriceItem(wantedByHeader[header], priceSet.CURRENCY));
            }
            changed = true;
        }

        return changed;
    }

    function buildPriceItem(item, currency) {
        return AdsApp.extensions().newPriceItemBuilder()
            .withHeader(item.HEADER)
            .withDescription(item.DESCRIPTION)
            .withAmount(item.AMOUNT)
            .withCurrencyCode(currency)
            .withUnitType('UNSPECIFIED')
            .withFinalUrl(item.URL)
            .build()
            .getResult();
    }

    function campaignQualifies(campaignName) {
        if (CONFIG.CAMPAIGN_NAME_FILTER &&
            campaignName.indexOf(CONFIG.CAMPAIGN_NAME_FILTER) === -1) {
            return false;
        }
        for (const pattern of CONFIG.CAMPAIGN_EXCLUDE_PATTERNS) {
            if (campaignName.toUpperCase().indexOf(pattern.toUpperCase()) !== -1) {
                return false;
            }
        }
        return true;
    }

    function logSummary(counters) {
        const preview = CONFIG.PREVIEW_MODE ? ' (PREVIEW MODE - nothing was changed)' : '';
        Logger.log([
            '',
            '========== Execution Summary' + preview + ' ==========',
            'Ad groups with RSAs examined: ' + counters.adGroups,
            '  Matched a price set: ' + counters.matched +
            ' | no match (untouched): ' + counters.noMatch,
            'Extensions ' + (CONFIG.PREVIEW_MODE ? 'that would be' : '') + ' created: ' +
            counters.created + ', updated: ' + counters.updated +
            ', unchanged: ' + counters.unchanged,
            'Removed for having under 3 items: ' + counters.removedLow,
            (counters.timedOut ? 'Stopped early near the execution time limit.' : ''),
            '====================================================',
        ].join('\n'));
    }
}
