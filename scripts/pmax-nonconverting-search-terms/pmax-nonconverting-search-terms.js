/**
 * PMax Non-Converting Search Terms
 *
 * Performance Max is a black box exactly where it hurts: which searches
 * eat the budget without converting. The data exists - Google exposes
 * PMax search terms through search term insights - but the UI buries it
 * per campaign, per category, unrankable. This script digs it all out:
 * every search term across your PMax campaigns with real clicks and no
 * conversions, ranked, in a spreadsheet, with an email alert - ready to
 * become negative keywords.
 *
 * How a term qualifies:
 *   1. For each enabled PMax campaign, search term insight categories
 *      with at least MIN_CLICKS are fetched, then each category's terms.
 *   2. A term with at least MIN_CLICKS clicks and conversions below
 *      CONVERSION_THRESHOLD in the window is flagged.
 *   3. Flagged terms are ranked by clicks, written to a dated spreadsheet
 *      tab and emailed.
 *
 * Read-only: PMax negative keywords are set through your account's
 * negative keyword lists or Google support flows - the report is the
 * paste-ready input.
 *
 * Setup:
 *   1. Leave SPREADSHEET_URL empty on the first run - the script creates
 *      a spreadsheet and logs its URL; paste it into CONFIG.
 *   2. Fill RECIPIENT_EMAILS and schedule weekly.
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
    // Spreadsheet for the reports. Empty: a new spreadsheet is created and
    // its URL logged - paste it here for the next runs.
    SPREADSHEET_URL: '',

    // Who receives the alert. Empty = log only.
    RECIPIENT_EMAILS: [],

    // How many days of search term insight data to analyse (ending
    // yesterday). PMax conversion lag is long - keep the window wide.
    LOOKBACK_DAYS: 90,

    // A term needs at least this many clicks in the window to be judged.
    MIN_CLICKS: 50,

    // Terms with fewer conversions than this are flagged (0.5 tolerates
    // fractional attribution noise).
    CONVERSION_THRESHOLD: 0.5,

    // Only audit PMax campaigns whose name contains this substring
    // ('' = all enabled PMax campaigns).
    CAMPAIGN_NAME_FILTER: '',

    // Stop fetching this many milliseconds after the script starts -
    // insight queries are slow on large accounts; the report ships with
    // whatever was analysed.
    MAX_RUNTIME_MS: 25 * 60 * 1000,
};

function main() {
    const startTime = Date.now();
    const audit = new PmaxSearchTermAudit(startTime);
    audit.run();
}

function PmaxSearchTermAudit(startTime) {

    this.run = function () {
        const dateFrom = formattedDate(-CONFIG.LOOKBACK_DAYS);
        const dateTo = formattedDate(-1);
        const counters = {
            campaigns: 0, categories: 0, terms: 0, flagged: 0,
            timedOut: false,
        };
        const flagged = [];

        Logger.log('Finding enabled PMax campaigns...');
        const campaigns = getPmaxCampaigns();
        counters.campaigns = campaigns.length;
        if (campaigns.length === 0) {
            Logger.log('No enabled Performance Max campaigns found. Exiting.');
            return;
        }

        for (const campaign of campaigns) {
            Logger.log('Analysing "' + campaign.name + '"...');
            const categories = getInsightCategories(campaign.id, dateFrom, dateTo);
            counters.categories += categories.length;

            for (const category of categories) {
                for (const term of getCategoryTerms(campaign.id, category.id, dateFrom, dateTo)) {
                    counters.terms++;
                    if (term.clicks >= CONFIG.MIN_CLICKS &&
                        term.conversions < CONFIG.CONVERSION_THRESHOLD) {
                        counters.flagged++;
                        flagged.push({
                            campaign: campaign.name,
                            category: category.label,
                            term: term.text,
                            impressions: term.impressions,
                            clicks: term.clicks,
                            conversions: term.conversions,
                            value: term.value,
                        });
                    }
                }

                if (Date.now() - startTime > CONFIG.MAX_RUNTIME_MS) {
                    counters.timedOut = true;
                    Logger.log('Approaching the execution time limit - reporting what was ' +
                        'analysed so far. Raise MIN_CLICKS or lower LOOKBACK_DAYS to cover ' +
                        'everything in one run.');
                    break;
                }
            }
            if (counters.timedOut) {
                break;
            }
        }

        flagged.sort(function (a, b) { return b.clicks - a.clicks; });
        for (const entry of flagged) {
            Logger.log(entry.clicks + ' clicks, ' + round(entry.conversions, 2) +
                ' conv: "' + entry.term + '" [' + entry.category + '] (' +
                entry.campaign + ')');
        }

        if (flagged.length > 0) {
            const spreadsheet = writeSheet(flagged, dateTo);
            if (CONFIG.RECIPIENT_EMAILS.length > 0) {
                sendAlert(flagged, spreadsheet, dateFrom, dateTo);
            }
        }

        logSummary(counters);
    };

    function getPmaxCampaigns() {
        const campaigns = [];
        const rows = AdsApp.search(
            'SELECT campaign.id, campaign.name ' +
            'FROM campaign ' +
            'WHERE campaign.advertising_channel_type = \'PERFORMANCE_MAX\' ' +
            'AND campaign.status = \'ENABLED\'');
        while (rows.hasNext()) {
            const row = rows.next();
            if (CONFIG.CAMPAIGN_NAME_FILTER &&
                row.campaign.name.indexOf(CONFIG.CAMPAIGN_NAME_FILTER) === -1) {
                continue;
            }
            campaigns.push({ id: row.campaign.id, name: row.campaign.name });
        }
        return campaigns;
    }

    /**
     * Search term insight categories of one PMax campaign that cleared the
     * clicks floor - each category is then expanded into its terms.
     */
    function getInsightCategories(campaignId, dateFrom, dateTo) {
        const categories = [];
        const rows = AdsApp.search(
            'SELECT campaign_search_term_insight.id, ' +
            'campaign_search_term_insight.category_label, metrics.clicks ' +
            'FROM campaign_search_term_insight ' +
            'WHERE segments.date BETWEEN \'' + dateFrom + '\' AND \'' + dateTo + '\' ' +
            'AND campaign_search_term_insight.campaign_id = ' + campaignId + ' ' +
            'AND metrics.clicks >= ' + CONFIG.MIN_CLICKS);
        while (rows.hasNext()) {
            const row = rows.next();
            categories.push({
                id: row.campaignSearchTermInsight.id,
                label: row.campaignSearchTermInsight.categoryLabel || '(unlabeled)',
            });
        }
        return categories;
    }

    /**
     * The individual search terms of one insight category, deduplicated.
     */
    function getCategoryTerms(campaignId, categoryId, dateFrom, dateTo) {
        const byTerm = {};
        const rows = AdsApp.search(
            'SELECT segments.search_term, metrics.impressions, metrics.clicks, ' +
            'metrics.conversions, metrics.conversions_value ' +
            'FROM campaign_search_term_insight ' +
            'WHERE segments.date BETWEEN \'' + dateFrom + '\' AND \'' + dateTo + '\' ' +
            'AND campaign_search_term_insight.campaign_id = ' + campaignId + ' ' +
            'AND campaign_search_term_insight.id = "' + categoryId + '"');
        while (rows.hasNext()) {
            const row = rows.next();
            const text = row.segments.searchTerm;
            if (!text) {
                continue;
            }
            if (!byTerm[text]) {
                byTerm[text] = {
                    text: text, impressions: 0, clicks: 0, conversions: 0, value: 0,
                };
            }
            byTerm[text].impressions += parseInt(row.metrics.impressions, 10) || 0;
            byTerm[text].clicks += parseInt(row.metrics.clicks, 10) || 0;
            byTerm[text].conversions += Number(row.metrics.conversions) || 0;
            byTerm[text].value += Number(row.metrics.conversionsValue) || 0;
        }
        const terms = [];
        for (const text in byTerm) {
            terms.push(byTerm[text]);
        }
        return terms;
    }

    function writeSheet(flagged, dateTo) {
        const spreadsheet = getOrCreateSpreadsheet();
        const tabName = 'Non-converting ' + dateTo;
        let sheet = spreadsheet.getSheetByName(tabName);
        if (!sheet) {
            sheet = spreadsheet.insertSheet(tabName);
        }
        sheet.clear();
        const rows = [['Campaign', 'Category', 'Search term', 'Impressions', 'Clicks',
            'Conversions', 'Conv. value']];
        for (const entry of flagged) {
            rows.push([entry.campaign, entry.category, entry.term, entry.impressions,
                entry.clicks, round(entry.conversions, 2), round(entry.value, 2)]);
        }
        sheet.getRange(1, 1, rows.length, 7).setValues(rows);
        Logger.log('Report written to tab "' + tabName + '": ' + spreadsheet.getUrl());
        return spreadsheet;
    }

    function getOrCreateSpreadsheet() {
        if (CONFIG.SPREADSHEET_URL) {
            return SpreadsheetApp.openByUrl(CONFIG.SPREADSHEET_URL);
        }
        const name = AdsApp.currentAccount().getName() + ' - PMax Non-Converting Terms';
        const spreadsheet = SpreadsheetApp.create(name);
        Logger.log('Created spreadsheet "' + name + '" - paste this URL into ' +
            'CONFIG.SPREADSHEET_URL: ' + spreadsheet.getUrl());
        return spreadsheet;
    }

    function sendAlert(flagged, spreadsheet, dateFrom, dateTo) {
        const accountName = AdsApp.currentAccount().getName();
        const lines = ['Non-converting PMax search terms in ' + accountName +
            ' (' + dateFrom + ' to ' + dateTo + '), worst first:', ''];
        for (const entry of flagged.slice(0, 25)) {
            lines.push(entry.clicks + ' clicks | "' + entry.term + '" (' +
                entry.campaign + ')');
        }
        if (flagged.length > 25) {
            lines.push('... and ' + (flagged.length - 25) + ' more in the sheet.');
        }
        lines.push('');
        lines.push('Full report: ' + spreadsheet.getUrl());

        MailApp.sendEmail(
            CONFIG.RECIPIENT_EMAILS.join(','),
            'PMax wasting budget on ' + flagged.length + ' non-converting term(s) in ' +
            accountName,
            lines.join('\n'));
    }

    function logSummary(counters) {
        Logger.log([
            '',
            '========== Execution Summary ==========',
            'PMax campaigns: ' + counters.campaigns +
            ' | insight categories: ' + counters.categories,
            'Search terms analysed: ' + counters.terms,
            (counters.timedOut ? 'Stopped early near the execution time limit.' : ''),
            'Flagged (>= ' + CONFIG.MIN_CLICKS + ' clicks, < ' +
            CONFIG.CONVERSION_THRESHOLD + ' conversions): ' + counters.flagged,
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
