# Cross Ad Group Query Fencing

When the same search query serves from two ad groups, they compete against
each other: the query's performance data splits, the less relevant ad often
wins the auction, and neither ad group accumulates clean history. This script
routes every shared query to a single owner — the ad group whose trigger
keyword is most similar to the query — and fences it off everywhere else with
a negative exact keyword.

## How it works

1. **Collects search terms with their trigger keywords** per ad group over
   the lookback window, above a clicks floor.
2. **Detects conflicts** — terms serving from two or more ad groups.
3. **Picks the owner** by similarity between each ad group's trigger keyword
   and the term (word-order-insensitive Levenshtein). Ties break by clicks,
   then conversions.
4. **Fences the losers** with `[term]` negative exacts — except where the
   term earned more than `MAX_CLICKS_AUTO_FENCE` clicks: rerouting that much
   traffic is a human decision, so those land in the digest for manual
   review instead.

## Setup

1. In Google Ads: **Tools → Bulk actions → Scripts → +**, paste
   `cross-adgroup-query-fencing.js`.
2. Review `CONFIG` — the defaults are sane for most accounts; consider
   raising `MIN_QUERY_CLICKS` on large accounts.
3. **Authorize and run with `PREVIEW_MODE: true`.** Read the conflicts,
   winners and planned negatives in the logs — nothing is changed.
4. Set `PREVIEW_MODE: false` and schedule (weekly).

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `PREVIEW_MODE` | `true` | Log what would happen; write nothing |
| `RECIPIENT_EMAILS` | `[]` | Digest of fenced + manual-review conflicts |
| `LOOKBACK_DAYS` | `30` | Analysis window, ending yesterday |
| `MIN_QUERY_CLICKS` | `2` | Clicks floor per (term, ad group) |
| `MAX_CLICKS_AUTO_FENCE` | `50` | Above this, report instead of fence |
| `CAMPAIGN_EXCLUDE_PATTERNS` | `SHOPPING, PMAX, DSA` | Campaigns to skip |
| `MAX_TERM_WORDS` / `MAX_TERM_CHARS` | `10` / `80` | Google Ads keyword limits |
| `MAX_RUNTIME_MS` | 27 min | Safety stop before the 30-min script limit |

## Requirements & notes

- Works on a single account (not MCC-level).
- Negatives are always **exact match on the specific query** — precise by
  design; the script never guesses broader phrase negatives.
- The script only **adds** negatives; if you restructure ad groups, prune
  old fences manually.
- Complements the other fencing scripts in this repo:
  [DSA fencing](../dsa-search-term-fencing/) handles DSA vs keywords,
  [exact-to-phrase](../exact-to-phrase-negative-sync/) handles mirrored
  campaigns — this one handles keyword ad groups against each other.
- Modernised from Omnicliq's inter-ad-group fencer that ran on client
  accounts for years (rewritten from the deprecated AWQL reporting API to
  GAQL; the fragile broad-negative guessing was replaced by always-exact
  negatives, which the original fell back to anyway).

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
