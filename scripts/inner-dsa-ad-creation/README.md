# Inner DSA Ad Creation

Part of the [DSA Layering playbook](../../docs/DSA-LAYERING.md): a DSA ad
group without ads serves nothing, and writing DSA descriptions per campaign
by hand doesn't scale. It doesn't need to — the campaign's responsive search
ads already carry proven copy. This script fills every inner DSA ad group
with dynamic search ads built from the campaign's own RSA descriptions.

## How it works

1. **Harvests copy per campaign**: the campaign's RSAs contribute their
   distinct descriptions in order of appearance; `DESCRIPTION_PICKS`
   selects which two become the DSA's lines (default the 3rd and 4th — in
   our structure the first two are offer lines that age badly, the later
   ones are evergreen).
2. **Creates the ads in both line orders** (`CREATE_BOTH_ORDERS`) — a free
   A/B test of description order, resolved by Google's rotation.
3. **Mirrors status**: the new ads are `ENABLED` when at least half the
   source RSAs are enabled, `PAUSED` otherwise — a paused campaign variant
   doesn't get an active DSA.
4. **Optional copy variants** (`VARIANT_LABELS`): label your RSAs (e.g.
   `Ad Text: Sales` / `Ad Text: Normal`) and each variant yields its own
   DSA pair, mirroring its own variant's majority status.
5. **Idempotent**: ad groups whose existing DSA ads already carry a planned
   description pair are skipped; all creations go through one bulk mutate
   with partial failure.

## Setup

1. In Google Ads: **Tools → Bulk actions → Scripts → +**, paste
   `inner-dsa-ad-creation.js`.
2. Make sure `DSA_ADGROUP_PATTERN` matches your inner DSA ad group naming
   and `CAMPAIGN_EXCLUDE_PATTERNS` covers your outer DSA campaigns.
3. **Authorize and run with `PREVIEW_MODE: true`.** Read the planned ads in
   the logs — nothing is changed.
4. Set `PREVIEW_MODE: false` and run — or schedule it so new campaigns get
   their DSA ads automatically.

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `PREVIEW_MODE` | `true` | Log the plan only; create nothing |
| `DSA_ADGROUP_PATTERN` | `'DSA'` | Name substring of inner DSA ad groups |
| `CAMPAIGN_EXCLUDE_PATTERNS` | `DSA, SHOPPING, PMAX` | Campaigns skipped entirely |
| `DESCRIPTION_PICKS` | `[3, 4]` | Which distinct RSA descriptions become the DSA lines |
| `CREATE_BOTH_ORDERS` | `true` | Also create the reversed-order ad |
| `VARIANT_LABELS` | `[]` | RSA labels splitting copy into variants |
| `MIRROR_SOURCE_STATUS` | `true` | New ads follow source RSAs' majority status |

## Requirements & notes

- Works on a single account (not MCC-level).
- Requires the inner-DSA structure — see the
  [playbook](../../docs/DSA-LAYERING.md). The complete suite:
  [Target Sync](../inner-dsa-target-sync/) (where it serves) →
  **Ad Creation** (what it says) →
  [Fencing](../inner-dsa-search-term-fencing/) (which queries it keeps).
- Campaigns with fewer distinct RSA descriptions than the picked positions
  are reported and skipped — write more RSA copy first.
- Battle-tested on Omnicliq client accounts; this standalone edition
  generalises the internal sales/normal split into configurable variant
  labels and configurable description picks.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
