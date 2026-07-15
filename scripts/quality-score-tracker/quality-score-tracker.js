/**
 * Quality Score Tracker
 *
 * Quality Score moves silently: Google won't tell you that a keyword slid
 * from 7 to 4 last Tuesday, but you pay for it on every auction from then
 * on. This script snapshots every keyword's Quality Score and its three
 * components daily, alerts you on drops, labels chronic low-QS keywords -
 * and, because the components say WHY (expected CTR, ad relevance, landing
 * page experience), the fix is usually obvious from the sheet alone.
 *
 * What each run does:
 *   1. Reads QS + components for every eligible keyword.
 *   2. Compares against the previous snapshot and reports keywords that
 *      dropped by DROP_ALERT_POINTS or more.
 *   3. Rewrites the 'Latest' spreadsheet tab and appends account-level
 *      averages to the 'History' tab - your QS trend over time.
 *   4. Labels keywords at or below LOW_QUALITY_THRESHOLD (label removed
 *      when they recover); optionally pauses them.
 *
 * Setup:
 *   1. Review CONFIG below. Leave SPREADSHEET_URL empty on the first run -
 *      the script creates a spreadsheet and logs its URL; paste that URL
 *      into SPREADSHEET_URL so subsequent runs reuse it.
 *   2. Run with PREVIEW_MODE: true first. Read the execution summary in
 *      the logs; account and spreadsheet stay untouched.
 *   3. Set PREVIEW_MODE: false and schedule daily.
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
    // true: analyse and log only; no labels, pauses, sheet writes or email.
    // false: full run.
    PREVIEW_MODE: true,

    // Spreadsheet that receives the snapshots. Empty: a new spreadsheet is
    // created and its URL logged - paste it here for the next runs.
    SPREADSHEET_URL: '',

    // Who is alerted about QS drops. Empty = no email.
    RECIPIENT_EMAILS: [],

    // Alert when a keyword's QS falls by at least this many points since
    // the previous snapshot.
    DROP_ALERT_POINTS: 2,

    // Keywords at or below this QS get LOW_QUALITY_LABEL (removed again
    // when they recover above it).
    LOW_QUALITY_THRESHOLD: 3,

    // Also pause keywords at or below the threshold. Labels-only is the
    // safe default - low QS is a symptom to fix, not always to kill.
    PAUSE_LOW_QUALITY: false,

    // Label for low-QS keywords. Created automatically if missing.
    LOW_QUALITY_LABEL: 'QS: Low',

    // Campaigns whose name contains any of these are skipped.
    CAMPAIGN_EXCLUDE_PATTERNS: [],
};

function main() {
    validateConfig();

    const tracker = new QualityScoreTracker();
    tracker.track();
}

function validateConfig() {
    if (CONFIG.LOW_QUALITY_THRESHOLD < 1 || CONFIG.LOW_QUALITY_THRESHOLD > 10) {
        throw new Error('LOW_QUALITY_THRESHOLD must be between 1 and 10.');
    }
    if (!CONFIG.LOW_QUALITY_LABEL) {
        throw new Error('LOW_QUALITY_LABEL must not be empty.');
    }
}

function QualityScoreTracker() {

    const LATEST_HEADER = ['Campaign', 'Ad Group', 'Keyword', 'QS',
        'Expected CTR', 'Ad Relevance', 'LP Experience'];

    this.track = function () {
        const counters = {
            keywords: 0, lowQuality: 0, drops: 0,
            labeled: 0, unlabeled: 0, paused: 0,
        };

        Logger.log('Reading Quality Scores...');
        const snapshot = collectSnapshot(counters);

        const spreadsheet = CONFIG.PREVIEW_MODE ? null : getOrCreateSpreadsheet();
        const previous = spreadsheet ? readPrevious(spreadsheet) : {};

        const drops = [];
        for (const key in snapshot) {
            const before = previous[key];
            const now = snapshot[key].qs;
            if (before && before - now >= CONFIG.DROP_ALERT_POINTS) {
                drops.push({ entry: snapshot[key], from: before, to: now });
                counters.drops++;
                Logger.log('QS drop ' + before + ' -> ' + now + ': "' +
                    snapshot[key].keyword + '" (' + snapshot[key].campaign + ' > ' +
                    snapshot[key].adGroup + ')');
            }
        }

        if (!CONFIG.PREVIEW_MODE) {
            ensureLabel();
            applyLabels(snapshot, counters);
            writeSheets(spreadsheet, snapshot);
            if (drops.length > 0 && CONFIG.RECIPIENT_EMAILS.length > 0) {
                sendDropAlert(drops);
            }
        }

        logSummary(counters, spreadsheet);
    };

    /**
     * QS and components per keyword, keyed by ad group id + criterion id.
     */
    function collectSnapshot(counters) {
        const snapshot = {};
        const rows = AdsApp.search(
            'SELECT campaign.name, ad_group.id, ad_group.name, ' +
            'ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ' +
            'ad_group_criterion.quality_info.quality_score, ' +
            'ad_group_criterion.quality_info.creative_quality_score, ' +
            'ad_group_criterion.quality_info.search_predicted_ctr, ' +
            'ad_group_criterion.quality_info.post_click_quality_score ' +
            'FROM ad_group_criterion ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            'AND ad_group.status = \'ENABLED\' ' +
            'AND ad_group_criterion.status = \'ENABLED\' ' +
            'AND ad_group_criterion.type = \'KEYWORD\' ' +
            'AND ad_group_criterion.negative = false ' +
            'AND ad_group_criterion.quality_info.quality_score > 0');
        while (rows.hasNext()) {
            const row = rows.next();
            if (isExcluded(row.campaign.name)) {
                continue;
            }
            counters.keywords++;
            const qs = parseInt(row.adGroupCriterion.qualityInfo.qualityScore, 10);
            if (qs <= CONFIG.LOW_QUALITY_THRESHOLD) {
                counters.lowQuality++;
            }
            const key = row.adGroup.id + '~' + row.adGroupCriterion.criterionId;
            snapshot[key] = {
                adGroupId: row.adGroup.id,
                criterionId: row.adGroupCriterion.criterionId,
                campaign: row.campaign.name,
                adGroup: row.adGroup.name,
                keyword: row.adGroupCriterion.keyword.text,
                qs: qs,
                expectedCtr: row.adGroupCriterion.qualityInfo.searchPredictedCtr,
                adRelevance: row.adGroupCriterion.qualityInfo.creativeQualityScore,
                lpExperience: row.adGroupCriterion.qualityInfo.postClickQualityScore,
            };
        }
        return snapshot;
    }

    /**
     * Applies/removes the low-QS label (and optional pause) by iterating
     * only over the affected keywords.
     */
    function applyLabels(snapshot, counters) {
        const lowIds = [];
        const recoveredCandidateIds = [];
        for (const key in snapshot) {
            const entry = snapshot[key];
            const idPair = [entry.adGroupId, entry.criterionId];
            if (entry.qs <= CONFIG.LOW_QUALITY_THRESHOLD) {
                lowIds.push(idPair);
            } else {
                recoveredCandidateIds.push(idPair);
            }
        }

        const lowIterator = AdsApp.keywords().withIds(lowIds).get();
        while (lowIterator.hasNext()) {
            const keyword = lowIterator.next();
            if (!hasLabel(keyword, CONFIG.LOW_QUALITY_LABEL)) {
                keyword.applyLabel(CONFIG.LOW_QUALITY_LABEL);
                counters.labeled++;
            }
            if (CONFIG.PAUSE_LOW_QUALITY && keyword.isEnabled()) {
                keyword.pause();
                counters.paused++;
            }
        }

        // Recovered keywords: only the currently-labeled ones need touching.
        const labelIterator = AdsApp.labels()
            .withCondition('label.name = \'' + CONFIG.LOW_QUALITY_LABEL + '\'')
            .get();
        if (labelIterator.hasNext()) {
            const labeled = labelIterator.next().keywords().get();
            while (labeled.hasNext()) {
                const keyword = labeled.next();
                const key = keyword.getAdGroup().getId() + '~' + keyword.getId();
                if (snapshot[key] && snapshot[key].qs > CONFIG.LOW_QUALITY_THRESHOLD) {
                    keyword.removeLabel(CONFIG.LOW_QUALITY_LABEL);
                    counters.unlabeled++;
                }
            }
        }
    }

    function hasLabel(keyword, labelName) {
        const labels = keyword.labels().get();
        while (labels.hasNext()) {
            if (labels.next().getName() === labelName) {
                return true;
            }
        }
        return false;
    }

    /**
     * Previous QS per keyword key, from the 'Latest' tab written last run.
     */
    function readPrevious(spreadsheet) {
        const previous = {};
        const sheet = spreadsheet.getSheetByName('Latest');
        if (!sheet || sheet.getLastRow() < 2) {
            return previous;
        }
        const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, LATEST_HEADER.length + 1)
            .getValues();
        for (const row of values) {
            // Key is stored in the last (hidden-ish) column.
            previous[row[LATEST_HEADER.length]] = Number(row[3]);
        }
        return previous;
    }

    function writeSheets(spreadsheet, snapshot) {
        // 'Latest': full per-keyword state, overwritten each run.
        const rows = [];
        let qsSum = 0;
        for (const key in snapshot) {
            const entry = snapshot[key];
            rows.push([entry.campaign, entry.adGroup, entry.keyword, entry.qs,
                entry.expectedCtr, entry.adRelevance, entry.lpExperience, key]);
            qsSum += entry.qs;
        }
        rows.sort(function (a, b) { return a[3] - b[3]; });

        let latest = spreadsheet.getSheetByName('Latest');
        if (!latest) {
            latest = spreadsheet.insertSheet('Latest');
        }
        latest.clear();
        latest.getRange(1, 1, 1, LATEST_HEADER.length + 1)
            .setValues([LATEST_HEADER.concat(['Key'])]);
        if (rows.length > 0) {
            latest.getRange(2, 1, rows.length, LATEST_HEADER.length + 1).setValues(rows);
        }

        // 'History': one account-average row per run.
        let history = spreadsheet.getSheetByName('History');
        if (!history) {
            history = spreadsheet.insertSheet('History');
            history.appendRow(['Date', 'Keywords', 'Average QS', 'Low QS share']);
        }
        const lowCount = rows.filter(function (row) {
            return row[3] <= CONFIG.LOW_QUALITY_THRESHOLD;
        }).length;
        history.appendRow([
            Utilities.formatDate(new Date(), AdsApp.currentAccount().getTimeZone(), 'yyyy-MM-dd'),
            rows.length,
            rows.length > 0 ? round(qsSum / rows.length, 2) : 0,
            rows.length > 0 ? round(lowCount / rows.length, 4) : 0,
        ]);
    }

    function sendDropAlert(drops) {
        const accountName = AdsApp.currentAccount().getName();
        const lines = ['Quality Score drops in ' + accountName + ':', ''];
        for (const drop of drops) {
            lines.push(drop.from + ' -> ' + drop.to + ': "' + drop.entry.keyword + '"');
            lines.push('  ' + drop.entry.campaign + ' > ' + drop.entry.adGroup);
            lines.push('  Expected CTR: ' + drop.entry.expectedCtr +
                ' | Ad relevance: ' + drop.entry.adRelevance +
                ' | LP experience: ' + drop.entry.lpExperience);
            lines.push('');
        }

        MailApp.sendEmail(
            CONFIG.RECIPIENT_EMAILS.join(','),
            'QS drops in ' + accountName + ': ' + drops.length + ' keyword(s)',
            lines.join('\n'));
    }

    function ensureLabel() {
        const labelIterator = AdsApp.labels()
            .withCondition('label.name = \'' + CONFIG.LOW_QUALITY_LABEL + '\'')
            .get();
        if (!labelIterator.hasNext()) {
            AdsApp.createLabel(CONFIG.LOW_QUALITY_LABEL);
        }
    }

    function getOrCreateSpreadsheet() {
        if (CONFIG.SPREADSHEET_URL) {
            return SpreadsheetApp.openByUrl(CONFIG.SPREADSHEET_URL);
        }
        const name = AdsApp.currentAccount().getName() + ' - Quality Score Tracker';
        const spreadsheet = SpreadsheetApp.create(name);
        Logger.log('Created spreadsheet "' + name + '" - paste this URL into ' +
            'CONFIG.SPREADSHEET_URL: ' + spreadsheet.getUrl());
        return spreadsheet;
    }

    function isExcluded(campaignName) {
        for (const pattern of CONFIG.CAMPAIGN_EXCLUDE_PATTERNS) {
            if (campaignName.toUpperCase().indexOf(pattern.toUpperCase()) !== -1) {
                return true;
            }
        }
        return false;
    }

    function logSummary(counters, spreadsheet) {
        const preview = CONFIG.PREVIEW_MODE ? ' (PREVIEW MODE - nothing was changed)' : '';
        Logger.log([
            '',
            '========== Execution Summary' + preview + ' ==========',
            'Keywords with a Quality Score: ' + counters.keywords,
            'At or below ' + CONFIG.LOW_QUALITY_THRESHOLD + ': ' + counters.lowQuality,
            'Drops >= ' + CONFIG.DROP_ALERT_POINTS + ' points since last run: ' + counters.drops,
            'Labeled: ' + counters.labeled + ' | label removed (recovered): ' +
            counters.unlabeled + ' | paused: ' + counters.paused,
            (spreadsheet ? 'Spreadsheet: ' + spreadsheet.getUrl() : ''),
            '====================================================',
        ].join('\n'));
    }
}

function round(value, decimals) {
    return Number(Math.round(value + 'e' + decimals) + 'e-' + decimals);
}
