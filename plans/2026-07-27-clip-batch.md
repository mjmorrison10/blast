---
approved: 2026-07-27
---

# BLAST: hold a batch of clips, not one

## Goal
Wave C leg 3 of 4 — the activator. The owner edits a podcast into 20-30 clips
at once, then posts them through the day. BLAST modelled exactly ONE clip, so
every clip meant a fresh session and another wait on the AI, often on bad
service. Now BLAST holds the whole batch: set each clip's platforms, generate
once, post from the cards over the following days.

## Facts
- Eight module-level platform* maps were the de-facto state, serialized into
  blast_session_v1 — a shape PULSE's import depends on.
- resetSession() was the only way to move to the next clip, and it discarded
  everything.

## Changes
- **posts array is the source of truth**, loaded from blast_queue_v1 (written
  by RECALL). A permanent "quick" post preserves the paste-a-caption-and-go
  flow. `bindPost` points the platform* maps AT a post's own objects, so the
  existing ~240 lines of card wiring mutate the post itself; a capture-phase
  binder on each section re-points them before any handler runs, which is what
  lets several posts' platform grids coexist in the DOM.
- **blast_session_v1 stays the Quick post's projection** — unchanged shape, so
  PULSE keeps working. An in-flight pre-upgrade session migrates into the Quick
  post on first load (one-way, persisted immediately).
- **Queue UI**: one collapsed card per clip (preview, source, state badge,
  posted count). Expanding renders THAT clip's platform grid lazily — 24
  collapsed cards render zero platform cards. Per-clip platform picker (with
  "use as default for new clips"), inline base-caption edit, per-clip remove.
- **Generate captions for all**: sequential, per-clip progress through the
  existing aiRun timer/model label, only the clip's selected platforms in the
  prompt, saves after EVERY clip (reload mid-batch keeps finished work and
  resume skips it), continue-on-error with the reason on the card, Stop
  between clips. Options per platform is selectable 1/2/3 (persisted in
  blast_batch_count_v1) with a cost hint; >1 stores suggestion arrays in the
  existing shape and auto-applies option 1 so every card is copy-ready.
- Storage pressure: savePosts drops UNPICKED suggestion options (oldest clips
  first) and retries once before reporting failure.
- The session bar now summarizes the whole batch.
- **stackdata.js** (all four copies, byte-identical): blast_queue_v1 added to
  SYNC_EXCLUDE, same precedent as blast_handoff_v1 — a device-local posting
  inbox has no business syncing to Drive.

## Rollback
Revert the squash commit. blast_session_v1 keeps being written throughout, so
the previous version reads its state back unchanged.

## Verification (headless Playwright — log below)
Empty queue behaves exactly as before (9 cards, session written, mark-posted
lands in PULSE's shape); migration; lazy sections; per-clip platforms;
generate-all with continue-on-error, resume, and platform scoping; options 1/3
with scaled token budget.

## Audit
- PLAN approved (this file). EXECUTE/VERIFY/SHIP below.
- EXECUTE posts model + bindPost + projection + migration — PASS.
- EXECUTE queue UI, platform picker, batch generate, storage fallback — PASS.
- EXECUTE stackdata SYNC_EXCLUDE across four copies (sha256 identical) — PASS.
- VERIFY new suite 36/36 PASS; regression: blast-verify, aiux, 429, context,
  hangfix, mobile-settings all green (one mobile assertion re-scoped because a
  second modal now exists in the DOM).
- SHIP: committed, PR squash-merged, live poll confirmed.
