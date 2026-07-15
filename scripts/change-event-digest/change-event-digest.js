/**
 * Change Event Digest
 *
 * 'Who changed that?' is the first question after every performance jump -
 * and the change history screen answers it one hunt at a time. This script
 * turns it into a push: every run emails a digest of yesterday's account
 * changes - who, what resource, which operation - grouped by user, with
 * noisy change types filtered out.
 *
 * What each run does:
 *   1. Reads yesterday's change events (Google keeps ~30 days).
 *   2. Drops the change types in IGNORE_TYPES (bulk noise like ad-group
 *      criterion churn from your own scripts, if you choose).
 *   3. Emails one digest grouped by user email, capped at MAX_EVENTS
 *      lines - past that it reports the count per type instead.
 *
 * Read-only by nature. Useful as an audit trail for agencies (client-side
 * edits surface next morning) and as a tripwire for unexpected script or
 * automated-rule behaviour.
 *
 * Setup:
 *   1. Fill RECIPIENT_EMAILS.
 *   2. Schedule daily, early morning.
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

    // Change resource types to leave out of the digest entirely
    // (e.g. 'AD_GROUP_CRITERION' when your own scripts churn keywords).
    IGNORE_TYPES: [],

    // Maximum individual events listed per digest; beyond it the digest
    // shows per-type counts only.
    MAX_EVENTS: 200,
};

function main() {
    const digest = new ChangeDigest();
    digest.run();
}

function ChangeDigest() {

    this.run = function () {
        const yesterday = formattedDate(-1);
        const counters = { events: 0, ignored: 0 };
        // user -> array of event lines.
        const byUser = {};
        const typeCounts = {};

        Logger.log('Reading change events for ' + yesterday + '...');
        const rows = AdsApp.search(
            'SELECT change_event.change_date_time, change_event.user_email, ' +
            'change_event.change_resource_type, change_event.resource_change_operation, ' +
            'change_event.change_resource_name, campaign.name ' +
            'FROM change_event ' +
            'WHERE change_event.change_date_time >= \'' + yesterday + ' 00:00:00\' ' +
            'AND change_event.change_date_time <= \'' + yesterday + ' 23:59:59\' ' +
            'ORDER BY change_event.change_date_time ' +
            'LIMIT 9999');
        while (rows.hasNext()) {
            const row = rows.next();
            const event = row.changeEvent;
            if (CONFIG.IGNORE_TYPES.indexOf(event.changeResourceType) !== -1) {
                counters.ignored++;
                continue;
            }
            counters.events++;
            typeCounts[event.changeResourceType] =
                (typeCounts[event.changeResourceType] || 0) + 1;

            const user = event.userEmail || 'unknown';
            if (!byUser[user]) {
                byUser[user] = [];
            }
            byUser[user].push(String(event.changeDateTime).split(' ')[1] + ' ' +
                event.resourceChangeOperation + ' ' + event.changeResourceType +
                (row.campaign && row.campaign.name ? ' @ ' + row.campaign.name : ''));
        }

        const lines = ['Account changes on ' + yesterday + ' in ' +
            AdsApp.currentAccount().getName() + ':', ''];
        if (counters.events <= CONFIG.MAX_EVENTS) {
            for (const user in byUser) {
                lines.push('== ' + user + ' (' + byUser[user].length + ') ==');
                for (const line of byUser[user]) {
                    lines.push('  ' + line);
                }
                lines.push('');
            }
        } else {
            lines.push(counters.events + ' changes - per-type counts:');
            for (const type in typeCounts) {
                lines.push('  ' + type + ': ' + typeCounts[type]);
            }
            lines.push('');
            for (const user in byUser) {
                lines.push('  ' + user + ': ' + byUser[user].length + ' changes');
            }
        }
        for (const line of lines) {
            Logger.log(line);
        }

        if (counters.events > 0 && CONFIG.RECIPIENT_EMAILS.length > 0) {
            MailApp.sendEmail(
                CONFIG.RECIPIENT_EMAILS.join(','),
                'Account changes ' + yesterday + ': ' + counters.events + ' in ' +
                AdsApp.currentAccount().getName(),
                lines.join('\n'));
        }

        logSummary(counters);
    };

    function logSummary(counters) {
        Logger.log([
            '',
            '========== Execution Summary ==========',
            'Change events: ' + counters.events + ' | ignored by type: ' + counters.ignored,
            '====================================================',
        ].join('\n'));
    }
}

function formattedDate(daysShift) {
    const date = new Date();
    date.setDate(date.getDate() + daysShift);
    return Utilities.formatDate(date, AdsApp.currentAccount().getTimeZone(), 'yyyy-MM-dd');
}
