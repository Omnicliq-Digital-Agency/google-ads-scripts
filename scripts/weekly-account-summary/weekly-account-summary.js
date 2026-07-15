/**
 * Weekly Account Summary
 *
 * The Monday morning question is always the same: what happened last week,
 * and what moved? This script answers it in one email: last week's core
 * metrics against the week before, plus the campaigns that moved the
 * numbers most - biggest spend increases, biggest conversion drops - so
 * the first coffee goes to the right campaign.
 *
 * What the email contains:
 *   1. Account totals week-over-week: cost, clicks, impressions,
 *      conversions, conversion value, with the derived CPC, conv. rate,
 *      cost/conv and ROAS.
 *   2. Movers: campaigns whose cost or conversions changed by at least
 *      MOVER_THRESHOLD (relative) and MIN_COST_FOR_MOVER (absolute),
 *      ranked by the size of the change.
 *
 * Read-only, obviously.
 *
 * Setup:
 *   1. Fill RECIPIENT_EMAILS.
 *   2. Schedule weekly, Monday early morning.
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
    // Who receives the summary. Empty = log only.
    RECIPIENT_EMAILS: [],

    // A campaign is a mover when cost or conversions changed by at least
    // this relative share vs the previous week (0.25 = 25%)...
    MOVER_THRESHOLD: 0.25,

    // ...and its cost in either week was at least this (account currency).
    MIN_COST_FOR_MOVER: 20,

    // How many movers to list.
    MAX_MOVERS: 10,

    // Campaigns whose name contains any of these are skipped.
    CAMPAIGN_EXCLUDE_PATTERNS: [],
};

const TOTALS_METRICS = ['cost', 'clicks', 'impressions', 'conversions', 'value'];

function main() {
    const summary = new WeeklySummary();
    summary.run();
}

function WeeklySummary() {

    this.run = function () {
        // Last full week = the 7 days ending yesterday; previous the 7 before.
        const lastWeek = readWeek(-7, -1);
        const previousWeek = readWeek(-14, -8);

        const lines = ['Weekly summary for ' + AdsApp.currentAccount().getName() +
            ' (' + formattedDate(-7) + ' to ' + formattedDate(-1) +
            ' vs previous week):', ''];

        lines.push(totalsBlock(lastWeek.totals, previousWeek.totals));
        lines.push('');

        const movers = findMovers(lastWeek.byCampaign, previousWeek.byCampaign);
        if (movers.length > 0) {
            lines.push('== Movers ==');
            for (const mover of movers.slice(0, CONFIG.MAX_MOVERS)) {
                lines.push('  ' + mover);
            }
        } else {
            lines.push('No campaign moved more than ' +
                Math.round(CONFIG.MOVER_THRESHOLD * 100) + '% week-over-week.');
        }

        for (const line of lines) {
            Logger.log(line);
        }
        if (CONFIG.RECIPIENT_EMAILS.length > 0) {
            MailApp.sendEmail(
                CONFIG.RECIPIENT_EMAILS.join(','),
                'Weekly summary: ' + AdsApp.currentAccount().getName(),
                lines.join('\n'));
        }

        Logger.log('\n========== Execution Summary ==========\n' +
            'Campaigns compared: ' + Object.keys(lastWeek.byCampaign).length +
            ' | movers: ' + movers.length +
            '\n====================================================');
    };

    function readWeek(fromShift, toShift) {
        const totals = { cost: 0, clicks: 0, impressions: 0, conversions: 0, value: 0 };
        const byCampaign = {};
        const rows = AdsApp.search(
            'SELECT campaign.name, metrics.cost_micros, metrics.clicks, ' +
            'metrics.impressions, metrics.conversions, metrics.conversions_value ' +
            'FROM campaign ' +
            'WHERE segments.date BETWEEN \'' + formattedDate(fromShift) + '\' AND \'' +
            formattedDate(toShift) + '\'');
        while (rows.hasNext()) {
            const row = rows.next();
            if (isExcluded(row.campaign.name)) {
                continue;
            }
            const values = {
                cost: (parseInt(row.metrics.costMicros, 10) || 0) / 1000000,
                clicks: parseInt(row.metrics.clicks, 10) || 0,
                impressions: parseInt(row.metrics.impressions, 10) || 0,
                conversions: Number(row.metrics.conversions) || 0,
                value: Number(row.metrics.conversionsValue) || 0,
            };
            if (!byCampaign[row.campaign.name]) {
                byCampaign[row.campaign.name] = { cost: 0, conversions: 0 };
            }
            byCampaign[row.campaign.name].cost += values.cost;
            byCampaign[row.campaign.name].conversions += values.conversions;
            for (const metric of TOTALS_METRICS) {
                totals[metric] += values[metric];
            }
        }
        return { totals: totals, byCampaign: byCampaign };
    }

    function totalsBlock(now, before) {
        const currency = AdsApp.currentAccount().getCurrencyCode();
        const line = function (label, nowValue, beforeValue, suffix) {
            return label + ': ' + round(nowValue, 2) + (suffix || '') + ' (' +
                delta(nowValue, beforeValue) + ')';
        };
        return [
            line('Cost', now.cost, before.cost, ' ' + currency),
            line('Clicks', now.clicks, before.clicks),
            line('Impressions', now.impressions, before.impressions),
            line('Conversions', now.conversions, before.conversions),
            line('Conv. value', now.value, before.value, ' ' + currency),
            line('CPC', ratio(now.cost, now.clicks), ratio(before.cost, before.clicks)),
            line('Conv. rate', ratio(now.conversions, now.clicks),
                ratio(before.conversions, before.clicks)),
            line('Cost / conv.', ratio(now.cost, now.conversions),
                ratio(before.cost, before.conversions)),
            line('ROAS', ratio(now.value, now.cost), ratio(before.value, before.cost)),
        ].join('\n');
    }

    function findMovers(now, before) {
        const movers = [];
        const names = {};
        for (const name in now) { names[name] = true; }
        for (const name in before) { names[name] = true; }

        for (const name in names) {
            const nowEntry = now[name] || { cost: 0, conversions: 0 };
            const beforeEntry = before[name] || { cost: 0, conversions: 0 };
            if (Math.max(nowEntry.cost, beforeEntry.cost) < CONFIG.MIN_COST_FOR_MOVER) {
                continue;
            }
            const costChange = relativeChange(nowEntry.cost, beforeEntry.cost);
            const convChange = relativeChange(nowEntry.conversions, beforeEntry.conversions);
            const biggest = Math.abs(costChange) >= Math.abs(convChange) ?
                { metric: 'cost', change: costChange, now: nowEntry.cost, before: beforeEntry.cost } :
                { metric: 'conversions', change: convChange, now: nowEntry.conversions, before: beforeEntry.conversions };
            if (Math.abs(biggest.change) < CONFIG.MOVER_THRESHOLD) {
                continue;
            }
            movers.push({
                magnitude: Math.abs(biggest.change),
                line: name + ': ' + biggest.metric + ' ' + round(biggest.before, 2) +
                    ' -> ' + round(biggest.now, 2) + ' (' +
                    (biggest.change > 0 ? '+' : '') + Math.round(biggest.change * 100) + '%)',
            });
        }
        movers.sort(function (a, b) { return b.magnitude - a.magnitude; });
        return movers.map(function (mover) { return mover.line; });
    }

    function relativeChange(now, before) {
        if (before === 0) {
            return now > 0 ? 1 : 0;
        }
        return (now - before) / before;
    }

    function ratio(numerator, denominator) {
        return denominator > 0 ? numerator / denominator : 0;
    }

    function delta(now, before) {
        if (before === 0) {
            return now > 0 ? 'new' : '±0%';
        }
        const change = Math.round(((now - before) / before) * 100);
        return (change > 0 ? '+' : '') + change + '%';
    }

    function isExcluded(campaignName) {
        for (const pattern of CONFIG.CAMPAIGN_EXCLUDE_PATTERNS) {
            if (campaignName.toUpperCase().indexOf(pattern.toUpperCase()) !== -1) {
                return true;
            }
        }
        return false;
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
