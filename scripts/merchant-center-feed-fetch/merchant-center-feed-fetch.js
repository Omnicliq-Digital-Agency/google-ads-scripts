/**
 * Merchant Center Feed Fetch
 *
 * Merchant Center fetches a scheduled feed at most once a day. Prices and
 * stock change faster than that, and between fetches Shopping and PMax ads
 * advertise yesterday's catalog. This script makes Merchant Center fetch
 * your feeds on every run - so the feed refresh follows the script schedule
 * instead of the Merchant Center one - and reports how the previous fetch
 * went, so a failing feed never goes unnoticed.
 *
 * Which data sources get fetched:
 *   1. File-based data sources that Merchant Center pulls itself: a
 *      scheduled URL fetch (FETCH) or a Google Sheet (GOOGLE_SHEETS).
 *   2. If DATA_SOURCE_IDS is set, only those ids - anything else is ignored.
 *   Uploaded files (UPLOAD), API and UI data sources cannot be fetched and
 *   are skipped.
 *
 * Setup:
 *   1. In the script editor click "Advanced APIs" and enable Merchant API ->
 *      DataSources (it appears in scripts as MerchantDataSources). Then
 *      authorize the script again so the Merchant Center permission is
 *      granted.
 *   2. Fill MERCHANT_CENTER_ID in CONFIG below. The user who authorizes the
 *      script needs access to that Merchant Center account.
 *   3. Register the script with Merchant Center, once. The Merchant API only
 *      answers Google Cloud projects registered with the account, and every
 *      Google Ads script runs in its own hidden project, so only the script
 *      itself can register it: enable Merchant API -> Accounts under
 *      "Advanced APIs" too, set REGISTER_PROJECT: true, run once, set it
 *      back to false and wait 5 minutes. If you manage the account through
 *      an agency/advanced account, register there (REGISTRATION_ACCOUNT_ID).
 *   4. Run with PREVIEW_MODE: true first. The logs list every data source,
 *      whether it would be fetched and how its last fetch went; nothing is
 *      fetched.
 *   5. Set PREVIEW_MODE: false and schedule (hourly is the most frequent
 *      schedule Google Ads offers).
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
    // true: list the data sources and their last fetch result, fetch nothing.
    // false: trigger the fetches and send the problem email.
    PREVIEW_MODE: true,

    // The Merchant Center account that owns the feeds (numeric id, as shown
    // in the Merchant Center UI). For a multi-client account, use the
    // sub-account id that holds the data sources.
    MERCHANT_CENTER_ID: '',

    // One-time setup. true: register this script's Google Cloud project with
    // MERCHANT_CENTER_ID and stop; set back to false afterwards. Needs the
    // Merchant API Accounts sub-API and an admin of the Merchant Center.
    REGISTER_PROJECT: false,

    // The account to register with. Empty = MERCHANT_CENTER_ID. If your
    // access to MERCHANT_CENTER_ID comes through a managing (advanced/agency)
    // account, Google only accepts registration there: put its id here.
    REGISTRATION_ACCOUNT_ID: '',

    // Who receives Google's Merchant API notices for this registration (gets
    // the API developer role). Empty = no developer contact is added.
    DEVELOPER_EMAIL: '',

    // Fetch only these data source ids. Empty = every fetchable data source
    // in the account. Find the ids in the preview-mode log.
    DATA_SOURCE_IDS: [],

    // Who hears about failed fetches and feeds whose last processing failed
    // or reported errors. Empty = no email.
    RECIPIENT_EMAILS: [],

    // How many issues per data source the log and email list (the most
    // frequent first).
    MAX_ISSUES_PER_SOURCE: 5,
};

const FETCHABLE_INPUT_TYPES = ['FETCH', 'GOOGLE_SHEETS'];

function main() {
    validateConfig();

    if (CONFIG.REGISTER_PROJECT) {
        registerProject('accounts/' + (CONFIG.REGISTRATION_ACCOUNT_ID || CONFIG.MERCHANT_CENTER_ID));
        return;
    }
    const fetcher = new FeedFetcher(MerchantDataSources, 'accounts/' + CONFIG.MERCHANT_CENTER_ID);
    fetcher.run();
}

function validateConfig() {
    if (typeof MerchantDataSources === 'undefined') {
        throw new Error('Enable Merchant API -> DataSources under "Advanced APIs" ' +
            '(it appears in scripts as MerchantDataSources), then authorize the script again.');
    }
    if (!/^\d+$/.test(CONFIG.MERCHANT_CENTER_ID)) {
        throw new Error('MERCHANT_CENTER_ID must be the numeric Merchant Center account id.');
    }
    if (CONFIG.REGISTRATION_ACCOUNT_ID && !/^\d+$/.test(CONFIG.REGISTRATION_ACCOUNT_ID)) {
        throw new Error('REGISTRATION_ACCOUNT_ID must be a numeric Merchant Center account id or empty.');
    }
    if (CONFIG.REGISTER_PROJECT && typeof MerchantAccounts === 'undefined') {
        throw new Error('REGISTER_PROJECT needs Merchant API -> Accounts enabled under "Advanced APIs" ' +
            '(it appears in scripts as MerchantAccounts), then authorize the script again.');
    }
    for (const dataSourceId of CONFIG.DATA_SOURCE_IDS) {
        if (typeof dataSourceId !== 'string' || !/^\d+$/.test(dataSourceId)) {
            throw new Error('DATA_SOURCE_IDS must hold numeric ids as strings, got "' + dataSourceId + '".');
        }
    }
}

function registerProject(accountName) {
    Logger.log('Registering this script\'s Google Cloud project with ' + accountName + '...');
    const request = CONFIG.DEVELOPER_EMAIL ? {developerEmail: CONFIG.DEVELOPER_EMAIL} : {};
    const registration = MerchantAccounts.Accounts.DeveloperRegistration.registerGcp(
        request, accountName + '/developerRegistration');
    Logger.log('Registered. Project ids on ' + registration.name + ': ' + (registration.gcpIds || []).join(', '));
    Logger.log('Set REGISTER_PROJECT: false and run again in 5 minutes.');
}

function FeedFetcher(dataSourcesService, accountName) {

    this.run = function () {
        const counters = {
            dataSources: 0, fetched: 0,
            skippedNotSelected: 0, skippedNotFetchable: 0,
            notFound: 0, fetchFailed: 0, lastUploadProblems: 0,
        };
        const problems = [];

        Logger.log('Collecting data sources of ' + accountName + '...');
        const dataSources = listDataSources();
        counters.dataSources = dataSources.length;

        const dataSourcesById = {};
        for (const dataSource of dataSources) {
            dataSourcesById[dataSource.dataSourceId] = dataSource;
        }
        for (const dataSourceId of CONFIG.DATA_SOURCE_IDS) {
            if (!dataSourcesById[dataSourceId]) {
                counters.notFound++;
                problems.push('Data source ' + dataSourceId + ' does not exist in ' + accountName + '.');
            }
        }

        for (const dataSource of dataSources) {
            const label = '"' + dataSource.displayName + '" (' + dataSource.dataSourceId + ')';

            if (CONFIG.DATA_SOURCE_IDS.length > 0 &&
                CONFIG.DATA_SOURCE_IDS.indexOf(dataSource.dataSourceId) === -1) {
                counters.skippedNotSelected++;
                continue;
            }
            const inputType = fileInputType(dataSource);
            if (FETCHABLE_INPUT_TYPES.indexOf(inputType) === -1) {
                counters.skippedNotFetchable++;
                Logger.log('Skipping ' + label + ': input ' + dataSource.input +
                    (inputType ? '/' + inputType : '') + ' cannot be fetched.');
                continue;
            }

            const lastUpload = describeLastUpload(dataSource);
            Logger.log('Data source ' + label + ' [' + inputType + '] - last fetch: ' + lastUpload.summary);
            for (const line of lastUpload.issueLines) {
                Logger.log('    ' + line);
            }
            if (lastUpload.isProblem) {
                counters.lastUploadProblems++;
                problems.push('Last fetch of ' + label + ': ' + lastUpload.summary +
                    (lastUpload.issueLines.length > 0 ? '\n    ' + lastUpload.issueLines.join('\n    ') : ''));
            }

            if (CONFIG.PREVIEW_MODE) {
                Logger.log('Would fetch ' + label + ' now.');
                counters.fetched++;
                continue;
            }
            try {
                dataSourcesService.Accounts.DataSources.fetch({}, dataSource.name);
                Logger.log('Fetch triggered for ' + label + '.');
                counters.fetched++;
            } catch (e) {
                counters.fetchFailed++;
                Logger.log('Fetch FAILED for ' + label + ': ' + e.message);
                problems.push('Fetch request for ' + label + ' failed: ' + e.message);
            }
        }

        if (problems.length > 0 && !CONFIG.PREVIEW_MODE && CONFIG.RECIPIENT_EMAILS.length > 0) {
            sendProblemEmail(problems);
        }
        logSummary(counters);
    };

    function listDataSources() {
        const dataSources = [];
        let pageToken;
        do {
            const response = dataSourcesService.Accounts.DataSources.list(accountName, {pageToken: pageToken});
            for (const dataSource of response.dataSources || []) {
                dataSources.push(dataSource);
            }
            pageToken = response.nextPageToken;
        } while (pageToken);
        return dataSources;
    }

    // The latest file upload is the outcome of the previous fetch: the one
    // this run triggers is processed asynchronously and shows up next run.
    function describeLastUpload(dataSource) {
        let upload;
        try {
            upload = dataSourcesService.Accounts.DataSources.FileUploads.get(
                dataSource.name + '/fileUploads/latest');
        } catch (e) {
            return {summary: 'no processing result available (' + e.message + ')', issueLines: [], isProblem: false};
        }

        const issues = (upload.issues || []).slice().sort(function (a, b) {
            return Number(b.count || 0) - Number(a.count || 0);
        });
        const errorCount = issues.filter(function (issue) {
            return issue.severity === 'ERROR';
        }).length;
        const issueLines = issues.slice(0, CONFIG.MAX_ISSUES_PER_SOURCE).map(function (issue) {
            return issue.severity + ' x' + (issue.count || '?') + ': ' + issue.title +
                (issue.code ? ' [' + issue.code + ']' : '');
        });

        return {
            summary: upload.processingState + ' at ' + upload.uploadTime +
                ' - items processed ' + (upload.itemsTotal || 0) +
                ', created ' + (upload.itemsCreated || 0) +
                ', updated ' + (upload.itemsUpdated || 0) +
                ', issues ' + issues.length + ' (' + errorCount + ' errors)',
            issueLines: issueLines,
            isProblem: upload.processingState === 'FAILED' || errorCount > 0,
        };
    }

    function sendProblemEmail(problems) {
        const adsAccountName = AdsApp.currentAccount().getName();
        MailApp.sendEmail(
            CONFIG.RECIPIENT_EMAILS.join(','),
            'Merchant Center feed problems (Merchant Center ' + CONFIG.MERCHANT_CENTER_ID + ', ' +
            adsAccountName + '): ' + problems.length,
            ['Merchant Center ' + CONFIG.MERCHANT_CENTER_ID + ' feed problems:', '']
                .concat(problems).join('\n'));
    }

    function logSummary(counters) {
        const preview = CONFIG.PREVIEW_MODE ? ' (PREVIEW MODE - nothing was fetched)' : '';
        Logger.log([
            '',
            '========== Execution Summary' + preview + ' ==========',
            'Data sources in account: ' + counters.dataSources,
            'Fetch ' + (CONFIG.PREVIEW_MODE ? 'would be ' : '') + 'triggered: ' + counters.fetched +
            ' | fetch request failed: ' + counters.fetchFailed,
            'Skipped - not in DATA_SOURCE_IDS: ' + counters.skippedNotSelected +
            ', not fetchable: ' + counters.skippedNotFetchable,
            'Configured ids not found: ' + counters.notFound,
            'Data sources whose last fetch failed or had errors: ' + counters.lastUploadProblems,
            '====================================================',
        ].join('\n'));
    }
}

function fileInputType(dataSource) {
    return dataSource.fileInput ? dataSource.fileInput.fileInputType : '';
}
