/**
 * MCC Spend Anomaly Detector
 *
 * A campaign that stops spending — or spends triple — rarely announces
 * itself. You find out days later, in a budget report or an angry email.
 * This MCC-level script checks every account's spend today against its own
 * history and alerts you the same day the pattern breaks.
 *
 * How an account is checked:
 *   1. Spend is compared like-for-like: today (a Monday) is compared only
 *      against previous Mondays, and only up to the current hour minus
 *      DATA_DELAY_HOURS (recent hours are excluded because Google's spend
 *      data lags).
 *   2. The previous LOOKBACK_WEEKS same-weekdays form the sample; its mean
 *      and sample standard deviation define the expected range:
 *      mean +/- STD_DEV_MULTIPLIER * stddev.
 *   3. MIN_STD_DEV (in account currency) puts a floor under the deviation,
 *      so low-spend accounts with naturally tiny variance don't fire alerts
 *      over pocket-change differences.
 *   4. Accounts with fewer than MIN_SAMPLE_DAYS of history are skipped.
 *
 * Anomalies (over- and under-spending) are collected into one digest email
 * per run, so a bad morning does not mean thirty emails.
 *
 * Setup:
 *   1. Create the script at MCC (manager account) level: your manager
 *      account -> Tools -> Bulk actions -> Scripts.
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

    // Only check accounts carrying this MCC account label. Leave empty to
    // check every account in the MCC.
    ACCOUNT_LABEL: '',

    // How many weeks of same-weekday history form the comparison sample.
    LOOKBACK_WEEKS: 12,

    // An account needs at least this many same-weekday days with data to be
    // checked; below that it is skipped as 'not enough history'.
    MIN_SAMPLE_DAYS: 5,

    // Hours to subtract from 'now' before comparing, because Google's spend
    // data runs a few hours behind. Spend in the excluded hours is ignored
    // on the historical side of the comparison.
    DATA_DELAY_HOURS: 3,

    // The expected range is mean +/- STD_DEV_MULTIPLIER * stddev.
    STD_DEV_MULTIPLIER: 2,

    // Floor for the standard deviation, in account currency. Protects
    // low-spend accounts, where a naturally tiny variance would otherwise
    // turn small absolute differences into alerts.
    MIN_STD_DEV: 10,

    // Stop checking this many milliseconds after the script starts, leaving
    // time to send the digest before the 30-minute hard limit.
    MAX_RUNTIME_MS: 27 * 60 * 1000,
};

function main() {
    validateConfig();

    const startTime = Date.now();
    const detector = new SpendAnomalyDetector(startTime);
    detector.detect();
}

function validateConfig() {
    if (typeof AdsManagerApp === 'undefined') {
        throw new Error('This script must run at MCC (manager account) level - ' +
            'create it under your manager account, not a client account.');
    }
    if (!CONFIG.PREVIEW_MODE && CONFIG.RECIPIENT_EMAILS.length === 0) {
        throw new Error('RECIPIENT_EMAILS is empty. Add at least one address ' +
            'or keep PREVIEW_MODE: true.');
    }
}

function SpendAnomalyDetector(startTime) {

    const mccAccount = AdsApp.currentAccount();

    this.detect = function () {
        const anomalies = [];
        const counters = {
            accounts: 0, checked: 0, notEnoughData: 0,
            overspending: 0, underspending: 0,
            timedOut: false,
        };

        let accountSelector = AdsManagerApp.accounts();
        if (CONFIG.ACCOUNT_LABEL) {
            accountSelector = accountSelector
                .withCondition('LabelNames CONTAINS \'' + CONFIG.ACCOUNT_LABEL + '\'');
        }
        const accounts = accountSelector.get();
        Logger.log('Checking ' + accounts.totalNumEntities() + ' accounts...');

        while (accounts.hasNext()) {
            const account = accounts.next();
            counters.accounts++;
            AdsManagerApp.select(account);

            const check = checkAccount(account);
            if (check.status !== 'Checked') {
                counters.notEnoughData++;
                Logger.log(account.getName() + ' (' + account.getCustomerId() + '): ' + check.status);
                continue;
            }
            counters.checked++;

            const verdict = assess(check.sample, check.todaySpend);
            Logger.log(account.getName() + ' (' + account.getCustomerId() + '): today ' +
                verdict.todaySpend + ', expected ' + verdict.lowerBound + ' - ' +
                verdict.upperBound + ' (mean ' + verdict.mean + ', stddev ' + verdict.stdDev +
                ', ' + check.sample.length + ' days) -> ' + verdict.label);

            if (verdict.label !== 'OK') {
                anomalies.push({
                    accountName: account.getName(),
                    customerId: account.getCustomerId(),
                    currency: account.getCurrencyCode(),
                    verdict: verdict,
                });
                if (verdict.label === 'Overspending') {
                    counters.overspending++;
                } else {
                    counters.underspending++;
                }
            }

            if (Date.now() - startTime > CONFIG.MAX_RUNTIME_MS) {
                counters.timedOut = true;
                Logger.log('Approaching the execution time limit - reporting what was checked so far.');
                break;
            }
        }

        AdsManagerApp.select(mccAccount);

        if (!CONFIG.PREVIEW_MODE && anomalies.length > 0) {
            sendDigest(anomalies);
        }

        logSummary(counters, anomalies);
    };

    /**
     * Collects same-weekday spend (up to the delay-shifted hour) for the
     * lookback window and today's spend so far, in the account's time zone.
     */
    function checkAccount(account) {
        const timeZone = account.getTimeZone();
        const now = new Date();
        const weekDay = Utilities.formatDate(now, timeZone, 'EEEE').toUpperCase();
        const shiftedHour = parseInt(Utilities.formatDate(now, timeZone, 'H'), 10) -
            CONFIG.DATA_DELAY_HOURS;

        if (shiftedHour <= 0) {
            return { status: 'Too early in the day to compare' };
        }

        const dateFrom = formattedDate(-7 * CONFIG.LOOKBACK_WEEKS, timeZone);
        const dateTo = formattedDate(-1, timeZone);

        const rows = AdsApp.search(
            'SELECT segments.date, metrics.cost_micros ' +
            'FROM customer ' +
            'WHERE segments.day_of_week = \'' + weekDay + '\' ' +
            'AND segments.hour < ' + shiftedHour + ' ' +
            'AND segments.date BETWEEN \'' + dateFrom + '\' AND \'' + dateTo + '\'');

        const spendByDate = {};
        while (rows.hasNext()) {
            const row = rows.next();
            const cost = parseInt(row.metrics.costMicros, 10) / 1000000;
            spendByDate[row.segments.date] = (spendByDate[row.segments.date] || 0) + cost;
        }

        const sample = [];
        for (const date in spendByDate) {
            sample.push(round(spendByDate[date], 2));
        }

        if (sample.length < CONFIG.MIN_SAMPLE_DAYS) {
            return { status: 'Not enough history (' + sample.length + ' comparable days)' };
        }

        return {
            status: 'Checked',
            sample: sample,
            todaySpend: round(AdsApp.currentAccount().getStatsFor('TODAY').getCost(), 2),
        };
    }

    /**
     * Compares today's spend against the sample's mean +/- multiplier *
     * stddev range, with MIN_STD_DEV as deviation floor.
     */
    function assess(sample, todaySpend) {
        const mean = average(sample);
        const stdDev = sampleStandardDeviation(sample, mean);
        const flooredStdDev = Math.max(stdDev, CONFIG.MIN_STD_DEV);

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
        const lines = ['Spend anomalies detected by the MCC Spend Anomaly Detector:', ''];
        for (const anomaly of anomalies) {
            lines.push(anomaly.verdict.label + ': ' + anomaly.accountName +
                ' (' + anomaly.customerId + ')');
            lines.push('  Spend today: ' + anomaly.verdict.todaySpend + ' ' + anomaly.currency);
            lines.push('  Expected range: ' + anomaly.verdict.lowerBound + ' - ' +
                anomaly.verdict.upperBound + ' ' + anomaly.currency +
                ' (same-weekday mean ' + anomaly.verdict.mean + ')');
            lines.push('');
        }
        lines.push('Checked like-for-like: same weekday, up to the current hour minus ' +
            CONFIG.DATA_DELAY_HOURS + 'h, over the last ' + CONFIG.LOOKBACK_WEEKS + ' weeks.');

        MailApp.sendEmail(
            CONFIG.RECIPIENT_EMAILS.join(','),
            'Google Ads spend anomalies: ' + anomalies.length + ' account(s)',
            lines.join('\n'));
    }

    function logSummary(counters, anomalies) {
        const preview = CONFIG.PREVIEW_MODE ? ' (PREVIEW MODE - no email sent)' : '';
        Logger.log([
            '',
            '========== Execution Summary' + preview + ' ==========',
            'Accounts examined: ' + counters.accounts,
            'Checked against history: ' + counters.checked,
            'Skipped (not enough history / too early): ' + counters.notEnoughData,
            (counters.timedOut ? 'Stopped early near the execution time limit.' : ''),
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
