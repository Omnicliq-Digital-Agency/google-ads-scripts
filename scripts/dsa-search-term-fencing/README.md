# DSA Search Term Fencing

Dynamic Search Ads are great at finding queries you didn't think of — and just
as good at quietly taking over queries your keyword campaigns already serve.
When both serve the same term you pay twice to compete with yourself, and the
term's data splits across campaigns. This script fences the DSA side
automatically, with one pragmatic exception: **if DSA gets the term at a
cheaper CPC, DSA keeps it.**

## How it works

1. **Collects search terms from both sides** over the lookback window: DSA
   campaigns (matched by `DSA_CAMPAIGN_PATTERN` in the name) and keyword
   campaigns (everything else, minus `CAMPAIGN_EXCLUDE_PATTERNS`).
2. **Groups by targeted country** (`GROUP_BY_COUNTRY`) so a Greek and a
   Cypriot campaign can share terms without fencing each other. Single-market
   accounts can turn this off and skip the geo lookups.
3. **Compares CPCs on overlapping terms.** A term served by both sides is
   fenced only when the keyword side's average CPC is equal or better; terms
   without comparable CPCs on both sides are left alone.
4. **Adds negative exact keywords** (`[term]`) to every DSA ad group that
   matched the term, skipping ones already fenced.

## Setup

1. In Google Ads: **Tools → Bulk actions → Scripts → +**, paste
   `dsa-search-term-fencing.js`.
2. Edit `CONFIG` at the top:
   - `DSA_CAMPAIGN_PATTERN` — the substring identifying your DSA campaigns.
   - `GROUP_BY_COUNTRY` — leave on for multi-market accounts.
   - `MIN_SEARCH_TERM_IMPRESSIONS` — noise floor for keyword-side terms.
3. **Authorize and run with `PREVIEW_MODE: true`.** Read the execution summary
   in the logs — nothing is changed in the account.
4. Set `PREVIEW_MODE: false` and schedule (weekly fits search term data
   freshness well).

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `PREVIEW_MODE` | `true` | Log what would happen; write nothing |
| `DSA_CAMPAIGN_PATTERN` | `'DSA'` | Name substring of DSA campaigns |
| `CAMPAIGN_EXCLUDE_PATTERNS` | `SHOPPING, PMAX` | Keyword-side campaigns to ignore |
| `LOOKBACK_DAYS` | `30` | Analysis window, ending yesterday |
| `MIN_SEARCH_TERM_IMPRESSIONS` | `10` | Noise floor for keyword-side terms |
| `GROUP_BY_COUNTRY` | `true` | Only fence within the same targeted country |
| `MAX_TERM_WORDS` / `MAX_TERM_CHARS` | `10` / `80` | Google Ads keyword limits |
| `MAX_RUNTIME_MS` | 27 min | Safety stop before the 30-min script limit |

## Requirements & notes

- Works on a single account (not MCC-level).
- DSA campaigns are recognised by name — a naming convention is required.
- Campaigns targeting several countries are grouped under their first
  location target's country.
- The script only **adds** negatives; removing a fence (e.g. after pausing
  the keyword) is a manual or separate-routine decision.
- Built and battle-tested on Omnicliq client accounts since 2022; this is the
  standalone public edition.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
