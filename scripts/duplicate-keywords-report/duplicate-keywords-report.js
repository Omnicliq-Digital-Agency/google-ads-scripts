/**
 * Duplicate Keywords Report
 *
 * The same keyword in two ad groups splits its own history: two Quality
 * Scores, two ad tests, and Google picking the entry point per auction.
 * Duplicates accumulate through restructures and bulk uploads, and nobody
 * audits for them by hand. This script finds every keyword text + match
 * type that lives in more than one enabled ad group, compares the copies'
 * performance side by side, and recommends the survivor.
 *
 * How duplicates are judged:
 *   1. Keywords are normalised (lowercased, whitespace collapsed) and
 *      grouped by text + match type across enabled campaigns.
 *   2. Groups with more than one member are duplicates. The recommended
 *      survivor is the copy with the most conversions, then clicks, then
 *      the lower cost.
 *   3. The full comparison lands in the log and the optional digest -
 *      nothing is paused; consolidation is a restructure decision.
 *
 * Setup:
 *   1. Review CONFIG below.
 *   2. Run it; read the duplicate groups in the logs.
 *   3. Schedule monthly and fill RECIPIENT_EMAILS.
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
    // Who receives the digest. Empty = log only.
    RECIPIENT_EMAILS: [],

    // Performance window for the side-by-side comparison (ending
    // yesterday).
    LOOKBACK_DAYS: 90,

    // Duplicates across different campaigns only count when true is off -
    // set to true to also report duplicates within the same campaign only.
    // false: every cross-ad-group duplicate is reported.
    SAME_CAMPAIGN_ONLY: false,

    // Campaigns whose name contains any of these are skipped.
    CAMPAIGN_EXCLUDE_PATTERNS: ['DSA', 'SHOPPING', 'PMAX'],
};

function main() {
    const report = new DuplicateReport();
    report.run();
}

function DuplicateReport() {

    this.run = function () {
        const dateFrom = formattedDate(-CONFIG.LOOKBACK_DAYS);
        const dateTo = formattedDate(-1);
        const counters = { keywords: 0, groups: 0, copies: 0 };

        Logger.log('Collecting keywords (' + dateFrom + ' to ' + dateTo + ')...');
        const byKey = {};
        const rows = AdsApp.search(
            'SELECT campaign.name, ad_group.name, ad_group_criterion.keyword.text, ' +
            'ad_group_criterion.keyword.match_type, metrics.clicks, ' +
            'metrics.cost_micros, metrics.conversions ' +
            'FROM keyword_view ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            'AND ad_group.status = \'ENABLED\' ' +
            'AND ad_group_criterion.status = \'ENABLED\' ' +
            'AND segments.date BETWEEN \'' + dateFrom + '\' AND \'' + dateTo + '\'');
        while (rows.hasNext()) {
            const row = rows.next();
            if (isExcluded(row.campaign.name)) {
                continue;
            }
            const normalized = row.adGroupCriterion.keyword.text.toLowerCase()
                .replace(/\s+/g, ' ').trim();
            const key = normalized + '|' + row.adGroupCriterion.keyword.matchType;
            const placeKey = row.campaign.name + '>' + row.adGroup.name;
            if (!byKey[key]) {
                byKey[key] = {};
            }
            if (!byKey[key][placeKey]) {
                counters.keywords++;
                byKey[key][placeKey] = {
                    campaign: row.campaign.name,
                    adGroup: row.adGroup.name,
                    text: normalized,
                    matchType: row.adGroupCriterion.keyword.matchType,
                    clicks: 0, cost: 0, conversions: 0,
                };
            }
            const entry = byKey[key][placeKey];
            entry.clicks += parseInt(row.metrics.clicks, 10) || 0;
            entry.cost += (parseInt(row.metrics.costMicros, 10) || 0) / 1000000;
            entry.conversions += Number(row.metrics.conversions) || 0;
        }

        const reportLines = [];
        for (const key in byKey) {
            const places = Object.keys(byKey[key]);
            if (places.length < 2) {
                continue;
            }
            const copies = places.map(function (placeKey) {
                return byKey[key][placeKey];
            });
            if (CONFIG.SAME_CAMPAIGN_ONLY) {
                const campaigns = {};
                for (const copy of copies) {
                    campaigns[copy.campaign] = (campaigns[copy.campaign] || 0) + 1;
                }
                let hasIntraCampaign = false;
                for (const campaign in campaigns) {
                    if (campaigns[campaign] > 1) {
                        hasIntraCampaign = true;
                    }
                }
                if (!hasIntraCampaign) {
                    continue;
                }
            }
            counters.groups++;
            counters.copies += copies.length;

            copies.sort(function (a, b) {
                return (b.conversions - a.conversions) || (b.clicks - a.clicks) ||
                    (a.cost - b.cost);
            });
            reportLines.push('[' + copies[0].matchType + '] "' + copies[0].text + '" x' +
                copies.length + ':');
            for (let i = 0; i < copies.length; i++) {
                const copy = copies[i];
                reportLines.push('  ' + (i === 0 ? 'KEEP  ' : 'review') + ' ' +
                    copy.campaign + ' > ' + copy.adGroup + ' | ' +
                    round(copy.conversions, 2) + ' conv, ' + copy.clicks + ' clicks, ' +
                    round(copy.cost, 2) + ' cost');
            }
        }
        for (const line of reportLines) {
            Logger.log(line);
        }

        if (reportLines.length > 0 && CONFIG.RECIPIENT_EMAILS.length > 0) {
            MailApp.sendEmail(
                CONFIG.RECIPIENT_EMAILS.join(','),
                'Duplicate keywords: ' + counters.groups + ' group(s) in ' +
                AdsApp.currentAccount().getName(),
                ['Duplicate keywords (' + dateFrom + ' to ' + dateTo + '), survivor first:', '']
                    .concat(reportLines).join('\n'));
        }

        logSummary(counters);
    };

    function isExcluded(campaignName) {
        for (const pattern of CONFIG.CAMPAIGN_EXCLUDE_PATTERNS) {
            if (campaignName.toUpperCase().indexOf(pattern.toUpperCase()) !== -1) {
                return true;
            }
        }
        return false;
    }

    function logSummary(counters) {
        Logger.log([
            '',
            '========== Execution Summary ==========',
            'Distinct keyword placements: ' + counters.keywords,
            'Duplicate groups: ' + counters.groups + ' covering ' + counters.copies +
            ' keyword copies',
            '====================================================',
        ].join('\n'));
    }
}

function formattedDate(daysShift) {
    const date = new Date();
    date.setDate(date.getDate() + daysShift);
    return Utilities.formatDate(date, AdsApp.currentAccount().getTimeZone(), 'yyyy-MM-dd');
}

function round(value, decimals) {
    return Number(Math.round(value + 'e' + decimals) + 'e-' + decimals);
}
