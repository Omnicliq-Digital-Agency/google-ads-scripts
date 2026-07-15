# Search Term N-Gram Analyzer

Your search term report shows queries one by one — thousands of rows, each too
small to judge. The patterns live one level up: the word "cheap" appearing in
400 different queries with terrible conversion rates, or "buy" quietly
carrying half your revenue. This script breaks every search term into n-grams
(single words, pairs, triples), sums the performance of every query containing
each n-gram, and writes the ranked analysis to a spreadsheet — the fastest
route to negative keyword ideas and bid insights you can't see query-by-query.

## How it works

1. **Collects search terms** over the lookback window (default 90 days) with
   clicks, impressions, cost, conversions and conversion value.
2. **Builds n-grams** of the sizes you choose (`MIN`/`MAX_NGRAM_LENGTH`) —
   each query counts once per distinct n-gram it contains.
3. **Aggregates and derives**: Queries, Clicks, Impressions, Cost,
   Conversions, Conv. value, plus CTR, CPC, Conv. rate, Cost/conv. and ROAS.
4. **Writes one tab per n-gram size and level** (account-wide and per
   campaign), sorted by cost — the expensive patterns surface first.
   Thresholds keep the long tail out of the sheets.

Read it like this: sort by cost, scan for high-cost/zero-conversion n-grams →
negative keyword candidates. Then sort by ROAS for expansion candidates.

## Setup

1. In Google Ads: **Tools → Bulk actions → Scripts → +**, paste
   `search-term-ngram-analyzer.js`.
2. First run: leave `SPREADSHEET_URL` empty — the script creates the
   spreadsheet and logs its URL. Paste that URL into `SPREADSHEET_URL` so
   later runs reuse it.
3. Schedule **weekly**. The script is read-only in the account — it only
   writes to the spreadsheet (and optionally emails its URL).

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `SPREADSHEET_URL` | `''` | Output spreadsheet (auto-created when empty) |
| `RECIPIENT_EMAILS` | `[]` | Email the spreadsheet URL after each run |
| `LOOKBACK_DAYS` | `90` | Analysis window, ending yesterday |
| `MIN_NGRAM_LENGTH` / `MAX_NGRAM_LENGTH` | `1` / `2` | N-gram sizes (3 = triples) |
| `LEVELS.ACCOUNT` / `LEVELS.CAMPAIGN` | `true` / `true` | Which breakdowns to write |
| `THRESHOLDS.*` | `2 queries, 10 impressions` | Floor for a row to be written |
| `CAMPAIGN_EXCLUDE_PATTERNS` | `SHOPPING, PMAX` | Campaigns to skip |
| `INCLUDE_PAUSED` | `false` | Include paused campaigns/ad groups |

## Requirements & notes

- Works on a single account (not MCC-level).
- Strictly read-only in the account.
- Big accounts with `MAX_NGRAM_LENGTH: 3` can produce large sheets — raise
  the thresholds before lowering them.
- Findings feed naturally into the fencing scripts in this repo:
  [Competitor Query Fencing](../competitor-query-fencing/) for competitor
  terms and negative-keyword workflows for the rest.
- Omnicliq has run n-gram analyses across client accounts for years (the
  internal edition also n-grams ad copy from our warehouse); this standalone
  edition analyses search terms fully in-script.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
