# Competitor Query Fencing

Unless you deliberately bid on competitor names, searches like
"competitor-brand + your product" are expensive clicks with terrible intent —
the searcher wants them, not you. Those queries slip in through phrase and
broad matching, one impression at a time, across every ad group, and negating
them by hand never keeps up. This script keeps up: every search term
containing a competitor brand becomes a negative exact keyword in the ad group
that matched it.

## How it works

1. **Competitor registry.** Names come from `CONFIG.COMPETITORS` and/or a
   shared negative keyword list you maintain in the UI
   (`COMPETITOR_LIST_NAME`) — the list doesn't need to be attached to any
   campaign; the script reads it as a registry, stripping match-type
   punctuation.
2. **Word-boundary matching.** `ikea` matches `ikea sofa` but not
   `bikeatlas` — plain substring matching would fence innocent queries.
3. **Respects intentional competitor campaigns.** Campaigns matching
   `COMPETITOR_CAMPAIGN_PATTERN` are skipped entirely — that's where you bid
   on competitors on purpose.
4. **Adds negative exact keywords** (`[term]`) per matched ad group, skipping
   terms already negated.

## Setup

1. In Google Ads: **Tools → Bulk actions → Scripts → +**, paste
   `competitor-query-fencing.js`.
2. Configure the registry: either fill `COMPETITORS` in the script, or create
   a shared negative keyword list (Tools → Shared library) with one
   competitor name per entry and set `COMPETITOR_LIST_NAME` — the list lets
   your team maintain names without touching code.
3. **Authorize and run with `PREVIEW_MODE: true`.** Read the execution summary
   in the logs — nothing is changed in the account.
4. Set `PREVIEW_MODE: false` and schedule (weekly).

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `PREVIEW_MODE` | `true` | Log what would happen; write nothing |
| `COMPETITORS` | `[]` | Competitor names, matched case-insensitively on word boundaries |
| `COMPETITOR_LIST_NAME` | `''` | Optional shared negative list used as name registry |
| `COMPETITOR_CAMPAIGN_PATTERN` | `['Competitor']` | Campaigns where you bid on competitors on purpose — skipped |
| `CAMPAIGN_EXCLUDE_PATTERNS` | `SHOPPING, PMAX, DSA` | Channels to skip |
| `LOOKBACK_DAYS` | `30` | Analysis window, ending yesterday |
| `MIN_SEARCH_TERM_IMPRESSIONS` | `1` | Noise floor |
| `MAX_TERM_WORDS` / `MAX_TERM_CHARS` | `10` / `80` | Google Ads keyword limits |
| `MAX_RUNTIME_MS` | 27 min | Safety stop before the 30-min script limit |

## Requirements & notes

- Works on a single account (not MCC-level).
- Multi-word competitor names are supported (`'brand x'` matches on the full
  phrase).
- The script only **adds** ad-group negatives; if you later start a
  competitor campaign, its pattern in `COMPETITOR_CAMPAIGN_PATTERN` stops new
  fencing there, but existing negatives are yours to clean up.
- Built and battle-tested on Omnicliq client accounts since 2022; this is the
  standalone public edition.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
