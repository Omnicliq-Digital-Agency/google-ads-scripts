/**
 * Account Spend Anomaly Detector
 *
 * A campaign that stops spending — or spends triple — rarely announces
 * itself. This single-account script checks today's spend against the
 * account's own history and alerts you the same day the pattern breaks.
 * On top of the account total it can watch every campaign individually,
 * catching the incident the account total hides: one campaign dies, the
 * others keep spending, and the total still looks normal.
 *
 * How spend is checked:
 *   1. Spend is compared like-for-like: today (a Monday) is compared only
 *      against previous Mondays, and only up to the current hour minus
 *      DATA_DELAY_HOURS (recent hours are excluded because Google's spend
 *      data lags).
 *   2. The previous LOOKBACK_WEEKS same-weekdays form the sample; its mean
 *      and sample standard deviation define the expected range:
 *      mean +/- STD_DEV_MULTIPLIER * stddev.
 *   3. MIN_STD_DEV (account level) and CAMPAIGN_MIN_STD_DEV (campaign
 *      level, in account currency) put a floor under the deviation, so
 *      naturally tiny variance doesn't fire alerts over pocket change.
 *   4. Series with fewer than MIN_SAMPLE_DAYS of history are skipped.
 *
 * Anomalies (over- and under-spending) are collected into one digest email
 * per run.
 *
 * Setup:
 *   1. In the account: Tools -> Bulk actions -> Scripts -> +, paste this
 *      script. (For monitoring many accounts at once, use the MCC edition:
 *      mcc-spend-anomaly-detector.)
 *   2. Fill in RECIPIENT_EMAILS, review the thresholds below.
 *   3. Run with PREVIEW_MODE: true first. Read the execution summary in the
 *      logs; no email is sent.
 *   4. Set PREVIEW_MODE: false and schedule hourly or a few times a day.
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
    // true: analyse and log only, send no email.
    // false: send the anomaly digest email.
    PREVIEW_MODE: true,

    // Who receives the anomaly digest.
    RECIPIENT_EMAILS: [],

    // Check the account's total spend.
    CHECK_ACCOUNT: true,

    // Also check every enabled campaign individually. Catches single-campaign
    // incidents that the account total averages away.
    CHECK_CAMPAIGNS: true,

    // Only check campaigns whose name contains this substring. Leave empty
    // to check all enabled campaigns.
    CAMPAIGN_NAME_FILTER: '',

    // How many weeks of same-weekday history form the comparison sample.
    LOOKBACK_WEEKS: 12,

    // A series needs at least this many same-weekday days with data to be
    // checked; below that it is skipped as 'not enough history'.
    MIN_SAMPLE_DAYS: 5,

    // Hours to subtract from 'now' before comparing, because Google's spend
    // data runs a few hours behind. Spend in the excluded hours is ignored
    // on both sides of the comparison.
    DATA_DELAY_HOURS: 3,

    // The expected range is mean +/- STD_DEV_MULTIPLIER * stddev.
    STD_DEV_MULTIPLIER: 2,

    // Floors for the standard deviation, in account currency. Campaigns
    // spend less than the whole account, so they get their own (lower)
    // floor. Protects low-spend series, where a naturally tiny variance
    // would otherwise turn small absolute differences into alerts.
    MIN_STD_DEV: 10,
    CAMPAIGN_MIN_STD_DEV: 5,
};

function main() {
    validateConfig();

    const detector = new SpendAnomalyDetector();
    detector.detect();
}

function validateConfig() {
    if (!CONFIG.PREVIEW_MODE && CONFIG.RECIPIENT_EMAILS.length === 0) {
        throw new Error('RECIPIENT_EMAILS is empty. Add at least one address ' +
            'or keep PREVIEW_MODE: true.');
    }
    if (!CONFIG.CHECK_ACCOUNT && !CONFIG.CHECK_CAMPAIGNS) {
        throw new Error('Both CHECK_ACCOUNT and CHECK_CAMPAIGNS are false - nothing to do.');
    }
}

function SpendAnomalyDetector() {

    const timeZone = AdsApp.currentAccount().getTimeZone();
    const currency = AdsApp.currentAccount().getCurrencyCode();

    this.detect = function () {
        const anomalies = [];
        const counters = {
            seriesChecked: 0, notEnoughData: 0,
            overspending: 0, underspending: 0,
        };

        const now = new Date();
        const weekDay = Utilities.formatDate(now, timeZone, 'EEEE').toUpperCase();
        const shiftedHour = parseInt(Utilities.formatDate(now, timeZone, 'H'), 10) -
            CONFIG.DATA_DELAY_HOURS;

        if (shiftedHour <= 0) {
            Logger.log('Too early in the day to compare (current hour minus ' +
                CONFIG.DATA_DELAY_HOURS + 'h delay is not past midnight yet). Exiting.');
            return;
        }

        const dateFrom = formattedDate(-7 * CONFIG.LOOKBACK_WEEKS, timeZone);
        const dateTo = formattedDate(-1, timeZone);
        const today = formattedDate(0, timeZone);

        const series = [];
        if (CONFIG.CHECK_ACCOUNT) {
            series.push({
                name: 'Account total',
                minStdDev: CONFIG.MIN_STD_DEV,
                history: collectSpendByDate('customer', '', weekDay, shiftedHour, dateFrom, dateTo),
                todaySpend: collectTodaySpend('customer', '', shiftedHour, today),
            });
        }
        if (CONFIG.CHECK_CAMPAIGNS) {
            collectCampaignSeries(weekDay, shiftedHour, dateFrom, dateTo, today, series);
        }

        for (const entry of series) {
            const sample = [];
            for (const date in entry.history) {
                sample.push(round(entry.history[date], 2));
            }
            if (sample.length < CONFIG.MIN_SAMPLE_DAYS) {
                counters.notEnoughData++;
                Logger.log(entry.name + ': not enough history (' + sample.length +
                    ' comparable days)');
                continue;
            }
            counters.seriesChecked++;

            const verdict = assess(sample, entry.todaySpend, entry.minStdDev);
            Logger.log(entry.name + ': today ' + verdict.todaySpend + ', expected ' +
                verdict.lowerBound + ' - ' + verdict.upperBound + ' (mean ' + verdict.mean +
                ', stddev ' + verdict.stdDev + ', ' + sample.length + ' days) -> ' +
                verdict.label);

            if (verdict.label !== 'OK') {
                anomalies.push({ name: entry.name, verdict: verdict });
                if (verdict.label === 'Overspending') {
                    counters.overspending++;
                } else {
                    counters.underspending++;
                }
            }
        }

        if (!CONFIG.PREVIEW_MODE && anomalies.length > 0) {
            sendDigest(anomalies);
        }

        logSummary(counters, anomalies);
    };

    /**
     * Sums same-weekday spend per date (up to the delay-shifted hour) for
     * one GAQL resource, optionally filtered.
     */
    function collectSpendByDate(resource, extraCondition, weekDay, shiftedHour, dateFrom, dateTo) {
        const rows = AdsApp.search(
            'SELECT segments.date, metrics.cost_micros ' +
            'FROM ' + resource + ' ' +
            'WHERE segments.day_of_week = \'' + weekDay + '\' ' +
            'AND segments.hour < ' + shiftedHour + ' ' +
            extraCondition +
            'AND segments.date BETWEEN \'' + dateFrom + '\' AND \'' + dateTo + '\'');
        const spendByDate = {};
        while (rows.hasNext()) {
            const row = rows.next();
            const cost = parseInt(row.metrics.costMicros, 10) / 1000000;
            spendByDate[row.segments.date] = (spendByDate[row.segments.date] || 0) + cost;
        }
        return spendByDate;
    }

    /**
     * Today's spend up to the delay-shifted hour, so both sides of the
     * comparison cover the same hours.
     */
    function collectTodaySpend(resource, extraCondition, shiftedHour, today) {
        const rows = AdsApp.search(
            'SELECT metrics.cost_micros ' +
            'FROM ' + resource + ' ' +
            'WHERE segments.hour < ' + shiftedHour + ' ' +
            extraCondition +
            'AND segments.date = \'' + today + '\'');
        let cost = 0;
        while (rows.hasNext()) {
            cost += parseInt(rows.next().metrics.costMicros, 10) / 1000000;
        }
        return round(cost, 2);
    }

    /**
     * Builds one series per enabled campaign: same-weekday history and
     * today's spend, both cut at the delay-shifted hour.
     */
    function collectCampaignSeries(weekDay, shiftedHour, dateFrom, dateTo, today, series) {
        // One query for history, one for today, grouped in code - instead of
        // two queries per campaign.
        const historyRows = AdsApp.search(
            'SELECT campaign.id, campaign.name, segments.date, metrics.cost_micros ' +
            'FROM campaign ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            'AND segments.day_of_week = \'' + weekDay + '\' ' +
            'AND segments.hour < ' + shiftedHour + ' ' +
            'AND segments.date BETWEEN \'' + dateFrom + '\' AND \'' + dateTo + '\'');
        const byCampaign = {};
        while (historyRows.hasNext()) {
            const row = historyRows.next();
            const name = row.campaign.name;
            if (CONFIG.CAMPAIGN_NAME_FILTER &&
                name.indexOf(CONFIG.CAMPAIGN_NAME_FILTER) === -1) {
                continue;
            }
            const id = row.campaign.id;
            if (!byCampaign[id]) {
                byCampaign[id] = {
                    name: 'Campaign "' + name + '"',
                    minStdDev: CONFIG.CAMPAIGN_MIN_STD_DEV,
                    history: {},
                    todaySpend: 0,
                };
            }
            const cost = parseInt(row.metrics.costMicros, 10) / 1000000;
            byCampaign[id].history[row.segments.date] =
                (byCampaign[id].history[row.segments.date] || 0) + cost;
        }

        const todayRows = AdsApp.search(
            'SELECT campaign.id, metrics.cost_micros ' +
            'FROM campaign ' +
            'WHERE campaign.status = \'ENABLED\' ' +
            'AND segments.hour < ' + shiftedHour + ' ' +
            'AND segments.date = \'' + today + '\'');
        while (todayRows.hasNext()) {
            const row = todayRows.next();
            const entry = byCampaign[row.campaign.id];
            if (entry) {
                entry.todaySpend = round(entry.todaySpend +
                    parseInt(row.metrics.costMicros, 10) / 1000000, 2);
            }
        }

        for (const id in byCampaign) {
            series.push(byCampaign[id]);
        }
    }

    /**
     * Compares today's spend against the sample's mean +/- multiplier *
     * stddev range, with minStdDev as deviation floor.
     */
    function assess(sample, todaySpend, minStdDev) {
        const mean = average(sample);
        const stdDev = sampleStandardDeviation(sample, mean);
        const flooredStdDev = Math.max(stdDev, minStdDev);

        const margin = CONFIG.STD_DEV_MULTIPLIER * flooredStdDev;
        const lowerBound = Math.max(round(mean - margin, 2), 0.01);
        const upperBound = round(mean + margin, 2);

        let label = 'OK';
        if (todaySpend < lowerBound) {
            label = 'Underspending';
        } else if (todaySpend > upperBound) {
            label = 'Overspending';
        }

        return {
            label: label,
            todaySpend: todaySpend,
            mean: round(mean, 2),
            stdDev: round(stdDev, 2),
            lowerBound: lowerBound,
            upperBound: upperBound,
        };
    }

    function sendDigest(anomalies) {
        const accountName = AdsApp.currentAccount().getName();
        const customerId = AdsApp.currentAccount().getCustomerId();
        const lines = ['Spend anomalies in ' + accountName + ' (' + customerId + '):', ''];
        for (const anomaly of anomalies) {
            lines.push(anomaly.verdict.label + ': ' + anomaly.name);
            lines.push('  Spend today: ' + anomaly.verdict.todaySpend + ' ' + currency);
            lines.push('  Expected range: ' + anomaly.verdict.lowerBound + ' - ' +
                anomaly.verdict.upperBound + ' ' + currency +
                ' (same-weekday mean ' + anomaly.verdict.mean + ')');
            lines.push('');
        }
        lines.push('Checked like-for-like: same weekday, up to the current hour minus ' +
            CONFIG.DATA_DELAY_HOURS + 'h, over the last ' + CONFIG.LOOKBACK_WEEKS + ' weeks.');

        MailApp.sendEmail(
            CONFIG.RECIPIENT_EMAILS.join(','),
            'Spend anomalies in ' + accountName + ': ' + anomalies.length + ' finding(s)',
            lines.join('\n'));
    }

    function logSummary(counters, anomalies) {
        const preview = CONFIG.PREVIEW_MODE ? ' (PREVIEW MODE - no email sent)' : '';
        Logger.log([
            '',
            '========== Execution Summary' + preview + ' ==========',
            'Series checked: ' + counters.seriesChecked +
            ' (account total and/or campaigns)',
            'Skipped (not enough history): ' + counters.notEnoughData,
            'Anomalies: ' + counters.overspending + ' overspending, ' +
            counters.underspending + ' underspending' +
            (anomalies.length > 0 && !CONFIG.PREVIEW_MODE ? ' - digest email sent' : ''),
            '====================================================',
        ].join('\n'));
    }
}

function formattedDate(daysShift, timeZone) {
    const date = new Date();
    date.setDate(date.getDate() + daysShift);
    return Utilities.formatDate(date, timeZone, 'yyyy-MM-dd');
}

function average(values) {
    let sum = 0;
    for (const value of values) {
        sum += value;
    }
    return sum / values.length;
}

function sampleStandardDeviation(values, mean) {
    if (values.length < 2) {
        return 0;
    }
    let squaredDiffs = 0;
    for (const value of values) {
        squaredDiffs += (value - mean) * (value - mean);
    }
    return Math.sqrt(squaredDiffs / (values.length - 1));
}

function round(value, decimals) {
    return Number(Math.round(value + 'e' + decimals) + 'e-' + decimals);
}
