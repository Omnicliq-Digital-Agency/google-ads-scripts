# Ad Schedule Heatmap

Bid adjustments by hour and day are guesses until you've seen the heatmap:
which hours spend money, which hours convert, and — the cell that matters —
which hours spend *without* converting. Google's UI gives you hourly OR daily
breakdowns; the 7×24 picture you actually schedule around isn't a report you
can click to. This script builds it.

## How it works

1. **Aggregates** the lookback window (default 8 weeks, enough to smooth the
   weekday mix) by day-of-week × hour across your enabled campaigns.
2. **Writes one matrix tab per metric** — Cost, Conversions, Conv. value,
   Clicks, and the derived Cost per conv. — days as rows, hours as columns.
3. **Shades every cell** relative to the metric's maximum: white → deep green
   (Cost per conv. inverts — expensive hours go red), so the pattern reads
   from across the room.

Read it like this: **dark Cost + light Conversions = negative bid adjustment
candidates**; the reverse = hours to protect when budgets tighten.

## Setup

1. In Google Ads: **Tools → Bulk actions → Scripts → +**, paste
   `ad-schedule-heatmap.js`.
2. First run: leave `SPREADSHEET_URL` empty — the script creates the
   spreadsheet and logs its URL. Paste that URL into `SPREADSHEET_URL`.
3. Open the sheet and look for the dark-cost/light-conversion hours.
4. Schedule **weekly**. The script is read-only in the account — turning the
   picture into ad schedule bid adjustments is deliberately left to you.

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `SPREADSHEET_URL` | `''` | Output spreadsheet (auto-created when empty) |
| `RECIPIENT_EMAILS` | `[]` | Email the spreadsheet URL after each run |
| `LOOKBACK_DAYS` | `56` | Aggregation window, ending yesterday |
| `CAMPAIGN_NAME_FILTER` | `''` | Only campaigns containing this substring |
| `CAMPAIGN_EXCLUDE_PATTERNS` | `[]` | Campaigns to skip |

## Requirements & notes

- Works on a single account (not MCC-level).
- Strictly read-only in the account; writes only to its spreadsheet.
- Hours follow the account's time zone (Google segments reports that way).
- Smart Bidding already adjusts by time — the heatmap is still the fastest
  way to *see* what it's doing, and the decision layer for accounts on
  manual or tCPA-with-adjustments setups.
- A companion piece built for this collection in the same style as our
  long-running internal scripts.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
