# Impression Share Tracker

Impression share explains the other metrics: conversions dropped because you lost the auction, not because the ads got worse. But Google shows IS as a snapshot — the trend never accumulates anywhere. This script accumulates it: every run appends each search campaign's IS and its two loss components to a history spreadsheet, and alerts when a campaign drops sharply against its own trailing average.

## How it works

1. Reads yesterday's search IS, budget-lost IS and rank-lost IS per enabled search campaign (above `MIN_IMPRESSIONS`).
2. Appends one row per campaign to the History tab.
3. Compares yesterday against the campaign's average over its previous `TREND_DAYS` rows; drops of `DROP_ALERT_POINTS`+ IS points are emailed — with the budget/rank split, so you know *why* you lost ground.

## Setup

First run with empty `SPREADSHEET_URL` creates the sheet (URL in the logs — pin it). Schedule **daily** — the history is the product; gaps are blind days.

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `SPREADSHEET_URL` | `''` | History spreadsheet (auto-created when empty) |
| `RECIPIENT_EMAILS` | `[]` | Drop alert recipients |
| `DROP_ALERT_POINTS` | `5` | IS points below trailing average to alert |
| `TREND_DAYS` | `14` | Rows per campaign in the trailing average |
| `MIN_IMPRESSIONS` | `100` | Ignore campaigns below this yesterday |
| `CAMPAIGN_EXCLUDE_PATTERNS` | `[]` | Campaigns to skip |

## Requirements & notes

- Single account; search campaigns only (IS metrics). Two runs needed before alerts start.
- A companion piece built for this collection in the same style as our long-running internal scripts.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
