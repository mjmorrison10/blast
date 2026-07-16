---
task: Google Drive cross-device sync + safe backup merge (all four stack apps)
date: 2026-07-16
approved: 2026-07-16
---

# Drive sync + safe merge

## Goal
The stack backup was file-only, so moving between laptop and phone meant
ferrying JSON by hand. Add (1) manual sync through the user's OWN Google Drive
(each user grants access to their own Drive; no server) and (2) a
conflict-safe merge so two devices converge instead of clobbering — with hard
protection against merging two unrelated workspaces and against repeated
merges degrading data.

## What shipped
- **stackdata.js v2** (canonical in recall/, vendored byte-identical to the
  other three): backup `version:2`; `exportAll({forSync})` strips a
  SYNC_EXCLUDE list (secrets, themes, caches, transient inbox, legacy library
  fallback) so the Drive payload NEVER carries API keys; importAll still
  accepts v1 (replace) and rejects >2.
- **Workspace identity** (`stack_workspace_v1`): named on first sync/merge;
  merge/sync hard-blocks when two different workspace ids meet, pointing to
  STACK RESTORE as the explicit replace path. A workspace-less side adopts
  the other's.
- **Tombstones** (`stack_tombstones_v1`): `StackData.tombstone(kind,id)` at 5
  delete sites (recall source, pulse del + delall, hooklab ledger + comp);
  merge unions with max deletedAt and suppresses resurrected deletes
  (unconditional for uid ids; timestamp-compared for reusable pulse_<id>
  ledger ids), pruned at 90 days.
- **Merge engine** `StackData.mergeStates(a,b)` — pure, idempotent: union by
  stable id for collections, newest-wins for singletons (blast session
  updatedAt, ledger editedAt), PULSE dupe-collapse with snapshot union
  (dedup by elapsedMin, re-sorted), forward-compatible last-writer for
  unknown future keys. Throws WORKSPACE_MISMATCH on the guard.
- **Drive REST layer** (fetch + GIS token client, `drive.file` scope, lazy
  GSI load, one file found by appProperties marker) + `syncDrive`
  (pull→merge→apply-locally→push) and `mergeFromFile`.
- **UI**: `StackData.bindSyncUI(toast)` wires `#stacksync` / `#stackmerge` /
  `#stackmergefile` / `#syncstatus` — same ids added beside the existing
  stack-backup buttons in all four index.html; each app calls bindSyncUI in
  its backup block.

## Owner one-time Google setup (REQUIRED before sync works in prod)
Code ships with a placeholder client id and a graceful "Drive setup pending"
state, so nothing breaks until this is done. See
`plans/2026-07-16-drive-sync-OWNER-SETUP.md`.

## Files touched
recall/stackdata.js (canonical) + vendored copies in Hooklabs/blast/pulse;
recall/app.js, pulse/app.js, Hooklabs/app.js (tombstones + bindSyncUI call);
blast/app.js (bindSyncUI call); each index.html (buttons); each app's
delete path (tombstones).

## Rollback
Revert the commit per repo. New localStorage keys (stack_workspace_v1,
stack_tombstones_v1, stack_sync_meta_v1) are additive; delete to reset. No
data is destroyed by the feature (merge only adds; tombstones only suppress
resurrections and keep old ids in tombstone map / clipIdPrev).

## Verification (headless Playwright — all green)
- Merge engine 24/24: unions, newest-wins, PULSE dupe+snapshot merge,
  idempotence fixpoint, tombstone suppression (incl. recreate-after-tombstone
  survives), workspace-mismatch throw, secrets stripped, unknown-key forward
  compat.
- Drive flow 21/21: first sync uploads a version-2, secret-free payload;
  A↔B round-trip converges; workspace mismatch blocks with no write; 401
  silent re-auth; placeholder id → not-configured, GSI never fetched.
- Wiring + E2E 28/28: all four apps mount the sync UI with no page errors;
  file-merge unions and foreign-workspace file blocks; v1 restore still
  replaces and version>2 rejects; UI deletes in PULSE and RECALL write the
  right tombstones.

## Accepted limitations
RECALL same-source concurrent edits: more-segments-wins (no timestamps).
BLAST session reset / bin items can resurrect via merge (no tombstones by
design). Token popup may reappear after ~1h (no client-side refresh tokens).
Tombstones expire after 90 days offline. Provider/model prefs and HOOKLAB
brandVoice don't sync (inside excluded settings keys).

## Execution log (2026-07-16)
Implemented and verified as above; no divergences from plan. DRIVE_CLIENT_ID
remains a placeholder pending owner Google Cloud setup.
