# Account Spend Anomaly Detector

The single-account edition of the
[MCC Spend Anomaly Detector](../mcc-spend-anomaly-detector/) — for when you
don't manage the account through an MCC, or a client runs the script in their
own account. Same statistical engine, plus one thing the MCC edition doesn't
do: **per-campaign monitoring**, which catches the incident the account total
hides — one campaign dies, the others keep spending, and the total still looks
normal.

## How it works

1. **Like-for-like comparison.** Today (say, a Monday at 14:00) is compared
   only against previous Mondays, and only spend up to the same hour minus
   `DATA_DELAY_HOURS` (Google's spend data lags a few hours). Unlike the MCC
   edition, today's spend is also cut at the same hour, so both sides of the
   comparison cover identical hours.
2. **Statistical range per series.** The previous `LOOKBACK_WEEKS`
   same-weekdays form a sample; mean and sample standard deviation define the
   expected range: `mean ± STD_DEV_MULTIPLIER × stddev`.
3. **Two levels.** The account total (`CHECK_ACCOUNT`) and every enabled
   campaign individually (`CHECK_CAMPAIGNS`), each with its own deviation
   floor — campaigns spend less, so `CAMPAIGN_MIN_STD_DEV` is lower.
4. **One digest email per run** listing every over- and under-spending
   finding with its actual spend and expected range.

Series with fewer than `MIN_SAMPLE_DAYS` comparable days are skipped, and runs
too early in the day (before the delay-shifted hour passes midnight) exit
cleanly.

## Setup

1. In the account: **Tools → Bulk actions → Scripts → +**, paste
   `account-spend-anomaly-detector.js`.
2. Edit `CONFIG` at the top:
   - `RECIPIENT_EMAILS` — who gets the digest.
   - `CHECK_CAMPAIGNS` / `CAMPAIGN_NAME_FILTER` — per-campaign monitoring,
     optionally restricted by name substring.
   - `MIN_STD_DEV` / `CAMPAIGN_MIN_STD_DEV` — what "pocket change" means in
     the account's currency, at each level.
3. **Authorize and run with `PREVIEW_MODE: true`.** Read the per-series
   verdicts and the execution summary in the logs — no email is sent.
4. Set `PREVIEW_MODE: false` and schedule **hourly**.

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `PREVIEW_MODE` | `true` | Log verdicts only; send no email |
| `RECIPIENT_EMAILS` | `[]` | Digest recipients |
| `CHECK_ACCOUNT` | `true` | Check the account total |
| `CHECK_CAMPAIGNS` | `true` | Also check every enabled campaign |
| `CAMPAIGN_NAME_FILTER` | `''` | Only campaigns containing this substring |
| `LOOKBACK_WEEKS` | `12` | Same-weekday history window |
| `MIN_SAMPLE_DAYS` | `5` | Minimum comparable days per series |
| `DATA_DELAY_HOURS` | `3` | Hours excluded from 'now' for data lag |
| `STD_DEV_MULTIPLIER` | `2` | Width of the expected range |
| `MIN_STD_DEV` | `10` | Deviation floor for the account total |
| `CAMPAIGN_MIN_STD_DEV` | `5` | Deviation floor per campaign |

## Requirements & notes

- Single-account script — for portfolio-wide monitoring from a manager
  account, use the [MCC edition](../mcc-spend-anomaly-detector/).
- Purely observational: reads spend, sends email, changes nothing.
- Campaigns created recently simply skip checks until they accumulate
  `MIN_SAMPLE_DAYS` of same-weekday history.
- Built on the same engine as the MCC edition, battle-tested on Omnicliq
  client accounts.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
