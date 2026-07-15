/**
 * RSA Asset Performance Report
 *
 * Google grades every RSA headline and description - BEST, GOOD, LOW - and
 * buries the grades three clicks deep, per ad. Nobody reviews them ad by
 * ad, so LOW assets keep serving for months. This script sweeps the whole
 * account: every asset of every enabled RSA, grouped by grade, with the
 * repeat offenders (the same LOW text used across many ads) ranked first
 * in the digest.
 *
 * What you get:
 *   1. A count of assets per performance grade across the account.
 *   2. The LOW list, deduped by text, ranked by how many ads carry each
 *      one - fixing the top line improves dozens of ads at once.
 *   3. Optionally the full asset list in a spreadsheet tab.
 *
 * The script is read-only: replacing ad copy is an editorial decision.
 *
 * Setup:
 *   1. Run it; read the grade counts and the LOW list in the logs.
 *   2. Schedule monthly, fill RECIPIENT_EMAILS, and rewrite the top
 *      offenders.
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

    // Optional spreadsheet for the full asset list. Empty = no sheet.
    SPREADSHEET_URL: '',

    // How many LOW assets the digest lists (the log always shows all).
    TOP_OFFENDERS: 20,

    // Campaigns whose name contains any of these are skipped.
    CAMPAIGN_EXCLUDE_PATTERNS: [],
};

function main() {
    const report = new AssetReport();
    report.run();
}

function AssetReport() {

    this.run = function () {
        const counters = { assets: 0 };
        const gradeCounts = {};
        // LOW asset text -> {text, fieldType, adCount}
        const lowByText = {};
        const all = [];

        Logger.log('Sweeping RSA asset performance labels...');
        const rows = AdsApp.search(
            'SELECT campaign.name, ad_group.name, ad_group_ad_asset_view.field_type, ' +
            'ad_group_ad_asset_view.performance_label, asset.text_asset.text ' +
            'FROM ad_group_ad_asset_view ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            'AND ad_group.status = \'ENABLED\' ' +
            'AND ad_group_ad.status = \'ENABLED\' ' +
            'AND ad_group_ad_asset_view.enabled = true');
        while (rows.hasNext()) {
            const row = rows.next();
            if (isExcluded(row.campaign.name)) {
                continue;
            }
            const view = row.adGroupAdAssetView;
            const text = row.asset.textAsset ? row.asset.textAsset.text : '';
            if (!text) {
                continue;
            }
            counters.assets++;
            const grade = view.performanceLabel || 'PENDING';
            gradeCounts[grade] = (gradeCounts[grade] || 0) + 1;
            all.push({
                campaign: row.campaign.name,
                adGroup: row.adGroup.name,
                fieldType: view.fieldType,
                grade: grade,
                text: text,
            });

            if (grade === 'LOW') {
                const key = view.fieldType + '|' + text;
                if (!lowByText[key]) {
                    lowByText[key] = { text: text, fieldType: view.fieldType, adCount: 0 };
                }
                lowByText[key].adCount++;
            }
        }

        for (const grade in gradeCounts) {
            Logger.log(grade + ': ' + gradeCounts[grade] + ' assets');
        }

        const offenders = [];
        for (const key in lowByText) {
            offenders.push(lowByText[key]);
        }
        offenders.sort(function (a, b) { return b.adCount - a.adCount; });
        for (const offender of offenders) {
            Logger.log('LOW [' + offender.fieldType + '] used in ' + offender.adCount +
                ' ad(s): "' + offender.text + '"');
        }

        if (CONFIG.SPREADSHEET_URL) {
            writeSheet(all);
        }
        if (offenders.length > 0 && CONFIG.RECIPIENT_EMAILS.length > 0) {
            sendDigest(offenders, gradeCounts);
        }

        logSummary(counters, gradeCounts);
    };

    function writeSheet(all) {
        const spreadsheet = SpreadsheetApp.openByUrl(CONFIG.SPREADSHEET_URL);
        const tabName = 'Assets ' + formattedDate(-1);
        let sheet = spreadsheet.getSheetByName(tabName);
        if (!sheet) {
            sheet = spreadsheet.insertSheet(tabName);
        }
        sheet.clear();
        const rows = [['Campaign', 'Ad group', 'Field', 'Grade', 'Text']];
        for (const entry of all) {
            rows.push([entry.campaign, entry.adGroup, entry.fieldType, entry.grade,
                entry.text]);
        }
        sheet.getRange(1, 1, rows.length, 5).setValues(rows);
        Logger.log('Full asset list written to tab "' + tabName + '": ' +
            spreadsheet.getUrl());
    }

    function sendDigest(offenders, gradeCounts) {
        const accountName = AdsApp.currentAccount().getName();
        const lines = ['RSA asset grades in ' + accountName + ':', ''];
        for (const grade in gradeCounts) {
            lines.push('  ' + grade + ': ' + gradeCounts[grade]);
        }
        lines.push('');
        lines.push('Top LOW assets by reuse (fixing one line improves every ad using it):');
        for (const offender of offenders.slice(0, CONFIG.TOP_OFFENDERS)) {
            lines.push('  ' + offender.adCount + ' ad(s) [' + offender.fieldType + '] "' +
                offender.text + '"');
        }

        MailApp.sendEmail(
            CONFIG.RECIPIENT_EMAILS.join(','),
            'RSA asset report: ' + offenders.length + ' LOW asset(s) in ' + accountName,
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

    function logSummary(counters, gradeCounts) {
        Logger.log([
            '',
            '========== Execution Summary ==========',
            'Enabled RSA assets swept: ' + counters.assets,
            'LOW: ' + (gradeCounts['LOW'] || 0) + ' | GOOD: ' + (gradeCounts['GOOD'] || 0) +
            ' | BEST: ' + (gradeCounts['BEST'] || 0),
            '====================================================',
        ].join('\n'));
    }
}

function formattedDate(daysShift) {
    const date = new Date();
    date.setDate(date.getDate() + daysShift);
    return Utilities.formatDate(date, AdsApp.currentAccount().getTimeZone(), 'yyyy-MM-dd');
}
