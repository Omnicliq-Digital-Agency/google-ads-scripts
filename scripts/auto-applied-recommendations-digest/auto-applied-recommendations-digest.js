/**
 * Auto-Applied Recommendations Digest
 *
 * Google can change your accounts without asking: with auto-apply
 * recommendations enabled - sometimes without anyone remembering having
 * enabled them - keywords appear, budgets shift, targeting expands. The
 * change history records it all, attributed to 'Recommendations
 * Auto-Apply', but nobody reads change history daily across an MCC. This
 * script does: every morning it sweeps every account for changes Google
 * applied automatically and emails one digest - so nothing changes in
 * your accounts without a human knowing.
 *
 * What each run does:
 *   1. Iterates the MCC's accounts (optionally filtered by label).
 *   2. Reads change events of the last LOOKBACK_DAYS attributed to
 *      Google's 'Recommendations Auto-Apply' actor.
 *   3. Emails one digest grouped by account: when, what resource type,
 *      which operation, in which campaign.
 *
 * Read-only. The fix for unwanted entries is Settings -> Recommendations
 * auto-apply, per account - the digest tells you where to look.
 *
 * Setup:
 *   1. Create the script at MCC (manager account) level.
 *   2. Fill RECIPIENT_EMAILS and schedule daily, early morning.
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

    // How many days of change history to sweep (Google keeps ~30).
    LOOKBACK_DAYS: 3,

    // Only check accounts carrying this MCC account label ('' = all).
    ACCOUNT_LABEL: '',

    // Maximum events listed per account in the digest.
    MAX_EVENTS_PER_ACCOUNT: 50,
};

// Google's change-history actor for automatically applied recommendations.
const AUTO_APPLY_ACTOR = 'Recommendations Auto-Apply';

function main() {
    validateConfig();

    const digest = new AutoApplyDigest();
    digest.run();
}

function validateConfig() {
    if (typeof AdsManagerApp === 'undefined') {
        throw new Error('This script must run at MCC (manager account) level - ' +
            'create it under your manager account, not a client account.');
    }
    if (CONFIG.LOOKBACK_DAYS < 1 || CONFIG.LOOKBACK_DAYS > 30) {
        throw new Error('LOOKBACK_DAYS must be between 1 and 30 - Google keeps ' +
            'about 30 days of change history.');
    }
}

function AutoApplyDigest() {

    const mccAccount = AdsApp.currentAccount();

    this.run = function () {
        const counters = { accounts: 0, affectedAccounts: 0, events: 0 };
        const lines = [];

        let accountSelector = AdsManagerApp.accounts();
        if (CONFIG.ACCOUNT_LABEL) {
            accountSelector = accountSelector
                .withCondition('LabelNames CONTAINS \'' + CONFIG.ACCOUNT_LABEL + '\'');
        }
        const accounts = accountSelector.get();
        Logger.log('Sweeping accounts for auto-applied recommendations...');

        while (accounts.hasNext()) {
            const account = accounts.next();
            AdsManagerApp.select(account);
            counters.accounts++;

            const events = readAutoApplyEvents();
            if (events.length === 0) {
                continue;
            }
            counters.affectedAccounts++;
            counters.events += events.length;

            Logger.log(account.getName() + ': ' + events.length + ' auto-applied change(s)');
            lines.push('== ' + account.getName() + ' (' + account.getCustomerId() + ') - ' +
                events.length + ' change(s) ==');
            for (const event of events.slice(0, CONFIG.MAX_EVENTS_PER_ACCOUNT)) {
                lines.push('  ' + event);
                Logger.log('  ' + event);
            }
            if (events.length > CONFIG.MAX_EVENTS_PER_ACCOUNT) {
                lines.push('  ... and ' + (events.length - CONFIG.MAX_EVENTS_PER_ACCOUNT) +
                    ' more');
            }
            lines.push('');
        }
        AdsManagerApp.select(mccAccount);

        if (counters.events > 0 && CONFIG.RECIPIENT_EMAILS.length > 0) {
            lines.push('To stop unwanted entries: the affected account -> Settings -> ' +
                'Recommendations auto-apply.');
            MailApp.sendEmail(
                CONFIG.RECIPIENT_EMAILS.join(','),
                'Google auto-applied ' + counters.events + ' change(s) across ' +
                counters.affectedAccounts + ' account(s)',
                ['Changes Google applied automatically (last ' + CONFIG.LOOKBACK_DAYS +
                    ' day(s)):', ''].concat(lines).join('\n'));
        }

        logSummary(counters);
    };

    /**
     * Change events of the selected account attributed to the auto-apply
     * actor, newest first, as formatted lines.
     */
    function readAutoApplyEvents() {
        const timeZone = AdsApp.currentAccount().getTimeZone();
        const from = formattedDate(-(CONFIG.LOOKBACK_DAYS - 1), timeZone) + ' 00:00:00';
        const to = formattedDate(0, timeZone) + ' 23:59:59';

        const events = [];
        const rows = AdsApp.search(
            'SELECT change_event.change_date_time, change_event.change_resource_type, ' +
            'change_event.resource_change_operation, campaign.name ' +
            'FROM change_event ' +
            'WHERE change_event.change_date_time >= \'' + from + '\' ' +
            'AND change_event.change_date_time <= \'' + to + '\' ' +
            'AND change_event.user_email = \'' + AUTO_APPLY_ACTOR + '\' ' +
            'ORDER BY change_event.change_date_time DESC ' +
            'LIMIT 9999');
        while (rows.hasNext()) {
            const row = rows.next();
            const event = row.changeEvent;
            events.push(String(event.changeDateTime) + ' | ' +
                event.resourceChangeOperation + ' ' + event.changeResourceType +
                (row.campaign && row.campaign.name ? ' @ ' + row.campaign.name : ''));
        }
        return events;
    }

    function logSummary(counters) {
        Logger.log([
            '',
            '========== Execution Summary ==========',
            'Accounts swept: ' + counters.accounts,
            'Accounts with auto-applied changes: ' + counters.affectedAccounts +
            ' | total changes: ' + counters.events,
            '====================================================',
        ].join('\n'));
    }
}

function formattedDate(daysShift, timeZone) {
    const date = new Date();
    date.setDate(date.getDate() + daysShift);
    return Utilities.formatDate(date, timeZone, 'yyyy-MM-dd');
}
