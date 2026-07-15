# Optimization Score Tracker

Google's Optimization Score influences everything from Partner status to how pushy the recommendations UI gets — and it moves without telling you. This MCC-level script makes it visible: every run appends each account's score (and its campaigns') to a history spreadsheet and emails a digest of anything below your floors.

## How it works

1. Reads `customer.optimization_score` per account and `campaign.optimization_score` per serving campaign, across the MCC (optionally filtered by `ACCOUNT_LABEL`).
2. Appends one row per account to the History tab — your score trend over time.
3. Emails accounts below `MIN_ACCOUNT_SCORE` and campaigns below `MIN_CAMPAIGN_SCORE`, worst first.

**The score measures Google's recommendations, not your strategy.** Apply or dismiss each recommendation deliberately — dismissing also restores the score. This script only makes the number visible; it never applies anything.

## Setup

1. In your **manager account (MCC)**: **Tools → Bulk actions → Scripts → +**, paste the script.
2. First run with empty `SPREADSHEET_URL` creates the sheet (URL in the logs — pin it in CONFIG).
3. Fill `RECIPIENT_EMAILS`, schedule **weekly**.

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `SPREADSHEET_URL` | `''` | History spreadsheet (auto-created when empty) |
| `RECIPIENT_EMAILS` | `[]` | Digest recipients |
| `MIN_ACCOUNT_SCORE` | `80` | Account floor (0–100) |
| `MIN_CAMPAIGN_SCORE` | `70` | Campaign floor (0–100) |
| `ACCOUNT_LABEL` | `''` | Only check labeled accounts |

## Requirements & notes

- MCC-level script; strictly read-only.
- Campaigns Google hasn't scored yet (score 0) are not flagged.
- A companion piece built for this collection in the same style as our long-running internal scripts.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
