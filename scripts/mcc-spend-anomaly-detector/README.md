# MCC Spend Anomaly Detector

A campaign that stops spending — or spends triple — rarely announces itself.
Usually you find out days later, in a budget report or a client email. This
MCC-level script checks every account's spend **today** against that account's
own history and emails you the same day the pattern breaks, in either
direction.

## How it works

1. **Like-for-like comparison.** Weekend spend patterns differ from weekdays,
   and mornings differ from evenings — so today (say, a Monday at 14:00) is
   compared only against previous Mondays, and only their spend up to the
   same hour (minus `DATA_DELAY_HOURS`, because Google's spend data lags a
   few hours).
2. **Statistical range, per account.** The previous `LOOKBACK_WEEKS`
   same-weekdays form a sample; its mean and sample standard deviation define
   the expected range: `mean ± STD_DEV_MULTIPLIER × stddev`.
3. **Deviation floor.** `MIN_STD_DEV` (in account currency) puts a floor
   under the deviation, so low-spend accounts with naturally tiny variance
   don't alert over pocket change.
4. **One digest email per run** listing every over- and under-spending
   account with its actual spend and expected range — not thirty separate
   emails on a bad morning.

Accounts with fewer than `MIN_SAMPLE_DAYS` comparable days are skipped and
counted in the execution summary, as are runs too early in the day to have
comparable hours.

## Setup

1. In your **manager account (MCC)**: **Tools → Bulk actions → Scripts → +**,
   paste `mcc-spend-anomaly-detector.js`. The script must run at MCC level.
2. Edit `CONFIG` at the top:
   - `RECIPIENT_EMAILS` — who gets the digest.
   - `ACCOUNT_LABEL` — optionally restrict to accounts with this MCC label.
   - `MIN_STD_DEV` — set to what "pocket change" means in your accounts'
     currency.
3. **Authorize and run with `PREVIEW_MODE: true`.** Read the per-account
   verdicts and the execution summary in the logs — no email is sent.
4. Set `PREVIEW_MODE: false` and schedule **hourly** (the check is cheap;
   hourly runs catch anomalies the same morning they start).

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `PREVIEW_MODE` | `true` | Log verdicts only; send no email |
| `RECIPIENT_EMAILS` | `[]` | Digest recipients |
| `ACCOUNT_LABEL` | `''` | Only check accounts with this MCC label (empty = all) |
| `LOOKBACK_WEEKS` | `12` | Same-weekday history window |
| `MIN_SAMPLE_DAYS` | `5` | Minimum comparable days to check an account |
| `DATA_DELAY_HOURS` | `3` | Hours excluded from 'now' for data lag |
| `STD_DEV_MULTIPLIER` | `2` | Width of the expected range |
| `MIN_STD_DEV` | `10` | Deviation floor, in account currency |
| `MAX_RUNTIME_MS` | 27 min | Safety stop before the 30-min script limit |

## Requirements & notes

- **MCC-level script** — it will refuse to run in a single account.
- Purely observational: reads spend, sends email, changes nothing in any
  account.
- Today's spend comes from account stats (all hours so far) while history is
  cut at the delay-shifted hour — during the first hours of the day the
  comparison is naturally rougher; `MIN_STD_DEV` absorbs most of that noise.
- Each account is evaluated in its own time zone and currency.
- Built and battle-tested on Omnicliq client accounts; this is the standalone
  public edition (the internal version also watches Meta and TikTok spend
  through their APIs).

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
