# Campaign Budget Utilization

Two campaign states quietly waste money: chronically capped (budget runs out daily, delivery throttled, CPCs drift up) and chronically idle (budget sits unused while a capped sibling starves). Both are invisible on any single day — they are patterns. This script measures each enabled campaign's average daily spend against its daily budget over the window and reports both tails.

## How it works

1. Average daily spend over `LOOKBACK_DAYS` ÷ daily budget = utilization.
2. ≥ `CAPPED_THRESHOLD` → capped list (more budget or tighter targeting); ≤ `IDLE_THRESHOLD` with spend > 0 → idle list (budget that could move).
3. Micro-budgets below `MIN_DAILY_BUDGET` are ignored — noise, not decisions.

**Read-only** — budget moves are money decisions; the report ranks them.

## Setup

Paste, run, read the two lists. Schedule weekly, fill `RECIPIENT_EMAILS`.

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `RECIPIENT_EMAILS` | `[]` | Report recipients |
| `LOOKBACK_DAYS` | `14` | Averaging window |
| `CAPPED_THRESHOLD` | `0.95` | Utilization at/above = capped |
| `IDLE_THRESHOLD` | `0.5` | Utilization at/below = idle |
| `MIN_DAILY_BUDGET` | `5` | Ignore micro-budgets below this |
| `CAMPAIGN_EXCLUDE_PATTERNS` | `[]` | Campaigns to skip |

## Requirements & notes

- Single account. Pairs with the [MCC Budget Pacing Guard](../mcc-budget-pacing-guard/): that watches account-level monthly budgets, this watches campaign-level daily ones.
- A companion piece built for this collection in the same style as our long-running internal scripts.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
