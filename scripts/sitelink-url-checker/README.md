# Sitelink URL Checker

Sitelinks outlive the pages they point to: seasonal landing pages get
retired, category URLs change, and the sitelink keeps serving — straight into
a 404 rendered under your otherwise healthy ad. Ad and keyword URLs get
checked (that's the
[Landing Page Link Checker](../landing-page-link-checker/)); sitelinks almost
never do. This script closes the gap.

## How it works

1. **Collects every sitelink URL in use** — assets linked at account,
   campaign and ad group level — with the link text and where each one
   serves.
2. **Fetches and classifies** each unique URL once, without following
   redirects: `OK`, `REDIRECT` (3xx), `CLIENT_ERROR` (4xx), `SERVER_ERROR`
   (5xx), `FETCH_FAILED` (DNS/timeout/SSL), or `TEXT_MATCH` (a 200 page
   containing one of your `ERROR_TEXTS` markers).
3. **Emails a digest** of broken URLs with every usage listed — link text
   and level/campaign/ad group — so the fix takes minutes.

**Read-only by design**: sitelink fixes belong on the shared asset (one edit
covers every campaign using it), so the digest tells you which asset to open
— it never severs associations.

## Setup

1. In Google Ads: **Tools → Bulk actions → Scripts → +**, paste
   `sitelink-url-checker.js`.
2. If sitelinks point at product-like pages, add your shop's out-of-stock
   wording to `ERROR_TEXTS`.
3. Run it and read the verdicts in the logs.
4. Schedule **daily** and fill `RECIPIENT_EMAILS`.

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `RECIPIENT_EMAILS` | `[]` | Digest recipients (empty = log only) |
| `ERROR_TEXTS` | `[]` | Page markers that flag a 200 as broken |
| `MAX_URLS_PER_RUN` | `500` | URL fetch budget per run |
| `MAX_RUNTIME_MS` | 27 min | Safety stop before the 30-min script limit |

## Requirements & notes

- Works on a single account (not MCC-level).
- Some sites block Google Apps Script's fetcher; those show as
  `FETCH_FAILED` — verify one manually before acting.
- Pairs with the [Landing Page Link Checker](../landing-page-link-checker/):
  that one covers keywords and ads (with labels, pauses and recovery), this
  one covers the sitelink layer, report-only.
- A companion piece built for this collection in the same style as our
  long-running internal scripts.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
