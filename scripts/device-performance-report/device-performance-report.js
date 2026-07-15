/**
 * Device Performance Report
 *
 * Mobile clicks are not desktop clicks: on many accounts one device
 * converts at half the cost of the other, and the campaign averages hide
 * it. This script breaks every campaign down by device, compares each
 * device's cost per conversion against the campaign's own average, and
 * suggests the bid adjustment that would price the gap - as a report, not
 * a change.
 *
 * How a suggestion is computed:
 *   1. Cost, conversions and value are aggregated per campaign x device
 *      over the lookback window.
 *   2. Devices with fewer than MIN_CONVERSIONS in the window are reported
 *      as 'not enough data' - no suggestion on noise.
 *   3. Suggested modifier = campaign avg cost/conv / device cost/conv - 1,
 *      capped at +/-MAX_SUGGESTION. A device converting 30% cheaper than
 *      the campaign average suggests roughly +30%.
 *
 * The script is read-only: bid adjustments interact with Smart Bidding
 * (which already adjusts by device on tROAS/tCPA), so the suggestions are
 * decision support, not automation.
 *
 * Setup:
 *   1. Review CONFIG below.
 *   2. Run it; read the per-campaign device table in the logs.
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
    // Who receives the report. Empty = log only.
    RECIPIENT_EMAILS: [],

    // How many days to analyse (ending yesterday).
    LOOKBACK_DAYS: 60,

    // A campaign x device cell needs at least this many conversions before
    // a suggestion is made.
    MIN_CONVERSIONS: 10,

    // Suggestions are capped at +/- this share (0.5 = 50%).
    MAX_SUGGESTION: 0.5,

    // Only report deviations larger than this share (0.1 = 10%) - smaller
    // gaps aren't worth a bid adjustment.
    MIN_DEVIATION: 0.1,

    // Campaigns whose name contains any of these are skipped.
    CAMPAIGN_EXCLUDE_PATTERNS: [],
};

const DEVICES = ['MOBILE', 'DESKTOP', 'TABLET'];

function main() {
    const report = new DeviceReport();
    report.run();
}

function DeviceReport() {

    this.run = function () {
        const dateFrom = formattedDate(-CONFIG.LOOKBACK_DAYS);
        const dateTo = formattedDate(-1);
        const counters = { campaigns: 0, suggestions: 0, lowData: 0 };
        const findings = [];

        Logger.log('Aggregating by campaign and device (' + dateFrom + ' to ' + dateTo + ')...');
        const byCampaign = {};
        const rows = AdsApp.search(
            'SELECT campaign.name, segments.device, metrics.cost_micros, ' +
            'metrics.conversions ' +
            'FROM campaign ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            'AND segments.date BETWEEN \'' + dateFrom + '\' AND \'' + dateTo + '\'');
        while (rows.hasNext()) {
            const row = rows.next();
            if (isExcluded(row.campaign.name)) {
                continue;
            }
            const device = row.segments.device;
            if (DEVICES.indexOf(device) === -1) {
                continue;
            }
            const name = row.campaign.name;
            if (!byCampaign[name]) {
                counters.campaigns++;
                byCampaign[name] = {};
            }
            if (!byCampaign[name][device]) {
                byCampaign[name][device] = { cost: 0, conversions: 0 };
            }
            byCampaign[name][device].cost +=
                (parseInt(row.metrics.costMicros, 10) || 0) / 1000000;
            byCampaign[name][device].conversions += Number(row.metrics.conversions) || 0;
        }

        for (const name in byCampaign) {
            let totalCost = 0;
            let totalConversions = 0;
            for (const device in byCampaign[name]) {
                totalCost += byCampaign[name][device].cost;
                totalConversions += byCampaign[name][device].conversions;
            }
            if (totalConversions === 0) {
                continue;
            }
            const campaignCpa = totalCost / totalConversions;

            for (const device in byCampaign[name]) {
                const cell = byCampaign[name][device];
                if (cell.conversions < CONFIG.MIN_CONVERSIONS) {
                    counters.lowData++;
                    continue;
                }
                const deviceCpa = cell.cost / cell.conversions;
                let suggestion = campaignCpa / deviceCpa - 1;
                if (Math.abs(suggestion) < CONFIG.MIN_DEVIATION) {
                    continue;
                }
                suggestion = Math.max(-CONFIG.MAX_SUGGESTION,
                    Math.min(CONFIG.MAX_SUGGESTION, suggestion));
                counters.suggestions++;
                const line = name + ' | ' + device + ': cost/conv ' + round(deviceCpa, 2) +
                    ' vs campaign ' + round(campaignCpa, 2) + ' -> suggested modifier ' +
                    (suggestion > 0 ? '+' : '') + Math.round(suggestion * 100) + '%';
                findings.push(line);
                Logger.log(line);
            }
        }

        if (findings.length > 0 && CONFIG.RECIPIENT_EMAILS.length > 0) {
            MailApp.sendEmail(
                CONFIG.RECIPIENT_EMAILS.join(','),
                'Device performance report: ' + findings.length + ' suggestion(s) in ' +
                AdsApp.currentAccount().getName(),
                ['Device bid adjustment suggestions (' + dateFrom + ' to ' + dateTo + '):', '']
                    .concat(findings)
                    .concat(['', 'Suggestions price the cost/conv gap vs the campaign ' +
                        'average. Review against your bid strategy before applying.'])
                    .join('\n'));
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
            'Campaigns analysed: ' + counters.campaigns,
            'Suggestions: ' + counters.suggestions +
            ' | device cells below ' + CONFIG.MIN_CONVERSIONS + ' conversions: ' +
            counters.lowData,
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
