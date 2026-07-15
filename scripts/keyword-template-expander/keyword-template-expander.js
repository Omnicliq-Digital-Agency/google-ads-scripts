/**
 * Keyword Template Expander
 *
 * Accounts with a catalog dimension - brands, cities, models, materials -
 * need the same keyword pattern repeated dozens or hundreds of times:
 * "buy {brand} shoes" for every brand you carry, each pointing at the
 * brand's landing page. Building that by hand is slow; keeping it in sync
 * as the catalog changes is worse. This script does the expansion: you
 * mark template keywords with a label, and every template is multiplied by
 * your value list, substituting the placeholder in both the keyword text
 * and the final URL.
 *
 * How a keyword is created:
 *   1. Keywords labeled SEED_LABEL whose text AND final URL contain
 *      PLACEHOLDER are treated as templates. Seeds with a missing URL or
 *      missing placeholder are reported and skipped.
 *   2. Each template is expanded once per value: '{brand} shoes' with
 *      'nike' becomes 'nike shoes'; the URL placeholder is replaced with
 *      the value transformed per URL_VALUE_TRANSFORM (e.g. slugified).
 *   3. The new keyword inherits the template's match type and ad group,
 *      skips values already present in the ad group, and gets
 *      CREATED_LABEL for review and rollback.
 *
 * Templates themselves never serve - keep them paused; the script reads
 * paused seeds too.
 *
 * Setup:
 *   1. Label your template keywords (default label 'Seed') and put
 *      PLACEHOLDER in their text and final URL.
 *   2. Fill VALUES (or VALUES_LIST_NAME) with your catalog dimension.
 *   3. Run with PREVIEW_MODE: true first. Read the execution summary in
 *      the logs; nothing is changed in the account.
 *   4. Set PREVIEW_MODE: false and schedule (daily; new values and new
 *      seeds are picked up on the next run).
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

    // The token in template text and URLs that each value replaces.
    PLACEHOLDER: '{brand}',

    // The values to expand with (brands, cities, models, ...).
    VALUES: [],

    // Optional: also read values from this shared negative keyword list,
    // used purely as a registry maintained in the UI (do not attach it to
    // campaigns).
    VALUES_LIST_NAME: '',

    // Label marking template keywords. The templates should stay paused.
    SEED_LABEL: 'Seed',

    // Label applied to created keywords. Created automatically if missing.
    CREATED_LABEL: 'Template: Created',

    // How the value is written into the URL: 'none' keeps it as-is,
    // 'lowercase' lowercases it, 'slug' lowercases and turns spaces into
    // hyphens ('New Balance' -> 'new-balance').
    URL_VALUE_TRANSFORM: 'slug',

    // Only expand inside campaigns whose name contains this substring
    // ('' = wherever seeds are found).
    CAMPAIGN_NAME_FILTER: '',

    // Stop analysing this many milliseconds after the script starts,
    // leaving time to commit pending keywords before the 30-minute limit.
    MAX_RUNTIME_MS: 27 * 60 * 1000,
};

function main() {
    validateConfig();

    const startTime = Date.now();
    const expander = new TemplateExpander(startTime);
    expander.expand();
}

function validateConfig() {
    if (!CONFIG.PLACEHOLDER) {
        throw new Error('PLACEHOLDER must be set.');
    }
    if (CONFIG.VALUES.length === 0 && !CONFIG.VALUES_LIST_NAME) {
        throw new Error('No values configured - fill in VALUES or VALUES_LIST_NAME.');
    }
    if (['none', 'lowercase', 'slug'].indexOf(CONFIG.URL_VALUE_TRANSFORM) === -1) {
        throw new Error('URL_VALUE_TRANSFORM must be \'none\', \'lowercase\' or \'slug\'.');
    }
}

function TemplateExpander(startTime) {

    this.expand = function () {
        const values = collectValues();
        Logger.log(values.length + ' values loaded.');

        const counters = {
            seeds: 0, seedIssues: 0,
            expansions: 0, skipExists: 0,
            timedOut: false,
        };

        // ad group id -> set of existing keyword texts, for dedup.
        const existingTexts = collectExistingKeywordTexts();
        // creations grouped per ad group: {adGroup, keywords: [...]}.
        const pending = [];

        Logger.log('Collecting template keywords labeled "' + CONFIG.SEED_LABEL + '"...');
        const labelIterator = AdsApp.labels()
            .withCondition('label.name = \'' + CONFIG.SEED_LABEL + '\'')
            .get();
        if (!labelIterator.hasNext()) {
            Logger.log('Label "' + CONFIG.SEED_LABEL + '" does not exist in the account. Exiting.');
            return;
        }
        const seeds = labelIterator.next().keywords()
            .withCondition('ad_group_criterion.status IN (\'ENABLED\', \'PAUSED\')')
            .get();

        while (seeds.hasNext()) {
            const seed = seeds.next();
            if (CONFIG.CAMPAIGN_NAME_FILTER &&
                seed.getCampaign().getName().indexOf(CONFIG.CAMPAIGN_NAME_FILTER) === -1) {
                continue;
            }
            counters.seeds++;

            const text = seed.getText();
            const finalUrl = seed.urls().getFinalUrl();
            if (!finalUrl) {
                Logger.log('Seed "' + text + '" has no final URL - skipped.');
                counters.seedIssues++;
                continue;
            }
            if (text.indexOf(CONFIG.PLACEHOLDER) === -1 ||
                finalUrl.indexOf(CONFIG.PLACEHOLDER) === -1) {
                Logger.log('Seed "' + text + '" is missing the placeholder ' +
                    CONFIG.PLACEHOLDER + ' in its text or URL - skipped.');
                counters.seedIssues++;
                continue;
            }

            const adGroup = seed.getAdGroup();
            const adGroupId = adGroup.getId();
            const matchType = seed.getMatchType();
            const creations = [];

            for (const value of values) {
                const newText = replaceAll(text, CONFIG.PLACEHOLDER, value);
                if (existingTexts[adGroupId] && existingTexts[adGroupId][newText.toLowerCase()]) {
                    counters.skipExists++;
                    continue;
                }
                if (!existingTexts[adGroupId]) {
                    existingTexts[adGroupId] = {};
                }
                existingTexts[adGroupId][newText.toLowerCase()] = true;

                creations.push({
                    text: newText,
                    matchType: matchType,
                    finalUrl: replaceAll(finalUrl, CONFIG.PLACEHOLDER, transformForUrl(value)),
                });
                counters.expansions++;
                Logger.log('Queueing [' + matchType + '] "' + newText + '" in "' +
                    adGroup.getName() + '"');
            }

            if (creations.length > 0) {
                pending.push({ adGroup: adGroup, keywords: creations });
            }

            if (Date.now() - startTime > CONFIG.MAX_RUNTIME_MS) {
                counters.timedOut = true;
                Logger.log('Approaching the execution time limit - committing what was analysed so far.');
                break;
            }
        }

        if (!CONFIG.PREVIEW_MODE && counters.expansions > 0) {
            ensureCreatedLabel();
            commit(pending);
        }

        logSummary(counters, values.length);
    };

    function commit(pending) {
        for (const entry of pending) {
            const operations = [];
            for (const keyword of entry.keywords) {
                operations.push(entry.adGroup.newKeywordBuilder()
                    .withText(decorateKeywordText(keyword.text, keyword.matchType))
                    .withFinalUrl(keyword.finalUrl)
                    .build());
            }
            for (const operation of operations) {
                if (operation.isSuccessful()) {
                    operation.getResult().applyLabel(CONFIG.CREATED_LABEL);
                } else {
                    Logger.log('Keyword creation failed: ' +
                        JSON.stringify(operation.getErrors()));
                }
            }
        }
    }

    /**
     * All positive keyword texts per ad group (lowercased), so expansions
     * that already exist - by any earlier run or by hand - are skipped.
     */
    function collectExistingKeywordTexts() {
        const texts = {};
        const rows = AdsApp.search(
            'SELECT ad_group.id, ad_group_criterion.keyword.text ' +
            'FROM ad_group_criterion ' +
            'WHERE campaign.status IN (\'ENABLED\', \'PAUSED\') ' +
            'AND ad_group.status IN (\'ENABLED\', \'PAUSED\') ' +
            'AND ad_group_criterion.status IN (\'ENABLED\', \'PAUSED\') ' +
            'AND ad_group_criterion.type = \'KEYWORD\' ' +
            'AND ad_group_criterion.negative = false');
        while (rows.hasNext()) {
            const row = rows.next();
            if (row.adGroupCriterion.keyword === undefined) {
                continue;
            }
            const adGroupId = row.adGroup.id;
            if (!texts[adGroupId]) {
                texts[adGroupId] = {};
            }
            texts[adGroupId][row.adGroupCriterion.keyword.text.toLowerCase()] = true;
        }
        return texts;
    }

    function collectValues() {
        const seen = {};
        const values = [];
        const register = function (text) {
            const clean = String(text).replace(/^["\[]|["\]]$/g, '').trim();
            if (clean && !seen[clean.toLowerCase()]) {
                seen[clean.toLowerCase()] = true;
                values.push(clean);
            }
        };

        for (const value of CONFIG.VALUES) {
            register(value);
        }

        if (CONFIG.VALUES_LIST_NAME) {
            const lists = AdsApp.negativeKeywordLists()
                .withCondition('Name = \'' + CONFIG.VALUES_LIST_NAME + '\'')
                .get();
            if (!lists.hasNext()) {
                throw new Error('Values list "' + CONFIG.VALUES_LIST_NAME + '" was not found.');
            }
            const entries = lists.next().negativeKeywords().get();
            while (entries.hasNext()) {
                register(entries.next().getText());
            }
        }

        return values;
    }

    function ensureCreatedLabel() {
        const labelIterator = AdsApp.labels()
            .withCondition('label.name = \'' + CONFIG.CREATED_LABEL + '\'')
            .get();
        if (!labelIterator.hasNext()) {
            AdsApp.createLabel(CONFIG.CREATED_LABEL);
        }
    }

    function transformForUrl(value) {
        if (CONFIG.URL_VALUE_TRANSFORM === 'lowercase') {
            return value.toLowerCase();
        }
        if (CONFIG.URL_VALUE_TRANSFORM === 'slug') {
            return value.toLowerCase().replace(/\s+/g, '-');
        }
        return value;
    }

    function decorateKeywordText(text, matchType) {
        if (matchType === 'EXACT') {
            return '[' + text + ']';
        }
        if (matchType === 'PHRASE') {
            return '"' + text + '"';
        }
        return text;
    }

    function replaceAll(text, token, replacement) {
        return text.split(token).join(replacement);
    }

    function logSummary(counters, valueCount) {
        const preview = CONFIG.PREVIEW_MODE ? ' (PREVIEW MODE - nothing was changed)' : '';
        Logger.log([
            '',
            '========== Execution Summary' + preview + ' ==========',
            'Values: ' + valueCount + ' | template keywords: ' + counters.seeds,
            'Template issues (skipped): ' + counters.seedIssues,
            'Already existing expansions skipped: ' + counters.skipExists,
            (counters.timedOut ? 'Stopped early near the execution time limit.' : ''),
            'Keywords ' + (CONFIG.PREVIEW_MODE ? 'that would be created' : 'created') + ': ' +
            counters.expansions,
            '====================================================',
        ].join('\n'));
    }
}
