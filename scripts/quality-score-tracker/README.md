# Quality Score Tracker

Quality Score moves silently: Google won't tell you a keyword slid from 7 to
4 last Tuesday, but you pay for it on every auction from then on. This script
snapshots every keyword's Quality Score **and its three components** daily,
alerts you on drops, and labels chronic low-QS keywords. Because the
components say *why* — expected CTR, ad relevance, landing page experience —
the fix is usually obvious from the sheet alone.

## How it works

1. **Snapshots** QS + components for every eligible keyword.
2. **Detects drops** of `DROP_ALERT_POINTS` or more against the previous
   run's snapshot and emails them with the component breakdown — so you see
   at a glance whether the ad or the landing page broke.
3. **Writes two tabs**: `Latest` (per-keyword state, sorted worst-first) and
   `History` (one account-average row per run — your QS trend over time).
4. **Labels** keywords at or below `LOW_QUALITY_THRESHOLD` with `QS: Low`,
   removes the label when they recover, and — only if you switch on
   `PAUSE_LOW_QUALITY` — pauses them. Labels-only is the default: low QS is
   a symptom to fix, not always to kill.

## Setup

1. In Google Ads: **Tools → Bulk actions → Scripts → +**, paste
   `quality-score-tracker.js`.
2. First non-preview run: leave `SPREADSHEET_URL` empty — the script creates
   the spreadsheet and logs its URL. Paste that URL into `SPREADSHEET_URL`.
3. **Authorize and run with `PREVIEW_MODE: true`.** Read the summary in the
   logs — account and spreadsheet stay untouched.
4. Set `PREVIEW_MODE: false` and schedule **daily** (drop detection compares
   consecutive runs, so a steady cadence matters).

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `PREVIEW_MODE` | `true` | Log only; no labels, sheet writes or email |
| `SPREADSHEET_URL` | `''` | Output spreadsheet (auto-created when empty) |
| `RECIPIENT_EMAILS` | `[]` | Drop alert recipients (empty = no email) |
| `DROP_ALERT_POINTS` | `2` | Minimum QS fall to alert on |
| `LOW_QUALITY_THRESHOLD` | `3` | At or below → labeled |
| `PAUSE_LOW_QUALITY` | `false` | Also pause low-QS keywords |
| `LOW_QUALITY_LABEL` | `'QS: Low'` | The label (auto-created) |
| `CAMPAIGN_EXCLUDE_PATTERNS` | `[]` | Campaigns to skip |

## Requirements & notes

- Works on a single account (not MCC-level).
- Only keywords Google reports a QS for are tracked (new/low-volume keywords
  have none).
- Drop detection needs two runs to start working — the first run just lays
  down the baseline.
- Low `Expected CTR` → work the ad copy; low `Ad relevance` → tighten the ad
  group theme; low `LP experience` → the landing page (pair with the
  [Landing Page Link Checker](../landing-page-link-checker/)).
- Distilled from Omnicliq's internal quality score tooling; the tracking and
  component breakdown are the public edition's additions.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
