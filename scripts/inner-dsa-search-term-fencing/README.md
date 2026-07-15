# Inner DSA Search Term Fencing

Part of the [DSA Layering playbook](../../docs/DSA-LAYERING.md): the inner
DSA ad group inside each keyword campaign earns its keep on queries the
keywords *don't* cover. When a query serves from both the keyword ad groups
and the inner DSA, the DSA is cannibalising, not catching. This script fences
it — with two deliberate exceptions where the DSA keeps the term.

## How it works

1. **Collects search terms from both sides** of each campaign: the inner DSA
   ad groups (matched by `DSA_ADGROUP_PATTERN` in the ad group name) and the
   keyword ad groups, over the lookback window. `GROUP_BY_COUNTRY` scopes
   overlaps to same-country campaigns.
2. **Fences overlapping terms** as negative exacts (`[term]`) in every inner
   DSA ad group that matched them — except:
   - **Cheaper in DSA** — the inner DSA gets the term at a lower CPC than
     the keyword side, so it keeps it.
   - **Competitor terms** — queries containing a competitor brand
     (word-boundary matched, registry in `COMPETITORS` and/or a shared
     negative keyword list) stay with the DSA: keyword campaigns don't bid
     on competitors, so the inner DSA is exactly where that traffic belongs.
3. **Skips** terms already negated per ad group, over Google's keyword
   length limits, or without comparable CPCs.

## Setup

1. In Google Ads: **Tools → Bulk actions → Scripts → +**, paste
   `inner-dsa-search-term-fencing.js`.
2. Make sure `DSA_ADGROUP_PATTERN` matches your inner DSA ad group naming
   and `CAMPAIGN_EXCLUDE_PATTERNS` covers your outer DSA campaigns.
3. Optionally point `COMPETITOR_LIST_NAME` at your competitor registry list.
4. **Authorize and run with `PREVIEW_MODE: true`.** Read the execution
   summary in the logs — nothing is changed.
5. Set `PREVIEW_MODE: false` and schedule (weekly).

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `PREVIEW_MODE` | `true` | Log what would happen; write nothing |
| `DSA_ADGROUP_PATTERN` | `'DSA'` | Name substring of inner DSA ad groups |
| `CAMPAIGN_EXCLUDE_PATTERNS` | `DSA, SHOPPING, PMAX` | Campaigns skipped entirely |
| `COMPETITORS` / `COMPETITOR_LIST_NAME` | `[]` / `''` | Competitor registry (terms the DSA keeps) |
| `LOOKBACK_DAYS` | `30` | Analysis window, ending yesterday |
| `MIN_SEARCH_TERM_IMPRESSIONS` | `10` | Noise floor for keyword-side terms |
| `GROUP_BY_COUNTRY` | `true` | Only fence within the same targeted country |
| `MAX_TERM_WORDS` / `MAX_TERM_CHARS` | `10` / `80` | Google Ads keyword limits |
| `MAX_RUNTIME_MS` | 27 min | Safety stop before the 30-min script limit |

## Requirements & notes

- Works on a single account (not MCC-level).
- Requires the inner-DSA structure — see the
  [playbook](../../docs/DSA-LAYERING.md).
- The suite division of labour:
  [Inner DSA Target Sync](../inner-dsa-target-sync/) controls *where* the
  inner DSA serves, this script controls *which queries* it may keep, and
  [DSA Search Term Fencing](../dsa-search-term-fencing/) fences the outer
  catch-all campaigns.
- The script only **adds** negatives; competitor-registry changes don't
  retroactively unfence terms.
- Battle-tested on Omnicliq client accounts; this standalone edition makes
  the naming patterns and competitor registry configurable.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
