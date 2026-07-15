/**
 * Sitelink URL Checker
 *
 * Sitelinks outlive the pages they point to: seasonal landing pages get
 * retired, category URLs change, and the sitelink keeps serving - straight
 * into a 404 that Google renders under your otherwise healthy ad. Ad and
 * keyword URLs get checked (see landing-page-link-checker); sitelinks
 * almost never do. This script closes that gap: it collects every sitelink
 * URL in use at account, campaign and ad group level, fetches each one,
 * and emails a digest of the broken ones with enough context to fix them.
 *
 * How a URL is classified:
 *   OK           - responds 200 and contains none of the ERROR_TEXTS
 *   REDIRECT     - responds 3xx
 *   CLIENT_ERROR - responds 4xx (broken page)
 *   SERVER_ERROR - responds 5xx
 *   FETCH_FAILED - did not respond (DNS, timeout, SSL)
 *   TEXT_MATCH   - responds 200 but contains an ERROR_TEXTS marker
 *
 * The script is read-only: sitelink fixes belong in the shared asset (one
 * edit fixes every campaign using it), so the digest tells you which asset
 * to open, not which association to sever.
 *
 * Setup:
 *   1. Review CONFIG below - add your shop's out-of-stock wording to
 *      ERROR_TEXTS if sitelinks point at product-like pages.
 *   2. Run it; read the verdicts in the logs.
 *   3. Schedule daily and fill RECIPIENT_EMAILS.
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
    // Who receives the issue digest. Empty = log only.
    RECIPIENT_EMAILS: [],

    // Case-insensitive markers that flag a 200 page as broken anyway.
    ERROR_TEXTS: [],

    // URL fetch budget per run. Unique URLs beyond it wait for the next
    // run (fetching is the slow part; ~2-3 URLs/second).
    MAX_URLS_PER_RUN: 500,

    // Stop this many milliseconds after the script starts.
    MAX_RUNTIME_MS: 27 * 60 * 1000,
};

function main() {
    const startTime = Date.now();
    const checker = new SitelinkChecker(startTime);
    checker.check();
}

function SitelinkChecker(startTime) {

    this.check = function () {
        const counters = {
            sitelinks: 0, uniqueUrls: 0, fetched: 0, ok: 0, issues: 0,
            timedOut: false,
        };
        const issues = [];

        Logger.log('Collecting sitelink URLs in use...');
        // url -> array of {level, context, linkText} usages.
        const usagesByUrl = {};
        collectLevel('customer_asset', 'Account', usagesByUrl, counters);
        collectLevel('campaign_asset', 'Campaign', usagesByUrl, counters);
        collectLevel('ad_group_asset', 'Ad group', usagesByUrl, counters);

        const urls = Object.keys(usagesByUrl);
        counters.uniqueUrls = urls.length;
        const urlsToCheck = urls.slice(0, CONFIG.MAX_URLS_PER_RUN);
        if (urls.length > urlsToCheck.length) {
            Logger.log((urls.length - urlsToCheck.length) + ' URLs exceed MAX_URLS_PER_RUN ' +
                'and will be checked on later runs.');
        }

        Logger.log('Checking ' + urlsToCheck.length + ' unique sitelink URLs...');
        for (const url of urlsToCheck) {
            const verdict = classifyUrl(url);
            counters.fetched++;

            if (verdict.category === 'OK') {
                counters.ok++;
            } else {
                counters.issues++;
                issues.push({ url: url, verdict: verdict, usages: usagesByUrl[url] });
                Logger.log(verdict.category + ' (' + verdict.detail + '): ' + url +
                    ' [' + usagesByUrl[url].length + ' usage(s)]');
            }

            if (Date.now() - startTime > CONFIG.MAX_RUNTIME_MS) {
                counters.timedOut = true;
                Logger.log('Approaching the execution time limit - stopping here; ' +
                    'the next run continues.');
                break;
            }
        }

        if (issues.length > 0 && CONFIG.RECIPIENT_EMAILS.length > 0) {
            sendDigest(issues);
        }

        logSummary(counters);
    };

    /**
     * Sitelink assets linked at one level (account, campaign or ad group),
     * grouped under their first final URL.
     */
    function collectLevel(resource, levelName, usagesByUrl, counters) {
        const contextField = resource === 'customer_asset' ? '' :
            (resource === 'campaign_asset' ? 'campaign.name, ' : 'campaign.name, ad_group.name, ');
        const rows = AdsApp.search(
            'SELECT ' + contextField + 'asset.sitelink_asset.link_text, asset.final_urls ' +
            'FROM ' + resource + ' ' +
            'WHERE ' + resource + '.status = \'ENABLED\' ' +
            'AND asset.type = \'SITELINK\'');
        while (rows.hasNext()) {
            const row = rows.next();
            counters.sitelinks++;
            const finalUrls = row.asset.finalUrls || [];
            if (finalUrls.length === 0) {
                continue;
            }
            const url = finalUrls[0];
            if (!usagesByUrl[url]) {
                usagesByUrl[url] = [];
            }
            let context = levelName;
            if (row.campaign) {
                context += ': ' + row.campaign.name +
                    (row.adGroup ? ' > ' + row.adGroup.name : '');
            }
            usagesByUrl[url].push({
                context: context,
                linkText: row.asset.sitelinkAsset.linkText,
            });
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

    function sendDigest(issues) {
        const accountName = AdsApp.currentAccount().getName();
        const lines = ['Broken sitelink URLs in ' + accountName + ':', ''];
        for (const issue of issues) {
            lines.push(issue.verdict.category + ' (' + issue.verdict.detail + '): ' + issue.url);
            for (const usage of issue.usages) {
                lines.push('  "' + usage.linkText + '" @ ' + usage.context);
            }
            lines.push('');
        }
        lines.push('Fix the URL on the sitelink asset itself - one edit covers every ' +
            'campaign using it.');

        MailApp.sendEmail(
            CONFIG.RECIPIENT_EMAILS.join(','),
            'Broken sitelinks in ' + accountName + ': ' + issues.length + ' URL(s)',
            lines.join('\n'));
    }

    function logSummary(counters) {
        Logger.log([
            '',
            '========== Execution Summary ==========',
            'Sitelink usages collected: ' + counters.sitelinks +
            ' | unique URLs: ' + counters.uniqueUrls,
            'Checked this run: ' + counters.fetched,
            'Working: ' + counters.ok + ' | with issues: ' + counters.issues,
            (counters.timedOut ? 'Stopped early near the execution time limit.' : ''),
            '====================================================',
        ].join('\n'));
    }
}
