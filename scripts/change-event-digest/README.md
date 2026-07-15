# Change Event Digest

"Who changed that?" is the first question after every performance jump — and the change history screen answers it one hunt at a time. This script turns it into a push: every morning, one email with yesterday's account changes — who, what resource, which operation — grouped by user.

## How it works

1. Reads yesterday's change events (Google keeps ~30 days).
2. Drops the resource types in `IGNORE_TYPES` (e.g. keyword churn from your own scripts).
3. Emails one digest grouped by user email; above `MAX_EVENTS` events it switches to per-type counts so the mail stays readable.

Useful as an agency audit trail (client-side edits surface next morning) and as a tripwire for unexpected automated-rule behaviour.

## Setup

Fill `RECIPIENT_EMAILS`, schedule daily early morning.

## Configuration reference

| Key | Default | Meaning |
|---|---|---|
| `RECIPIENT_EMAILS` | `[]` | Digest recipients |
| `IGNORE_TYPES` | `[]` | Change resource types to drop |
| `MAX_EVENTS` | `200` | Line cap before switching to counts |

## Requirements & notes

- Single account; `change_event` requires a LIMIT clause and covers ~30 days — the script queries one day at a time, well within both.
- A companion piece built for this collection in the same style as our long-running internal scripts.

---

Author: Dimitris Bachtsevanis · Maintained by [Omnicliq](https://www.omnicliq.com) · Apache 2.0
