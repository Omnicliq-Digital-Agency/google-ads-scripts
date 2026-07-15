/**
 * Ad Schedule Heatmap
 *
 * Bid adjustments by hour and day are guesses until you've seen the
 * heatmap: which hours spend money, which hours convert, and - the cell
 * that matters - which hours spend without converting. Google's UI shows
 * hourly OR daily breakdowns; the 7x24 picture you actually schedule
 * around isn't a report you can click to. This script builds it: one
 * spreadsheet tab per metric, days as rows and hours as columns, shaded
 * so the pattern is visible from across the room.
 *
 * What you get:
 *   - One 7x24 matrix tab per metric: Cost, Conversions, Conv. value,
 *     Clicks - plus derived Cost/conv.
 *   - Cells shaded relative to the metric's maximum (white -> deep
 *     green; Cost/conv. inverts, expensive hours go red).
 *   - Read it like this: dark Cost + light Conversions = your negative
 *     bid adjustment candidates; the reverse = hours to protect.
 *
 * The script is read-only in the account: it writes only to the
 * spreadsheet. Turning the picture into ad schedule bid adjustments is
 * deliberately left to you.
 *
 * Setup:
 *   1. Leave SPREADSHEET_URL empty on the first run - the script creates
 *      a spreadsheet and logs its URL; paste that URL into
 *      SPREADSHEET_URL so later runs reuse it.
 *   2. Run it, open the sheet, look for the dark-cost/light-conversion
 *      hours.
 *   3. Schedule weekly to keep the picture fresh.
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
    // Spreadsheet that receives the heatmaps. Empty: a new spreadsheet is
    // created and its URL logged - paste it here for the next runs.
    SPREADSHEET_URL: '',

    // Also email the spreadsheet URL after each run. Empty = no email.
    RECIPIENT_EMAILS: [],

    // How many days of data to aggregate (ending yesterday). Longer
    // windows smooth noise; 8 weeks covers seasonality of the weekday mix.
    LOOKBACK_DAYS: 56,

    // Only include campaigns whose name contains this substring ('' = all
    // enabled campaigns).
    CAMPAIGN_NAME_FILTER: '',

    // Campaigns whose name contains any of these are skipped.
    CAMPAIGN_EXCLUDE_PATTERNS: [],
};

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
const METRICS = ['Cost', 'Conversions', 'Conv. value', 'Clicks'];

function main() {
    const heatmap = new ScheduleHeatmap();
    heatmap.build();
}

function ScheduleHeatmap() {

    this.build = function () {
        const dateFrom = formattedDate(-CONFIG.LOOKBACK_DAYS);
        const dateTo = formattedDate(-1);

        // metric -> day -> hour -> value
        const grids = {};
        for (const metric of METRICS) {
            grids[metric] = emptyGrid();
        }

        Logger.log('Aggregating ' + dateFrom + ' to ' + dateTo + ' by day and hour...');
        let rowsRead = 0;
        const rows = AdsApp.search(
            'SELECT campaign.name, segments.day_of_week, segments.hour, ' +
            'metrics.cost_micros, metrics.conversions, metrics.conversions_value, ' +
            'metrics.clicks ' +
            'FROM campaign ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            'AND segments.date BETWEEN \'' + dateFrom + '\' AND \'' + dateTo + '\'');
        while (rows.hasNext()) {
            const row = rows.next();
            if (!campaignQualifies(row.campaign.name)) {
                continue;
            }
            rowsRead++;
            const day = DAYS.indexOf(row.segments.dayOfWeek);
            const hour = parseInt(row.segments.hour, 10);
            if (day === -1 || isNaN(hour)) {
                continue;
            }
            grids['Cost'][day][hour] += (parseInt(row.metrics.costMicros, 10) || 0) / 1000000;
            grids['Conversions'][day][hour] += Number(row.metrics.conversions) || 0;
            grids['Conv. value'][day][hour] += Number(row.metrics.conversionsValue) || 0;
            grids['Clicks'][day][hour] += parseInt(row.metrics.clicks, 10) || 0;
        }

        // Derived: cost per conversion, empty where there are no conversions.
        const costPerConv = emptyGrid();
        for (let day = 0; day < 7; day++) {
            for (let hour = 0; hour < 24; hour++) {
                costPerConv[day][hour] = grids['Conversions'][day][hour] > 0 ?
                    grids['Cost'][day][hour] / grids['Conversions'][day][hour] : 0;
            }
        }

        const spreadsheet = getOrCreateSpreadsheet();
        for (const metric of METRICS) {
            writeGrid(spreadsheet, metric, grids[metric], false);
        }
        writeGrid(spreadsheet, 'Cost per conv.', costPerConv, true);

        Logger.log('Heatmaps written: ' + spreadsheet.getUrl());
        if (CONFIG.RECIPIENT_EMAILS.length > 0) {
            MailApp.sendEmail(
                CONFIG.RECIPIENT_EMAILS.join(','),
                'Ad schedule heatmap: ' + AdsApp.currentAccount().getName(),
                'Fresh day-by-hour heatmaps (' + dateFrom + ' to ' + dateTo + '):\n' +
                spreadsheet.getUrl());
        }

        logSummary(rowsRead, dateFrom, dateTo, spreadsheet.getUrl());
    };

    function emptyGrid() {
        const grid = [];
        for (let day = 0; day < 7; day++) {
            grid.push(new Array(24).fill(0));
        }
        return grid;
    }

    /**
     * One tab per metric: header row of hours, one row per day, values
     * rounded, cells shaded relative to the grid maximum. 'inverted'
     * shades high values red instead of green (bad when high).
     */
    function writeGrid(spreadsheet, metric, grid, inverted) {
        let sheet = spreadsheet.getSheetByName(metric);
        if (!sheet) {
            sheet = spreadsheet.insertSheet(metric);
        }
        sheet.clear();

        const header = [''];
        for (let hour = 0; hour < 24; hour++) {
            header.push(hour + ':00');
        }
        const values = [header];
        const backgrounds = [new Array(25).fill('#ffffff')];

        let max = 0;
        for (let day = 0; day < 7; day++) {
            for (let hour = 0; hour < 24; hour++) {
                max = Math.max(max, grid[day][hour]);
            }
        }

        for (let day = 0; day < 7; day++) {
            const valueRow = [DAYS[day]];
            const backgroundRow = ['#ffffff'];
            for (let hour = 0; hour < 24; hour++) {
                valueRow.push(round(grid[day][hour], 2));
                backgroundRow.push(shade(grid[day][hour], max, inverted));
            }
            values.push(valueRow);
            backgrounds.push(backgroundRow);
        }

        const range = sheet.getRange(1, 1, values.length, header.length);
        range.setValues(values);
        range.setBackgrounds(backgrounds);
    }

    /**
     * White at zero to full green (or red when inverted) at the maximum.
     */
    function shade(value, max, inverted) {
        if (max <= 0 || value <= 0) {
            return '#ffffff';
        }
        const intensity = Math.sqrt(value / max);
        const level = Math.round(255 - intensity * 160);
        const hex = ('0' + level.toString(16)).slice(-2);
        return inverted ?
            '#ff' + hex + hex :
            '#' + hex + 'ff' + hex;
    }

    function campaignQualifies(campaignName) {
        if (CONFIG.CAMPAIGN_NAME_FILTER &&
            campaignName.indexOf(CONFIG.CAMPAIGN_NAME_FILTER) === -1) {
            return false;
        }
        for (const pattern of CONFIG.CAMPAIGN_EXCLUDE_PATTERNS) {
            if (campaignName.toUpperCase().indexOf(pattern.toUpperCase()) !== -1) {
                return false;
            }
        }
        return true;
    }

    function getOrCreateSpreadsheet() {
        if (CONFIG.SPREADSHEET_URL) {
            return SpreadsheetApp.openByUrl(CONFIG.SPREADSHEET_URL);
        }
        const name = AdsApp.currentAccount().getName() + ' - Ad Schedule Heatmap';
        const spreadsheet = SpreadsheetApp.create(name);
        Logger.log('Created spreadsheet "' + name + '" - paste this URL into ' +
            'CONFIG.SPREADSHEET_URL: ' + spreadsheet.getUrl());
        return spreadsheet;
    }

    function logSummary(rowsRead, dateFrom, dateTo, url) {
        Logger.log([
            '',
            '========== Execution Summary ==========',
            'Window: ' + dateFrom + ' to ' + dateTo,
            'Report rows aggregated: ' + rowsRead,
            'Tabs written: ' + METRICS.join(', ') + ', Cost per conv.',
            'Spreadsheet: ' + url,
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
