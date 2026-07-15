---
task: Surface provider rate limits in the UI instead of a generic JSON error
date: 2026-07-15
approved: 2026-07-15
---

# BLAST: surface rate limits / real provider errors

## Goal
An OpenRouter rate limit surfaced only in the console as "Model returned
something that wasn't valid JSON" — invisible on mobile. Two causes:
1. The 429 -> "Rate limited" mapping in llm.js only fires on !res.ok; when
   the provider returns rate-limit PROSE with HTTP 200, parseCaptionJSON
   swallows the text and throws the generic JSON error.
2. suggestCaptionsFromText never passes onPhase into generateText, so the
   retry backoff ("Rate limited — retrying in Ns") shows nothing; the UI
   sits frozen on "Analyzing…".

## Steps
- E1: parseCaptionJSON — strip a markdown ```json fence, then on parse
  failure inspect the raw text: rate-limit markers -> "Provider rate
  limited — wait a minute and retry, or switch provider/key in Settings";
  otherwise include a ~120-char snippet of what the model actually said.
  Replace the inline duplicate parser in adaptCaptionsForPlatforms with the
  helper.
- E2: onPhase plumbing — suggestCaptionsFromText and
  adaptCaptionsForPlatforms accept onPhase and pass it to generateText;
  callers pass the #suggestLabel / #adaptLabel closures (the media path
  already does). llm.js unchanged.
- E3: toast(msg, ms) optional duration; AI error toasts use 6000ms.

## Files touched
blast/app.js only.

## Rollback
Revert the commit. No data or storage changes.

## Verification (headless Playwright, OpenRouter stubbed)
(a) 200 + rate-limit prose -> toast says "rate limited", visible past 3s.
(b) 429 twice then valid JSON -> #suggestLabel shows "Rate limited —
    retrying" during backoff, then captions render.
(c) 200 + other prose -> toast includes the snippet of the model output.

## Execution log (2026-07-15)
- Implemented as designed: parseCaptionJSON now strips markdown fences,
  names rate-limit prose, and quotes a 120-char snippet otherwise; the
  inline duplicate parser in adaptCaptionsForPlatforms replaced with the
  helper; onPhase plumbed through suggestCaptionsFromText,
  suggestCaptionsFromVideo's transcript tail, and adaptCaptionsForPlatforms;
  toast(msg, ms) with 6000ms on both AI catch blocks. llm.js untouched.
- Headless verification: 12/12 PASS — 200+rate-limit-prose yields the named
  rate-limit toast (visible past 3.5s), real 429s surface "Rate limited —
  retrying" in #suggestLabel then succeed on attempt 3, non-JSON prose is
  quoted in the toast, fenced ```json responses now parse. Zero page errors.
- No divergences from plan.
