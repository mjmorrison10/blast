---
approved: 2026-07-27
---

# BLAST: kill the 300s caption hang (full-body deadline, token budgets, model visibility)

## Goal
Wave A leg 1 of 3. Captions on OpenRouter could run 300+ seconds with no
error, no console output, and no way to tell what was happening. Bound every
request, cap every generation, salvage truncated responses instead of throwing
them away, and make the running model visible.

## Facts (verified before the change)
- `fetchWithTimeout` cleared its abort timer the moment the Response headers
  resolved; the subsequent `res.json()` was unbounded. OpenRouter's
  non-streaming endpoint returns 200 headers early and holds the connection
  open for the whole generation, so the abort NEVER fired. That is the exact
  "no error, ticker keeps climbing" signature.
- Same unbounded-read hazard at the retry loop's `res.clone().text()` and the
  OpenRouter error path's `res.text()`.
- Retries could legally reach ~556s (3 attempts x 180s + backoff) before
  surfacing anything.
- NO maxTokens anywhere in app.js: adapt = 9 platforms in one call; suggest =
  9 platforms x up to 5 options = 45 captions in one JSON. Truncation
  (`finish_reason: "length"` / `MAX_TOKENS`) threw the whole response away.
- `StackModels.populate` defaulted an empty model input to the TOP
  arena-ranked model — a reasoning tier — and the shared key store can change
  the model from another app without touching BLAST.

## Changes
- **llm.js**: `fetchBodyWithTimeout(url, init, ms, what)` returns
  `{res, bodyText}` with the body read INSIDE the abort window; every AI-path
  fetch uses it. `fetchWithRetry` threads `{res, bodyText}` and stops retrying
  once `OP_BUDGET_MS` (240s) would be exceeded. Extractors take
  `(res, bodyText, partialOnTruncate)` and return truncated-but-usable text
  instead of throwing when the caller opts in.
- **app.js**: `captionTokenBudget(names, count, pref)` (400 + n x count x
  per-length, clamped 16000) passed as maxTokens from adapt + both suggest
  paths; transcription capped at 8000. `salvageCaptionObject` recovers whole
  `"Platform": value` pairs from a cut-off response (string/escape aware, each
  pair JSON.parsed on its own); `parseCaptionJSON` falls back to it and marks
  the result `__partial` (non-enumerable), which the handlers report as
  "Adapted N of M platforms". `lengthGuidanceBlock(pref, names)` only emits
  the platforms being asked for. `activeModelLabel()` shows the model in the
  progress ticker; `SLOW_MODEL_RE` drives a Settings hint + a run-start toast.
- **stackmodels.js**: `pickFastDefault(models, ranked)` — prefer
  openai/gpt-4o-mini, else a flash/mini/haiku/lite tier, else the ranked
  leader.
- **index.html**: `#slowModelHint` line under the model field.

## Rollback
Revert the squash commit. No storage changes, no new keys.

## Verification (headless Playwright — log below)
Stalled-body stub aborts at the deadline; truncated response applies the
platforms that arrived; retry budget caps wall time; request bodies carry
max_tokens; ticker shows the model; slow-model hint appears; existing suites
green.

## Audit
- PLAN approved (this file). EXECUTE/VERIFY/SHIP below.
- EXECUTE llm.js: fetchBodyWithTimeout returning {res, bodyText} with the body
  read inside the abort window; all 9 AI-path call sites converted; retry loop
  reuses bodyText (no more res.clone().text()); OP_BUDGET_MS caps the retry
  arithmetic; both extractors take (res, bodyText, partialOnTruncate) — PASS.
- EXECUTE app.js: captionTokenBudget + partialOnTruncate on adapt/suggest-text/
  suggest-vision (transcription capped 8000); salvageCaptionObject +
  parseCaptionJSON fallback marking __partial; partial toasts on both handlers;
  lengthGuidanceBlock(pref, names); activeModelLabel in the ticker;
  SLOW_MODEL_RE toast + refreshSlowModelHint wired to input/select — PASS.
- EXECUTE stackmodels.js pickFastDefault; index.html #slowModelHint — PASS.
- VERIFY new suite 23/23 PASS, including the core regression: a stalled body
  (headers only, body never completes — the exact OpenRouter hang) now aborts
  at the deadline and writes "timed out after 180s" to the error line with the
  button re-enabled, verified via Playwright's fake clock. Also: ticker shows
  the model, truncated 7-of-9 response applies 7 captions with no error line,
  max_tokens 3100 on a 9-platform medium run, slow-model hint on/off.
- VERIFY regression: blast-aiux (2 stale assertions updated for the
  intentional label/helper rename), blast-verify, blast-429, blast-context all
  green. (blast-app-check.mjs is a stale scratch helper importing a
  non-existent local llm.js — broken before this change, unrelated.)
- SHIP: committed on claude/handoff-doctrine-fable-opus-5bs5cv, PR
  squash-merged, live poll confirmed on Pages (logged after merge).
