# URL-Matched Price Extensions

Price extensions lift CTR — Google shows them under your ad with real prices,
making the ad bigger and more concrete. But maintaining them by hand across
dozens of ad groups is the chore that quietly stops happening, and stale
prices are worse than none. This script maintains them automatically: declare
your price sets once, keyed by landing page, and every ad group advertising
that page keeps an up-to-date price extension.

## How it works

1. **Matches by URL.** Each enabled ad group's responsive search ad final URL
   (query string ignored) is looked up in `CONFIG.PRICE_SETS`.
2. **Creates or diff-updates.** A matched ad group gets its price extension
   created — or, if one exists, updated **in place**: unchanged items are
   left alone (preserving the extension's performance history), changed items
   are replaced, stale items are removed, missing ones added.
3. **Respects Google's 3–8 items rule.** Sets that shrink below 3 items
   remove the extension entirely until they grow back; sets are capped at 8.
4. **Touches nothing else.** Ad groups whose URL matches no price set are
   left exactly as they are.

## Setup

1. In Google Ads: **Tools → Bulk actions → Scripts → +**, paste
   `url-matched-price-extensions.js`.
2. Edit `CONFIG.PRICE_SETS` — one entry per landing page, each with `TYPE`
   (SERVICES, PRODUCT_CATEGORIES, LOCATIONS, BRANDS, EVENTS, …), `LANGUAGE`,
   `CURRENCY` and 3–8 `ITEMS`. If your prices live in a feed or spreadsheet,
   generate this block from it.
3. **Authorize and run with `PREVIEW_MODE: true`.** Read the per-ad-group
   outcomes and the execution summary in the logs — nothing is changed.
4. Set `PREVIEW_MODE: false` and schedule (daily, or as often as your prices
   change).

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `PREVIEW_MODE` | `true` | Log outcomes only; change nothing |
| `PRICE_SETS` | example | Landing page URL → price extension definition |
| `CAMPAIGN_NAME_FILTER` | `''` | Only campaigns containing this substring |
| `CAMPAIGN_EXCLUDE_PATTERNS` | `DSA, SHOPPING, PMAX` | Campaigns to skip |
| `MAX_RUNTIME_MS` | 27 min | Safety stop before the 30-min script limit |

## Requirements & notes

- Works on a single account (not MCC-level).
- Headers are validated against Google's 25-character limit before anything
  runs; misconfigured sets fail fast with a clear error.
- Update-in-place is deliberate: rebuilding an extension resets its
  performance history, so the script only rebuilds when it must (no extension
  yet, or duplicates).
- Built and battle-tested on Omnicliq client accounts (the internal edition
  feeds live prices from BigQuery); this standalone edition is CONFIG-driven.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
