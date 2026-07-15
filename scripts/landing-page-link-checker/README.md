# Landing Page Link Checker

The ad is perfect, the bid is right — and the landing page is a 404. Google
won't stop the traffic; the clicks keep costing money until someone notices.
This script notices: it fetches every final URL your keywords and ads use,
classifies each page, labels the affected entities, and (optionally) pauses
them until the page recovers — then re-enables them itself.

## How it works

1. **Collects final URLs** from enabled campaigns' keywords and ads
   (including paused entities, so recovery can re-enable them), deduplicated
   — each URL is fetched once no matter how many entities share it.
2. **Fetches and classifies** every URL, without following redirects:

   | Category | Meaning |
   |---|---|
   | `OK` | 200 and none of your `ERROR_TEXTS` on the page |
   | `REDIRECT` | 3xx — the destination moved |
   | `CLIENT_ERROR` | 4xx — broken page |
   | `SERVER_ERROR` | 5xx — site trouble |
   | `FETCH_FAILED` | no response (DNS, timeout, SSL) |
   | `TEXT_MATCH` | 200 but the page contains an `ERROR_TEXTS` marker — catches "out of stock" and "no results" pages HTTP codes can't see |

3. **Labels every affected keyword/ad** with its category label and, when the
   category's `PAUSE_ON` flag is on, pauses enabled entities.
4. **Recovers automatically.** When a URL works again, checker labels are
   removed and — with `ENABLE_RECOVERED` — entities that are paused *and*
   carry a checker label are re-enabled. The label is the safety: only
   entities this script paused are ever touched; a human's pauses stay.
5. **Emails a digest** of broken URLs with affected-entity counts.

## Setup

1. In Google Ads: **Tools → Bulk actions → Scripts → +**, paste
   `landing-page-link-checker.js`.
2. Edit `CONFIG` at the top:
   - `ERROR_TEXTS` — your shop's out-of-stock / empty-results wording.
   - `PAUSE_ON` — which categories justify pausing (all off by default;
     labels-only is a safe start).
   - `RECIPIENT_EMAILS` — who hears about broken pages.
3. **Authorize and run with `PREVIEW_MODE: true`.** Read the per-URL verdicts
   and the execution summary in the logs — nothing is changed.
4. Set `PREVIEW_MODE: false` and schedule **daily**.

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `PREVIEW_MODE` | `true` | Log verdicts only; change nothing |
| `RECIPIENT_EMAILS` | `[]` | Digest recipients (empty = no email) |
| `ERROR_TEXTS` | `[]` | Page markers that flag a 200 as broken |
| `PAUSE_ON.*` | all `false` | Pause entities per category |
| `ENABLE_RECOVERED` | `true` | Re-enable script-paused entities on recovery |
| `LABELS.*` | `Link Check: *` | Category labels |
| `CAMPAIGN_NAME_FILTER` | `''` | Only campaigns containing this substring |
| `CAMPAIGN_EXCLUDE_PATTERNS` | `SHOPPING, PMAX` | Campaigns to skip |
| `MAX_URLS_PER_RUN` | `800` | URL fetch budget per run |
| `MAX_RUNTIME_MS` | 27 min | Safety stop before the 30-min script limit |

## Requirements & notes

- Works on a single account (not MCC-level).
- Fetching is the slow part (~2–3 URLs/second): large accounts spread the
  work across daily runs via `MAX_URLS_PER_RUN`.
- `REDIRECT` is reported but usually shouldn't pause — update the final URL
  instead, redirects hurt tracking and quality score.
- Some sites block Google Apps Script's fetcher; those show as
  `FETCH_FAILED` — verify one manually before trusting a pause flag on that
  category.
- The internal Omnicliq edition delegates crawling to a dedicated external
  checker with stock-level detection; this standalone edition checks pages
  in-script, with `ERROR_TEXTS` covering the stock/results cases.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
