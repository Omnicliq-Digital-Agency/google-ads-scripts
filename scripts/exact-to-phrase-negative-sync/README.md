# Exact-to-Phrase Negative Sync

In a mirrored Exact/Phrase (alpha/beta) structure the Phrase campaign's job is
discovery — finding new queries. But without fencing, phrase keywords also
match the exact terms your Exact campaign already owns, splitting traffic
between the two and blurring your per-term data. This script builds the fence:
every serving keyword in an Exact campaign becomes a negative exact keyword in
its mirrored Phrase ad group, so exact traffic flows only through the Exact
side.

## How it works

1. **Pairs campaigns by name.** A campaign containing `EXACT_PATTERN` is
   paired with the campaign whose name swaps it for `PHRASE_PATTERN`:
   `Brand - Exact` ⟷ `Brand - PH`. Ad groups pair by having the same name in
   both campaigns.
2. **Collects the eligible exact keywords** — only from enabled campaigns and
   ad groups, only keywords with serving status `ELIGIBLE`. A keyword you
   pause on the Exact side stops being fenced, letting the Phrase side pick
   the traffic back up.
3. **Adds each keyword as a negative exact match** (`[keyword]`) to the pair
   Phrase ad group, unless it is already there.
4. **Reports unpaired campaigns/ad groups** in the execution summary so
   structural drift is visible too.

## Setup

1. In Google Ads: **Tools → Bulk actions → Scripts → +**, paste
   `exact-to-phrase-negative-sync.js`.
2. Edit `CONFIG` at the top:
   - `CAMPAIGNS.EXACT_PATTERN` / `PHRASE_PATTERN` — the naming convention that
     distinguishes your mirrors (e.g. `' - Exact'` / `' - PH'`).
   - `CAMPAIGNS.ADGROUP_EXCLUDE_PATTERNS` — ad groups to skip (e.g. DSA).
3. **Authorize and run with `PREVIEW_MODE: true`.** Read the execution summary
   in the logs — nothing is changed in the account.
4. When the previewed negatives look right, set `PREVIEW_MODE: false` and
   schedule the script (daily recommended — the fence should follow keyword
   changes closely).

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `PREVIEW_MODE` | `true` | Log what would happen; write nothing |
| `CAMPAIGNS.EXACT_PATTERN` | `' - Exact'` | Name substring of exact campaigns |
| `CAMPAIGNS.PHRASE_PATTERN` | `' - PH'` | Name substring of phrase campaigns |
| `CAMPAIGNS.ADGROUP_EXCLUDE_PATTERNS` | `['DSA']` | Ad groups to skip on both sides |
| `MAX_RUNTIME_MS` | 27 min | Safety stop before the 30-min script limit |

## Requirements & notes

- Works on a single account (not MCC-level).
- Requires a consistent naming convention for the Exact/Phrase mirrors —
  pairing is purely name-based.
- The script only **adds** negatives; it never removes them. If you pause an
  exact keyword and want the phrase side to recover that traffic, remove the
  corresponding negative manually or with your negative cleanup routine.
- Completes the alpha/beta trio with
  [Search Term Auto Expander](../search-term-auto-expander/) (promotes winning
  search terms into keywords) and
  [Exact-Phrase Keyword Sync](../exact-phrase-keyword-sync/) (keeps the
  mirrors' positive keywords aligned).
- Built and battle-tested on Omnicliq client accounts since 2022; this is the
  standalone public edition.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
