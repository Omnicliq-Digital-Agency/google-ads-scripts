# RSA Asset Performance Report

Google grades every RSA headline and description — BEST, GOOD, LOW — and buries the grades three clicks deep, per ad. Nobody reviews them ad by ad, so LOW assets keep serving for months. This script sweeps the whole account and ranks the repeat offenders: the same LOW text used across many ads, where one rewrite improves dozens of ads at once.

## How it works

1. Sweeps every enabled asset of every enabled RSA via `ad_group_ad_asset_view`.
2. Counts assets per performance grade; dedupes LOW assets by text and ranks them by how many ads carry each one.
3. Emails the grade counts + top offenders; optionally writes the full asset list to a spreadsheet tab.

**Read-only** — replacing copy is an editorial decision.

## Setup

Paste, run, read the grade counts and LOW list. Schedule monthly, fill `RECIPIENT_EMAILS`.

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `RECIPIENT_EMAILS` | `[]` | Digest recipients |
| `SPREADSHEET_URL` | `''` | Optional full asset list output |
| `TOP_OFFENDERS` | `20` | LOW assets listed in the digest |
| `CAMPAIGN_EXCLUDE_PATTERNS` | `[]` | Campaigns to skip |

## Requirements & notes

- Single account. PENDING grades mean Google hasn't collected enough data yet — not a problem to fix.
- Pair with the [RSA Builder](../rsa-builder/): fix the frame once, roll it out everywhere.
- A companion piece built for this collection in the same style as our long-running internal scripts.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
