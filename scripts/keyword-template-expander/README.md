# Keyword Template Expander

Accounts with a catalog dimension — brands, cities, models, materials — need
the same keyword pattern repeated dozens or hundreds of times: `buy {brand}
shoes` for every brand you carry, each pointing at the brand's landing page.
Building that by hand is slow; keeping it in sync as the catalog changes is
worse. This script does the expansion: mark template keywords with a label,
declare your value list once, and every template × value combination becomes a
real keyword with the placeholder substituted in both the text and the final
URL.

## How it works

1. **Templates are keywords** — labeled `SEED_LABEL` (default `Seed`), with
   `PLACEHOLDER` in their text and final URL, living in the ad group where
   the expansions belong. Keep them paused; they never serve, they're just
   the pattern. Example:
   - Text: `buy {brand} shoes` (phrase match)
   - URL: `https://shop.example.com/brands/{brand}`
2. **Expansion.** Each template is multiplied by the values: with `nike` the
   text becomes `buy nike shoes`, keeping the template's match type; the URL
   placeholder gets the value transformed per `URL_VALUE_TRANSFORM` —
   `slug` turns `New Balance` into `new-balance`.
3. **Dedup and audit.** Values already present as keywords in the ad group
   are skipped; created keywords get `CREATED_LABEL` for review or rollback.
4. **Catalog sync for free.** New values (or new templates) are picked up on
   the next scheduled run. Removing discontinued values' keywords is your
   call — filter by the label.

## Setup

1. In Google Ads: **Tools → Bulk actions → Scripts → +**, paste
   `keyword-template-expander.js`.
2. Create the `Seed` label and label your template keywords.
3. Fill `VALUES` — or maintain the list in the UI as a shared negative
   keyword list (used purely as a registry) and set `VALUES_LIST_NAME`.
4. **Authorize and run with `PREVIEW_MODE: true`.** Read the planned
   expansions in the logs — nothing is changed.
5. Set `PREVIEW_MODE: false` and schedule (daily).

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `PREVIEW_MODE` | `true` | Log expansions only; create nothing |
| `PLACEHOLDER` | `'{brand}'` | Token replaced in text and URL |
| `VALUES` | `[]` | The catalog dimension values |
| `VALUES_LIST_NAME` | `''` | Shared negative list used as registry |
| `SEED_LABEL` | `'Seed'` | Label marking template keywords |
| `CREATED_LABEL` | `'Template: Created'` | Label on created keywords |
| `URL_VALUE_TRANSFORM` | `'slug'` | `none`, `lowercase`, or `slug` for URLs |
| `CAMPAIGN_NAME_FILTER` | `''` | Only expand in matching campaigns |
| `MAX_RUNTIME_MS` | 27 min | Safety stop before the 30-min script limit |

## Requirements & notes

- Works on a single account (not MCC-level).
- Created keywords inherit the template's match type and land in the
  template's ad group.
- The script doesn't verify that the substituted landing pages exist — pair
  it with the [Landing Page Link Checker](../landing-page-link-checker/),
  which will catch and label any expansion whose page 404s.
- The internal Omnicliq edition gates expansion on externally verified brand
  URLs and files issues to our PM system; this standalone edition expands
  from your declared values and leaves URL health to the link checker.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
