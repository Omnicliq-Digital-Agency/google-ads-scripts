# PMax Non-Converting Search Terms

Performance Max is a black box exactly where it hurts: which searches eat the budget without converting. The data exists — Google exposes PMax search terms through **search term insights** — but the UI buries it per campaign, per category, unrankable. This script digs it all out: every PMax search term with real clicks and no conversions, ranked worst-first, in a spreadsheet, with an email alert — ready to become negative keywords.

## How it works

1. For each enabled PMax campaign, fetches the search term insight categories that cleared `MIN_CLICKS`, then expands each category into its individual terms.
2. Flags terms with at least `MIN_CLICKS` clicks and conversions below `CONVERSION_THRESHOLD` (0.5 by default — tolerates fractional attribution noise).
3. Writes the ranked list to a dated spreadsheet tab and emails the top offenders with a link.
4. Insight queries are slow on large accounts — a runtime guard ships the report with whatever was analysed and tells you how to tighten the scope.

**Read-only**: PMax negatives are managed through account-level negative keyword lists — the report is the paste-ready input.

## Setup

1. In Google Ads: **Tools → Bulk actions → Scripts → +**, paste the script.
2. First run with empty `SPREADSHEET_URL` creates the sheet (URL in the logs — pin it in CONFIG).
3. Fill `RECIPIENT_EMAILS`, schedule **weekly**.

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `SPREADSHEET_URL` | `''` | Report spreadsheet (auto-created when empty) |
| `RECIPIENT_EMAILS` | `[]` | Alert recipients |
| `LOOKBACK_DAYS` | `90` | Analysis window — PMax conversion lag is long |
| `MIN_CLICKS` | `50` | Clicks floor before a term is judged |
| `CONVERSION_THRESHOLD` | `0.5` | Below this many conversions = flagged |
| `CAMPAIGN_NAME_FILTER` | `''` | Only matching PMax campaigns |
| `MAX_RUNTIME_MS` | 25 min | Runtime guard for slow insight queries |

## Requirements & notes

- Works on a single account (not MCC-level).
- Uses the `campaign_search_term_insight` GAQL resource — newer surface; verify on your account with a preview run first.
- Pairs with the [PMax Placement Audit](../pmax-placement-audit/): that shows *where* PMax served, this shows *which searches* it wasted budget on.
- A companion piece built for this collection in the same style as our long-running internal scripts.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
