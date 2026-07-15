# The DSA Layering Playbook

Most accounts run Dynamic Search Ads as one big catch-all campaign and hope
the negatives keep it honest. There is a better structure — we've run it
across client accounts for years — and the scripts in this repo automate its
maintenance. This page explains the architecture so the scripts make sense.

## The two layers

**Inner DSA** — a DSA ad group *inside* each keyword campaign, targeting
exactly the landing pages that campaign's keywords advertise. It catches the
long-tail phrasings your keywords miss, with the campaign's own budget,
location targeting and bid strategy — because a long-tail query about running
shoes belongs to the running shoes campaign, not to a generic catch-all.

**Outer DSA** — one (or one per market) catch-all DSA campaign targeting the
whole site. It discovers demand for pages no keyword campaign covers yet:
new categories, forgotten content, queries nobody predicted.

Traffic flows downhill: keywords serve what they know, inner DSA catches the
campaign's long tail, outer DSA catches everything else. Each layer must be
fenced off from the layers above it, or they cannibalise each other.

## The maintenance jobs (and their scripts)

| Job | Script |
|---|---|
| Keep each inner DSA ad group's webpage targets in sync with the campaign's keyword/ad landing pages | [Inner DSA Target Sync](../scripts/inner-dsa-target-sync/) |
| Fill the inner DSA ad groups with ads built from the campaign's own RSA copy | [Inner DSA Ad Creation](../scripts/inner-dsa-ad-creation/) |
| Stop the inner DSA cannibalising its own campaign's keywords (sparing DSA-cheaper and competitor terms) | [Inner DSA Search Term Fencing](../scripts/inner-dsa-search-term-fencing/) |
| Stop the outer DSA serving queries the keyword campaigns already own (unless DSA is cheaper) | [DSA Search Term Fencing](../scripts/dsa-search-term-fencing/) |
| Route queries between keyword ad groups themselves | [Cross Ad Group Query Fencing](../scripts/cross-adgroup-query-fencing/) |

The layering also relies on plain conventions the scripts read:

- **Naming.** Inner DSA ad groups carry a recognisable name marker
  (default `DSA`); the outer DSA campaigns carry it in the campaign name.
  Every script takes the patterns from CONFIG.
- **One inner DSA ad group per campaign.** Its webpage targets are URL
  lists, not rules — synced automatically, never hand-edited.

## Why not page feeds?

Page feeds are the right tool for the *outer* layer at scale. The inner
layer wants exact URL targets derived from what the campaign actually
advertises right now — which is precisely what the sync script maintains,
with additions and removals following your keywords automatically.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
