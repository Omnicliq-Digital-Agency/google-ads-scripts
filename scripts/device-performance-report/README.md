# Device Performance Report

Mobile clicks are not desktop clicks: on many accounts one device converts at half the cost of the other, and campaign averages hide it. This script breaks every campaign down by device, compares each device's cost/conv against the campaign's own average, and suggests the bid adjustment that would price the gap — as a report, not a change.

## How it works

1. Aggregates cost and conversions per campaign × device over `LOOKBACK_DAYS`.
2. Cells with fewer than `MIN_CONVERSIONS` get no suggestion — no advice on noise.
3. Suggested modifier = campaign avg cost/conv ÷ device cost/conv − 1, capped at ±`MAX_SUGGESTION`; gaps under `MIN_DEVIATION` are skipped.

**Read-only**: bid adjustments interact with Smart Bidding (which already adjusts by device on tROAS/tCPA) — the suggestions are decision support.

## Setup

Paste, run, read the per-campaign device lines. Schedule monthly and fill `RECIPIENT_EMAILS`.

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `RECIPIENT_EMAILS` | `[]` | Report recipients |
| `LOOKBACK_DAYS` | `60` | Analysis window |
| `MIN_CONVERSIONS` | `10` | Data floor per campaign × device |
| `MAX_SUGGESTION` | `0.5` | Cap on suggested modifiers |
| `MIN_DEVIATION` | `0.1` | Smallest gap worth reporting |
| `CAMPAIGN_EXCLUDE_PATTERNS` | `[]` | Campaigns to skip |

## Requirements & notes

- Single account. Review suggestions against your bid strategy before applying.
- A companion piece built for this collection in the same style as our long-running internal scripts.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
