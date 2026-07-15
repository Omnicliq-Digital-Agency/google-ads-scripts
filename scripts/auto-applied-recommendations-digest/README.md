# Auto-Applied Recommendations Digest

Google can change your accounts without asking: with auto-apply recommendations enabled — sometimes without anyone remembering having enabled them — keywords appear, budgets shift, targeting expands. The change history records it all, attributed to **Recommendations Auto-Apply**, but nobody reads change history daily across an MCC. This script does, and emails one morning digest — so nothing changes in your accounts without a human knowing.

## How it works

1. Iterates the MCC's accounts (optionally filtered by `ACCOUNT_LABEL`).
2. Reads the last `LOOKBACK_DAYS` of change events attributed to Google's auto-apply actor.
3. Emails one digest grouped by account: when, what resource type, which operation, in which campaign — capped per account so the mail stays readable.

The fix for unwanted entries is per account: **Settings → Recommendations auto-apply**. The digest tells you where to look.

## Setup

1. In your **manager account (MCC)**: **Tools → Bulk actions → Scripts → +**, paste the script.
2. Fill `RECIPIENT_EMAILS`, schedule **daily, early morning**.

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `RECIPIENT_EMAILS` | `[]` | Digest recipients |
| `LOOKBACK_DAYS` | `3` | Sweep window (1–30; overlap tolerates skipped runs) |
| `ACCOUNT_LABEL` | `''` | Only check labeled accounts |
| `MAX_EVENTS_PER_ACCOUNT` | `50` | Line cap per account in the digest |

## Requirements & notes

- MCC-level script; strictly read-only.
- Google keeps ~30 days of change history — the digest can't look further back.
- Complements the [Change Event Digest](../change-event-digest/): that reports *all* changes per account, this hunts specifically for Google's automatic ones across the MCC.
- A companion piece built for this collection in the same style as our long-running internal scripts.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
