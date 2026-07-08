---
approved: 2026-07-08
---

# Add OpenRouter provider option + video-to-captions suggestions

## Context

Two features requested together: (1) a pluggable AI provider so users can
choose OpenRouter (any text model) instead of Gemini, with Gemini staying
the zero-config default; (2) upload an edited clip and get AI-suggested
captions per platform, with a choice of 1/3/5 options, instead of writing
captions from scratch.

Approved via ExitPlanMode in the same session that wrote this plan (plan
mode workflow — the full plan, including the codebase research behind it,
lives in that session's plan file). This repo copy exists so the doctrine's
audit trail is visible here too, not just in the planning session.

## What was built

- `llm.js` — provider abstraction (Gemini default, OpenRouter optional).
  Gemini keeps its Files API path for large media (up to 2GB) and native
  video understanding; OpenRouter is text-first with a small inline-media
  ceiling (~15MB) and no reliable video input, so video analysis is
  Gemini-only and the UI disables that option automatically when
  OpenRouter is selected rather than let it fail.
- Settings modal: provider radio (Gemini/OpenRouter), OpenRouter key +
  model fields, same BYO-key/localStorage pattern as the existing Gemini
  key.
- Caption adaptation ("Adapt for each platform") now goes through
  `llm.js`, provider-aware — unchanged behavior on Gemini.
- New "Suggest captions from video" panel: mode toggle (watch the video /
  from transcript), count selector (1/3/5 options per platform), results
  render as selectable chips per platform card that fill the existing
  editable caption box.

## Verification

Headless-browser pass (Playwright): settings save/persist/clear for both
providers; caption adapt unchanged on mocked Gemini; OpenRouter request
shape (Bearer auth, OpenAI `messages`) verified via request interception;
video-suggestion vision mode (mocked) fills N options per platform;
transcript mode (mocked transcribe + mocked caption call) same; vision
mode auto-disables when OpenRouter is selected; count selector produces
the right number of options; existing ffmpeg reformat regression test
still produces a real 1080x1920 output.

## Rollback

Feature branch `claude/openrouter-and-video-captions`, PR opened for
review. Nothing reaches `main` without a separate go-live plan + explicit
approval, per this repo's own doctrine.
