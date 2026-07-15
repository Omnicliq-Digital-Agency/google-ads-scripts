# Shopping Allowlist Fencing

A themed shopping campaign — brand terms, a product line, a category — only
stays themed if you keep fencing it. Product ads match whatever Google decides
is relevant, so off-theme queries leak in daily and drag the campaign's ROAS
with them. This script automates the fence: every search term that doesn't
match your allowlist becomes a negative exact keyword. And because fences like
this grow into the thousands, it handles capacity too — when the campaign's
negative keyword limit fills up, the overflow goes into auto-created shared
negative keyword lists attached to the same campaigns.

## How it works

1. **Targets campaigns by name.** A shopping campaign whose name contains all
   `TARGET_CAMPAIGN_PATTERNS` entries is fenced.
2. **Judges every search term** in the lookback window against the allowlist:
   - `CONTAINS` mode (default): a term survives when it contains any
     allowlist entry on word boundaries — `nike shoes` survives with `nike`
     allowed.
   - `EXACT` mode: a term survives only when it equals an entry — the strict
     fence for pure brand-search campaigns.
3. **Negates everything else** as `[exact match]` on the campaign — or, once
   the campaign's `CAMPAIGN_NEGATIVE_CAPACITY` is reached, on
   `'<PREFIX> (n)'` shared lists that the script creates, fills, and attaches
   automatically.
4. **The allowlist lives where you want it**: in `ALLOWED_TERMS`, and/or a
   shared negative keyword list used purely as a registry
   (`ALLOWLIST_NAME`) so the team maintains it from the UI.

## Setup

1. In Google Ads: **Tools → Bulk actions → Scripts → +**, paste
   `shopping-allowlist-fencing.js`.
2. Edit `CONFIG` at the top:
   - `TARGET_CAMPAIGN_PATTERNS` — e.g. `['SHOPPING', 'Brands']`.
   - The allowlist (`ALLOWED_TERMS` or `ALLOWLIST_NAME`) and `MATCH_MODE`.
3. **Authorize and run with `PREVIEW_MODE: true`.** Read the execution summary
   in the logs — nothing is changed in the account.
4. Set `PREVIEW_MODE: false` and schedule (daily or weekly).

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `PREVIEW_MODE` | `true` | Log what would happen; write nothing |
| `TARGET_CAMPAIGN_PATTERNS` | `['SHOPPING', 'Brands']` | Campaign must contain ALL patterns |
| `ALLOWED_TERMS` | `[]` | Allowlist entries in the script |
| `ALLOWLIST_NAME` | `''` | Shared negative list used as registry |
| `MATCH_MODE` | `'CONTAINS'` | `CONTAINS` (word-boundary) or `EXACT` |
| `OVERFLOW_LIST_PREFIX` | `'Allowlist Fence'` | Names of auto-created lists |
| `CAMPAIGN_NEGATIVE_CAPACITY` | `10000` | Campaign negative keyword budget |
| `LIST_CAPACITY` | `5000` | Shared list keyword budget |
| `LOOKBACK_DAYS` | `30` | Analysis window, ending yesterday |
| `MIN_SEARCH_TERM_IMPRESSIONS` | `1` | Noise floor |
| `MAX_TERM_WORDS` / `MAX_TERM_CHARS` | `10` / `80` | Google Ads keyword limits |
| `MAX_RUNTIME_MS` | 27 min | Safety stop before the 30-min script limit |

## Requirements & notes

- Works on a single account (not MCC-level).
- **Configure the allowlist before unpausing preview mode** — an empty
  allowlist is rejected at startup because it would negate every term.
- Google caps shared negative lists per account (currently 20); the overflow
  mechanism respects list capacity but very large fences eventually meet that
  account-level cap.
- The script only **adds** negatives; pruning the fence after a theme change
  is a manual decision.
- Built and battle-tested on Omnicliq client accounts since 2022 (as the
  brand-shopping fence); this standalone edition generalises the allowlist.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
