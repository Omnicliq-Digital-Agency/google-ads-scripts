# Zero-Conversion Spenders

Every account has them: keywords that spend real money month after month and never convert. Each is small enough to hide in the averages; together they're a budget leak. This script finds every enabled keyword that spent at least `MIN_SPEND` in the window with zero conversions, ranks the list by cost, labels the offenders, and emails the digest.

## How it works

1. Aggregates keyword cost/clicks/conversions over `LOOKBACK_DAYS` (default 90 — cover your conversion lag three times over).
2. Flags keywords with cost ≥ `MIN_SPEND` and zero conversions (optionally zero conversion value too via `REQUIRE_ZERO_VALUE`).
3. Applies the `Zero Conv Spend` label — removed automatically when a keyword converts again — and emails the ranked list with total leakage.

**Never pauses anything**: a zero-conversion keyword may be an assist player your attribution hides. The label puts the list one filter away in the UI; the decision stays with you.

## Setup

1. Paste into **Tools → Bulk actions → Scripts**, set `MIN_SPEND` to what a real decision costs in your currency.
2. Run with `PREVIEW_MODE: true`, read the ranked list in the logs.
3. Set `PREVIEW_MODE: false` and schedule weekly.

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `PREVIEW_MODE` | `true` | Log only; no labels or email |
| `RECIPIENT_EMAILS` | `[]` | Digest recipients |
| `MIN_SPEND` | `50` | Spend floor to make the list |
| `REQUIRE_ZERO_VALUE` | `false` | Also require zero conversion value |
| `LOOKBACK_DAYS` | `90` | Analysis window |
| `LABEL` | `Zero Conv Spend` | Applied/removed automatically |
| `CAMPAIGN_EXCLUDE_PATTERNS` | `[]` | Campaigns to skip |

## Requirements & notes

- Single account; label lifecycle is symmetric (converts again → label removed).
- A companion piece built for this collection in the same style as our long-running internal scripts.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
