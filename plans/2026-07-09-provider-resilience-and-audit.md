---
task: 429 resilience + audit fixes (part of RECALL workflow sweep)
date: 2026-07-09
approved: 2026-07-09
---

# BLAST — provider resilience + audit fixes

## Goal

Part of a cross-app sweep triggered by RECALL's Gemini 429s and a dead
OpenRouter model slug. BLAST shares RECALL's provider layer and is the last
stop in the RECALL → HOOKLAB → BLAST workflow (it receives a caption handoff
from RECALL), so it gets the same hardening plus fixes for real bugs found in
an audit.

## Changes

### llm.js — rate-limit resilience + current model
- Added `fetchWithRetry()` (retry on HTTP 429, up to 3 attempts, 4s/12s backoff,
  honoring Google's `RetryInfo` delay, capped at 20s), wrapped around every
  `generateContent` call, the Files upload-start, and both OpenRouter calls.
- Upgraded Gemini endpoint `gemini-2.0-flash` → `gemini-2.5-flash`.
- Map OpenRouter 404 / "no endpoints found" to an actionable message.

### app.js / index.html — dead-slug migration + audit fixes
- OpenRouter default model `google/gemini-2.0-flash-001` (retired → 404) →
  `google/gemini-2.5-flash`, in defaults, settings input, and datalist;
  `loadSettings()` silently upgrades retired slugs saved in localStorage.
- **XSS fix:** the uploaded file name is now `escHtml()`-escaped before going
  into the upload-zone `innerHTML`. A file named `<img src=x onerror=…>.mp4`
  (drag-drop bypasses the `accept` filter) previously ran script in the app's
  origin — the origin holding the saved API keys. (audit finding #1)
- **Stale validation fix:** clicking an AI suggestion chip now calls
  `refreshValidation()`, so the character counter and over-limit warning update
  immediately instead of reflecting the previous caption. (audit finding #2)
- **Post-status fix:** the post-URL `input` handler only promotes a platform to
  "posted" for a plausible `https?://` URL (and refreshes status), so typing
  then clearing the field no longer strands the platform permanently "Posted"
  in a tool whose job is accurate posting status. (audit finding #3)

## Verified (not a bug)
- RECALL → BLAST handoff: RECALL writes `blast_handoff_v1`
  (`recall/topclips.js`) and BLAST reads the same key (`app.js`), with matching
  payload shape. Works.

## Verification (headless Chromium, stubbed network) — PASS
- App loads with no page errors; llm.js on gemini-2.5-flash with `fetchWithRetry`.
- Dead OpenRouter slug migrated in the settings UI.
- Filename with an `onerror` img renders escaped and does not execute.

## Rollback
Revert this branch; changes confined to `llm.js`, `app.js`, `index.html`.
