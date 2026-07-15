/**
 * Geo Performance Report
 *
 * Location targeting decisions age: the region that converted well when
 * you set the +20% adjustment two years ago may be your worst performer
 * today. This script aggregates account performance by the user's
 * location, ranks regions by spend, flags the ones converting far worse
 * than the account average, and writes the full picture to a spreadsheet.
 *
 * How a location is judged:
 *   1. Cost, clicks, conversions and value are aggregated per geo target
 *      (user location) over the lookback window; location names are
 *      resolved from Google's geo target constants.
 *   2. Locations with at least MIN_SPEND spend and a cost/conv worse than
 *      DEVIATION_FACTOR x the account average are flagged - as are
 *      locations spending MIN_SPEND with zero conversions.
 *
 * The script is read-only: geo adjustments and exclusions stay with you.
 *
 * Setup:
 *   1. Review CONFIG below.
 *   2. Leave SPREADSHEET_URL empty on the first run - the script creates
 *      a spreadsheet and logs its URL; pin it in CONFIG afterwards.
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
    // Who receives the digest of flagged locations. Empty = log only.
    RECIPIENT_EMAILS: [],

    // Spreadsheet for the full ranked location list. Empty on the first
    // run: one is created and its URL logged.
    SPREADSHEET_URL: '',

    // How many days to analyse (ending yesterday).
    LOOKBACK_DAYS: 90,

    // Minimum spend (account currency) before a location can be flagged.
    MIN_SPEND: 100,

    // A location is flagged when its cost/conv exceeds the account average
    // times this factor (1.5 = 50% worse).
    DEVIATION_FACTOR: 1.5,
};

function main() {
    const report = new GeoReport();
    report.run();
}

function GeoReport() {

    this.run = function () {
        const dateFrom = formattedDate(-CONFIG.LOOKBACK_DAYS);
        const dateTo = formattedDate(-1);
        const counters = { locations: 0, flagged: 0 };

        Logger.log('Aggregating by user location (' + dateFrom + ' to ' + dateTo + ')...');
        const byGeo = {};
        const rows = AdsApp.search(
            'SELECT user_location_view.country_criterion_id, ' +
            'metrics.cost_micros, metrics.clicks, metrics.conversions, ' +
            'metrics.conversions_value ' +
            'FROM user_location_view ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            'AND segments.date BETWEEN \'' + dateFrom + '\' AND \'' + dateTo + '\'');
        // user_location_view reports where users actually were, at country
        // granularity; the geo_target_constant lookup resolves ids to names.
        while (rows.hasNext()) {
            const row = rows.next();
            const geoId = String(row.userLocationView.countryCriterionId);
            if (!byGeo[geoId]) {
                counters.locations++;
                byGeo[geoId] = { geoId: geoId, cost: 0, clicks: 0, conversions: 0, value: 0 };
            }
            const entry = byGeo[geoId];
            entry.cost += (parseInt(row.metrics.costMicros, 10) || 0) / 1000000;
            entry.clicks += parseInt(row.metrics.clicks, 10) || 0;
            entry.conversions += Number(row.metrics.conversions) || 0;
            entry.value += Number(row.metrics.conversionsValue) || 0;
        }

        resolveNames(byGeo);

        let totalCost = 0;
        let totalConversions = 0;
        const all = [];
        for (const geoId in byGeo) {
            totalCost += byGeo[geoId].cost;
            totalConversions += byGeo[geoId].conversions;
            all.push(byGeo[geoId]);
        }
        all.sort(function (a, b) { return b.cost - a.cost; });
        const accountCpa = totalConversions > 0 ? totalCost / totalConversions : 0;

        const flagged = [];
        for (const entry of all) {
            if (entry.cost < CONFIG.MIN_SPEND) {
                continue;
            }
            const reason = entry.conversions === 0 ? 'zero conversions' :
                (accountCpa > 0 && entry.cost / entry.conversions >
                    accountCpa * CONFIG.DEVIATION_FACTOR ?
                    'cost/conv ' + round(entry.cost / entry.conversions, 2) +
                    ' vs account ' + round(accountCpa, 2) : undefined);
            if (!reason) {
                continue;
            }
            counters.flagged++;
            entry.reason = reason;
            flagged.push(entry);
            Logger.log('FLAGGED (' + reason + '): ' + entry.name + ' - ' +
                round(entry.cost, 2) + ' spent');
        }

        writeSheet(all, dateTo);
        if (flagged.length > 0 && CONFIG.RECIPIENT_EMAILS.length > 0) {
            sendDigest(flagged, dateFrom, dateTo);
        }

        logSummary(counters);
    };

    /**
     * Resolves geo target constant ids to canonical names in one query.
     */
    function resolveNames(byGeo) {
        const ids = Object.keys(byGeo);
        if (ids.length === 0) {
            return;
        }
        const resources = ids.map(function (id) {
            return 'geoTargetConstants/' + id;
        });
        const rows = AdsApp.search(
            'SELECT geo_target_constant.resource_name, geo_target_constant.canonical_name ' +
            'FROM geo_target_constant ' +
            'WHERE geo_target_constant.resource_name IN (\'' +
            resources.join('\', \'') + '\')');
        const names = {};
        while (rows.hasNext()) {
            const row = rows.next();
            names[String(row.geoTargetConstant.resourceName).split('/').pop()] =
                row.geoTargetConstant.canonicalName;
        }
        for (const id of ids) {
            byGeo[id].name = names[id] || ('geo ' + id);
        }
    }

    function writeSheet(all, dateTo) {
        const spreadsheet = getOrCreateSpreadsheet();
        const tabName = 'Locations ' + dateTo;
        let sheet = spreadsheet.getSheetByName(tabName);
        if (!sheet) {
            sheet = spreadsheet.insertSheet(tabName);
        }
        sheet.clear();
        const rows = [['Location', 'Cost', 'Clicks', 'Conversions', 'Conv. value',
            'Cost / conv.']];
        for (const entry of all) {
            rows.push([entry.name, round(entry.cost, 2), entry.clicks,
                round(entry.conversions, 2), round(entry.value, 2),
                entry.conversions > 0 ? round(entry.cost / entry.conversions, 2) : '-']);
        }
        sheet.getRange(1, 1, rows.length, 6).setValues(rows);
        Logger.log('Full location list written to tab "' + tabName + '": ' +
            spreadsheet.getUrl());
    }

    function getOrCreateSpreadsheet() {
        if (CONFIG.SPREADSHEET_URL) {
            return SpreadsheetApp.openByUrl(CONFIG.SPREADSHEET_URL);
        }
        const name = AdsApp.currentAccount().getName() + ' - Geo Performance';
        const spreadsheet = SpreadsheetApp.create(name);
        Logger.log('Created spreadsheet "' + name + '" - paste this URL into ' +
            'CONFIG.SPREADSHEET_URL: ' + spreadsheet.getUrl());
        return spreadsheet;
    }

    function sendDigest(flagged, dateFrom, dateTo) {
        const accountName = AdsApp.currentAccount().getName();
        const currency = AdsApp.currentAccount().getCurrencyCode();
        const lines = ['Underperforming locations in ' + accountName +
            ' (' + dateFrom + ' to ' + dateTo + '):', ''];
        for (const entry of flagged) {
            lines.push(round(entry.cost, 2) + ' ' + currency + ' | ' + entry.name);
            lines.push('  ' + entry.reason);
        }

        MailApp.sendEmail(
            CONFIG.RECIPIENT_EMAILS.join(','),
            'Geo performance: ' + flagged.length + ' flagged location(s) in ' + accountName,
            lines.join('\n'));
    }

    function logSummary(counters) {
        Logger.log([
            '',
            '========== Execution Summary ==========',
            'Locations with traffic: ' + counters.locations,
            'Flagged: ' + counters.flagged,
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
