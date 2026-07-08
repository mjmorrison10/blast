---
approved: 2026-07-08
---

# BLAST posting command center — phase 1: status tracking + session persistence

## Context

User feedback (via an arena.ai product analysis): if BLAST only opens upload
pages, it's redundant for a creator who already has their tabs open. The fix
is to make it the thing that *remembers the workflow* — a posting command
center, not a link launcher. This phase ships the highest-value slice of that
direction: per-platform posting status, session persistence, and a combined
copy+open+mark action. Presets and per-platform caption validation are planned
as follow-on phases.

Approved to build directly on a branch (no separate plan-doc gate); PR for
review; nothing merges to `main` without a go-live step.

## What was built

- **Per-platform status** — `none → copied → opened → posted`, plus `skipped`.
  Status only advances forward (a later "copy" won't knock a posted card back).
  A status chip + left-border color shows state at a glance; a session bar
  summarizes "N of 8 posted" with a progress fill.
- **Combined action** — each card's primary button copies that platform's
  caption, opens its upload page, and bumps status to "opened" in one click.
  "Copy only" and manual "Mark posted / Skip" remain. Pasting a live post URL
  auto-marks posted.
- **Session persistence** (`blast_session_v1` in localStorage) — base caption,
  per-platform captions, AI suggestions + picks, status, and post URLs all
  survive refresh/close. "Reset session" clears it (API key untouched).
- Status refresh is surgical (`refreshStatus()` updates chips/summary without
  re-rendering the grid) so it never blurs a field mid-edit.

## Files touched

- `blast/app.js` — session state + persistence, status model, rewritten
  `renderPlatforms`, `refreshStatus`, reset + base-caption-save wiring.
- `blast/index.html` — session bar above the platform grid.
- `blast/style.css` — status chips/colors, combined button, status row,
  post-URL field, session bar + progress.
- `blast/README.md` — documents the tracker + combined action.

## Verification (headless Chromium)

26-check suite, all passing: session bar + empty state; 8 status chips /
combined buttons / mark controls; base-caption + copy+open flow (copies,
opens URL, advances to "opened", doesn't count as posted); mark posted →
count increments + card class; status non-regression (copy-after-posted stays
posted); skip; post-URL paste auto-marks posted; **persistence across reload**
(base caption, posted/skipped status, post URL, summary all restored); reset
clears everything. Regression suites re-run green: provider/settings (18),
video-suggest (12), transcript+OpenRouter (8). Live API calls remain
mock-verified only (no key in session) — unchanged from prior PRs.

## Rollback

Feature branch `claude/posting-command-center`; PR for review. Additive and
backward-compatible — an empty/absent `blast_session_v1` just yields the old
empty-start behavior.
