---
task: STACK RESTORE replace-mode (cross-workspace leak fix) + per-workspace Drive files + live OAuth client id
date: 2026-07-16
approved: 2026-07-16
---

# Restore replace-mode + workspace-scoped Drive files + client id

## Goal
Owner runs two social accounts as separate stacks and switches by restoring
backups. Bug: restoring Stack B (which has RECALL data but no PULSE/BLAST
keys) left Stack A's PULSE/BLAST data in place. Root cause: `importAll` was a
per-key OVERLAY — it wrote keys the backup carried and never cleared the ones
it didn't. Correct for sync/merge, wrong for STACK RESTORE which promises to
REPLACE all four apps. Also: wire the real OAuth client id, and scope the
Drive sync file per-workspace so two stacks on one Google account don't fight
over one file (and don't trip the workspace guard).

## What changed (canonical recall/stackdata.js, re-vendored ×4)
- `importAll(data, {replace:true})`: before overlaying, wipe every
  stack-prefixed localStorage key EXCEPT a `DEVICE_PRESERVE` list (5 settings
  keys + 3 theme keys), so app data is fully replaced but device API
  keys/themes survive when the backup doesn't carry them (and are overwritten
  when it does). In replace mode a backup with no library CLEARS the IDB
  library (`clearRecallLibrary()`); overlay keeps the old no-op.
- Restore callers pass `{replace:true}`: `importFromFile` (STACK RESTORE in
  all apps) and the stack-backup sniffs in `Hooklabs/app.js` and
  `pulse/app.js`. `syncDrive`/`mergeFromFile` stay overlay (correct).
- `mergeStates` now EMITS the collection keys (topclips/posts/presets/hooklab)
  whenever either input had them, even when the merged result is empty, so a
  tombstone that clears the last item propagates on a sync (overlay) apply.
  Merged output is now fully order-stable (sources/bin/enabled/posts/presets/
  topclips/tombstones/unknown-keys all sorted) → strictly idempotent
  regardless of wall-clock (previously the union order depended on which side
  was "newer", making `merge(merge(a,b),b)` differ in array order).
- Drive: `DRIVE_CLIENT_ID` set to the owner's real client id. Sync file is now
  per-workspace: `appProperties {app, ws:<workspace id>}` + filename
  `mjm-stack-sync-<slug>.json`; `driveFind(token, wsId)` filters by ws;
  `stack_sync_meta_v1` records `wsId` and is ignored/created fresh for a
  different workspace. Result: each stack keeps its own Drive file.

## Files
recall/stackdata.js (canonical) → Hooklabs/blast/pulse (byte-identical);
Hooklabs/app.js + pulse/app.js (restore sniff → replace:true).

## Rollback
Revert the commit per repo. Replace-mode is opt-in via the flag; without it
behavior is the old overlay. New meta field `wsId` is additive.

## Verification (headless Playwright — all green)
- restore-replace suite 23/23: the reported bug exactly (restore recall-only
  Stack B clears Stack A pulse/blast/presets/topclips, switches IDB library +
  workspace, PRESERVES device keys/theme, clears stale sync meta); null-library
  clears in replace / preserved in overlay; carried settings overwrite;
  tombstone-clears-last-item propagates; client id wired (no "setup pending").
- merge engine 24/24 (idempotence now wall-clock-independent).
- Drive suite incl. per-workspace scoping: first sync uploads clean v2 payload;
  A<->B converge; a SECOND workspace gets its OWN file (ws-tagged) with W1's
  file untouched and no guard block; 401 re-auth; placeholder → not configured.
- wiring + tombstone E2E 27/27.

## Execution log (2026-07-16)
Implemented + verified as above; no divergences. Added order-stable sorting to
mergeStates beyond the original plan to make idempotence robust to wall-clock
(surfaced by the merge-engine suite on a later-in-day run).
