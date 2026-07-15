# Shopping Product Audit

Shopping campaigns report at product level, but nobody reads thousands of product rows — so money-losing items hide in plain sight. This script aggregates every product that served in your Shopping/PMax retail campaigns, writes the full ranked list to a spreadsheet, and emails the two lists that matter: products spending without converting, and products converting below your ROAS floor.

## How it works

1. Aggregates cost/clicks/conversions/value per item id over `LOOKBACK_DAYS` from `shopping_performance_view`.
2. `ZERO CONV` list: cost ≥ `MIN_SPEND`, zero conversions. `LOW ROAS` list: cost ≥ `MIN_SPEND`, value/cost below `MIN_ROAS`.
3. Full ranked product list lands in a dated spreadsheet tab; the flagged lists go to email.

**Read-only**: excluding a product is a feed or listing-group decision — yours.

## Setup

1. Paste the script, set `MIN_SPEND`/`MIN_ROAS` to your economics.
2. First run with empty `SPREADSHEET_URL` creates the sheet and logs its URL — pin it in CONFIG.
3. Schedule weekly, fill `RECIPIENT_EMAILS`.

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `RECIPIENT_EMAILS` | `[]` | Digest recipients |
| `SPREADSHEET_URL` | `''` | Full-list output (auto-created when empty) |
| `LOOKBACK_DAYS` | `30` | Analysis window |
| `MIN_SPEND` | `20` | Spend floor before flagging |
| `MIN_ROAS` | `2.5` | ROAS floor (0 disables the check) |
| `CAMPAIGN_EXCLUDE_PATTERNS` | `[]` | Campaigns to skip |

## Requirements & notes

- Single account; covers products that actually served (zero-impression products don't appear in the report by definition).
- A companion piece built for this collection in the same style as our long-running internal scripts.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
