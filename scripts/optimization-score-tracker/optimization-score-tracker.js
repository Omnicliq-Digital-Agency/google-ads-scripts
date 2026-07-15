/**
 * Optimization Score Tracker
 *
 * Google's Optimization Score influences everything from Partner status to
 * how pushy the recommendations UI gets - and it moves without telling
 * you. This MCC-level script tracks it: every run appends each account's
 * score (and its campaigns' scores) to a history spreadsheet and emails a
 * digest of accounts or campaigns that fell below your floor.
 *
 * What each run does:
 *   1. Reads customer.optimization_score per account and
 *      campaign.optimization_score per serving campaign.
 *   2. Appends one row per account to the History tab - your score trend
 *      over time.
 *   3. Emails accounts below MIN_ACCOUNT_SCORE and campaigns below
 *      MIN_CAMPAIGN_SCORE, worst first.
 *
 * The score measures Google's recommendations, not your strategy - apply
 * or dismiss recommendations deliberately. This script only makes the
 * number visible; it never applies anything.
 *
 * Setup:
 *   1. Create the script at MCC (manager account) level. Leave
 *      SPREADSHEET_URL empty on the first run - the script creates a
 *      spreadsheet and logs its URL; paste it into CONFIG.
 *   2. Schedule weekly and fill RECIPIENT_EMAILS.
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
    // Spreadsheet holding the history. Empty: a new spreadsheet is created
    // and its URL logged - paste it here for the next runs.
    SPREADSHEET_URL: '',

    // Who receives the digest. Empty = log only.
    RECIPIENT_EMAILS: [],

    // Accounts below this score (0-100) land in the digest.
    MIN_ACCOUNT_SCORE: 80,

    // Campaigns below this score (0-100) land in the digest.
    MIN_CAMPAIGN_SCORE: 70,

    // Only check accounts carrying this MCC account label ('' = all).
    ACCOUNT_LABEL: '',
};

function main() {
    validateConfig();

    const tracker = new OptimizationScoreTracker();
    tracker.track();
}

function validateConfig() {
    if (typeof AdsManagerApp === 'undefined') {
        throw new Error('This script must run at MCC (manager account) level - ' +
            'create it under your manager account, not a client account.');
    }
}

function OptimizationScoreTracker() {

    const mccAccount = AdsApp.currentAccount();

    this.track = function () {
        const counters = { accounts: 0, lowAccounts: 0, lowCampaigns: 0 };
        const lowAccounts = [];
        const lowCampaigns = [];
        const historyRows = [];
        const today = Utilities.formatDate(new Date(), mccAccount.getTimeZone(), 'yyyy-MM-dd');

        let accountSelector = AdsManagerApp.accounts();
        if (CONFIG.ACCOUNT_LABEL) {
            accountSelector = accountSelector
                .withCondition('LabelNames CONTAINS \'' + CONFIG.ACCOUNT_LABEL + '\'');
        }
        const accounts = accountSelector.get();
        Logger.log('Tracking optimization scores...');

        while (accounts.hasNext()) {
            const account = accounts.next();
            AdsManagerApp.select(account);
            counters.accounts++;

            const accountScore = readAccountScore();
            historyRows.push([today, account.getName(), account.getCustomerId(), accountScore]);
            Logger.log(account.getName() + ': ' + accountScore);

            if (accountScore < CONFIG.MIN_ACCOUNT_SCORE) {
                counters.lowAccounts++;
                lowAccounts.push({ name: account.getName(), score: accountScore });
            }

            for (const campaign of readLowCampaigns()) {
                counters.lowCampaigns++;
                campaign.account = account.getName();
                lowCampaigns.push(campaign);
                Logger.log('  LOW campaign ' + campaign.score + ': ' + campaign.name);
            }
        }
        AdsManagerApp.select(mccAccount);

        const spreadsheet = getOrCreateSpreadsheet();
        appendHistory(spreadsheet, historyRows);

        if ((lowAccounts.length > 0 || lowCampaigns.length > 0) &&
            CONFIG.RECIPIENT_EMAILS.length > 0) {
            sendDigest(lowAccounts, lowCampaigns);
        }

        logSummary(counters, spreadsheet);
    };

    /**
     * The selected account's optimization score as 0-100.
     */
    function readAccountScore() {
        const rows = AdsApp.search(
            'SELECT customer.optimization_score FROM customer');
        while (rows.hasNext()) {
            const score = Number(rows.next().customer.optimizationScore) || 0;
            return round(score * 100, 1);
        }
        return 0;
    }

    /**
     * Serving campaigns of the selected account scoring below the floor.
     */
    function readLowCampaigns() {
        const low = [];
        const rows = AdsApp.search(
            'SELECT campaign.name, campaign.optimization_score ' +
            'FROM campaign ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            'AND campaign.serving_status = \'SERVING\'');
        while (rows.hasNext()) {
            const row = rows.next();
            const score = round((Number(row.campaign.optimizationScore) || 0) * 100, 1);
            if (score > 0 && score < CONFIG.MIN_CAMPAIGN_SCORE) {
                low.push({ name: row.campaign.name, score: score });
            }
        }
        low.sort(function (a, b) { return a.score - b.score; });
        return low;
    }

    function appendHistory(spreadsheet, historyRows) {
        let sheet = spreadsheet.getSheetByName('History');
        if (!sheet) {
            sheet = spreadsheet.insertSheet('History');
            sheet.appendRow(['Date', 'Account', 'Customer id', 'Optimization score']);
        }
        for (const row of historyRows) {
            sheet.appendRow(row);
        }
    }

    function getOrCreateSpreadsheet() {
        if (CONFIG.SPREADSHEET_URL) {
            return SpreadsheetApp.openByUrl(CONFIG.SPREADSHEET_URL);
        }
        const name = mccAccount.getName() + ' - Optimization Score Tracker';
        const spreadsheet = SpreadsheetApp.create(name);
        Logger.log('Created spreadsheet "' + name + '" - paste this URL into ' +
            'CONFIG.SPREADSHEET_URL: ' + spreadsheet.getUrl());
        return spreadsheet;
    }

    function sendDigest(lowAccounts, lowCampaigns) {
        const lines = ['Optimization scores below your floors:', ''];
        if (lowAccounts.length > 0) {
            lines.push('== Accounts below ' + CONFIG.MIN_ACCOUNT_SCORE + ' (' +
                lowAccounts.length + ') ==');
            lowAccounts.sort(function (a, b) { return a.score - b.score; });
            for (const entry of lowAccounts) {
                lines.push('  ' + entry.score + ' | ' + entry.name);
            }
            lines.push('');
        }
        if (lowCampaigns.length > 0) {
            lines.push('== Campaigns below ' + CONFIG.MIN_CAMPAIGN_SCORE + ' (' +
                lowCampaigns.length + ') ==');
            for (const entry of lowCampaigns) {
                lines.push('  ' + entry.score + ' | ' + entry.account + ' > ' + entry.name);
            }
        }
        lines.push('');
        lines.push('The score measures Google\'s recommendations, not your strategy - ' +
            'review each recommendation deliberately; dismissing also restores the score.');

        MailApp.sendEmail(
            CONFIG.RECIPIENT_EMAILS.join(','),
            'Optimization score digest: ' + lowAccounts.length + ' account(s), ' +
            lowCampaigns.length + ' campaign(s) below floor',
            lines.join('\n'));
    }

    function logSummary(counters, spreadsheet) {
        Logger.log([
            '',
            '========== Execution Summary ==========',
            'Accounts tracked: ' + counters.accounts,
            'Below account floor (' + CONFIG.MIN_ACCOUNT_SCORE + '): ' + counters.lowAccounts +
            ' | campaigns below ' + CONFIG.MIN_CAMPAIGN_SCORE + ': ' + counters.lowCampaigns,
            'History: ' + spreadsheet.getUrl(),
            '====================================================',
        ].join('\n'));
    }
}

function round(value, decimals) {
    return Number(Math.round(value + 'e' + decimals) + 'e-' + decimals);
}
