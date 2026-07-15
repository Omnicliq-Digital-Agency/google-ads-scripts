# Search Term Auto Expander

Google Ads matches your exact and phrase keywords to "close variants" — plurals,
typos, reorderings, near-synonyms. Some of those variants quietly become your
best performers, but as long as they are only search terms you can't bid on
them, set their URL, or negative them apart. This script finds the close
variants that have earned their place and promotes them to real keywords,
automatically and with full audit labels.

## How it works

Every run, the script:

1. **Collects search terms** matched as `NEAR_EXACT` close variants in your
   Exact and Phrase campaigns over the lookback window, with a minimum-clicks
   floor.
2. **Compares each term to the keyword that triggered it** on three signals:
   - **Similarity** — Levenshtein distance between term and keyword after
     removing your `FILTER_WORDS` (brand names, "buy", colours…) and ignoring
     word order, expressed as 0–1.
   - **Relative CPC** — the term's average CPC as a fraction of the keyword's.
     A variant that costs as much as the keyword deserves its own bid.
   - **Click share** — the term's clicks as a fraction of the keyword's. A
     variant taking a real share of traffic deserves its own keyword.
3. **Adds qualifying terms as keywords** in the same ad group — `[exact]` in
   Exact campaigns, `"phrase"` in Phrase campaigns — inheriting the trigger
   keyword's CPC bid (when set at keyword level) and final URL.
4. **Labels everything** (`Auto Expand: Added`, plus `Auto Expand: Typo` for
   spelling variants) so every addition can be reviewed or rolled back with a
   simple label filter.

Terms that already exist as keywords, are too long for Google Ads limits, or
miss any threshold are skipped and counted in the execution summary.

## Setup

1. In Google Ads: **Tools → Bulk actions → Scripts → +**, paste
   `search-term-auto-expander.js`.
2. Edit `CONFIG` at the top:
   - `CAMPAIGNS.EXACT_PATTERN` / `PHRASE_PATTERN` — substrings that identify
     your exact and phrase campaigns by name (e.g. `' - Exact'`, `' - PH'`).
   - `CAMPAIGNS.EXCLUDE_PATTERNS` — campaigns to ignore entirely.
   - `THRESHOLDS` — start with the defaults and tighten/loosen after a few
     preview runs.
   - `FILTER_WORDS` — words to ignore when comparing texts.
3. **Authorize and run with `PREVIEW_MODE: true`.** Read the execution summary
   in the logs — nothing is changed in the account.
4. When the previewed additions look right, set `PREVIEW_MODE: false` and
   schedule the script (daily or weekly).

### Optional: typo detection

With `TYPO_CHECK.ENABLED: true` (requires your own
[Custom Search Engine](https://developers.google.com/custom-search/v1/introduction)
id and API key), terms that Google's spell checker corrects are still added but
receive the `Auto Expand: Typo` label — typo traffic is often cheaper, and the
label lets you bid or exclude it deliberately.

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `PREVIEW_MODE` | `true` | Log what would happen; write nothing |
| `LOOKBACK_DAYS` | `30` | Analysis window, ending yesterday |
| `MIN_SEARCH_TERM_CLICKS` | `5` | Ignore terms with fewer clicks |
| `CAMPAIGNS.EXACT_PATTERN` | `' - Exact'` | Name substring of exact campaigns |
| `CAMPAIGNS.PHRASE_PATTERN` | `' - PH'` | Name substring of phrase campaigns |
| `CAMPAIGNS.EXCLUDE_PATTERNS` | `DISPLAY, SHOPPING, PMAX, DSA` | Campaigns to skip |
| `THRESHOLDS.*.MIN_SIMILARITY` | `0.7` | Minimum 0–1 text similarity |
| `THRESHOLDS.*.MIN_RELATIVE_CPC` | `0.7` | Minimum term CPC / keyword CPC |
| `THRESHOLDS.*.MIN_CLICK_SHARE` | `0.1` | Minimum term clicks / keyword clicks |
| `FILTER_WORDS` | `[]` | Words ignored in similarity comparison |
| `LABELS.ADDED` / `LABELS.TYPO` | `Auto Expand: *` | Labels applied to created keywords |
| `MAX_TERM_WORDS` / `MAX_TERM_CHARS` | `10` / `80` | Google Ads keyword limits |
| `TYPO_CHECK.*` | disabled | Optional spell-check via Custom Search API |
| `MAX_RUNTIME_MS` | 27 min | Safety stop before the 30-min script limit |

## Requirements & notes

- Works on a single account (not MCC-level).
- Campaign identification is name-based — the script needs a naming convention
  that distinguishes exact from phrase campaigns.
- Built and battle-tested on Omnicliq client accounts since 2022; this is the
  standalone public edition.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
