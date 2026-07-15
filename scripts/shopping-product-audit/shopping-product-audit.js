/**
 * Shopping Product Audit
 *
 * Shopping campaigns report at product level, but nobody reads thousands
 * of product rows - so money-losing items hide in plain sight. This script
 * aggregates every product that served in your Shopping and PMax retail
 * campaigns over the lookback window, writes the full ranked list to a
 * spreadsheet, and emails the two lists that matter: products spending
 * without converting, and products converting below your ROAS floor.
 *
 * How a product is judged:
 *   1. Performance is aggregated per item id across the window.
 *   2. ZERO_CONV list: cost of at least MIN_SPEND with zero conversions.
 *   3. LOW_ROAS list: cost of at least MIN_SPEND with conversion value /
 *      cost below MIN_ROAS.
 *
 * The script is read-only: excluding a product is a feed or listing group
 * decision, and those belong to you.
 *
 * Setup:
 *   1. Set MIN_SPEND and MIN_ROAS to your economics.
 *   2. Leave SPREADSHEET_URL empty on the first run - the script creates
 *      a spreadsheet and logs its URL; pin it in CONFIG afterwards.
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
    // Who receives the digest. Empty = log only.
    RECIPIENT_EMAILS: [],

    // Spreadsheet for the full ranked product list. Empty on the first
    // run: one is created and its URL logged.
    SPREADSHEET_URL: '',

    // How many days to analyse (ending yesterday).
    LOOKBACK_DAYS: 30,

    // Minimum spend (account currency) before a product can be flagged.
    MIN_SPEND: 20,

    // Products below this conversion-value/cost ratio land on the LOW_ROAS
    // list (2.5 = 250%). Set to 0 to disable the ROAS check.
    MIN_ROAS: 2.5,

    // Campaigns whose name contains any of these are skipped.
    CAMPAIGN_EXCLUDE_PATTERNS: [],
};

function main() {
    const audit = new ProductAudit();
    audit.run();
}

function ProductAudit() {

    this.run = function () {
        const dateFrom = formattedDate(-CONFIG.LOOKBACK_DAYS);
        const dateTo = formattedDate(-1);
        const counters = { products: 0, zeroConv: 0, lowRoas: 0 };

        Logger.log('Aggregating product performance (' + dateFrom + ' to ' + dateTo + ')...');
        const byItem = {};
        const rows = AdsApp.search(
            'SELECT campaign.name, segments.product_item_id, segments.product_title, ' +
            'metrics.cost_micros, metrics.clicks, metrics.impressions, ' +
            'metrics.conversions, metrics.conversions_value ' +
            'FROM shopping_performance_view ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            'AND metrics.impressions > 0 ' +
            'AND segments.date BETWEEN \'' + dateFrom + '\' AND \'' + dateTo + '\'');
        while (rows.hasNext()) {
            const row = rows.next();
            if (isExcluded(row.campaign.name)) {
                continue;
            }
            const itemId = row.segments.productItemId;
            if (!byItem[itemId]) {
                counters.products++;
                byItem[itemId] = {
                    itemId: itemId,
                    title: row.segments.productTitle || itemId,
                    cost: 0, clicks: 0, impressions: 0, conversions: 0, value: 0,
                };
            }
            const entry = byItem[itemId];
            entry.cost += (parseInt(row.metrics.costMicros, 10) || 0) / 1000000;
            entry.clicks += parseInt(row.metrics.clicks, 10) || 0;
            entry.impressions += parseInt(row.metrics.impressions, 10) || 0;
            entry.conversions += Number(row.metrics.conversions) || 0;
            entry.value += Number(row.metrics.conversionsValue) || 0;
        }

        const all = [];
        const zeroConv = [];
        const lowRoas = [];
        for (const itemId in byItem) {
            const entry = byItem[itemId];
            entry.roas = entry.cost > 0 ? entry.value / entry.cost : 0;
            all.push(entry);
            if (entry.cost < CONFIG.MIN_SPEND) {
                continue;
            }
            if (entry.conversions === 0) {
                counters.zeroConv++;
                zeroConv.push(entry);
            } else if (CONFIG.MIN_ROAS > 0 && entry.roas < CONFIG.MIN_ROAS) {
                counters.lowRoas++;
                lowRoas.push(entry);
            }
        }
        all.sort(function (a, b) { return b.cost - a.cost; });
        zeroConv.sort(function (a, b) { return b.cost - a.cost; });
        lowRoas.sort(function (a, b) { return b.cost - a.cost; });

        for (const entry of zeroConv) {
            Logger.log('ZERO CONV: ' + round(entry.cost, 2) + ' spent | ' + entry.title +
                ' [' + entry.itemId + ']');
        }
        for (const entry of lowRoas) {
            Logger.log('LOW ROAS ' + round(entry.roas, 2) + ': ' + round(entry.cost, 2) +
                ' spent | ' + entry.title + ' [' + entry.itemId + ']');
        }

        writeSheet(all, dateTo);
        if ((zeroConv.length > 0 || lowRoas.length > 0) &&
            CONFIG.RECIPIENT_EMAILS.length > 0) {
            sendDigest(zeroConv, lowRoas, dateFrom, dateTo);
        }

        logSummary(counters);
    };

    function writeSheet(all, dateTo) {
        const spreadsheet = getOrCreateSpreadsheet();
        const tabName = 'Products ' + dateTo;
        let sheet = spreadsheet.getSheetByName(tabName);
        if (!sheet) {
            sheet = spreadsheet.insertSheet(tabName);
        }
        sheet.clear();
        const rows = [['Item id', 'Title', 'Cost', 'Clicks', 'Impressions',
            'Conversions', 'Conv. value', 'ROAS']];
        for (const entry of all) {
            rows.push([entry.itemId, entry.title, round(entry.cost, 2), entry.clicks,
                entry.impressions, round(entry.conversions, 2), round(entry.value, 2),
                round(entry.roas, 2)]);
        }
        sheet.getRange(1, 1, rows.length, 8).setValues(rows);
        Logger.log('Full product list written to tab "' + tabName + '": ' +
            spreadsheet.getUrl());
    }

    function getOrCreateSpreadsheet() {
        if (CONFIG.SPREADSHEET_URL) {
            return SpreadsheetApp.openByUrl(CONFIG.SPREADSHEET_URL);
        }
        const name = AdsApp.currentAccount().getName() + ' - Shopping Product Audit';
        const spreadsheet = SpreadsheetApp.create(name);
        Logger.log('Created spreadsheet "' + name + '" - paste this URL into ' +
            'CONFIG.SPREADSHEET_URL: ' + spreadsheet.getUrl());
        return spreadsheet;
    }

    function sendDigest(zeroConv, lowRoas, dateFrom, dateTo) {
        const accountName = AdsApp.currentAccount().getName();
        const currency = AdsApp.currentAccount().getCurrencyCode();
        const lines = ['Shopping product audit for ' + accountName +
            ' (' + dateFrom + ' to ' + dateTo + '):', ''];
        if (zeroConv.length > 0) {
            lines.push('== Spending without converting (' + zeroConv.length + ') ==');
            for (const entry of zeroConv) {
                lines.push(round(entry.cost, 2) + ' ' + currency + ' | ' + entry.title +
                    ' [' + entry.itemId + ']');
            }
            lines.push('');
        }
        if (lowRoas.length > 0) {
            lines.push('== Below ' + CONFIG.MIN_ROAS + ' ROAS (' + lowRoas.length + ') ==');
            for (const entry of lowRoas) {
                lines.push('ROAS ' + round(entry.roas, 2) + ' | ' + round(entry.cost, 2) +
                    ' ' + currency + ' | ' + entry.title + ' [' + entry.itemId + ']');
            }
        }

        MailApp.sendEmail(
            CONFIG.RECIPIENT_EMAILS.join(','),
            'Shopping product audit: ' + (zeroConv.length + lowRoas.length) +
            ' flagged product(s) in ' + accountName,
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
            'Products served: ' + counters.products,
            'Zero-conversion spenders: ' + counters.zeroConv +
            ' | below ROAS floor: ' + counters.lowRoas,
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
