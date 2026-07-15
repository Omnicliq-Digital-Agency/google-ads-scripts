# Duplicate Keywords Report

The same keyword in two ad groups splits its own history: two Quality Scores, two ad tests, Google picking the entry point per auction. Duplicates accumulate through restructures and bulk uploads, and nobody audits for them by hand. This script finds every keyword text + match type living in more than one enabled ad group, compares the copies side by side, and recommends the survivor.

## How it works

1. Keywords are normalised (lowercase, whitespace collapsed) and grouped by text + match type across enabled campaigns.
2. Groups with 2+ members are duplicates; the recommended survivor (`KEEP`) has the most conversions, then clicks, then the lower cost — the rest are marked `review`.
3. `SAME_CAMPAIGN_ONLY` restricts reporting to duplicates within one campaign (cross-campaign duplication is sometimes deliberate geo/brand structure).

**Read-only** — consolidation is a restructure decision.

## Setup

Paste, run, read the duplicate groups. Schedule monthly, fill `RECIPIENT_EMAILS`.

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `RECIPIENT_EMAILS` | `[]` | Digest recipients |
| `LOOKBACK_DAYS` | `90` | Performance comparison window |
| `SAME_CAMPAIGN_ONLY` | `false` | Only intra-campaign duplicates |
| `CAMPAIGN_EXCLUDE_PATTERNS` | `DSA, SHOPPING, PMAX` | Campaigns to skip |

## Requirements & notes

- Single account. Complements [Cross Ad Group Query Fencing](../cross-adgroup-query-fencing/): that routes *search terms*, this audits the *keywords themselves*.
- A companion piece built for this collection in the same style as our long-running internal scripts.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
