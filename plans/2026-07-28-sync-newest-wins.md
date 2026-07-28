---
approved: 2026-07-28
---

# BLAST: the queue is the truth, the session is a projection

## Goal
Three symptoms, one cause. After a Drive sync BLAST showed an OLD clip's
finished posting session ("6 of 9 posted, 2 skipped" for the wrong clip);
posted marks made on the phone appeared lost; and PULSE's import carried only
part of the platforms over. The user's rule: the most recent work wins.

## Confirmed root cause
1. The real work never synced. Since the multi-post redesign the clips and
   their per-platform Posted/Skipped marks live in `blast_queue_v1`, which was
   in `SYNC_EXCLUDE` ("transient batch inbox"). That premise died when posting
   status moved into the queue.
2. A stale projection synced and won. `blast_session_v1` is a projection of the
   Quick clip, re-stamped `updatedAt: Date.now()` on any keystroke, and merged
   whole-blob by "greater updatedAt wins". A device sitting on an old clip
   refreshed that old session's timestamp just by being typed in, and the
   zombie won the merge everywhere.
3. The zombie then resurrected locally: `migrateSessionIntoQuick` ran on EVERY
   load, so a synced-in session was absorbed into the Quick card; PULSE
   imported the session in preference to the queue.
   Accomplice: marking a platform posted never bumped the clip's `updatedAt`,
   so an afternoon of posting did not read as recent work.

Reproduced pre-fix: merging a local "THE NEW CLIP" session against a remote
"THE OLD CLIP" session with a fresher timestamp returned THE OLD CLIP with its
posted marks, and the payload carried no queue at all.

## Changes
### stackdata.js (vendored byte-identical to all four apps)
- `SYNC_EXCLUDE`: `blast_queue_v1` removed, `blast_session_v1` added. The
  projection never travels again; the queue does.
- New BLAST queue merge, replacing the session merge: clips unioned by `key`,
  per-clip newest (`updatedAt || createdAt`) wins, `blastClip:` tombstones
  suppress deletes while newer than the clip. Quick sorts first, then
  oldest-created first — stable and idempotent. Top-level
  `defaultPlatforms`/`batchCount` follow the newer side.
- `HANDLED` map updated accordingly.

### app.js
- `saveSession()` bumps the active clip's `updatedAt` — every call site is a
  user mutation, including Posted/Skipped/post-URL.
- `migrateSessionIntoQuick` is now a one-time legacy upgrade: it runs only when
  no `blast_queue_v1` exists at all.
- New `writeSessionProjection()`: one-way queue → `blast_session_v1`, also
  called on load, so a session left by an older build or an unopened device is
  overwritten rather than trusted.
- Clip removal and queue-clear write `blastClip` tombstones (the queue syncs
  now, so a delete needs one or the next merge undoes it).
- **New captions start a fresh posting session.** A suggest run clears the
  active clip's `status/postUrl/postedAt/postedCaption`, so a new clip cannot
  inherit the previous clip's "posted/skipped" grid. If any platform is still
  marked *posted* it confirms first (naming the count, pointing at PULSE);
  cancelling keeps every mark.

## Files
`blast/stackdata.js`, `blast/app.js` (+ vendored stackdata in recall, Hooklabs, pulse)

## Rollback
Revert the commits. Drive files stay readable; an old build simply ignores the
queue key again.

## Verification
`blast-sync-truth-verify.mjs` — 44 checks, real UI + in-page `mergeStates`.

## Audit — 2026-07-28

| Step | Result |
|---|---|
| R1 phone's posted marks survive a merge; laptop-only clip kept; quick not duplicated; merge idempotent | PASS |
| R2 zombie session with a fresher timestamp cannot reach the queue, the UI, or the projection | PASS |
| R3 legacy session-only device still migrates once, with its posting state | PASS |
| R4 removed clip is tombstoned and stays gone; re-queued later it survives | PASS |
| R5 PULSE imports the queue, not the stale session; re-import does not duplicate | PASS |
| R6 PULSE platform toggles survive a sync that rewrites the session | PASS |
| R7 marking posted bumps the clip's updatedAt | PASS |
| R8 queue travels, session excluded, secrets still excluded | PASS |
| R9 new captions reset the posting grid; confirm shown for real posted marks; cancel keeps them | PASS |
| Pre-fix reproduction (old clip wins, no queue in payload) | CONFIRMED |
| Regression: blast (batch, verify, context, aiux, hangfix, reasoning, fallback, 429), all pulse suites, pulse-autopromote, recall (sendall, verify, persist), hooklab-aiux, merge-engine, drive-sync, sync-wiring, restore-replace, stack-key, update-banner, mobile-settings | PASS |
| stackdata sha256 identical across all four repos | PASS |

Note: `recall-topclips-verify.mjs` has one failing assertion ("output cap
raised to 8000") that predates this work — verified failing with these changes
stashed. Left alone; it belongs to the reasoning-headroom wave.
