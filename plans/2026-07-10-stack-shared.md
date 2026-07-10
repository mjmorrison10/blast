---
approved: 2026-07-10
---

# One suite: shared API keys + full-stack export/import (BLAST + PULSE side)

## Goal

Same-suite behavior for the four same-origin apps: an API key saved in any app
works everywhere, and one export/import backs up and restores every app's data.
BLAST and PULSE (which lives at `blast/pulse/` and ships from this repo) gain
shared-key plumbing and whole-stack backup.

## Steps

BLAST:
1. Vendor `stackdata.js` (byte-identical). Loads as a classic script before the
   module `app.js`.
2. `index.html`: load `stackdata.js` before the module app; shared-keys hint;
   "Whole-stack backup" section (export/import + hidden file input) in Settings.
3. `app.js`: `loadSettings` merges shared keys via `resolveKeys`; `#keysave`
   write-throughs; `#keyclear` calls `clearSharedKey` and toasts "Key cleared
   everywhere"; wire the stack buttons.

PULSE (`blast/pulse/`):
4. Vendor `stackdata.js` (byte-identical). `index.html` loads it before
   `app.js`; add STACK BACKUP / STACK RESTORE buttons + hidden file input in the
   dashboard header; shared-keys hint in Settings.
5. `app.js`: `loadAll` resolves the shared `ytKey`; `#keysave`/`#ytkeyclear`
   write-through / clear the shared `ytKey`; `importJSON` detects the stack
   format and routes to `StackData.importAll`; wire `#stackexport`/`#stackfile`.

## Files touched

- `stackdata.js`, `index.html`, `app.js` (BLAST)
- `pulse/stackdata.js`, `pulse/index.html`, `pulse/app.js` (PULSE)

## Rollback

Revert the branch. Shared store is additive; BLAST/PULSE keep their own settings
keys.

## Verification

Same-origin headless Chromium harness: BLAST resolves a key saved elsewhere;
PULSE ytKey shares through the store; clear propagates; empty saves don't
clobber; full-stack export/import round-trip incl. RECALL IDB; format detection.
33 substantive assertions pass.
