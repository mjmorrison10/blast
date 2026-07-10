---
approved: 2026-07-10
---

# Data hygiene: PULSE stop-tracking vs delete-everywhere (BLAST/PULSE side)

## Goal

A test post logged from PULSE to the HOOKLAB ledger stayed there after the post
was deleted, polluting HOOKLAB's evidence. Give PULSE two explicit actions:
Stop tracking (PULSE only) and Delete (removes the post AND its HOOKLAB ledger
entry).

## Steps (PULSE, `blast/pulse/`)

1. `app.js` render: replace the single `×` "Stop tracking" button with two
   `.postact` buttons — `del` ("Stop tracking") and `delall` ("Delete",
   danger). Reuse the `data-act`/`data-id` dispatch.
2. `app.js` handler: `del` keeps today's behavior (remove from `posts` only) +
   toast. New `delall`: confirm (mentions the ledger only if
   `post.ledgerLoggedAt`), remove from `posts`, then call `deleteLedgerEntry`.
3. New `deleteLedgerEntry(post)`: reads `hooklab_state_v1`, filters
   `ledger` by the deterministic id `"pulse_" + post.id` (same id
   `logToLedger` writes), writes back. Returns whether an entry was removed so
   the toast can say "Deleted here and from the HOOKLAB ledger" vs "Deleted".
   Matching on `pulse_<id>` means a HOOKLAB-native entry is never touched.
4. `style.css`: `.postactions` + `.postact` (+ `.danger` hover) small-button
   styles.

## Files touched

`blast/pulse/app.js`, `blast/pulse/style.css`.

## Verification

Headless: two posts logged to ledger + one HOOKLAB-native entry seeded;
Stop tracking removes the post but leaves its ledger entry; Delete removes the
post AND its `pulse_<id>` ledger entry while leaving the native entry and the
other post's entry intact; deleting a never-logged post errors nothing.
26/26 hygiene assertions pass (all-app suite); prior suites unaffected.

## Rollback

Revert the branch; additive UI + a guarded localStorage write.
