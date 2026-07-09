---
approved: 2026-07-09
---

# BLAST — Threads platform, prefilled compose intents, RECALL caption handoff

## Context

Companion to RECALL's Top Posts (plans/2026-07-09-top-posts.md in the recall
repo): the Top Clips evidence pipeline extended to text posts for X and Threads.
BLAST's half: Threads becomes platform #9, X/Threads open a compose window with
the caption already prefilled, and BLAST accepts a caption handed off by RECALL.
Ships safely alone — with no handoff key present the import is a no-op.

## What was built

- **Threads** added to `PLATFORMS` (🧵, threads.net) and `PLATFORM_RULES`
  (limit 500, hashtagMax 3 — Threads convention is minimal hashtags). Presets,
  validation, Adapt/Suggest prompts, and the session tracker all iterate the
  platform list, so Threads inherits everything with no further changes.
- **Prefilled compose intents** — `INTENT_URLS` (X: x.com/intent/post?text=…,
  Threads: threads.net/intent/post?text=…) + `openUrlFor()` with a 2000-char
  URL guard (too long → plain page URL). "Copy + open" still copies to the
  clipboard first as the backup; the button reads "Copy + open compose →" on
  intent platforms.
- **RECALL handoff** — `consumeHandoff()` at boot (between loadSession and
  renderPlatforms) reads `blast_handoff_v1` {caption, source, createdAt}.
  Consumed ONLY when no caption is in progress; an in-flight session leaves the
  key untouched as a pending import. Malformed/empty payloads are
  garbage-collected. Import toasts "Caption imported from RECALL".
- Prose: meta/lede/README now say 9 platforms + prefilled-compose + import notes.

## Files touched

`app.js` (PLATFORMS, PLATFORM_RULES, INTENT_URLS/openUrlFor, copyopenbtn open
URL, openLabel, consumeHandoff at boot), `index.html` (meta, lede), `README.md`.

## Rollback

One squash commit on a feature branch; revert redeploys the prior state. The
handoff key simply goes unread if reverted. Session/settings shapes unchanged.

## Verification

Headless Chromium: 9 cards with Threads showing 0/500 + working ✎ preset;
stubbed window.open captures prefilled intent URLs for X/Threads and plain URLs
for others; 2100-char caption falls back to the plain X URL; handoff consumed
when caption empty (key removed, toast) and left untouched when a session is in
progress; Adapt prompt includes Threads and a 9-key response fills its card;
progress reads "of 9"; zero console errors. Results recorded on execution.
