/**
 * MCC Budget Pacing Guard
 *
 * A monthly budget dies in one of two ways: it runs out on the 20th, or a
 * third of it is still unspent on the 28th. Both are pacing failures, and
 * both are visible weeks earlier - if someone projects the month-end spend
 * every day. This MCC-level script is that someone: for every account with
 * a declared monthly budget it computes month-to-date spend, projects the
 * month-end total from the recent daily run-rate, and emails one digest
 * flagging every account pacing outside tolerance.
 *
 * How an account is judged:
 *   1. BUDGETS declares the monthly budget per customer id, in the
 *      account's own currency.
 *   2. Month-to-date spend and the average daily spend of the last
 *      RUN_RATE_DAYS are read; projection = MTD + daily run-rate x
 *      remaining days.
 *   3. Projection above budget x (1 + OVERPACE_TOLERANCE) -> Overpacing.
 *      Projection below budget x (1 - UNDERPACE_TOLERANCE) -> Underpacing.
 *      MTD already over budget -> Exceeded, regardless of projection.
 *
 * The script is read-only: it reports, you decide.
 *
 * Setup:
 *   1. Create the script at MCC (manager account) level and fill BUDGETS
 *      and RECIPIENT_EMAILS.
 *   2. Run with PREVIEW_MODE: true first. Read the per-account pacing in
 *      the logs; no email is sent.
 *   3. Set PREVIEW_MODE: false and schedule daily (morning, after
 *      yesterday's spend data settles).
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
    // false: send the pacing digest email.
    PREVIEW_MODE: true,

    // Who receives the digest.
    RECIPIENT_EMAILS: [],

    // Monthly budgets per account, in each account's own currency.
    // Customer ids with or without dashes both work.
    BUDGETS: {
        // '123-456-7890': 5000,
    },

    // The projection's daily run-rate is the average spend of this many
    // most recent full days.
    RUN_RATE_DAYS: 7,

    // Projection may exceed the budget by this share (0.1 = 10%) before an
    // account is flagged as overpacing.
    OVERPACE_TOLERANCE: 0.1,

    // Projection may fall short of the budget by this share before an
    // account is flagged as underpacing.
    UNDERPACE_TOLERANCE: 0.15,

    // Also list accounts that are pacing fine in the digest - useful as a
    // daily one-mail budget overview.
    INCLUDE_ON_PACE: false,
};

function main() {
    validateConfig();

    const guard = new PacingGuard();
    guard.check();
}

function validateConfig() {
    if (typeof AdsManagerApp === 'undefined') {
        throw new Error('This script must run at MCC (manager account) level - ' +
            'create it under your manager account, not a client account.');
    }
    if (Object.keys(CONFIG.BUDGETS).length === 0) {
        throw new Error('BUDGETS is empty - declare at least one account\'s monthly budget.');
    }
    if (!CONFIG.PREVIEW_MODE && CONFIG.RECIPIENT_EMAILS.length === 0) {
        throw new Error('RECIPIENT_EMAILS is empty. Add at least one address ' +
            'or keep PREVIEW_MODE: true.');
    }
}

function PacingGuard() {

    const mccAccount = AdsApp.currentAccount();

    this.check = function () {
        const budgets = normalizeBudgets();
        const results = [];
        const counters = { checked: 0, missing: 0, exceeded: 0, over: 0, under: 0, onPace: 0 };

        const accounts = AdsManagerApp.accounts()
            .withIds(Object.keys(budgets))
            .get();
        const seen = {};
        while (accounts.hasNext()) {
            const account = accounts.next();
            AdsManagerApp.select(account);

            const id = normalizeId(account.getCustomerId());
            seen[id] = true;
            counters.checked++;

            const result = assessAccount(account, budgets[id]);
            results.push(result);
            counters[result.counterKey]++;
            Logger.log(result.line);
        }
        AdsManagerApp.select(mccAccount);

        for (const id in budgets) {
            if (!seen[id]) {
                counters.missing++;
                Logger.log('Account ' + id + ' from BUDGETS was not found in this MCC.');
            }
        }

        const flagged = results.filter(function (result) {
            return result.counterKey !== 'onPace';
        });
        if (!CONFIG.PREVIEW_MODE &&
            (flagged.length > 0 || CONFIG.INCLUDE_ON_PACE) && results.length > 0) {
            sendDigest(results, flagged);
        }

        logSummary(counters);
    };

    /**
     * Month-to-date spend, recent run-rate and month-end projection for one
     * account, judged against its budget.
     */
    function assessAccount(account, budget) {
        const timeZone = account.getTimeZone();
        const today = new Date();
        const dayOfMonth = parseInt(Utilities.formatDate(today, timeZone, 'd'), 10);
        const daysInMonth = parseInt(Utilities.formatDate(
            new Date(today.getFullYear(), today.getMonth() + 1, 0), timeZone, 'd'), 10);
        const remainingDays = daysInMonth - dayOfMonth + 1;

        const mtdSpend = round(account.getStatsFor('THIS_MONTH').getCost(), 2);
        const runRate = getRunRate();
        const projection = round(mtdSpend + runRate * remainingDays, 2);
        const projectionShare = budget > 0 ? projection / budget : 0;

        let verdict = 'On pace';
        let counterKey = 'onPace';
        if (mtdSpend > budget) {
            verdict = 'EXCEEDED';
            counterKey = 'exceeded';
        } else if (projectionShare > 1 + CONFIG.OVERPACE_TOLERANCE) {
            verdict = 'Overpacing';
            counterKey = 'over';
        } else if (projectionShare < 1 - CONFIG.UNDERPACE_TOLERANCE) {
            verdict = 'Underpacing';
            counterKey = 'under';
        }

        const currency = account.getCurrencyCode();
        const line = verdict + ': ' + account.getName() + ' (' + account.getCustomerId() +
            ') - MTD ' + mtdSpend + ' ' + currency + ' of ' + budget +
            ', run-rate ' + round(runRate, 2) + '/day, projected ' + projection +
            ' (' + Math.round(projectionShare * 100) + '% of budget, day ' +
            dayOfMonth + '/' + daysInMonth + ')';

        return { verdict: verdict, counterKey: counterKey, line: line };
    }

    /**
     * Average daily spend over the last RUN_RATE_DAYS full days, from the
     * currently selected account.
     */
    function getRunRate() {
        const timeZone = AdsApp.currentAccount().getTimeZone();
        const rows = AdsApp.search(
            'SELECT metrics.cost_micros ' +
            'FROM customer ' +
            'WHERE segments.date BETWEEN \'' + formattedDate(-CONFIG.RUN_RATE_DAYS, timeZone) +
            '\' AND \'' + formattedDate(-1, timeZone) + '\'');
        let cost = 0;
        while (rows.hasNext()) {
            cost += (parseInt(rows.next().metrics.costMicros, 10) || 0) / 1000000;
        }
        return cost / CONFIG.RUN_RATE_DAYS;
    }

    function normalizeBudgets() {
        const budgets = {};
        for (const id in CONFIG.BUDGETS) {
            budgets[normalizeId(id)] = CONFIG.BUDGETS[id];
        }
        return budgets;
    }

    function normalizeId(customerId) {
        return String(customerId).replace(/-/g, '');
    }

    function sendDigest(results, flagged) {
        const listed = CONFIG.INCLUDE_ON_PACE ? results : flagged;
        const lines = ['Budget pacing (' + Utilities.formatDate(new Date(),
            mccAccount.getTimeZone(), 'yyyy-MM-dd') + '):', ''];
        for (const result of listed) {
            lines.push(result.line);
        }
        lines.push('');
        lines.push('Projection = month-to-date + last-' + CONFIG.RUN_RATE_DAYS +
            '-days run-rate x remaining days.');

        MailApp.sendEmail(
            CONFIG.RECIPIENT_EMAILS.join(','),
            'Budget pacing: ' + flagged.length + ' account(s) off pace',
            lines.join('\n'));
    }

    function logSummary(counters) {
        const preview = CONFIG.PREVIEW_MODE ? ' (PREVIEW MODE - no email sent)' : '';
        Logger.log([
            '',
            '========== Execution Summary' + preview + ' ==========',
            'Accounts checked: ' + counters.checked +
            ' | in BUDGETS but not found: ' + counters.missing,
            'Exceeded: ' + counters.exceeded + ' | overpacing: ' + counters.over +
            ' | underpacing: ' + counters.under + ' | on pace: ' + counters.onPace,
            '====================================================',
        ].join('\n'));
    }
}

function formattedDate(daysShift, timeZone) {
    const date = new Date();
    date.setDate(date.getDate() + daysShift);
    return Utilities.formatDate(date, timeZone, 'yyyy-MM-dd');
}

function round(value, decimals) {
    return Number(Math.round(value + 'e' + decimals) + 'e-' + decimals);
}
