---
approved: 2026-07-28
---

# BLAST: a Quick clip gets a real hook, and the pattern rides through

## Goal
The HOOKLAB ledger's first auto-promoted entry stored the platform CAPTION in
the "Hook / opening line" field. The owner: "the HOOKLAB Hook / opening line
should definitely be the hook, not the caption."

## Why it happened here
Clips that come from RECALL's Top Clips carry `hookText` — the verbatim spoken
opening. A **Quick clip** does not: the transcript is pasted straight into
BLAST, and `hookText` stayed empty. PULSE's importer falls back to the caption's
first line when a post has no hook, so the caption is what reached the ledger.

The transcript itself never travels — it lives only in the device-local session
projection — so the fallback was the only thing PULSE ever saw.

## Changes
- `openingHook(text)` — takes whole sentences from the transcript until there
  are enough words to be a real opening, stopping at 3 sentences or 200
  characters, whichever comes first. Deterministic; no AI call, no new failure
  mode. The spoken opening line IS the hook, so nothing needs inventing.
- `seedQuickHook()` runs when Suggest is pressed with a pasted transcript. It
  fills the **visible** `#videohook` input so the user sees it and can correct
  it, saves it onto the Quick clip, and says so in a toast. It never touches a
  hook the user typed, and never touches a queued clip (those come from RECALL
  with their own hook).
- `blankPost` gains `patternId` / `patternName` / `patternFamily`. BLAST does
  nothing with them beyond carrying them: RECALL stamps them, PULSE reads them.
  No stackdata change needed — queue merge is whole-clip newest-wins.

## Files
`blast/app.js`

## Rollback
Revert the commit. Additive fields; clips without them behave as today.

## Verification
`pattern-loop-verify.mjs` R5, using the owner's actual Andrew Tate transcript.

## Audit — 2026-07-28

| Step | Result |
|---|---|
| R5 the Video hook field starts empty and is filled in after Suggest | PASS |
| R5 the derived hook is verbatim the opening of the transcript | PASS |
| R5 it is a real opening line (>= 8 words), not one stray fragment | PASS |
| R5 it is not the whole transcript | PASS |
| R5 it is saved onto the Quick clip | PASS |
| R5 it reaches `blast_session_v1.videoHook`, which is what PULSE imports | PASS |
| R5 a hook the user typed themselves is never overwritten | PASS |
| R5 no page errors | PASS |
| Pre-fix proof: the field stays empty on the previous code | PASS |
| Regression: blast-verify, blast-batch-verify, blast-sync-truth-verify, merge-engine-verify | PASS |
