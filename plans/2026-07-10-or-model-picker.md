---
approved: 2026-07-10
---

# OpenRouter model dropdown: live list + pricing + arena.ai ranking (BLAST side)

## Goal

Replace BLAST's free-text OpenRouter "Model" box with a live, priced,
arena.ai-ranked dropdown. Note Gemini's free-tier behavior in the Gemini fields.

## Steps (BLAST)

1. Vendor `stackmodels.js` (byte-identical across recall/Hooklabs/blast;
   exposes `window.StackModels`; fetches OpenRouter's public models API, caches
   24h, ranks the top group from an arena.ai snapshot, formats FREE / $-per-1M
   labels). See recall's plan for the module's full shape.
2. `index.html`: replace `<input id="ormodel" list="ormodels">` + stale
   `<datalist>` with `<select id="ormodelselect">` above a hidden `#ormodel`;
   ranked/pricing hint; Gemini free-tier note; load `stackmodels.js` after
   stacknav.js.
3. `app.js`: in `openSettings()` after `ormodel.value = …`, call
   `window.StackModels.populate(#ormodelselect, ormodel)`. Save handler
   (`#keysave`) unchanged.
4. `style.css`: BLAST had no `select` styling — extend the `.mbody input` rule
   to `.mbody input, .mbody select` (+ `cursor:pointer`, focus border) so the
   new dropdown matches the other inputs.

## Files touched

`stackmodels.js` (new), `index.html`, `app.js`, `style.css`. No `llm.js` change.

## Verification

Same-origin headless Chromium with the OpenRouter models endpoint intercepted:
dropdown visible and styled on OpenRouter, optgroups present, top ranked =
claude-fable, FREE labels, image models excluded, selecting sets the hidden
input, Custom reveals it, cache avoids a second fetch, fetch-failure falls back
to the text input. 40/40 assertions pass.

## Rollback

Revert the branch; additive module, settings format unchanged.
