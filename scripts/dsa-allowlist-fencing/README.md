# DSA Allowlist Fencing

A branded campaign's DSA ad group has one job: catch brand-related queries the
keywords missed. But DSA doesn't know your brand list — it matches on pages,
so generic queries leak in and spend the branded budget on traffic that
belongs elsewhere. This script fences the DSA ad groups of your targeted
campaigns to an allowlist: search terms that do **not** contain any allowed
term become negative exact keywords in the ad group that matched them.

## How it works

1. **Targets ad groups by two patterns**: campaigns containing all
   `TARGET_CAMPAIGN_PATTERNS` entries (e.g. `['Brands']`), and inside them
   ad groups matching `DSA_ADGROUP_PATTERN`.
2. **Judges every search term** against the allowlist on word boundaries —
   `nike shoes` survives with `nike` allowed; `bikeatlas` doesn't make
   `ikea` match.
3. **Negates everything else** as `[exact match]` in its ad group, skipping
   terms already negated and Google's keyword length limits.
4. **The allowlist lives where you want it**: `ALLOWED_TERMS` in CONFIG,
   and/or a shared negative keyword list used purely as a registry
   (`ALLOWLIST_NAME`) so the team maintains it from the UI.

This is the ad-group-level sibling of
[Shopping Allowlist Fencing](../shopping-allowlist-fencing/), which fences
whole shopping campaigns at campaign level — same registry list works for
both.

## Setup

1. In Google Ads: **Tools → Bulk actions → Scripts → +**, paste
   `dsa-allowlist-fencing.js`.
2. Set `TARGET_CAMPAIGN_PATTERNS` and the allowlist (an empty allowlist is
   rejected at startup — it would negate every term).
3. **Authorize and run with `PREVIEW_MODE: true`.** Read the execution
   summary in the logs — nothing is changed.
4. Set `PREVIEW_MODE: false` and schedule (weekly).

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `PREVIEW_MODE` | `true` | Log what would happen; write nothing |
| `TARGET_CAMPAIGN_PATTERNS` | `['Brands']` | Campaign must contain ALL patterns |
| `DSA_ADGROUP_PATTERN` | `'DSA'` | Name substring of the fenced ad groups |
| `ALLOWED_TERMS` / `ALLOWLIST_NAME` | `[]` / `''` | The allowlist (CONFIG and/or shared-list registry) |
| `LOOKBACK_DAYS` | `30` | Analysis window, ending yesterday |
| `MIN_SEARCH_TERM_IMPRESSIONS` | `5` | Noise floor |
| `MAX_TERM_WORDS` / `MAX_TERM_CHARS` | `10` / `80` | Google Ads keyword limits |
| `MAX_RUNTIME_MS` | 27 min | Safety stop before the 30-min script limit |

## Requirements & notes

- Works on a single account (not MCC-level).
- The script only **adds** negatives; allowlist growth doesn't retroactively
  unfence terms.
- Built and battle-tested on Omnicliq client accounts (as the branded DSA
  fence); this standalone edition generalises the campaign/ad group patterns
  and the allowlist registry, and upgrades matching from substring to word
  boundaries.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
