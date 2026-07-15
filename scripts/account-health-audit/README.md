# Account Health Audit

Accounts rot quietly. An ad gets disapproved, an ad group loses its last ad,
conversion tracking silently breaks, a campaign starves on budget — each one
invisible in the day-to-day until it has cost real money. This script is the
smoke detector: a battery of health checks over the whole account, on a
schedule, with one digest email of everything it finds. It changes nothing.

## The checks

| Check | Finding |
|---|---|
| `DISAPPROVED_ADS` | Enabled ads that are disapproved or approved-limited |
| `ADS_PER_AD_GROUP` | Ad groups with **no** enabled ads, or more than `MAX_ADS_PER_AD_GROUP` |
| `KEYWORDS_PER_AD_GROUP` | Keyword ad groups where **nothing is eligible to serve** (all paused or low search volume) |
| `RSA_STRENGTH` | Responsive search ads with `POOR` ad strength |
| `CONVERSION_TRACKING` | No conversions — or no conversion value, with `REQUIRE_CONVERSION_VALUE` — in the window |
| `LOST_BUDGET` | Campaigns losing more than `MAX_LOST_BUDGET_SHARE` of search impression share to budget |
| `ZERO_IMPRESSIONS` | Enabled campaigns with zero impressions in the window |
| `DISPLAY_SELECT` | Search campaigns also serving on the Display Network |
| `WRONG_DOMAIN` | Ad final URLs pointing outside `EXPECTED_DOMAINS` |

Every check can be switched off individually, and `CAMPAIGN_EXCLUDE_PATTERNS`
carves out campaigns that shouldn't be judged (e.g. deliberately paused
seasonal ones).

## Setup

1. In Google Ads: **Tools → Bulk actions → Scripts → +**, paste
   `account-health-audit.js`.
2. Edit `CONFIG` at the top:
   - `RECIPIENT_EMAILS` — who gets the digest.
   - `EXPECTED_DOMAINS` — your landing page domains, for `WRONG_DOMAIN`.
   - `REQUIRE_CONVERSION_VALUE` — on for e-commerce, off for lead gen.
   - Switch off checks that don't apply.
3. **Authorize and run with `PREVIEW_MODE: true`.** Read the findings in the
   logs — no email is sent.
4. Set `PREVIEW_MODE: false` and schedule **daily**.

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `PREVIEW_MODE` | `true` | Log findings only; send no email |
| `RECIPIENT_EMAILS` | `[]` | Digest recipients |
| `CHECKS.*` | all `true` | Per-check switches |
| `EXPECTED_DOMAINS` | `[]` | Allowed landing page domains (suffix match) |
| `LOOKBACK_DAYS` | `14` | Window for performance-based checks |
| `MAX_ADS_PER_AD_GROUP` | `5` | Upper bound before a finding |
| `MAX_LOST_BUDGET_SHARE` | `0.1` | Worst-day budget-lost IS tolerance |
| `REQUIRE_CONVERSION_VALUE` | `false` | Also demand conversion value |
| `CAMPAIGN_EXCLUDE_PATTERNS` | `[]` | Campaigns exempt from all checks |

## Requirements & notes

- Works on a single account (not MCC-level).
- Strictly read-only — it reports, you decide.
- Pairs well with the
  [Account Spend Anomaly Detector](../account-spend-anomaly-detector/):
  that one watches the money, this one watches the structure.
- The internal Omnicliq edition runs 24 checks including structure-specific
  ones (mirrored campaign parity, DSA layering) and files tasks to our PM
  system; this standalone edition ships the nine checks that apply to any
  account.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
