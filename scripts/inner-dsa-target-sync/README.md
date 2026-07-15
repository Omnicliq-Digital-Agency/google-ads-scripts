# Inner DSA Target Sync

Part of the [DSA Layering playbook](../../docs/DSA-LAYERING.md): every keyword
campaign carries one **inner DSA ad group** targeting exactly the landing
pages the campaign's keywords advertise — catching the campaign's long-tail
queries with the campaign's own budget, geo targeting and bid strategy. That
only works while the DSA ad group's webpage targets mirror the campaign's
real landing pages, and keywords change weekly. This script keeps the mirror,
automatically.

## How it works

1. **Finds the inner DSA ad groups** — ad groups matching
   `DSA_ADGROUP_PATTERN` inside keyword campaigns (outer DSA campaigns are
   excluded by campaign name).
2. **Derives each campaign's landing page set** from its keywords' final
   URLs (query strings stripped); campaigns whose keywords carry no URLs
   fall back to the ads' final URLs.
3. **Reconciles**: missing URLs become positive webpage targets
   (`URL EQUALS`); with `REMOVE_STALE_TARGETS`, targets whose URL is no
   longer advertised are removed. URLs blocked by a negative webpage target
   are left alone — the negative was put there for a reason.
4. **One bulk mutate** with partial failure — a single bad URL doesn't sink
   the run; failures are counted and logged.

## Setup

1. In Google Ads: **Tools → Bulk actions → Scripts → +**, paste
   `inner-dsa-target-sync.js`.
2. Make sure `DSA_ADGROUP_PATTERN` matches your inner DSA ad group naming
   and `CAMPAIGN_EXCLUDE_PATTERNS` covers your outer DSA campaigns.
3. **Authorize and run with `PREVIEW_MODE: true`.** Read the planned `+`/`-`
   lines in the logs — nothing is changed.
4. Set `PREVIEW_MODE: false` and schedule (daily or weekly, matching how
   often your keywords change).

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `PREVIEW_MODE` | `true` | Log the plan only; change nothing |
| `DSA_ADGROUP_PATTERN` | `'DSA'` | Name substring of inner DSA ad groups |
| `CAMPAIGN_EXCLUDE_PATTERNS` | `DSA, SHOPPING, PMAX` | Campaigns skipped entirely |
| `REMOVE_STALE_TARGETS` | `true` | Remove targets no longer advertised |
| `INCLUDE_PAUSED_SOURCES` | `false` | Count paused keywords/ads as sources |

## Requirements & notes

- Works on a single account (not MCC-level).
- Requires the inner-DSA structure: a DSA ad group per keyword campaign,
  named per the pattern. See the
  [playbook](../../docs/DSA-LAYERING.md) for why and how.
- Complements [DSA Search Term Fencing](../dsa-search-term-fencing/): this
  script controls *where* the inner DSA serves, the fencing controls *which
  queries* it may keep.
- Battle-tested on Omnicliq client accounts; this standalone edition uses
  configurable naming patterns and the modern `AdsApp.mutateAll` bulk API.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
