# MCC Budget Pacing Guard

A monthly budget dies in one of two ways: it runs out on the 20th, or a third
of it is still unspent on the 28th. Both are pacing failures, and both are
visible weeks earlier — if someone projects the month-end spend every day.
This MCC-level script is that someone: for every account with a declared
monthly budget it computes month-to-date spend, projects the month-end total
from the recent run-rate, and emails one digest flagging every account pacing
outside tolerance.

## How it works

1. **You declare budgets once** — `BUDGETS` maps customer ids to monthly
   budgets in each account's own currency.
2. **Every morning the script computes** per account: month-to-date spend,
   the average daily spend of the last `RUN_RATE_DAYS`, and the projection
   `MTD + run-rate × remaining days`.
3. **Verdicts:**
   - `EXCEEDED` — MTD already over budget, no projection needed.
   - `Overpacing` — projection above budget × (1 + `OVERPACE_TOLERANCE`).
   - `Underpacing` — projection below budget × (1 − `UNDERPACE_TOLERANCE`).
   - `On pace` — everything else (included in the digest only with
     `INCLUDE_ON_PACE`, which turns it into a daily budget overview mail).
4. **Strictly read-only** — it reports, you decide what to throttle or push.

## Setup

1. In your **manager account (MCC)**: **Tools → Bulk actions → Scripts → +**,
   paste `mcc-budget-pacing-guard.js`. The script must run at MCC level.
2. Fill `BUDGETS` (ids with or without dashes both work) and
   `RECIPIENT_EMAILS`.
3. **Authorize and run with `PREVIEW_MODE: true`.** Read the per-account
   pacing lines in the logs — no email is sent.
4. Set `PREVIEW_MODE: false` and schedule **daily**, in the morning, after
   yesterday's spend has settled.

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `PREVIEW_MODE` | `true` | Log pacing only; send no email |
| `RECIPIENT_EMAILS` | `[]` | Digest recipients |
| `BUDGETS` | `{}` | Customer id → monthly budget (account currency) |
| `RUN_RATE_DAYS` | `7` | Days averaged into the daily run-rate |
| `OVERPACE_TOLERANCE` | `0.1` | Projection may exceed budget by 10% |
| `UNDERPACE_TOLERANCE` | `0.15` | Projection may fall short by 15% |
| `INCLUDE_ON_PACE` | `false` | Also list healthy accounts in the digest |

## Requirements & notes

- **MCC-level script** — it refuses to run in a single account.
- Budgets not found in the MCC are reported, not silently ignored — a typo
  in a customer id won't hide an account from monitoring.
- Early-month projections lean heavily on last month's tail via the
  run-rate window; expect them to stabilise after the first few days.
- Pairs with the [MCC Spend Anomaly Detector](../mcc-spend-anomaly-detector/):
  the detector catches sudden daily breaks, the guard catches slow monthly
  drift.
- Distilled from Omnicliq's internal cross-channel budget guard (the
  internal edition also reads Meta spend and budget plans from our
  operations sheets); this standalone edition covers the Google Ads side
  with CONFIG-declared budgets.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
