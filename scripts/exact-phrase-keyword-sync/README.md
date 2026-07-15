# Exact-Phrase Keyword Sync

The classic alpha/beta search structure mirrors every campaign twice: an Exact
campaign for control and a Phrase campaign for discovery. It works — until the
mirrors drift. A keyword added to the Exact side never reaches the Phrase side,
ad groups fall out of parity, and coverage quietly develops holes. This script
keeps the two sides in sync automatically, both directions, every run.

## How it works

1. **Pairs campaigns by name.** A campaign containing `EXACT_PATTERN` is
   paired with the campaign whose name swaps it for `PHRASE_PATTERN`:
   `Brand - Exact` ⟷ `Brand - PH`. Ad groups pair by having the same name in
   both campaigns.
2. **Compares keyword texts in each ad group pair**, both directions.
3. **Creates the missing keywords** — Exact-side keywords appear in the Phrase
   mirror as `"phrase match"`, Phrase-side keywords appear in the Exact mirror
   as `[exact match]` — inheriting the source keyword's final URL. Bids stay
   with the target ad group's default.
4. **Labels every created keyword** (`Keyword Sync: Added`) for easy review or
   rollback, and reports unpaired campaigns/ad groups in the execution summary
   so structural drift is visible too.

Keywords containing any `STOP_WORDS` entry are never synced — use it for terms
that intentionally live on one side only.

## Setup

1. In Google Ads: **Tools → Bulk actions → Scripts → +**, paste
   `exact-phrase-keyword-sync.js`.
2. Edit `CONFIG` at the top:
   - `CAMPAIGNS.EXACT_PATTERN` / `PHRASE_PATTERN` — the naming convention that
     distinguishes your mirrors (e.g. `' - Exact'` / `' - PH'`).
   - `CAMPAIGNS.ADGROUP_EXCLUDE_PATTERNS` — ad groups to skip (e.g. DSA).
   - `STOP_WORDS` — terms that must never cross sides.
3. **Authorize and run with `PREVIEW_MODE: true`.** Read the execution summary
   in the logs — nothing is changed in the account.
4. When the previewed additions look right, set `PREVIEW_MODE: false` and
   schedule the script (daily or weekly).

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `PREVIEW_MODE` | `true` | Log what would happen; write nothing |
| `CAMPAIGNS.EXACT_PATTERN` | `' - Exact'` | Name substring of exact campaigns |
| `CAMPAIGNS.PHRASE_PATTERN` | `' - PH'` | Name substring of phrase campaigns |
| `CAMPAIGNS.ADGROUP_EXCLUDE_PATTERNS` | `['DSA']` | Ad groups to skip on both sides |
| `STOP_WORDS` | `[]` | Keywords containing these are never synced |
| `LABELS.SYNCED` | `Keyword Sync: Added` | Label applied to created keywords |
| `MAX_RUNTIME_MS` | 27 min | Safety stop before the 30-min script limit |

## Requirements & notes

- Works on a single account (not MCC-level).
- Requires a consistent naming convention for the Exact/Phrase mirrors —
  pairing is purely name-based.
- Pairs well with
  [Search Term Auto Expander](../search-term-auto-expander/): the expander
  promotes winning search terms on one side, the sync propagates them to the
  mirror.
- Built and battle-tested on Omnicliq client accounts since 2022; this is the
  standalone public edition.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
