/**
 * Search Term N-Gram Analyzer
 *
 * Your search term report shows you queries one by one - thousands of rows,
 * each too small to judge. The patterns live one level up: the word
 * "cheap" appearing in 400 different queries with terrible conversion
 * rates, or "buy" quietly carrying half your revenue. This script breaks
 * every search term into n-grams (single words, pairs, triples), sums the
 * performance of every query containing each n-gram, and writes the ranked
 * analysis to a spreadsheet - the fastest route to negative keyword ideas
 * and bid insights you can't see query-by-query.
 *
 * What you get per n-gram:
 *   Queries, Clicks, Impressions, Cost, Conversions, Conversion value -
 *   and the derived CTR, CPC, Conv. rate, Cost/conv. and ROAS - at account
 *   level and per campaign, one spreadsheet tab per n-gram size and level.
 *
 * Setup:
 *   1. Review CONFIG below. Leave SPREADSHEET_URL empty on the first run -
 *      the script creates a spreadsheet and logs its URL; paste that URL
 *      into SPREADSHEET_URL so subsequent runs reuse it.
 *   2. Run it. This script is read-only in the account: it only writes to
 *      the spreadsheet and (optionally) emails its URL.
 *   3. Schedule weekly.
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
    // Spreadsheet that receives the analysis. Empty: a new spreadsheet is
    // created and its URL logged - paste it here for the next runs.
    SPREADSHEET_URL: '',

    // Also email the spreadsheet URL after each run. Empty = no email.
    RECIPIENT_EMAILS: [],

    // How many days of search term data to analyse (ending yesterday).
    LOOKBACK_DAYS: 90,

    // N-gram sizes to build: 1 = single words, 2 = pairs, 3 = triples.
    MIN_NGRAM_LENGTH: 1,
    MAX_NGRAM_LENGTH: 2,

    // Breakdowns to write: account-wide and/or per campaign.
    LEVELS: {
        ACCOUNT: true,
        CAMPAIGN: true,
    },

    // Only n-grams passing ALL thresholds are written - raise these to cut
    // the long tail and keep the sheets readable.
    THRESHOLDS: {
        MIN_QUERIES: 2,
        MIN_IMPRESSIONS: 10,
        MIN_CLICKS: 0,
        MIN_COST: 0,
    },

    // Campaigns whose name contains any of these are skipped.
    CAMPAIGN_EXCLUDE_PATTERNS: ['SHOPPING', 'PMAX'],

    // Include paused campaigns/ad groups in the analysis.
    INCLUDE_PAUSED: false,
};

const STATS = ['Queries', 'Clicks', 'Impressions', 'Cost', 'Conversions', 'Conv. value'];
const DERIVED = [
    { name: 'CTR', numerator: 'Clicks', denominator: 'Impressions' },
    { name: 'CPC', numerator: 'Cost', denominator: 'Clicks' },
    { name: 'Conv. rate', numerator: 'Conversions', denominator: 'Clicks' },
    { name: 'Cost / conv.', numerator: 'Cost', denominator: 'Conversions' },
    { name: 'ROAS', numerator: 'Conv. value', denominator: 'Cost' },
];

function main() {
    validateConfig();

    const analyzer = new NGramAnalyzer();
    analyzer.analyze();
}

function validateConfig() {
    if (CONFIG.MIN_NGRAM_LENGTH < 1 || CONFIG.MAX_NGRAM_LENGTH < CONFIG.MIN_NGRAM_LENGTH) {
        throw new Error('MIN_NGRAM_LENGTH must be >= 1 and <= MAX_NGRAM_LENGTH.');
    }
    if (!CONFIG.LEVELS.ACCOUNT && !CONFIG.LEVELS.CAMPAIGN) {
        throw new Error('Both LEVELS are off - nothing to write.');
    }
}

function NGramAnalyzer() {

    this.analyze = function () {
        const dateFrom = formattedDate(-CONFIG.LOOKBACK_DAYS);
        const dateTo = formattedDate(-1);

        // level key ('' for account, campaign name otherwise) -> n -> gram -> stats.
        const grams = { account: {}, campaign: {} };
        const counters = { terms: 0 };

        Logger.log('Collecting search terms (' + dateFrom + ' to ' + dateTo + ')...');
        const statusCondition = CONFIG.INCLUDE_PAUSED ? 'IN (\'ENABLED\', \'PAUSED\')' : '= \'ENABLED\'';
        const rows = AdsApp.search(
            'SELECT campaign.name, search_term_view.search_term, metrics.clicks, ' +
            'metrics.impressions, metrics.cost_micros, metrics.conversions, ' +
            'metrics.conversions_value ' +
            'FROM search_term_view ' +
            'WHERE campaign.status ' + statusCondition + ' ' +
            'AND ad_group.status ' + statusCondition + ' ' +
            buildCampaignExcludeFilter() +
            'AND segments.date BETWEEN \'' + dateFrom + '\' AND \'' + dateTo + '\'');

        while (rows.hasNext()) {
            const row = rows.next();
            counters.terms++;
            const stats = {
                'Queries': 1,
                'Clicks': parseInt(row.metrics.clicks, 10) || 0,
                'Impressions': parseInt(row.metrics.impressions, 10) || 0,
                'Cost': (parseInt(row.metrics.costMicros, 10) || 0) / 1000000,
                'Conversions': Number(row.metrics.conversions) || 0,
                'Conv. value': Number(row.metrics.conversionsValue) || 0,
            };

            const words = row.searchTermView.searchTerm.toLowerCase()
                .replace(/[.!?,]/g, '').split(/\s+/);

            for (let n = CONFIG.MIN_NGRAM_LENGTH; n <= CONFIG.MAX_NGRAM_LENGTH; n++) {
                if (n > words.length) {
                    break;
                }
                const seen = {};
                for (let w = 0; w <= words.length - n; w++) {
                    const gram = words.slice(w, w + n).join(' ');
                    if (seen[gram]) {
                        continue;
                    }
                    seen[gram] = true;
                    if (CONFIG.LEVELS.ACCOUNT) {
                        accumulate(grams.account, '', n, gram, stats);
                    }
                    if (CONFIG.LEVELS.CAMPAIGN) {
                        accumulate(grams.campaign, row.campaign.name, n, gram, stats);
                    }
                }
            }
        }
        Logger.log(counters.terms + ' search terms analysed.');

        const spreadsheet = getOrCreateSpreadsheet();
        let rowsWritten = 0;
        for (let n = CONFIG.MIN_NGRAM_LENGTH; n <= CONFIG.MAX_NGRAM_LENGTH; n++) {
            if (CONFIG.LEVELS.ACCOUNT) {
                rowsWritten += writeLevel(spreadsheet, gramTabName(n, 'Account'),
                    [], grams.account, n);
            }
            if (CONFIG.LEVELS.CAMPAIGN) {
                rowsWritten += writeLevel(spreadsheet, gramTabName(n, 'Campaign'),
                    ['Campaign'], grams.campaign, n);
            }
        }

        Logger.log('Analysis written: ' + spreadsheet.getUrl());
        if (CONFIG.RECIPIENT_EMAILS.length > 0) {
            MailApp.sendEmail(
                CONFIG.RECIPIENT_EMAILS.join(','),
                'Search term n-gram analysis: ' + AdsApp.currentAccount().getName(),
                'Fresh n-gram analysis (' + dateFrom + ' to ' + dateTo + '):\n' +
                spreadsheet.getUrl());
        }

        logSummary(counters, rowsWritten, dateFrom, dateTo, spreadsheet.getUrl());
    };

    function accumulate(store, levelKey, n, gram, stats) {
        if (!store[levelKey]) {
            store[levelKey] = {};
        }
        if (!store[levelKey][n]) {
            store[levelKey][n] = {};
        }
        const bucket = store[levelKey][n];
        if (!bucket[gram]) {
            bucket[gram] = {};
            for (const stat of STATS) {
                bucket[gram][stat] = 0;
            }
        }
        for (const stat of STATS) {
            bucket[gram][stat] += stats[stat];
        }
    }

    /**
     * Writes one tab: header, then a threshold-filtered row per (level,
     * gram), sorted by cost then impressions descending.
     */
    function writeLevel(spreadsheet, tabName, levelColumns, store, n) {
        const header = levelColumns.concat(['Phrase']).concat(STATS)
            .concat(DERIVED.map(function (d) { return d.name; }));
        const output = [];

        for (const levelKey in store) {
            const bucket = store[levelKey][n];
            if (!bucket) {
                continue;
            }
            for (const gram in bucket) {
                const stats = bucket[gram];
                if (stats['Queries'] < CONFIG.THRESHOLDS.MIN_QUERIES ||
                    stats['Impressions'] < CONFIG.THRESHOLDS.MIN_IMPRESSIONS ||
                    stats['Clicks'] < CONFIG.THRESHOLDS.MIN_CLICKS ||
                    stats['Cost'] < CONFIG.THRESHOLDS.MIN_COST) {
                    continue;
                }
                const line = levelColumns.length > 0 ? [levelKey] : [];
                line.push(gram);
                for (const stat of STATS) {
                    line.push(round(stats[stat], 2));
                }
                for (const derived of DERIVED) {
                    line.push(stats[derived.denominator] > 0 ?
                        round(stats[derived.numerator] / stats[derived.denominator], 2) : '-');
                }
                output.push(line);
            }
        }

        const costIndex = header.indexOf('Cost');
        const imprIndex = header.indexOf('Impressions');
        output.sort(function (a, b) {
            return (b[costIndex] - a[costIndex]) || (b[imprIndex] - a[imprIndex]);
        });

        let sheet = spreadsheet.getSheetByName(tabName);
        if (!sheet) {
            sheet = spreadsheet.insertSheet(tabName);
        }
        sheet.clear();
        const rows = [header].concat(output);
        sheet.getRange(1, 1, rows.length, header.length).setValues(rows);

        return output.length;
    }

    function gramTabName(n, level) {
        return level + ' ' + (n === 1 ? 'Words' : n + '-Grams');
    }

    function getOrCreateSpreadsheet() {
        if (CONFIG.SPREADSHEET_URL) {
            return SpreadsheetApp.openByUrl(CONFIG.SPREADSHEET_URL);
        }
        const name = AdsApp.currentAccount().getName() + ' - Search Term N-Grams';
        const spreadsheet = SpreadsheetApp.create(name);
        Logger.log('Created spreadsheet "' + name + '" - paste this URL into ' +
            'CONFIG.SPREADSHEET_URL: ' + spreadsheet.getUrl());
        return spreadsheet;
    }

    function buildCampaignExcludeFilter() {
        let filter = '';
        for (const pattern of CONFIG.CAMPAIGN_EXCLUDE_PATTERNS) {
            filter += 'AND campaign.name NOT REGEXP_MATCH \'(?i).*' + escapeForRegexp(pattern) + '.*\' ';
        }
        return filter;
    }

    function logSummary(counters, rowsWritten, dateFrom, dateTo, url) {
        Logger.log([
            '',
            '========== Execution Summary ==========',
            'Window: ' + dateFrom + ' to ' + dateTo,
            'Search terms analysed: ' + counters.terms,
            'N-gram rows written (after thresholds): ' + rowsWritten,
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

function escapeForRegexp(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&');
}

function round(value, decimals) {
    return Number(Math.round(value + 'e' + decimals) + 'e-' + decimals);
}
