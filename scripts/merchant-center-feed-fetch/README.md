# Merchant Center Feed Fetch

Merchant Center fetches a scheduled feed at most once a day. Prices and stock
change faster than that, and until the next fetch your Shopping and
Performance Max ads keep advertising yesterday's catalog. This script makes
Merchant Center fetch your feeds every time it runs, so the feed refresh
follows the script schedule instead of the Merchant Center one. On each run it
also reports how the previous fetch went, so a failing feed gets noticed.

## How it works

1. **Lists the data sources** of the Merchant Center account through the
   Merchant API (DataSources sub-API).
2. **Selects the fetchable ones**: file data sources that Merchant Center
   pulls itself, either a scheduled URL (`FETCH`) or a Google Sheet
   (`GOOGLE_SHEETS`). When `DATA_SOURCE_IDS` is set, only those ids are
   considered. Uploaded files, API and UI data sources can't be fetched and
   are skipped.
3. **Reports the previous fetch** of each selected data source: processing
   state, processed/created/updated item counts and the most frequent issues.
   Fetches are processed asynchronously, so a fetch triggered in one run
   appears in the next run's report.
4. **Triggers an immediate fetch** (`accounts.dataSources.fetch`), even
   outside the Merchant Center fetch schedule.
5. **Emails the problems**: failed fetch requests, configured ids that don't
   exist, and data sources whose last fetch `FAILED` or reported errors.

## Setup

1. In Google Ads: **Tools → Bulk actions → Scripts → +**, paste
   `merchant-center-feed-fetch.js`.
2. Click **Advanced APIs** and enable **Merchant API → DataSources**. It
   appears in scripts as `MerchantDataSources`. Then **authorize the script
   again**: the Merchant Center permission (`auth/content`) is only granted
   by an authorization made after the API is enabled.
3. Edit `CONFIG` at the top:
   - `MERCHANT_CENTER_ID`: the account that owns the feeds.
   - `DATA_SOURCE_IDS`: leave empty to fetch every fetchable feed, or list the
     ids (the preview log prints them).
   - `RECIPIENT_EMAILS`: who hears about feed problems.
4. **Register the script with Merchant Center, once.** The Merchant API only
   answers Google Cloud projects registered with the Merchant Center account,
   and each Google Ads script runs in its own hidden project that you can't
   open in the Cloud Console. Only the script can register it:
   - enable **Merchant API → Accounts** under **Advanced APIs** too (it
     appears as `MerchantAccounts`) and authorize again;
   - set `REGISTER_PROJECT: true` (optionally `DEVELOPER_EMAIL`), run once;
     if you reach the account through an agency/advanced account, Google
     only accepts registration on that account: put its id in
     `REGISTRATION_ACCOUNT_ID` (the error message names it). A project
     registered there works for every account it manages;
   - set `REGISTER_PROJECT: false` and wait 5 minutes before the next run.
5. **Authorize and run with `PREVIEW_MODE: true`.** The log lists every data
   source, whether it would be fetched and how its last fetch went. Nothing
   is fetched.
6. Set `PREVIEW_MODE: false` and schedule it.

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `PREVIEW_MODE` | `true` | Report only; trigger no fetch, send no email |
| `MERCHANT_CENTER_ID` | `''` | Numeric Merchant Center account id |
| `REGISTER_PROJECT` | `false` | One-time: register the script's Cloud project with the account, then stop |
| `REGISTRATION_ACCOUNT_ID` | `''` | Account to register with (empty = `MERCHANT_CENTER_ID`); your agency/advanced account if access comes through it |
| `DEVELOPER_EMAIL` | `''` | Contact for Google's Merchant API notices (gets the API developer role) |
| `DATA_SOURCE_IDS` | `[]` | Only fetch these ids, as strings (empty = all fetchable) |
| `RECIPIENT_EMAILS` | `[]` | Problem email recipients (empty = no email) |
| `MAX_ISSUES_PER_SOURCE` | `5` | Issues listed per data source, most frequent first |

## Apps Script edition

If the Google Ads script can't be registered with Merchant Center (for example
when you reach the account through an agency/advanced account), use the
edition in [`apps-script/`](apps-script/). It does the same job from a
standard Google Cloud project that is registered with Merchant Center; one
registration covers every account the registered account manages.

1. Create an Apps Script project, paste `Code.gs` and replace
   `appsscript.json` with the one in the folder (it enables the Merchant API
   DataSources service).
2. In Project Settings, switch to a standard Cloud project that is registered
   with Merchant Center and has the Merchant API enabled.
3. Fill `MERCHANT_CENTER_ID`, run `main` with `PREVIEW_MODE: true`, then set
   it to `false` and add an hourly time-driven trigger.

## Requirements & notes

- The user who authorizes the script needs access to the Merchant Center
  account. The script doesn't have to run in the linked Google Ads account;
  it acts on whichever Merchant Center id you configure.
- For a multi-client account (MCA), use the id of the sub-account that
  holds the data sources.
- Google's API reference says that if you need to call this method more
  than once per day, you should use the Products API to update product data
  instead. For fast-moving prices and stock, an hourly fetch still works, but
  Merchant Center has to download and process the whole file each time.
  Match the schedule to how often your feed file actually changes.
- Registration rules from Google's
  [`registerGcp` reference](https://developers.google.com/merchant/api/reference/rest/accounts_v1/accounts.developerRegistration/registerGcp):
  the Merchant Center needs a verified website, test accounts can't be
  registered, and a sub-account can't be registered by a user whose access
  comes only through its parent (advanced) account.
- The Content API for Shopping `datafeeds.fetchnow` method that older
  scripts use was sunset on August 18, 2026. This script uses only the
  Merchant API.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
