/**
 * Zero-Conversion Spenders
 *
 * Every account has them: keywords that spend real money month after month
 * and have never converted. Each one is small enough to hide in the
 * averages; together they are a budget leak. This script finds every
 * keyword that spent at least MIN_SPEND in the lookback window with zero
 * conversions, ranks the list by cost, optionally labels the offenders,
 * and emails the digest.
 *
 * How a keyword qualifies:
 *   1. Enabled keyword in an enabled campaign and ad group.
 *   2. Cost of at least MIN_SPEND in the window (account currency).
 *   3. Zero conversions - and, with REQUIRE_ZERO_VALUE, zero conversion
 *      value too (view-through-heavy accounts may prefer that off).
 *
 * The script never pauses anything: a zero-conversion keyword may be an
 * assist player your attribution hides. The label puts the list one filter
 * away inside the UI; the decision stays with you.
 *
 * Setup:
 *   1. Set MIN_SPEND to what a real decision costs in your currency.
 *   2. Run with PREVIEW_MODE: true first; read the ranked list in the logs.
 *   3. Set PREVIEW_MODE: false and schedule (weekly).
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
    // true: log the list only; no labels, no email.
    // false: apply the label and send the digest.
    PREVIEW_MODE: true,

    // Who receives the digest. Empty = no email.
    RECIPIENT_EMAILS: [],

    // Minimum spend (account currency) in the window to make the list.
    MIN_SPEND: 50,

    // Also require zero conversion value, not just zero conversions.
    REQUIRE_ZERO_VALUE: false,

    // How many days to analyse (ending yesterday). Use at least your
    // typical conversion lag times three.
    LOOKBACK_DAYS: 90,

    // Label applied to qualifying keywords (removed when they convert
    // again). Created automatically if missing.
    LABEL: 'Zero Conv Spend',

    // Campaigns whose name contains any of these are skipped.
    CAMPAIGN_EXCLUDE_PATTERNS: [],
};

function main() {
    const finder = new ZeroConversionFinder();
    finder.find();
}

function ZeroConversionFinder() {

    this.find = function () {
        const dateFrom = formattedDate(-CONFIG.LOOKBACK_DAYS);
        const dateTo = formattedDate(-1);
        const counters = { keywords: 0, flagged: 0, labeled: 0, unlabeled: 0 };
        const offenders = [];

        Logger.log('Scanning keyword spend (' + dateFrom + ' to ' + dateTo + ')...');
        const rows = AdsApp.search(
            'SELECT campaign.name, ad_group.id, ad_group.name, ' +
            'ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ' +
            'metrics.cost_micros, metrics.clicks, metrics.conversions, ' +
            'metrics.conversions_value ' +
            'FROM keyword_view ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            'AND ad_group.status = \'ENABLED\' ' +
            'AND ad_group_criterion.status = \'ENABLED\' ' +
            'AND metrics.cost_micros > 0 ' +
            'AND segments.date BETWEEN \'' + dateFrom + '\' AND \'' + dateTo + '\'');

        // Sum per keyword: the report may split rows across segments.
        const byKeyword = {};
        while (rows.hasNext()) {
            const row = rows.next();
            if (isExcluded(row.campaign.name)) {
                continue;
            }
            const key = row.adGroup.id + '~' + row.adGroupCriterion.criterionId;
            if (!byKeyword[key]) {
                counters.keywords++;
                byKeyword[key] = {
                    adGroupId: row.adGroup.id,
                    criterionId: row.adGroupCriterion.criterionId,
                    campaign: row.campaign.name,
                    adGroup: row.adGroup.name,
                    text: row.adGroupCriterion.keyword.text,
                    cost: 0, clicks: 0, conversions: 0, value: 0,
                };
            }
            const entry = byKeyword[key];
            entry.cost += (parseInt(row.metrics.costMicros, 10) || 0) / 1000000;
            entry.clicks += parseInt(row.metrics.clicks, 10) || 0;
            entry.conversions += Number(row.metrics.conversions) || 0;
            entry.value += Number(row.metrics.conversionsValue) || 0;
        }

        for (const key in byKeyword) {
            const entry = byKeyword[key];
            if (entry.cost >= CONFIG.MIN_SPEND && entry.conversions === 0 &&
                (!CONFIG.REQUIRE_ZERO_VALUE || entry.value === 0)) {
                counters.flagged++;
                offenders.push(entry);
            }
        }
        offenders.sort(function (a, b) { return b.cost - a.cost; });
        for (const entry of offenders) {
            Logger.log(round(entry.cost, 2) + ' spent, ' + entry.clicks + ' clicks, 0 conv: "' +
                entry.text + '" (' + entry.campaign + ' > ' + entry.adGroup + ')');
        }

        if (!CONFIG.PREVIEW_MODE) {
            syncLabels(offenders, counters);
            if (offenders.length > 0 && CONFIG.RECIPIENT_EMAILS.length > 0) {
                sendDigest(offenders, dateFrom, dateTo);
            }
        }

        logSummary(counters);
    };

    /**
     * Applies the label to offenders and removes it from labeled keywords
     * that converted again.
     */
    function syncLabels(offenders, counters) {
        ensureLabel();

        const offenderKeys = {};
        const ids = [];
        for (const entry of offenders) {
            offenderKeys[entry.adGroupId + '~' + entry.criterionId] = true;
            ids.push([entry.adGroupId, entry.criterionId]);
        }

        const iterator = AdsApp.keywords().withIds(ids).get();
        while (iterator.hasNext()) {
            const keyword = iterator.next();
            if (!hasLabel(keyword)) {
                keyword.applyLabel(CONFIG.LABEL);
                counters.labeled++;
            }
        }

        const labelIterator = AdsApp.labels()
            .withCondition('label.name = \'' + CONFIG.LABEL + '\'')
            .get();
        if (labelIterator.hasNext()) {
            const labeled = labelIterator.next().keywords().get();
            while (labeled.hasNext()) {
                const keyword = labeled.next();
                const key = keyword.getAdGroup().getId() + '~' + keyword.getId();
                if (!offenderKeys[key]) {
                    keyword.removeLabel(CONFIG.LABEL);
                    counters.unlabeled++;
                }
            }
        }
    }

    function hasLabel(keyword) {
        const labels = keyword.labels().get();
        while (labels.hasNext()) {
            if (labels.next().getName() === CONFIG.LABEL) {
                return true;
            }
        }
        return false;
    }

    function ensureLabel() {
        const labelIterator = AdsApp.labels()
            .withCondition('label.name = \'' + CONFIG.LABEL + '\'')
            .get();
        if (!labelIterator.hasNext()) {
            AdsApp.createLabel(CONFIG.LABEL);
        }
    }

    function isExcluded(campaignName) {
        for (const pattern of CONFIG.CAMPAIGN_EXCLUDE_PATTERNS) {
            if (campaignName.toUpperCase().indexOf(pattern.toUpperCase()) !== -1) {
                return true;
            }
        }
        return false;
    }

    function sendDigest(offenders, dateFrom, dateTo) {
        const accountName = AdsApp.currentAccount().getName();
        const currency = AdsApp.currentAccount().getCurrencyCode();
        const lines = ['Keywords spending without converting in ' + accountName +
            ' (' + dateFrom + ' to ' + dateTo + '):', ''];
        let total = 0;
        for (const entry of offenders) {
            total += entry.cost;
            lines.push(round(entry.cost, 2) + ' ' + currency + ' | ' + entry.clicks +
                ' clicks | "' + entry.text + '"');
            lines.push('  ' + entry.campaign + ' > ' + entry.adGroup);
        }
        lines.push('');
        lines.push('Total: ' + round(total, 2) + ' ' + currency + ' across ' +
            offenders.length + ' keywords. All carry the "' + CONFIG.LABEL + '" label.');

        MailApp.sendEmail(
            CONFIG.RECIPIENT_EMAILS.join(','),
            'Zero-conversion spend: ' + offenders.length + ' keyword(s) in ' + accountName,
            lines.join('\n'));
    }

    function logSummary(counters) {
        const preview = CONFIG.PREVIEW_MODE ? ' (PREVIEW MODE - nothing was changed)' : '';
        Logger.log([
            '',
            '========== Execution Summary' + preview + ' ==========',
            'Keywords with spend: ' + counters.keywords,
            'Flagged (>= ' + CONFIG.MIN_SPEND + ', zero conversions): ' + counters.flagged,
            'Labeled: ' + counters.labeled + ' | label removed (converted again): ' +
            counters.unlabeled,
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
