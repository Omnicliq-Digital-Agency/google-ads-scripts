/**
 * RSA Builder
 *
 * Keeping ad copy consistent across dozens of ad groups is copy-paste
 * drudgery, and it shows: half the account runs last quarter's messaging.
 * This script builds responsive search ads from declared 'ad frames' -
 * reusable pools of headlines and descriptions with pinning rules. Label an
 * ad group with a frame's name and the next run gives it a uniform RSA,
 * inheriting the landing page from the ad group's existing ad. Update the
 * frame, and every labeled ad group gets the new copy on the next run.
 *
 * How an ad group is processed:
 *   1. Ad groups carrying a label that matches an AD_FRAMES key are
 *      targets.
 *   2. The frame's copy is compared against the ad group's enabled RSAs;
 *      if one already matches exactly, nothing happens.
 *   3. Otherwise a new RSA is created from the frame - pinned headlines
 *      and descriptions in their positions, fill headlines unpinned - with
 *      the final URL and display paths of the ad group's existing RSA.
 *      Old ads are NEVER paused or removed; retiring them is your
 *      decision, and the created label makes them easy to tell apart.
 *
 * Setup:
 *   1. Declare your frames in AD_FRAMES and create matching ad group
 *      labels in the account; label the ad groups to build.
 *   2. Run with PREVIEW_MODE: true first. Read the plan in the logs;
 *      nothing is changed in the account.
 *   3. Set PREVIEW_MODE: false and run (or schedule to keep copy synced).
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
    // false: create ads and labels.
    PREVIEW_MODE: true,

    // Reusable ad copy pools. The key doubles as the ad group label that
    // selects where the frame is built. HEADLINES_POS1/POS2 are pinned to
    // their positions; HEADLINES fill the rest unpinned. Google's limits:
    // 3-15 headlines (30 chars), 2-4 descriptions (90 chars).
    AD_FRAMES: {
        'RSA: Standard': {
            HEADLINES_POS1: ['Your Brand'],
            HEADLINES_POS2: ['Free Shipping Over 50'],
            HEADLINES: [
                'Shop The New Collection',
                '30-Day Free Returns',
                'Rated 4.8 By Customers',
            ],
            DESCRIPTIONS_POS1: ['The official store. Fast delivery, easy returns, secure checkout.'],
            DESCRIPTIONS: ['Browse thousands of products with free shipping on orders over 50.'],
        },
    },

    // Label applied to ads this script creates. Created if missing.
    CREATED_LABEL: 'RSA Builder: Created',

    // Campaigns whose name contains any of these are skipped.
    CAMPAIGN_EXCLUDE_PATTERNS: ['DSA', 'SHOPPING', 'PMAX'],

    // Stop this many milliseconds after the script starts.
    MAX_RUNTIME_MS: 27 * 60 * 1000,
};

function main() {
    validateConfig();

    const startTime = Date.now();
    const builder = new RsaBuilder(startTime);
    builder.build();
}

function validateConfig() {
    for (const frameName in CONFIG.AD_FRAMES) {
        const frame = CONFIG.AD_FRAMES[frameName];
        const headlines = (frame.HEADLINES_POS1 || [])
            .concat(frame.HEADLINES_POS2 || [])
            .concat(frame.HEADLINES || []);
        const descriptions = (frame.DESCRIPTIONS_POS1 || [])
            .concat(frame.DESCRIPTIONS || []);

        if (headlines.length < 3 || headlines.length > 15) {
            throw new Error('Frame "' + frameName + '" has ' + headlines.length +
                ' headlines - Google requires 3 to 15.');
        }
        if (descriptions.length < 2 || descriptions.length > 4) {
            throw new Error('Frame "' + frameName + '" has ' + descriptions.length +
                ' descriptions - Google requires 2 to 4.');
        }
        for (const headline of headlines) {
            if (headline.length > 30) {
                throw new Error('Headline "' + headline + '" exceeds 30 characters.');
            }
        }
        for (const description of descriptions) {
            if (description.length > 90) {
                throw new Error('Description "' + description + '" exceeds 90 characters.');
            }
        }
    }
}

function RsaBuilder(startTime) {

    this.build = function () {
        const counters = {
            adGroups: 0, upToDate: 0, created: 0,
            skipNoSourceAd: 0,
            timedOut: false,
        };

        if (!CONFIG.PREVIEW_MODE) {
            ensureCreatedLabel();
        }

        for (const frameName in CONFIG.AD_FRAMES) {
            const frame = CONFIG.AD_FRAMES[frameName];
            Logger.log('Building frame "' + frameName + '"...');

            const labelIterator = AdsApp.labels()
                .withCondition('label.name = \'' + frameName + '\'')
                .get();
            if (!labelIterator.hasNext()) {
                Logger.log('  Label "' + frameName + '" does not exist in the account - ' +
                    'no ad groups selected.');
                continue;
            }

            const adGroups = labelIterator.next().adGroups()
                .withCondition('ad_group.status IN (\'ENABLED\', \'PAUSED\')')
                .withCondition('campaign.status = \'ENABLED\'')
                .get();

            while (adGroups.hasNext()) {
                const adGroup = adGroups.next();
                if (isExcluded(adGroup.getCampaign().getName())) {
                    continue;
                }
                counters.adGroups++;

                processAdGroup(adGroup, frame, counters);

                if (Date.now() - startTime > CONFIG.MAX_RUNTIME_MS) {
                    counters.timedOut = true;
                    Logger.log('Approaching the execution time limit - stopping here; ' +
                        'the next run continues.');
                    break;
                }
            }
            if (counters.timedOut) {
                break;
            }
        }

        logSummary(counters);
    };

    function processAdGroup(adGroup, frame, counters) {
        // The existing enabled RSAs provide the landing page - and tell us
        // whether the frame is already built here.
        const existing = [];
        const ads = adGroup.ads()
            .withCondition('ad_group_ad.status = \'ENABLED\'')
            .withCondition('ad_group_ad.ad.type = \'RESPONSIVE_SEARCH_AD\'')
            .get();
        while (ads.hasNext()) {
            existing.push(ads.next().asType().responsiveSearchAd());
        }

        if (existing.length === 0) {
            counters.skipNoSourceAd++;
            Logger.log('  ' + adGroup.getName() + ': no enabled RSA to take the ' +
                'landing page from - skipped. Add one ad manually first.');
            return;
        }

        for (const ad of existing) {
            if (matchesFrame(ad, frame)) {
                counters.upToDate++;
                return;
            }
        }

        const source = existing[0];
        counters.created++;
        Logger.log('  ' + adGroup.getName() + ': creating RSA from frame (URL from ad ' +
            source.getId() + ')');
        if (CONFIG.PREVIEW_MODE) {
            return;
        }

        let builder = adGroup.newAd().responsiveSearchAdBuilder()
            .withFinalUrl(source.urls().getFinalUrl());
        if (source.getPath1()) {
            builder = builder.withPath1(source.getPath1());
        }
        if (source.getPath2()) {
            builder = builder.withPath2(source.getPath2());
        }
        builder = builder
            .withHeadlines(buildAssets(frame.HEADLINES_POS1, 'HEADLINE_1')
                .concat(buildAssets(frame.HEADLINES_POS2, 'HEADLINE_2'))
                .concat(frame.HEADLINES || []))
            .withDescriptions(buildAssets(frame.DESCRIPTIONS_POS1, 'DESCRIPTION_1')
                .concat(frame.DESCRIPTIONS || []));

        const operation = builder.build();
        if (operation.isSuccessful()) {
            operation.getResult().applyLabel(CONFIG.CREATED_LABEL);
        } else {
            Logger.log('  Ad creation failed in ' + adGroup.getName() + ': ' +
                JSON.stringify(operation.getErrors()));
        }
    }

    function buildAssets(texts, pinning) {
        return (texts || []).map(function (text) {
            return { text: text, pinning: pinning };
        });
    }

    /**
     * An ad matches the frame when its full headline and description sets
     * (text + pinning) equal the frame's, order-insensitively.
     */
    function matchesFrame(ad, frame) {
        const frameHeadlines = buildAssets(frame.HEADLINES_POS1, 'HEADLINE_1')
            .concat(buildAssets(frame.HEADLINES_POS2, 'HEADLINE_2'))
            .concat(buildAssets(frame.HEADLINES, undefined));
        const frameDescriptions = buildAssets(frame.DESCRIPTIONS_POS1, 'DESCRIPTION_1')
            .concat(buildAssets(frame.DESCRIPTIONS, undefined));

        return assetSetsEqual(ad.getHeadlines(), frameHeadlines) &&
            assetSetsEqual(ad.getDescriptions(), frameDescriptions);
    }

    function assetSetsEqual(actual, wanted) {
        if (actual.length !== wanted.length) {
            return false;
        }
        const key = function (asset) {
            return (asset.pinning || 'UNPINNED') + '|' + asset.text;
        };
        return actual.map(key).sort().join('\n') === wanted.map(key).sort().join('\n');
    }

    function ensureCreatedLabel() {
        const labelIterator = AdsApp.labels()
            .withCondition('label.name = \'' + CONFIG.CREATED_LABEL + '\'')
            .get();
        if (!labelIterator.hasNext()) {
            AdsApp.createLabel(CONFIG.CREATED_LABEL);
        }
    }

    function isExcluded(campaignName) {
        for (const pattern of CONFIG.CAMPAIGN_EXCLUDE_PATTERNS) {
            if (campaignName.toUpperCase().indexOf(pattern.toUpperCase()) !== -1) {
                return true;
            }
        }
        return false;
    }

    function logSummary(counters) {
        const preview = CONFIG.PREVIEW_MODE ? ' (PREVIEW MODE - nothing was changed)' : '';
        Logger.log([
            '',
            '========== Execution Summary' + preview + ' ==========',
            'Labeled ad groups examined: ' + counters.adGroups,
            'Already carrying the frame: ' + counters.upToDate,
            'Skipped (no enabled RSA to source the URL from): ' + counters.skipNoSourceAd,
            (counters.timedOut ? 'Stopped early near the execution time limit.' : ''),
            'Ads ' + (CONFIG.PREVIEW_MODE ? 'that would be created' : 'created') + ': ' +
            counters.created,
            '====================================================',
        ].join('\n'));
    }
}
