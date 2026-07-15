# PMax Placement Audit

Performance Max spends part of its budget on Display and YouTube placements —
and the UI barely shows you where. Mobile game apps, made-for-advertising
sites, kids' content channels: your ads may be running there right now, and
nothing in the campaign screen will tell you. This script pulls every
placement your PMax campaigns served on, flags the suspicious ones, and
emails you the paste-ready exclusion list every week.

## How it works

1. **Pulls all PMax placements** of the lookback window from Google's
   `performance_max_placement_view` report, with impressions.
2. **Flags** placements whose type is in `FLAG_TYPES` (mobile apps by
   default) or whose name/URL matches any `FLAG_PATTERNS` entry — extend the
   patterns with the junk you see in your market.
3. **Filters noise**: flagged placements under `MIN_IMPRESSIONS` aren't worth
   a decision yet and stay out of the report.
4. **Reports**: ranked log output, an optional email digest, and — with
   `SPREADSHEET_URL` — the full placement list in a dated spreadsheet tab.

**Read-only by necessity**: Google Ads Scripts cannot edit the account-level
placement exclusion list, so the final step stays with you (**Content
suitability → Excluded placements**). The digest is formatted to make that a
two-minute paste job.

## Setup

1. In Google Ads: **Tools → Bulk actions → Scripts → +**, paste
   `pmax-placement-audit.js`.
2. Extend `FLAG_PATTERNS` for your market and language.
3. Run it and read the flagged placements in the logs.
4. Schedule **weekly** and fill `RECIPIENT_EMAILS`.

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `RECIPIENT_EMAILS` | `[]` | Digest recipients (empty = log only) |
| `SPREADSHEET_URL` | `''` | Optional full-list output, one tab per run |
| `LOOKBACK_DAYS` | `30` | Analysis window, ending yesterday |
| `FLAG_TYPES` | `['MOBILE_APPLICATION']` | Placement types flagged wholesale |
| `FLAG_PATTERNS` | game, kids, quiz, … | Name/URL substrings that flag a placement |
| `MIN_IMPRESSIONS` | `50` | Reporting floor for flagged placements |
| `CAMPAIGN_NAME_FILTER` | `''` | Only audit matching PMax campaigns |

## Requirements & notes

- Works on a single account (not MCC-level).
- Strictly read-only — it reports, you exclude.
- Google reports impressions (not cost) per PMax placement; rank by
  impressions and let the patterns tell you what doesn't belong.
- Placement auditing for PMax is a known gap many practitioners have built
  tooling around; this is our from-scratch take, in this repo's uniform
  style — new to the collection rather than one of our long-running internal
  scripts.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
