# Geo Performance Report

Location decisions age: the region that earned its +20% adjustment two years ago may be your worst performer today. This script aggregates performance by the user's actual country, ranks locations by spend, flags the ones converting far worse than the account average, and writes the full picture to a spreadsheet.

## How it works

1. Aggregates cost/clicks/conversions/value per country from `user_location_view` (where users actually were) over `LOOKBACK_DAYS`; names resolved from geo target constants.
2. Flags locations with spend ≥ `MIN_SPEND` and either zero conversions or cost/conv worse than `DEVIATION_FACTOR` × the account average.
3. Full ranked list in a dated spreadsheet tab; flagged locations in the email digest.

**Read-only** — geo adjustments and exclusions stay with you.

## Setup

First run with empty `SPREADSHEET_URL` creates the sheet (URL in the logs — pin it). Schedule monthly, fill `RECIPIENT_EMAILS`.

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `RECIPIENT_EMAILS` | `[]` | Digest recipients |
| `SPREADSHEET_URL` | `''` | Full-list output (auto-created when empty) |
| `LOOKBACK_DAYS` | `90` | Analysis window |
| `MIN_SPEND` | `100` | Spend floor before flagging |
| `DEVIATION_FACTOR` | `1.5` | Cost/conv tolerance vs account average |

## Requirements & notes

- Single account; country granularity (that's what `user_location_view` reports reliably — finer geo slicing needs the UI's location reports).
- A companion piece built for this collection in the same style as our long-running internal scripts.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
