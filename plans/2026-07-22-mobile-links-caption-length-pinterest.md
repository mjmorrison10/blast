---
approved: 2026-07-22
---

# BLAST: mobile deep links + caption length + Pinterest title/desc + AI speed

## Goal
Owner's iPhone 14 Pro Max walk-through surfaced four things:
1. "Copy + open" opens plain web URLs for every platform. On mobile that means
   X's web intent gets hijacked into the X app's in-app browser and freezes,
   and TikTok lands on a useless web upload page. (YouTube/Threads/Pinterest
   are great; IG/Snap/FB "just open the app", which is fine.)
2. AI captions are too short for Instagram/Facebook; owner wants a
   Short/Medium/Long control. The AI never actually saw the per-platform char
   caps (they lived only in the on-screen counter).
3. Pinterest needs separate title + description (didn't exist — single caption).
4. AI feels slow (same Gemini-thinking cause as RECALL).

Confirmed choices: X → native composer `twitter://post?message=`; TikTok →
open the app via `snssdk1233://`.

## What changed
### Mobile deep links (app.js)
- `IS_MOBILE` (UA test) + `SCHEME_URLS` (X → `twitter://post?message=<cap>`,
  TikTok → `snssdk1233://`, comment noting `tiktok://` fallback).
- `openUrlFor` → `navTarget(p, text)` returning `{url, mode}`; mobile + scheme
  entry → `mode:"scheme"`, else the existing intent/plain-URL logic → `"tab"`.
  `window.__navTarget` exposed as a headless test hook.
- Copy+open handler: copy first, then `mode==="scheme"` → `location.href=url`
  (reliable iOS app handoff that doesn't unload the page; `window.open` on a
  custom scheme leaves a blank/blocked tab), else `window.open` as before.
  Launch stays synchronous in the click gesture. Button label → "app" for
  mobile scheme platforms. Every other platform is byte-identical on all devices.

### Caption length preference (app.js, index.html)
- `LS_CAPTION_LEN = "blast_caption_len_v1"` (its own key — the Settings save
  handler rewrites `blast_settings_v1` wholesale and would wipe a pref stored
  there). `getCaptionLengthPref()` defaults "medium".
- `LENGTH_TARGETS` table (per platform × short/medium/long char ranges) and
  `lengthGuidanceBlock(pref)` — emits per-platform "hard cap N (never exceed);
  aim for X" lines from `PLATFORM_RULES` + targets, a Snapchat always-≤80 note,
  a YouTube visible-title note, and a genuine long-form story-style instruction
  for IG/FB/LinkedIn on "long". Injected into BOTH the Adapt and Suggest prompts
  (covers text, transcript, and video flows).
- UI: Short/Medium/Long `.radiopill` row in the suggest panel; init from storage
  + change listener persists.

### Pinterest title + description (app.js, style.css)
- Pinterest's AI value is now an object: Adapt → `{title, description}`, Suggest
  → array of those. Other platforms stay strings; a stray plain-string reply
  degrades to description-only (legacy behavior). Prompts updated to require it.
- `platformTitles` state added to save/load/reset (`titles:` in
  `blast_session_v1`; old sessions load clean via `s.titles || {}`).
- UI: Pinterest card gets a `.ptitle` input above the description box, a
  "Copy title" button, and its "Copy only" relabeled "Copy description".
  Copy+open still copies the description (the pin builder's main paste target).
  Suggestion chips render "title — description" and picking one fills both.
  `suggestLabel/Desc/Title` helpers read either shape.

### AI speed (llm.js)
- `thinkingConfig:{thinkingBudget:0}` on both Gemini text + media calls (same
  fix shipped to RECALL) — disables 2.5 Flash's default hidden reasoning.

## Files touched
`app.js`, `index.html`, `style.css`, `llm.js`. Session schema is additive only.

## Rollback
Revert the four files (or the squash-merge commit). Old sessions unaffected
(the `titles` key is optional; caption/suggestion string shapes still parse).

## Verification — PASS (headless Playwright, 2026-07-22)
40/40 green:
- Desktop: X copy+open opens `x.com/intent/post?text=`, TikTok opens
  `tiktok.com/upload`; `__navTarget` returns tab mode.
- Mobile (iPhone UA): `__navTarget` → `twitter://post?message=…` (scheme) for X,
  `snssdk1233://` (scheme) for TikTok, unchanged https/tab for
  YouTube/Threads/Pinterest/Instagram; X button labeled "app"; clicking X
  copy+open copies the caption, does NOT call `window.open`, page stays alive.
- Length: Long persists across reload; Adapt prompt carries "hard cap 2200",
  "Always <=80", the story-style instruction, "wants LONG", and the Pinterest
  object-shape instruction.
- Pinterest: adapt object fills title input + description; Copy title / Copy
  description copy the right strings; both persist across reload; suggest array
  renders "title — description" chips and picking fills both; non-Pinterest
  chips stay plain strings.
- Backward compat: an old-shape session (string Pinterest caption + string
  suggestions, no `titles`) loads and renders with no page errors.
Script: scratchpad/blast-verify.mjs.

## On-device checklist (owner, after deploy)
- X copy+open → native composer opens with the caption pre-filled; returning to
  Safari, BLAST tab intact. TikTok copy+open → app foregrounds (if it no-ops,
  report back and we swap to `tiktok://`). YouTube/Threads/Pinterest unchanged;
  IG/Snap/FB still open the app.
- Set Long, run Suggest on a real clip → IG caption is genuinely long
  (hook + paragraphs + CTA + hashtags); Snapchat still ≤80.
- Pinterest: paste title into the title field, description into the description.
- Adapt/Suggest should feel snappier (thinking off).

## Audit (post-execution)
- PLAN: written + approved (this file). PASS
- EXECUTE: app.js, index.html, style.css, llm.js edited as planned. PASS
- VERIFY: 40/40 headless assertions green. PASS
- SHIP: push → PR → squash-merge → live-URL cache-busted poll (below).
