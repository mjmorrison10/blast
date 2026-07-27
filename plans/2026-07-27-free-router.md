---
approved: 2026-07-27
---

# BLAST: stop the free-model router from eating caption runs

## Goal
Fix the reported failure: "Writing captions failed after 180s — AI request
timed out after 180s". The timeout machinery worked; the model choice is the
problem.

## Diagnosis (checked against the live OpenRouter API)
The owner is on "⚡ Auto: best free model" — OUR label (stackmodels.js:182) for
OpenRouter's `openrouter/free` Free Models Router.
- It is NOT discontinued: `openrouter/free`, `openrouter/auto` and
  `openrouter/auto-beta` are all still live.
- It routes each request to whatever free model has capacity (currently things
  like NVIDIA Nemotron 3 Ultra 550B) and free tiers queue behind other users.
  A 9-platform JSON job can legitimately exceed 3 minutes.
- Router ids matched neither the reasoning-headroom regex nor the slow-model
  warning, so there was no advance signal — and our UI actively promoted the
  option with a lightning bolt.

## Changes
- **stackmodels.js** (byte-identical x3): relabel to "Auto: best free model
  (slow — can queue for minutes)", no lightning bolt.
- **llm.js** (x3): OR_REASONING_RE now matches `openrouter/(free|auto)` —
  routers can land on a reasoning model, so they get the same 3x headroom.
- **app.js**: ROUTER_MODEL_RE drives a router-specific Settings hint and
  run-start toast (queueing, not thinking, is the reason it's slow — and
  gpt-4o-mini is about a cent per batch).
- **app.js `withGeminiFallback`**: when the provider is OpenRouter, a Gemini
  key exists, and the failure is a timeout / spent-thinking / post-retry
  non-JSON / rate-limit / overload, the same job reruns on Gemini. Ticker
  shows "OpenRouter didn't answer — trying Gemini"; a 6s toast says the
  captions came from Gemini. No Gemini key => unchanged clean error and Gemini
  is never called. Wraps the three text caption paths; vision is Gemini-only
  already.

## Rollback
Revert the squash commit. No storage changes.

## Verification (headless Playwright — log below)
Router labelling/warning/headroom; the reported timeout rescued by Gemini via
fake clock; spent-thinking and 429 also rescued; no-key path clean with zero
Gemini calls; fast model untouched; static parity x3.

## Audit
- PLAN approved (this file). EXECUTE/VERIFY/SHIP below.
- EXECUTE stackmodels relabel, llm.js router regex, app.js hint/toast/fallback
  — PASS. (One defect caught in verification: a missing closing brace in
  adaptCaptionsForPlatforms passed `node --check` but broke in the browser;
  found via a dynamic-import parse check, fixed, and the import check is now
  the parse gate for ES modules.)
- VERIFY new suite 29/29 PASS. Regression: blast-reasoning, hangfix, batch,
  aiux, verify, 429, mobile-settings, stack-reasoning all green.
- SHIP: committed, PR squash-merged, live poll confirmed.
