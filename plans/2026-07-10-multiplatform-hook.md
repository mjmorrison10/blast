---
approved: 2026-07-10
---

# One clip, all platforms: multi-platform tracking + hook/caption separation

## Goal

When a creator posts one clip across several platforms, PULSE should track all
of them at once — from BLAST and from PULSE's manual add — with the per-platform
link optional and addable later. And the video hook (spoken opening line) must
be a first-class field separate from the caption (posted text), flowing BLAST →
PULSE → HOOKLAB. Single repo: BLAST + PULSE both ship from blast.

## What was built

### BLAST — a "Video hook" field (the missing hook home)
- `index.html`: `#videohook` input above the base caption, labeled and hinted;
  caption relabeled "the posted text".
- `app.js`: persisted as `videoHook` in `blast_session_v1`
  (save/load/reset + a debounced input listener alongside `#caption`).
- `style.css`: `input#videohook` styling.

### PULSE — import all posted platforms, links optional, hook separate
- `makePost(platform, url, caption, postedAt, hook, blastKey)`: `hook` is its
  own field (falls back to caption's first line for legacy callers); `url`
  optional; records `blastKey` when supplied.
- `importFromBlast`: imports every platform with status `posted` (URL no longer
  required), reads `s.videoHook` for the hook, keeps the per-platform posted
  caption, dedupes on `blastKey = name + "|" + postedAt` (falls back to
  platform+url for pre-existing posts).
- Manual add: `#mPlatforms` checkbox row pre-checked from "platforms you're
  running" (BLAST session active platforms → preset keys → all); separate
  `#mHook` + optional `#mCaption`; optional `#mUrl` attaches to the
  domain-matching platform (`platformForUrl`) or the first checked one; one
  post per checked platform, same hook/caption/time.
- Cards: a `＋ add link` button (`setlink` action, prompt-based) when a post has
  no URL — saving triggers a YouTube auto-check; a muted `.capline` shows the
  caption under the hook when they differ.
- `logToLedger` unchanged (already prefers `post.hook`).

## Files touched (blast repo only)

`blast/index.html`, `blast/app.js`, `blast/style.css`,
`blast/pulse/index.html`, `blast/pulse/app.js`, `blast/pulse/style.css`.

## Verification

Same-origin headless harness: BLAST video hook persists to the session and
restores on reload; PULSE imports all posted platforms (skipped excluded, links
optional, hook = video hook, caption kept separate, blastKey dedupe on
re-import); add-link-later saves + auto-checks; manual add fans out one clip to
all checked platforms with a single link attached to its matching platform;
the HOOKLAB ledger hook is the spoken hook, not the caption; legacy posts still
render. 26/26 new assertions pass; hygiene (26), picker (40), nav (24) suites
still green.

## Rollback

Revert the branch. Storage changes are additive (`videoHook` in the session,
`blastKey` + separate `hook` on new posts); old posts keep working via the
legacy fallbacks.
