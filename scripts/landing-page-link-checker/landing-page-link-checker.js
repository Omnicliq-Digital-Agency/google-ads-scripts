/**
 * Landing Page Link Checker
 *
 * The ad is perfect, the bid is right — and the landing page is a 404.
 * Google won't tell you; the click still costs money. This script fetches
 * every final URL your keywords and ads actually use, classifies each page,
 * labels the affected entities, and (optionally) pauses them until the page
 * recovers.
 *
 * How a URL is classified:
 *   OK           - responds 200 and contains none of the ERROR_TEXTS
 *   REDIRECT     - responds 3xx (the destination moved; your tracking and
 *                  quality score suffer even though users arrive somewhere)
 *   CLIENT_ERROR - responds 4xx (broken page)
 *   SERVER_ERROR - responds 5xx (site trouble)
 *   FETCH_FAILED - did not respond (DNS, timeout, SSL)
 *   TEXT_MATCH   - responds 200 but the page contains one of your
 *                  ERROR_TEXTS markers ('out of stock', '0 results', ...)
 *
 * What happens to keywords/ads pointing at a bad URL:
 *   - They get the category's label, so you can see and filter the damage.
 *   - If the category's PAUSE flag is on, enabled entities are paused.
 *   - When the URL recovers, labels are removed and - if ENABLE_RECOVERED
 *     is on - entities that carry a checker label AND are paused are
 *     re-enabled. Only labeled entities are ever re-enabled: the label marks
 *     them as paused by this script, not by a human.
 *
 * Setup:
 *   1. Review CONFIG below - especially ERROR_TEXTS for your shop's
 *      out-of-stock wording, and the PAUSE flags (all off by default).
 *   2. Run with PREVIEW_MODE: true first. Read the execution summary in the
 *      logs; nothing is changed in the account.
 *   3. Set PREVIEW_MODE: false and schedule (daily; large accounts spread
 *      the work across runs via MAX_URLS_PER_RUN).
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
    // false: apply labels, pauses and re-enables, send the digest email.
    PREVIEW_MODE: true,

    // Who receives the issue digest. Empty = no email.
    RECIPIENT_EMAILS: [],

    // Case-insensitive markers that flag a 200 page as broken anyway.
    // Add your shop's wording: 'out of stock', 'no results found', ...
    ERROR_TEXTS: [],

    // Pause enabled keywords/ads per category. REDIRECT is often survivable;
    // hard errors are the ones that burn money.
    PAUSE_ON: {
        REDIRECT: false,
        CLIENT_ERROR: false,
        SERVER_ERROR: false,
        FETCH_FAILED: false,
        TEXT_MATCH: false,
    },

    // Re-enable paused entities whose URL works again - only ones still
    // carrying a checker label (i.e. paused by this script, not by a human).
    ENABLE_RECOVERED: true,

    // Labels per category. Created automatically if missing.
    LABELS: {
        REDIRECT: 'Link Check: 3xx',
        CLIENT_ERROR: 'Link Check: 4xx',
        SERVER_ERROR: 'Link Check: 5xx',
        FETCH_FAILED: 'Link Check: Unreachable',
        TEXT_MATCH: 'Link Check: Page Text',
    },

    // Only check campaigns whose name contains this substring ('' = all
    // enabled search campaigns).
    CAMPAIGN_NAME_FILTER: '',

    // Campaigns whose name contains any of these are skipped.
    CAMPAIGN_EXCLUDE_PATTERNS: ['SHOPPING', 'PMAX'],

    // URL fetch budget per run. Unique URLs beyond it wait for the next run
    // (fetching is the slow part; ~2-3 URLs/second).
    MAX_URLS_PER_RUN: 800,

    // Stop this many milliseconds after the script starts.
    MAX_RUNTIME_MS: 27 * 60 * 1000,
};

const CATEGORIES = ['REDIRECT', 'CLIENT_ERROR', 'SERVER_ERROR', 'FETCH_FAILED', 'TEXT_MATCH'];

function main() {
    validateConfig();

    const startTime = Date.now();
    const checker = new LinkChecker(startTime);
    checker.check();
}

function validateConfig() {
    for (const category of CATEGORIES) {
        if (!CONFIG.LABELS[category]) {
            throw new Error('LABELS.' + category + ' must not be empty.');
        }
        if (CONFIG.PAUSE_ON[category] === undefined) {
            throw new Error('PAUSE_ON.' + category + ' is missing.');
        }
    }
}

function LinkChecker(startTime) {

    this.check = function () {
        const counters = {
            keywords: 0, ads: 0, uniqueUrls: 0, fetched: 0,
            ok: 0, issues: 0,
            labeled: 0, paused: 0, recovered: 0,
            timedOut: false,
        };
        const issues = [];

        // url -> array of {entity, kind, enabled} sharing that final URL.
        const entitiesByUrl = {};

        Logger.log('Collecting keyword and ad final URLs...');
        collectEntities(entitiesByUrl, counters);

        const urls = Object.keys(entitiesByUrl);
        counters.uniqueUrls = urls.length;
        const urlsToCheck = urls.slice(0, CONFIG.MAX_URLS_PER_RUN);
        if (urls.length > urlsToCheck.length) {
            Logger.log((urls.length - urlsToCheck.length) + ' URLs exceed MAX_URLS_PER_RUN ' +
                'and will be checked on later runs.');
        }

        if (!CONFIG.PREVIEW_MODE) {
            ensureLabels();
        }

        Logger.log('Checking ' + urlsToCheck.length + ' unique URLs...');
        for (const url of urlsToCheck) {
            const verdict = classifyUrl(url);
            counters.fetched++;

            if (verdict.category === 'OK') {
                counters.ok++;
                for (const ref of entitiesByUrl[url]) {
                    counters.recovered += clearChecker(ref) ? 1 : 0;
                }
            } else {
                counters.issues++;
                issues.push({ url: url, verdict: verdict, count: entitiesByUrl[url].length });
                Logger.log(verdict.category + ' (' + verdict.detail + '): ' + url +
                    ' [' + entitiesByUrl[url].length + ' entities]');
                for (const ref of entitiesByUrl[url]) {
                    applyChecker(ref, verdict.category, counters);
                }
            }

            if (Date.now() - startTime > CONFIG.MAX_RUNTIME_MS) {
                counters.timedOut = true;
                Logger.log('Approaching the execution time limit - stopping here; ' +
                    'the next run continues.');
                break;
            }
        }

        if (!CONFIG.PREVIEW_MODE && issues.length > 0 && CONFIG.RECIPIENT_EMAILS.length > 0) {
            sendDigest(issues);
        }

        logSummary(counters);
    };

    /**
     * Iterates enabled keywords and ads of qualifying campaigns, grouping
     * them under their final URL.
     */
    function collectEntities(entitiesByUrl, counters) {
        const register = function (entity, kind, counters) {
            const finalUrl = entity.urls().getFinalUrl();
            if (!finalUrl) {
                return;
            }
            if (kind === 'keyword') {
                counters.keywords++;
            } else {
                counters.ads++;
            }
            const url = decodeURI(finalUrl);
            if (!entitiesByUrl[url]) {
                entitiesByUrl[url] = [];
            }
            entitiesByUrl[url].push({ entity: entity, kind: kind });
        };

        const campaigns = AdsApp.campaigns()
            .withCondition('campaign.status = \'ENABLED\'')
            .get();
        while (campaigns.hasNext()) {
            const campaign = campaigns.next();
            if (!campaignQualifies(campaign.getName())) {
                continue;
            }

            const keywords = campaign.keywords()
                .withCondition('ad_group_criterion.status IN (\'ENABLED\', \'PAUSED\')')
                .get();
            while (keywords.hasNext()) {
                register(keywords.next(), 'keyword', counters);
            }

            const ads = campaign.ads()
                .withCondition('ad_group_ad.status IN (\'ENABLED\', \'PAUSED\')')
                .get();
            while (ads.hasNext()) {
                register(ads.next(), 'ad', counters);
            }
        }
    }

    /**
     * Fetches one URL without following redirects and classifies it.
     */
    function classifyUrl(url) {
        let response;
        try {
            response = UrlFetchApp.fetch(url, {
                muteHttpExceptions: true,
                followRedirects: false,
                validateHttpsCertificates: true,
            });
        } catch (e) {
            return { category: 'FETCH_FAILED', detail: e.message };
        }

        const code = response.getResponseCode();
        if (code >= 500) {
            return { category: 'SERVER_ERROR', detail: 'HTTP ' + code };
        }
        if (code >= 400) {
            return { category: 'CLIENT_ERROR', detail: 'HTTP ' + code };
        }
        if (code >= 300) {
            return { category: 'REDIRECT', detail: 'HTTP ' + code };
        }

        if (CONFIG.ERROR_TEXTS.length > 0) {
            const content = response.getContentText().toLowerCase();
            for (const marker of CONFIG.ERROR_TEXTS) {
                if (content.indexOf(marker.toLowerCase()) !== -1) {
                    return { category: 'TEXT_MATCH', detail: 'contains "' + marker + '"' };
                }
            }
        }

        return { category: 'OK', detail: 'HTTP ' + code };
    }

    /**
     * Labels a keyword/ad for its category, replacing any other checker
     * label, and pauses it when the category's flag is on.
     */
    function applyChecker(ref, category, counters) {
        if (CONFIG.PREVIEW_MODE) {
            counters.labeled++;
            if (CONFIG.PAUSE_ON[category] && ref.entity.isEnabled()) {
                counters.paused++;
            }
            return;
        }

        const currentLabels = getCheckerLabels(ref.entity);
        for (const labelName of currentLabels) {
            if (labelName !== CONFIG.LABELS[category]) {
                ref.entity.removeLabel(labelName);
            }
        }
        if (currentLabels.indexOf(CONFIG.LABELS[category]) === -1) {
            ref.entity.applyLabel(CONFIG.LABELS[category]);
            counters.labeled++;
        }

        if (CONFIG.PAUSE_ON[category] && ref.entity.isEnabled()) {
            ref.entity.pause();
            counters.paused++;
        }
    }

    /**
     * Removes checker labels from a recovered entity; re-enables it when it
     * was paused while carrying a checker label. Returns whether the entity
     * was re-enabled.
     */
    function clearChecker(ref) {
        if (CONFIG.PREVIEW_MODE) {
            return false;
        }

        const currentLabels = getCheckerLabels(ref.entity);
        if (currentLabels.length === 0) {
            return false;
        }
        for (const labelName of currentLabels) {
            ref.entity.removeLabel(labelName);
        }
        if (CONFIG.ENABLE_RECOVERED && ref.entity.isPaused()) {
            ref.entity.enable();
            return true;
        }
        return false;
    }

    function getCheckerLabels(entity) {
        const checkerLabelNames = CATEGORIES.map(function (category) {
            return CONFIG.LABELS[category];
        });
        const names = [];
        const labelIterator = entity.labels().get();
        while (labelIterator.hasNext()) {
            const name = labelIterator.next().getName();
            if (checkerLabelNames.indexOf(name) !== -1) {
                names.push(name);
            }
        }
        return names;
    }

    function ensureLabels() {
        const existing = {};
        const labelIterator = AdsApp.labels().get();
        while (labelIterator.hasNext()) {
            existing[labelIterator.next().getName()] = true;
        }
        for (const category of CATEGORIES) {
            if (!existing[CONFIG.LABELS[category]]) {
                AdsApp.createLabel(CONFIG.LABELS[category]);
            }
        }
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

    function sendDigest(issues) {
        const accountName = AdsApp.currentAccount().getName();
        const lines = ['Landing page issues in ' + accountName + ':', ''];
        for (const issue of issues) {
            lines.push(issue.verdict.category + ' (' + issue.verdict.detail + '): ' + issue.url);
            lines.push('  Affected keywords/ads: ' + issue.count);
        }

        MailApp.sendEmail(
            CONFIG.RECIPIENT_EMAILS.join(','),
            'Landing page issues in ' + accountName + ': ' + issues.length + ' URL(s)',
            lines.join('\n'));
    }

    function logSummary(counters) {
        const preview = CONFIG.PREVIEW_MODE ? ' (PREVIEW MODE - nothing was changed)' : '';
        Logger.log([
            '',
            '========== Execution Summary' + preview + ' ==========',
            'Entities collected: ' + counters.keywords + ' keywords, ' + counters.ads + ' ads',
            'Unique URLs: ' + counters.uniqueUrls + ' | checked this run: ' + counters.fetched,
            'Working: ' + counters.ok + ' | with issues: ' + counters.issues,
            'Entities ' + (CONFIG.PREVIEW_MODE ? 'that would be' : '') + ' labeled: ' +
            counters.labeled + ', paused: ' + counters.paused +
            ', re-enabled after recovery: ' + counters.recovered,
            (counters.timedOut ? 'Stopped early near the execution time limit.' : ''),
            '====================================================',
        ].join('\n'));
    }
}
