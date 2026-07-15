# Weekly Account Summary

The Monday morning question is always the same: what happened last week, and what moved? One email answers it: last week's core metrics against the week before — cost, clicks, impressions, conversions, value, plus derived CPC, conv. rate, cost/conv and ROAS — and the campaigns that moved the numbers most, so the first coffee goes to the right campaign.

## How it works

1. Compares the 7 days ending yesterday against the 7 days before.
2. Account totals with week-over-week deltas per metric.
3. Movers: campaigns whose cost or conversions changed by ≥ `MOVER_THRESHOLD` (relative) with ≥ `MIN_COST_FOR_MOVER` spend in either week, ranked by magnitude, capped at `MAX_MOVERS`.

## Setup

Fill `RECIPIENT_EMAILS`, schedule weekly on Monday early morning.

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `RECIPIENT_EMAILS` | `[]` | Summary recipients |
| `MOVER_THRESHOLD` | `0.25` | Relative change that makes a mover |
| `MIN_COST_FOR_MOVER` | `20` | Spend floor for mover eligibility |
| `MAX_MOVERS` | `10` | Movers listed |
| `CAMPAIGN_EXCLUDE_PATTERNS` | `[]` | Campaigns to skip |

## Requirements & notes

- Single account; strictly read-only.
- A companion piece built for this collection in the same style as our long-running internal scripts.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
