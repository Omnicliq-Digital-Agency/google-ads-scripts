/**
 * Impression Share Tracker
 *
 * Impression share is the metric that explains the others: conversions
 * dropped because you lost the auction, not because the ads got worse.
 * But Google shows it as a snapshot, and the trend - are we gaining or
 * losing ground, and is it budget or rank? - never accumulates anywhere.
 * This script accumulates it: every run appends each search campaign's
 * impression share and its two loss components to a history spreadsheet,
 * and alerts when a campaign's share drops sharply against its trailing
 * average.
 *
 * What each run does:
 *   1. Reads search impression share, budget-lost IS and rank-lost IS per
 *      enabled search campaign for yesterday.
 *   2. Appends one row per campaign to the History tab - date, campaign,
 *      IS, lost-to-budget, lost-to-rank.
 *   3. Compares yesterday's IS against the campaign's average over the
 *      previous TREND_DAYS rows in the sheet; drops larger than
 *      DROP_ALERT_POINTS impression-share points are emailed.
 *
 * Setup:
 *   1. Leave SPREADSHEET_URL empty on the first run - the script creates
 *      a spreadsheet and logs its URL; paste it into CONFIG.
 *   2. Schedule daily (the history is the product; gaps are blind days).
 *   3. Fill RECIPIENT_EMAILS for drop alerts.
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
    // Spreadsheet holding the history. Empty: a new spreadsheet is
    // created and its URL logged - paste it here for the next runs.
    SPREADSHEET_URL: '',

    // Who receives drop alerts. Empty = no email.
    RECIPIENT_EMAILS: [],

    // Alert when yesterday's IS is at least this many points below the
    // campaign's trailing average (5 = five impression-share points).
    DROP_ALERT_POINTS: 5,

    // How many previous history rows per campaign form the trailing
    // average.
    TREND_DAYS: 14,

    // Ignore campaigns with fewer impressions than this yesterday.
    MIN_IMPRESSIONS: 100,

    // Campaigns whose name contains any of these are skipped.
    CAMPAIGN_EXCLUDE_PATTERNS: [],
};

const HISTORY_HEADER = ['Date', 'Campaign', 'Impr. share %', 'Lost to budget %',
    'Lost to rank %', 'Impressions'];

function main() {
    const tracker = new ImpressionShareTracker();
    tracker.track();
}

function ImpressionShareTracker() {

    this.track = function () {
        const yesterday = formattedDate(-1);
        const counters = { campaigns: 0, drops: 0 };

        Logger.log('Reading impression share for ' + yesterday + '...');
        const today = [];
        const rows = AdsApp.search(
            'SELECT campaign.name, metrics.search_impression_share, ' +
            'metrics.search_budget_lost_impression_share, ' +
            'metrics.search_rank_lost_impression_share, metrics.impressions ' +
            'FROM campaign ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            'AND campaign.advertising_channel_type = \'SEARCH\' ' +
            'AND segments.date = \'' + yesterday + '\'');
        while (rows.hasNext()) {
            const row = rows.next();
            if (isExcluded(row.campaign.name)) {
                continue;
            }
            const impressions = parseInt(row.metrics.impressions, 10) || 0;
            if (impressions < CONFIG.MIN_IMPRESSIONS) {
                continue;
            }
            counters.campaigns++;
            today.push({
                campaign: row.campaign.name,
                share: round((Number(row.metrics.searchImpressionShare) || 0) * 100, 1),
                lostBudget: round(
                    (Number(row.metrics.searchBudgetLostImpressionShare) || 0) * 100, 1),
                lostRank: round(
                    (Number(row.metrics.searchRankLostImpressionShare) || 0) * 100, 1),
                impressions: impressions,
            });
        }

        const spreadsheet = getOrCreateSpreadsheet();
        const history = getHistorySheet(spreadsheet);
        const averages = trailingAverages(history);

        const drops = [];
        for (const entry of today) {
            const average = averages[entry.campaign];
            if (average !== undefined && average - entry.share >= CONFIG.DROP_ALERT_POINTS) {
                counters.drops++;
                drops.push(entry.campaign + ': IS ' + entry.share + '% vs trailing avg ' +
                    round(average, 1) + '% (lost to budget ' + entry.lostBudget +
                    '%, to rank ' + entry.lostRank + '%)');
            }
            history.appendRow([yesterday, entry.campaign, entry.share,
                entry.lostBudget, entry.lostRank, entry.impressions]);
            Logger.log(entry.campaign + ': IS ' + entry.share + '% (budget -' +
                entry.lostBudget + '%, rank -' + entry.lostRank + '%)');
        }

        for (const drop of drops) {
            Logger.log('DROP: ' + drop);
        }
        if (drops.length > 0 && CONFIG.RECIPIENT_EMAILS.length > 0) {
            MailApp.sendEmail(
                CONFIG.RECIPIENT_EMAILS.join(','),
                'Impression share drops: ' + drops.length + ' campaign(s) in ' +
                AdsApp.currentAccount().getName(),
                ['Impression share drops for ' + yesterday + ':', '']
                    .concat(drops).join('\n'));
        }

        logSummary(counters, spreadsheet);
    };

    /**
     * Average IS per campaign over each campaign's most recent TREND_DAYS
     * history rows (excluding rows about to be written).
     */
    function trailingAverages(history) {
        const averages = {};
        const lastRow = history.getLastRow();
        if (lastRow < 2) {
            return averages;
        }
        const values = history.getRange(2, 1, lastRow - 1, HISTORY_HEADER.length).getValues();
        const samples = {};
        // Newest rows are at the bottom; walk backwards, cap per campaign.
        for (let i = values.length - 1; i >= 0; i--) {
            const campaign = values[i][1];
            if (!samples[campaign]) {
                samples[campaign] = [];
            }
            if (samples[campaign].length < CONFIG.TREND_DAYS) {
                samples[campaign].push(Number(values[i][2]) || 0);
            }
        }
        for (const campaign in samples) {
            let sum = 0;
            for (const value of samples[campaign]) {
                sum += value;
            }
            averages[campaign] = sum / samples[campaign].length;
        }
        return averages;
    }

    function getHistorySheet(spreadsheet) {
        let sheet = spreadsheet.getSheetByName('History');
        if (!sheet) {
            sheet = spreadsheet.insertSheet('History');
            sheet.appendRow(HISTORY_HEADER);
        }
        return sheet;
    }

    function getOrCreateSpreadsheet() {
        if (CONFIG.SPREADSHEET_URL) {
            return SpreadsheetApp.openByUrl(CONFIG.SPREADSHEET_URL);
        }
        const name = AdsApp.currentAccount().getName() + ' - Impression Share Tracker';
        const spreadsheet = SpreadsheetApp.create(name);
        Logger.log('Created spreadsheet "' + name + '" - paste this URL into ' +
            'CONFIG.SPREADSHEET_URL: ' + spreadsheet.getUrl());
        return spreadsheet;
    }

    function isExcluded(campaignName) {
        for (const pattern of CONFIG.CAMPAIGN_EXCLUDE_PATTERNS) {
            if (campaignName.toUpperCase().indexOf(pattern.toUpperCase()) !== -1) {
                return true;
            }
        }
        return false;
    }

    function logSummary(counters, spreadsheet) {
        Logger.log([
            '',
            '========== Execution Summary ==========',
            'Campaigns tracked: ' + counters.campaigns,
            'Drops >= ' + CONFIG.DROP_ALERT_POINTS + ' points vs trailing avg: ' +
            counters.drops,
            'History: ' + spreadsheet.getUrl(),
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
