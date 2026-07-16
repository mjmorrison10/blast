---
task: "Update available" banner so users reload after a deploy instead of running stale JS
date: 2026-07-16
approved: 2026-07-16
---

# Update-available banner

## Goal
GitHub Pages serves every file with `cache-control: max-age=600` (not
configurable), so after a deploy a browser can keep running the previous
`stackdata.js` for ~10 min. That's how the owner saw "Drive sync isn't set up
yet" right after the client-id deploy. This lag hits every stack update and
will silently confuse clients (esp. on mobile). Add a banner that detects a
newer deploy and prompts a reload. Instant sub-10-min updates aren't possible
uniformly (BLAST/HOOKLAB are ES modules with fixed import URLs), so this is a
notify + best-effort-reload design.

## What shipped (canonical recall/stackdata.js, re-vendored ×4)
- `STACK_BUILD` constant (bumped per deploy). Single source of truth,
  auto-propagated by byte-identical vendoring.
- `checkForUpdate()`: cache-busted fetch of the app's own stackdata.js,
  regex its `STACK_BUILD`; if it differs from the running one, inject a banner.
  Throttled to once/2 min, fire-and-forget, all failures swallowed (never
  blocks or errors the app). Called from `bindSyncUI` on load + on tab-focus
  (`visibilitychange`).
- Banner: self-injected fixed bottom bar (stacknav owns the top), inline
  theme-neutral styles, "A newer version is available" + Reload + dismiss ✕.
  Reload records `sessionStorage.stack_update_tried` then `location.reload()`;
  if a reload already happened for this exact build and it's still stale, the
  banner shows softer copy ("GitHub is serving a cached copy for a few
  minutes; it will refresh on its own shortly") so the button never loops
  confusingly inside the 10-min window. Dismiss hides it for the session.
- No index.html or app.js changes.

## Deploy discipline (NEW — added to the ship checklist)
Bump `STACK_BUILD` in canonical stackdata.js before re-vendoring on any deploy
users should reload for.

## Rollback
Revert the commit. Purely additive; the banner and its sessionStorage keys
are self-contained.

## Verification (headless Playwright — all green, 21/21)
Serve the normal file on plain load but a bumped-STACK_BUILD copy for the
`?bust=` probe (simulates a newer deploy on the server while the page runs the
cached copy):
1. Newer build → banner appears with Reload.
2. Same build → no banner.
3. Reload → records tried build; still-stale reload → soft second-state copy.
4. Dismiss → hidden for the session, flag set.
5. Probe 500/network fail → no banner, no page error, app usable.
6. Injects with no errors in all four apps incl. the ES-module ones.
Existing suites re-run green (merge 24, restore-replace 23, wiring 27).

## Execution log (2026-07-16)
Implemented + verified as above; no divergences. This deploy is itself the
first real new build, so an already-open tab on the prior build will show the
banner once it lands (the feature demonstrating itself).
