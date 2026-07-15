/**
 * PMax Placement Audit
 *
 * Performance Max spends part of its budget on Display and YouTube
 * placements, and the UI barely shows you where. Mobile game apps, made-
 * for-advertising sites, kids' content channels - your ads may be running
 * there right now, and nothing in the campaign screen will tell you. This
 * script pulls every placement your PMax campaigns served on, flags the
 * suspicious ones by type and name patterns, and emails a digest - so
 * exclusions become an informed weekly routine instead of a mystery.
 *
 * How a placement is flagged:
 *   1. All PMax placements of the lookback window are pulled from the
 *      performance_max_placement_view report with their impressions.
 *   2. A placement is flagged when its type is in FLAG_TYPES (mobile
 *      applications by default) or its name/URL matches any FLAG_PATTERNS
 *      entry ('game', 'kids', ...).
 *   3. Flagged placements above MIN_IMPRESSIONS are ranked by impressions
 *      and reported - log always, email digest optionally, and the full
 *      list lands in a spreadsheet tab per run when SPREADSHEET_URL is set.
 *
 * The script is read-only: Google Ads Scripts cannot edit the account-level
 * placement exclusion list, so the last step stays with you (Content
 * suitability -> Excluded placements). The digest gives you the paste-ready
 * list.
 *
 * Setup:
 *   1. Review CONFIG below - extend FLAG_PATTERNS with the junk you see in
 *      your market.
 *   2. Run it; read the flagged placements in the logs.
 *   3. Schedule weekly and add RECIPIENT_EMAILS.
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
    // Who receives the digest of flagged placements. Empty = log only.
    RECIPIENT_EMAILS: [],

    // Optional spreadsheet for the full placement list (one tab per run).
    // Empty: no sheet output.
    SPREADSHEET_URL: '',

    // How many days of placement data to analyse (ending yesterday).
    LOOKBACK_DAYS: 30,

    // Placement types that are flagged wholesale. Valid values:
    // MOBILE_APPLICATION, WEBSITE, YOUTUBE_VIDEO, YOUTUBE_CHANNEL.
    FLAG_TYPES: ['MOBILE_APPLICATION'],

    // Case-insensitive substrings of the placement name or URL that flag
    // it. Extend with the junk patterns you see in your market.
    FLAG_PATTERNS: ['game', 'games', 'kids', 'cartoon', 'quiz', 'horoscope', 'wallpaper'],

    // Flagged placements below this many impressions are left out of the
    // report - they cost you nothing worth a decision yet.
    MIN_IMPRESSIONS: 50,

    // Only audit campaigns whose name contains this substring ('' = all
    // PMax campaigns).
    CAMPAIGN_NAME_FILTER: '',
};

const FLAGGABLE_TYPES = ['MOBILE_APPLICATION', 'WEBSITE', 'YOUTUBE_VIDEO', 'YOUTUBE_CHANNEL'];

function main() {
    validateConfig();

    const audit = new PlacementAudit();
    audit.run();
}

function validateConfig() {
    for (const type of CONFIG.FLAG_TYPES) {
        if (FLAGGABLE_TYPES.indexOf(type) === -1) {
            throw new Error('FLAG_TYPES contains "' + type + '" - valid values are ' +
                FLAGGABLE_TYPES.join(', ') + '.');
        }
    }
}

function PlacementAudit() {

    this.run = function () {
        const dateFrom = formattedDate(-CONFIG.LOOKBACK_DAYS);
        const dateTo = formattedDate(-1);

        const counters = { placements: 0, flagged: 0, belowFloor: 0 };
        const flagged = [];
        const all = [];

        Logger.log('Collecting PMax placements (' + dateFrom + ' to ' + dateTo + ')...');
        const rows = AdsApp.search(
            'SELECT campaign.name, performance_max_placement_view.display_name, ' +
            'performance_max_placement_view.placement, ' +
            'performance_max_placement_view.placement_type, ' +
            'performance_max_placement_view.target_url, metrics.impressions ' +
            'FROM performance_max_placement_view ' +
            'WHERE segments.date BETWEEN \'' + dateFrom + '\' AND \'' + dateTo + '\' ' +
            'AND metrics.impressions > 0');

        while (rows.hasNext()) {
            const row = rows.next();
            if (CONFIG.CAMPAIGN_NAME_FILTER &&
                row.campaign.name.indexOf(CONFIG.CAMPAIGN_NAME_FILTER) === -1) {
                continue;
            }
            counters.placements++;
            const view = row.performanceMaxPlacementView;
            const entry = {
                campaign: row.campaign.name,
                name: view.displayName || view.placement,
                type: view.placementType,
                url: view.targetUrl || '',
                impressions: parseInt(row.metrics.impressions, 10) || 0,
            };
            all.push(entry);

            const reason = flagReason(entry);
            if (!reason) {
                continue;
            }
            if (entry.impressions < CONFIG.MIN_IMPRESSIONS) {
                counters.belowFloor++;
                continue;
            }
            counters.flagged++;
            entry.reason = reason;
            flagged.push(entry);
        }

        flagged.sort(function (a, b) { return b.impressions - a.impressions; });
        for (const entry of flagged) {
            Logger.log('FLAGGED (' + entry.reason + '): ' + entry.name +
                ' [' + entry.type + '] - ' + entry.impressions + ' impressions (' +
                entry.campaign + ')' + (entry.url ? ' ' + entry.url : ''));
        }

        if (CONFIG.SPREADSHEET_URL) {
            writeSheet(all, dateTo);
        }
        if (flagged.length > 0 && CONFIG.RECIPIENT_EMAILS.length > 0) {
            sendDigest(flagged, dateFrom, dateTo);
        }

        logSummary(counters);
    };

    /**
     * Why a placement is suspicious: its type, or the first matching name/
     * URL pattern. Undefined when it looks fine.
     */
    function flagReason(entry) {
        if (CONFIG.FLAG_TYPES.indexOf(entry.type) !== -1) {
            return 'type ' + entry.type;
        }
        const haystack = (entry.name + ' ' + entry.url).toLowerCase();
        for (const pattern of CONFIG.FLAG_PATTERNS) {
            if (haystack.indexOf(pattern.toLowerCase()) !== -1) {
                return 'pattern "' + pattern + '"';
            }
        }
        return undefined;
    }

    function writeSheet(all, dateTo) {
        const spreadsheet = SpreadsheetApp.openByUrl(CONFIG.SPREADSHEET_URL);
        const tabName = 'Placements ' + dateTo;
        let sheet = spreadsheet.getSheetByName(tabName);
        if (!sheet) {
            sheet = spreadsheet.insertSheet(tabName);
        }
        sheet.clear();
        const rows = [['Campaign', 'Placement', 'Type', 'URL', 'Impressions']];
        all.sort(function (a, b) { return b.impressions - a.impressions; });
        for (const entry of all) {
            rows.push([entry.campaign, entry.name, entry.type, entry.url, entry.impressions]);
        }
        sheet.getRange(1, 1, rows.length, 5).setValues(rows);
        Logger.log('Full placement list written to tab "' + tabName + '": ' +
            spreadsheet.getUrl());
    }

    function sendDigest(flagged, dateFrom, dateTo) {
        const accountName = AdsApp.currentAccount().getName();
        const lines = ['Suspicious PMax placements in ' + accountName +
            ' (' + dateFrom + ' to ' + dateTo + '):', ''];
        for (const entry of flagged) {
            lines.push(entry.impressions + ' impr | ' + entry.name + ' [' + entry.type + ']');
            lines.push('  ' + entry.reason + ' | ' + entry.campaign +
                (entry.url ? ' | ' + entry.url : ''));
        }
        lines.push('');
        lines.push('To exclude: Google Ads -> Content suitability -> Excluded placements.');

        MailApp.sendEmail(
            CONFIG.RECIPIENT_EMAILS.join(','),
            'PMax placement audit: ' + flagged.length + ' suspicious placement(s) in ' +
            accountName,
            lines.join('\n'));
    }

    function logSummary(counters) {
        Logger.log([
            '',
            '========== Execution Summary ==========',
            'Placements with impressions: ' + counters.placements,
            'Flagged: ' + counters.flagged +
            ' | flagged but below ' + CONFIG.MIN_IMPRESSIONS + ' impressions: ' +
            counters.belowFloor,
            '====================================================',
        ].join('\n'));
    }
}

function formattedDate(daysShift) {
    const date = new Date();
    date.setDate(date.getDate() + daysShift);
    return Utilities.formatDate(date, AdsApp.currentAccount().getTimeZone(), 'yyyy-MM-dd');
}
