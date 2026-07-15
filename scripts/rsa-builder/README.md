# RSA Builder

Keeping ad copy consistent across dozens of ad groups is copy-paste drudgery,
and it shows: half the account runs last quarter's messaging. This script
builds responsive search ads from declared **ad frames** — reusable pools of
headlines and descriptions with pinning rules. Label an ad group with a
frame's name and the next run gives it a uniform RSA; update the frame, and
every labeled ad group gets the new copy on the next run.

## How it works

1. **Frames are copy templates.** Each `AD_FRAMES` entry declares pinned
   position-1/position-2 headlines, unpinned fill headlines, and
   descriptions. The entry's key doubles as the **ad group label** that
   selects where it's built — you assign work in the Google Ads UI, not in
   code.
2. **Idempotent by comparison.** An ad group whose enabled RSA already
   matches the frame exactly (texts and pinnings, order-insensitive) is left
   alone — reruns don't duplicate ads.
3. **URL inheritance.** The new ad takes the final URL and display paths
   from the ad group's existing enabled RSA — copy is uniform, landing pages
   stay per-ad-group. Ad groups without any enabled RSA are reported and
   skipped.
4. **Never destructive.** Old ads are never paused or removed; created ads
   get `RSA Builder: Created`, so retiring the old copy is a one-filter
   manual step when you're ready.

## Setup

1. In Google Ads: **Tools → Bulk actions → Scripts → +**, paste
   `rsa-builder.js`.
2. Declare your frames in `AD_FRAMES` (Google's limits are validated before
   anything runs: 3–15 headlines ≤30 chars, 2–4 descriptions ≤90 chars).
3. Create ad group labels named exactly like your frames and label the ad
   groups to build.
4. **Authorize and run with `PREVIEW_MODE: true`.** Read the plan in the
   logs — nothing is changed.
5. Set `PREVIEW_MODE: false` and run — or schedule it, turning the frames
   into continuously enforced copy standards.

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `PREVIEW_MODE` | `true` | Log the plan only; create nothing |
| `AD_FRAMES` | example | Frame name (= ad group label) → copy pools |
| `CREATED_LABEL` | `'RSA Builder: Created'` | Label on created ads |
| `CAMPAIGN_EXCLUDE_PATTERNS` | `DSA, SHOPPING, PMAX` | Campaigns to skip |
| `MAX_RUNTIME_MS` | 27 min | Safety stop before the 30-min script limit |

## Requirements & notes

- Works on a single account (not MCC-level).
- Each ad group needs one enabled RSA already (the URL source); brand-new
  ad groups need one manual ad first.
- Ad strength benefits from variety — frames enforce the *structure* (pinned
  brand line, pinned offer line), keep the fill headlines diverse.
- Check results with the [Account Health Audit](../account-health-audit/)'s
  `RSA_STRENGTH` check after a rollout.
- Distilled from Omnicliq's internal RSA builder (sheet-driven ad frames
  with sales/normal variants across client accounts); this standalone
  edition declares frames in CONFIG and adds strict pre-run validation.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
