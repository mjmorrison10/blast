---
approved: 2026-07-27
---

# BLAST: survive reasoning models on OpenRouter

## Goal
Fix the reported failure: "Writing captions failed after 58s — Model didn't
return JSON — it said: 'We need to produce JSON with keys: YouTube Shorts,
TikTok, Instagram Reels, Snapchat Spotlight, Facebook Reels, X, Threa…'"

## Diagnosis
The selected OpenRouter model is a reasoning-style model that emitted its
chain-of-thought as the response text. Chain:
1. Model thinks out loud before writing any JSON.
2. The max_tokens budget added earlier today is sized for CAPTIONS, but
   OpenRouter bills reasoning as output tokens — so it cut the model off
   mid-thought.
3. finish_reason "length" + partialOnTruncate returned the truncated prose.
4. parseCaptionJSON found no JSON and raised the (correct) non-JSON error.

The new error surfacing worked; the run still failed. Before the budget cap an
uncapped reasoning model could ramble and THEN emit JSON, so the cap made this
failure mode more likely. Note: fake-key stubs can't produce this — it only
appears with a live reasoning model, which is why the existing suites missed it.

## Changes
- **llm.js request side**: `OR_REASONING_RE` detects reasoning-tier model ids;
  those get 3x the caption token budget (clamped 16000) so thinking can't eat
  the answer. jsonMode requests now send OpenRouter's `reasoning` param —
  `{exclude:true}` on Best quality, `{effort:"minimal",exclude:true}` on
  Fastest — so the toggle finally means something on OpenRouter. A 400 whose
  body mentions "reasoning" retries once without the field (models that make
  reasoning mandatory, or don't support the param).
- **llm.js response side**: strip `<think>…</think>` from content; when what's
  left has no JSON and the reply was truncated / had an unclosed think tag /
  carried a reasoning field with empty content, throw a named error —
  "The model spent the whole response thinking and never wrote the captions —
  pick a faster model in Settings, or just run it again" — instead of quoting
  the monologue back at the user.
- **app.js**: parseCaptionJSON strips think-text too and tags non-JSON
  failures; `withJsonRetry` retries ONCE with "respond with ONLY the JSON
  object, your reply must start with '{'" (phase shown in the ticker) across
  adapt, batch suggest, transcript suggest and vision. SLOW_MODEL_RE broadened
  to the same family list (qwq, kimi, glm-4.5+, minimax, magistral, grok-3+…).
- **index.html**: the toggle hint now says Fastest also asks OpenRouter models
  to skip extended reasoning.

## Rollback
Revert the squash commit. No storage changes.

## Verification (headless Playwright — log below)
Nine scenarios incl. a reproduction of the exact reported response.

## Audit
- PLAN approved (this file). EXECUTE/VERIFY/SHIP below.
- EXECUTE llm.js request+response, app.js parse/retry/regex, hint — PASS.
- VERIFY new suite 28/28 PASS: think-tag stripping, the reported
  prose+truncation case producing the named error with a retry, prose-then-JSON
  salvage, prose-only recovering on the automatic retry with the nudge present
  only on attempt 2, 3x headroom for reasoning ids vs unchanged budget for fast
  ones, toggle-driven reasoning params, 400 fallback dropping the field, empty
  content + reasoning field, and the broadened slow-model hint. Regression:
  blast-verify, aiux, 429, context, hangfix, batch all green.
- SHIP: committed, PR squash-merged, live poll confirmed.
