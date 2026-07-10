---
task: Paste-a-transcript caption suggestions + HOOKLAB-informed prompts
date: 2026-07-10
approved: 2026-07-10
---

# BLAST — transcript-driven caption suggestions

## Goal

The "Suggest captions from video" panel required uploading a video and its hint
pointed at an unnamed "optional section below". Creators coming from the RECALL
workflow already have a transcript — they shouldn't have to re-upload the video.
Let them paste a transcript and get per-platform caption suggestions, and lean
those suggestions on the creator's own proven hooks from HOOKLAB.

## Changes

### index.html — suggest subpanel (`#videoSuggestPanel`)
- Added a `#transcript` textarea as the primary input ("Paste a transcript").
- Rewrote the copy into two clear routes: paste a transcript (no upload), or
  a `#jumpToUpload` link that names and scrolls to the "Also reformatting a clip
  to 9:16?" section. Mode radios relabeled "If uploading a clip instead".
- Added a `#hookStatus` line for the HOOKLAB evidence state.
- Button text "Suggest captions from video →" → "Suggest captions →".

### app.js
- `loadHooklabEvidence()`: reads `hooklab_state_v1` (same-origin), returns up to
  15 ledger winners with a three-state `reason` (absent / empty / no-winners).
- `hooklabEvidenceBlock(ev)`: prompt fragment appended to any suggestion prompt
  when winners exist — "prefer captions echoing these proven structures/voice;
  still ground everything in the transcript" (personal ledger > generic).
- `renderHookStatus()`: status line mirroring RECALL's ledger copy, with a link
  to the full HOOKLAB app when there's nothing to lean on.
- Refactored suggest into `suggestCaptionsFromText(transcript, count, evidence)`
  (reused by both the paste path and the video-transcribe path) and
  `suggestCaptionsFromVideo(file, mode, count, evidence, onPhase)`.
- `#suggestBtn` handler priority: pasted transcript → uploaded clip → helpful
  toast ("Paste a transcript above, or upload a clip in the 9:16 section below").
  The transcript path calls `generateText` directly (no transcription step) and
  works on any provider. Reuses the existing `platformSuggestions` render path.
- Transcript persisted in `blast_session_v1` (save/load/reset) + saved on input;
  status refreshed on transcript focus. `renderHookStatus()` called at boot.

### style.css
- `#transcript` shares the `#caption` textarea styling (more contrast inside the
  subpanel); added `.fieldlabel` and `.hookstatus` styles.

## Not in scope (flagged in PR)
- RECALL passing its transcript through `blast_handoff_v1` — the channel supports
  it, but that's a cross-repo change to design later.

## Verification (headless Chromium, stubbed network) — PASS (13 checks)
- Transcript-only: chips render per platform, `generateText` called once (no
  transcription), request body contains the pasted transcript, picking a chip
  fills the caption.
- HOOKLAB winners seeded: evidence block present in the request body (winners
  included, flops excluded); status line shows "2 winning hooks".
- No ledger: status shows the "open the full HOOKLAB app" nudge; prompt has no
  evidence block.
- Empty inputs → new transcript-or-upload toast. Transcript restored after
  reload (session persistence).

## Rollback
Revert this branch; changes confined to `index.html`, `app.js`, `style.css`.
