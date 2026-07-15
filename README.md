# Omnicliq Google Ads Scripts

Free, production-grade Google Ads scripts by [Omnicliq](https://www.omnicliq.com).
Each script is a single self-contained file: paste it into **Tools → Bulk
actions → Scripts**, edit the `CONFIG` block at the top, preview, schedule.

These are standalone editions of automations we run daily on client accounts.
Every script ships with `PREVIEW_MODE: true` by default — the first run only
reports what it *would* do.

## Scripts

| Script | What it does |
|---|---|
| [Search Term Auto Expander](scripts/search-term-auto-expander/) | Promotes high-performing close-variant search terms into real exact/phrase keywords, with audit labels and optional typo detection |
| [Exact-Phrase Keyword Sync](scripts/exact-phrase-keyword-sync/) | Keeps mirrored Exact/Phrase (alpha/beta) campaigns in sync — keywords missing on one side are created on the other with the right match type |
| [Exact-to-Phrase Negative Sync](scripts/exact-to-phrase-negative-sync/) | Fences mirrored alpha/beta campaigns — every serving exact keyword becomes a negative exact in its Phrase mirror, so exact traffic stays exact |
| [MCC Spend Anomaly Detector](scripts/mcc-spend-anomaly-detector/) | MCC-level same-weekday spend monitoring — emails a digest the moment an account over- or under-spends vs its own 12-week pattern |
| [Account Spend Anomaly Detector](scripts/account-spend-anomaly-detector/) | Single-account edition of the spend monitor, with per-campaign checks that catch the incident the account total hides |
| [URL-Matched Price Extensions](scripts/url-matched-price-extensions/) | Maintains price extensions per ad group from a URL-keyed catalog — creates, diff-updates in place, and cleans up under Google's 3–8 items rule |
| [DSA Search Term Fencing](scripts/dsa-search-term-fencing/) | Stops DSA cannibalizing your keyword campaigns — overlapping search terms become DSA negatives, unless DSA serves them cheaper |
| [Competitor Query Fencing](scripts/competitor-query-fencing/) | Auto-negates search terms containing competitor brands (word-boundary matched, registry in code or a shared list), sparing intentional competitor campaigns |
| [Landing Page Link Checker](scripts/landing-page-link-checker/) | Fetches every final URL, catches 3xx/4xx/5xx and "out of stock" pages, labels and optionally pauses affected keywords/ads — and re-enables them on recovery |
| [Account Health Audit](scripts/account-health-audit/) | Nine scheduled health checks — disapprovals, empty ad groups, broken conversion tracking, starved budgets, wrong domains — in one daily digest |
| [Shopping Allowlist Fencing](scripts/shopping-allowlist-fencing/) | Keeps themed shopping campaigns on-theme — off-allowlist search terms become negative exacts, with automatic overflow into shared negative lists |
| [Keyword Template Expander](scripts/keyword-template-expander/) | Multiplies labeled template keywords by your catalog values — `buy {brand} shoes` × every brand, substituted in text and landing URL |
| [Search Term N-Gram Analyzer](scripts/search-term-ngram-analyzer/) | Aggregates search term performance by word patterns (1/2/3-grams) into a ranked spreadsheet — negative ideas and bid insights invisible query-by-query |
| [Quality Score Tracker](scripts/quality-score-tracker/) | Daily QS snapshots with component breakdown, drop alerts by email, and labeling of chronic low-QS keywords — with the why (CTR/relevance/LP) in every row |
| [Cross Ad Group Query Fencing](scripts/cross-adgroup-query-fencing/) | Routes queries serving from multiple ad groups to the most relevant one and fences the rest — high-traffic conflicts go to manual review, not auto-fenced |
| [MCC Budget Pacing Guard](scripts/mcc-budget-pacing-guard/) | Projects every account's month-end spend from its run-rate and flags budgets on course to blow out or go unspent — weeks before they do |
| [RSA Builder](scripts/rsa-builder/) | Builds uniform RSAs from declared ad frames (pinned + fill copy pools) across label-selected ad groups — idempotent, URL-inheriting, never deletes |
| [Inner DSA Target Sync](scripts/inner-dsa-target-sync/) | Keeps each campaign's inner DSA ad group targeting exactly the pages its keywords advertise — see the [DSA Layering playbook](docs/DSA-LAYERING.md) |
| [Inner DSA Search Term Fencing](scripts/inner-dsa-search-term-fencing/) | Stops inner DSA ad groups cannibalising their own campaign's keywords — sparing terms DSA serves cheaper and competitor queries that belong to DSA |
| [Inner DSA Ad Creation](scripts/inner-dsa-ad-creation/) | Fills inner DSA ad groups with ads built from the campaign's own RSA descriptions — both line orders, status mirroring, per-variant copy |
| [PMax Placement Audit](scripts/pmax-placement-audit/) | Surfaces where Performance Max actually served — flags mobile apps and junk placements by type and name patterns, with a paste-ready exclusion digest |
| [Sitelink URL Checker](scripts/sitelink-url-checker/) | Fetches every sitelink URL in use at account/campaign/ad group level and emails the broken ones with link text and location — the layer link checkers forget |
| [Ad Schedule Heatmap](scripts/ad-schedule-heatmap/) | The 7×24 day-by-hour picture the UI won't show — cost, conversions and cost/conv. as shaded spreadsheet matrices, dayparting decisions at a glance |
| [Zero-Conversion Spenders](scripts/zero-conversion-spenders/) | Finds and labels keywords spending real money with zero conversions — the budget leak that hides in the averages |
| [Shopping Product Audit](scripts/shopping-product-audit/) | Product-level truth for Shopping/PMax retail — zero-conversion spenders and below-ROAS-floor products, ranked and emailed |
| [Device Performance Report](scripts/device-performance-report/) | Per-campaign device CPA gaps with suggested bid modifiers — decision support, never auto-applied |
| [Geo Performance Report](scripts/geo-performance-report/) | Ranks countries by spend and flags the ones converting far worse than the account average |
| [Impression Share Tracker](scripts/impression-share-tracker/) | Daily IS history per search campaign with budget/rank loss split — and alerts when a campaign drops against its own trend |
| [Duplicate Keywords Report](scripts/duplicate-keywords-report/) | Finds the same keyword living in multiple ad groups, compares the copies, and recommends the survivor |
| [RSA Asset Performance Report](scripts/rsa-asset-performance-report/) | Sweeps Google's BEST/GOOD/LOW asset grades account-wide and ranks the LOW lines reused across the most ads |
| [Change Event Digest](scripts/change-event-digest/) | Yesterday's account changes — who, what, which operation — in one morning email, grouped by user |
| [Campaign Budget Utilization](scripts/campaign-budget-utilization/) | Flags chronically capped and chronically idle campaign budgets — the two tails that waste money invisibly |
| [Weekly Account Summary](scripts/weekly-account-summary/) | Monday morning in one email — week-over-week core metrics and the campaigns that moved them most |
| [DSA Allowlist Fencing](scripts/dsa-allowlist-fencing/) | Keeps branded campaigns' DSA ad groups on-brand — off-allowlist search terms become negative exacts, the ad-group sibling of the shopping fence |
| [Optimization Score Tracker](scripts/optimization-score-tracker/) | MCC-wide OptiScore history and floor alerts — the number Google judges you by, finally on a trend line |
| [Auto-Applied Recommendations Digest](scripts/auto-applied-recommendations-digest/) | One morning email with every change Google applied automatically across the MCC — nothing changes without a human knowing |
| [PMax Non-Converting Search Terms](scripts/pmax-nonconverting-search-terms/) | Digs the wasted-budget searches out of PMax search term insights — ranked, in a sheet, ready to become negatives |

More coming — watch the repo.

## Usage

1. Open the script's folder and read its README.
2. Copy the `.js` file into a new Google Ads script.
3. Edit `CONFIG`, authorize, and **preview first**.

## Author

Written and maintained by **Dimitris Bachtsevanis** (db@omnicliq.com), Omnicliq.

## License

[Apache 2.0](LICENSE) — free for any use, including commercial. No warranty:
review what a script does in preview mode before letting it change an account.
