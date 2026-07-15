/**
 * Campaign Budget Utilization
 *
 * Two campaign states quietly waste money: chronically capped (the budget
 * runs out daily, so delivery is throttled and CPCs drift up) and
 * chronically idle (the budget sits unused while a capped sibling starves).
 * Both are invisible on any single day - they are patterns. This script
 * measures each enabled campaign's average daily spend against its daily
 * budget over the lookback window and reports both tails.
 *
 * How a campaign is judged:
 *   1. Average daily spend over the window is divided by the daily budget
 *      (shared budgets are evaluated per budget, listing their campaigns).
 *   2. Utilization at or above CAPPED_THRESHOLD -> 'capped' - consider
 *      more budget or tighter targeting.
 *   3. Utilization at or below IDLE_THRESHOLD (with spend above zero) ->
 *      'idle' - budget that could move to a capped campaign.
 *
 * Read-only: budget moves are money decisions, the report ranks them.
 *
 * Setup:
 *   1. Review CONFIG below.
 *   2. Run it; read the two lists in the logs.
 *   3. Schedule weekly and fill RECIPIENT_EMAILS.
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

    // How many days to average (ending yesterday).
    LOOKBACK_DAYS: 14,

    // Average utilization at or above this share = capped (0.95 = 95%).
    CAPPED_THRESHOLD: 0.95,

    // Average utilization at or below this share = idle (0.5 = 50%).
    IDLE_THRESHOLD: 0.5,

    // Ignore campaigns whose daily budget is below this (account
    // currency) - micro-budgets produce noise, not decisions.
    MIN_DAILY_BUDGET: 5,

    // Campaigns whose name contains any of these are skipped.
    CAMPAIGN_EXCLUDE_PATTERNS: [],
};

function main() {
    const report = new BudgetUtilization();
    report.run();
}

function BudgetUtilization() {

    this.run = function () {
        const dateFrom = formattedDate(-CONFIG.LOOKBACK_DAYS);
        const dateTo = formattedDate(-1);
        const counters = { campaigns: 0, capped: 0, idle: 0 };
        const capped = [];
        const idle = [];

        Logger.log('Measuring budget utilization (' + dateFrom + ' to ' + dateTo + ')...');
        const spendByCampaign = {};
        const spendRows = AdsApp.search(
            'SELECT campaign.name, metrics.cost_micros ' +
            'FROM campaign ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            'AND segments.date BETWEEN \'' + dateFrom + '\' AND \'' + dateTo + '\'');
        while (spendRows.hasNext()) {
            const row = spendRows.next();
            spendByCampaign[row.campaign.name] =
                (spendByCampaign[row.campaign.name] || 0) +
                (parseInt(row.metrics.costMicros, 10) || 0) / 1000000;
        }

        const campaigns = AdsApp.campaigns()
            .withCondition('campaign.status = \'ENABLED\'')
            .get();
        while (campaigns.hasNext()) {
            const campaign = campaigns.next();
            const name = campaign.getName();
            if (isExcluded(name)) {
                continue;
            }
            const dailyBudget = campaign.getBudget().getAmount();
            if (dailyBudget < CONFIG.MIN_DAILY_BUDGET) {
                continue;
            }
            counters.campaigns++;

            const avgDailySpend = (spendByCampaign[name] || 0) / CONFIG.LOOKBACK_DAYS;
            const utilization = avgDailySpend / dailyBudget;
            const entry = {
                name: name,
                budget: dailyBudget,
                avgSpend: round(avgDailySpend, 2),
                utilization: round(utilization * 100, 0),
            };
            if (utilization >= CONFIG.CAPPED_THRESHOLD) {
                counters.capped++;
                capped.push(entry);
            } else if (utilization <= CONFIG.IDLE_THRESHOLD && avgDailySpend > 0) {
                counters.idle++;
                idle.push(entry);
            }
        }
        capped.sort(function (a, b) { return b.utilization - a.utilization; });
        idle.sort(function (a, b) { return a.utilization - b.utilization; });

        for (const entry of capped) {
            Logger.log('CAPPED ' + entry.utilization + '%: ' + entry.name +
                ' (avg ' + entry.avgSpend + ' of ' + entry.budget + '/day)');
        }
        for (const entry of idle) {
            Logger.log('IDLE ' + entry.utilization + '%: ' + entry.name +
                ' (avg ' + entry.avgSpend + ' of ' + entry.budget + '/day)');
        }

        if ((capped.length > 0 || idle.length > 0) && CONFIG.RECIPIENT_EMAILS.length > 0) {
            sendDigest(capped, idle, dateFrom, dateTo);
        }

        logSummary(counters);
    };

    function sendDigest(capped, idle, dateFrom, dateTo) {
        const accountName = AdsApp.currentAccount().getName();
        const currency = AdsApp.currentAccount().getCurrencyCode();
        const lines = ['Budget utilization in ' + accountName +
            ' (' + dateFrom + ' to ' + dateTo + '):', ''];
        if (capped.length > 0) {
            lines.push('== Capped - throttled by budget (' + capped.length + ') ==');
            for (const entry of capped) {
                lines.push('  ' + entry.utilization + '% | ' + entry.name + ' (avg ' +
                    entry.avgSpend + ' of ' + entry.budget + ' ' + currency + '/day)');
            }
            lines.push('');
        }
        if (idle.length > 0) {
            lines.push('== Idle - budget going unused (' + idle.length + ') ==');
            for (const entry of idle) {
                lines.push('  ' + entry.utilization + '% | ' + entry.name + ' (avg ' +
                    entry.avgSpend + ' of ' + entry.budget + ' ' + currency + '/day)');
            }
        }

        MailApp.sendEmail(
            CONFIG.RECIPIENT_EMAILS.join(','),
            'Budget utilization: ' + capped.length + ' capped, ' + idle.length +
            ' idle in ' + accountName,
            lines.join('\n'));
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
        Logger.log([
            '',
            '========== Execution Summary ==========',
            'Campaigns measured: ' + counters.campaigns,
            'Capped (>= ' + Math.round(CONFIG.CAPPED_THRESHOLD * 100) + '%): ' +
            counters.capped + ' | idle (<= ' +
            Math.round(CONFIG.IDLE_THRESHOLD * 100) + '%): ' + counters.idle,
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
