---
approved: 2026-07-09
---

# BLAST — phase 2: per-platform presets + soft caption validation

## Context

Follow-on to the posting command center (`plans/2026-07-08-posting-command-center.md`),
which explicitly deferred presets and per-platform caption validation as the next
phase. Both are static / zero-AI, additive, and backward-compatible — an absent
`blast_presets_v1` key means the old behavior, and validation is display-only.
Plan → Approve → Execute → Audit; feature branch + PR; no merge to main without a
separate go-live step.

## What was built

**Soft caption validation** (all advisory — never blocks a copy or disables a button):
- `PLATFORM_RULES` — real per-platform caption limits + recommended hashtag maxes.
  Documented judgment calls: YouTube Shorts = 100 (the *title*, the limiting field
  shown under a Short; the 5000-char description is a separate box BLAST doesn't
  model), Snapchat Spotlight = 80 (short caption overlay, conservative).
- `validate(caption, rules)` — pure function: char count vs limit (amber at ≥90%,
  red over), hashtag count vs max, ALL-CAPS (≥15 letters, uppercase-equal), and
  excessive-emoji (`\p{Extended_Pictographic}`, >8) checks.
- `refreshValidation(card, p)` — surgical per-card updater (same discipline as
  `refreshStatus`): updates a `.pmeta > .valcount + .valwarn` row and toggles
  `.pcaption.invalid` on keystroke, never re-rendering the card. Also called once
  per card at render, so it recomputes on every path (type, Adapt, Suggest, Apply
  preset, Apply all, load, Reset).
- New `--warn`/`--warn-ghost` (amber) and `--danger`/`--danger-ghost` (red) CSS
  tokens across all four theme blocks; `.valcount` mirrors `.statuschip`.

**Per-platform presets** (explicit apply — never auto-applies, never clobbers):
- One `{caption}`-template per platform in `blast_presets_v1` (single-blob store,
  mirrors the settings pattern). `loadPresets`/`savePresets`, `applyTemplate` (split/
  join on `{caption}`).
- Per-card ✎ toggle reveals an inline template editor (Save persists it). A
  per-card "Apply preset" button (shown only when a template exists) and a global
  "Apply all presets" button next to Adapt substitute `{caption}` with the current
  base caption and write `platformCaptions[name]` — exactly like Adapt.
- `resetSession` untouched, so presets survive Reset session.

## Files touched

- `app.js` — `PLATFORM_RULES` + heuristic consts, `validate`, `refreshValidation`,
  `loadPresets`/`savePresets`/`applyTemplate`, preset editor + apply wiring in
  `renderPlatforms`, global Apply-all handler.
- `index.html` — `#applyAllPresets` button in the Adapt actionrow.
- `style.css` — `--warn`/`--danger` tokens (4 theme blocks), `.valcount`/`.valwarn`/
  `.pcaption.invalid`, `.presetedit`/`.presetpanel`/`.presetinput`/`.presetsave`/
  `.presetrow`.

## Verification

Headless Chromium (global Playwright, served via http-server; `pageerror` listener
doubles as the ES-module syntax check): 8 counters show `N / <limit>` matching
PLATFORM_RULES; >280 chars in X → red counter + `.invalid`, copy still enabled;
ALL-CAPS + emoji + over-max hashtags → warnings; TikTok preset applies to the field;
presets persist across reload and survive Reset session; Apply-all applies all saved
presets; no console/page errors; light + dark screenshots confirm amber/red don't
collide with brand orange / posted green. Existing flows (settings, adapt, suggest,
command-center) stay green.

## Rollback

Additive feature branch; open a PR, don't merge without go-live. Absent
`blast_presets_v1` → old behavior; validation is display-only. Revert = drop the
commits (the branch doesn't deploy until merged to main).
