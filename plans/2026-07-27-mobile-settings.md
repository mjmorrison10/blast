---
approved: 2026-07-27
---

# BLAST: settings that are readable on a phone

## Goal
Wave B leg 1 of 3. On a 390px phone the owner could not tell "Best quality"
from "Fastest" — his words: "it's kind of hard to read or understand on
mobile. Like I know because I built it but even I kind of have to guess."

## Facts (measured before the change)
- No media query touched the modal; the only breakpoint (640px) adjusts .wrap.
- .mbody content width at 390px is ~318px, so the two-pill rows half-wrapped.
- .pilltag was 10px monospace in var(--faint) — roughly 3.4:1, below WCAG AA.
- .radiopill computed to ~36px tall, under the 44px touch-target minimum.
- .mbody inputs were 14px, under the 16px iOS zoom-on-focus threshold.
- 88vh + no safe-area padding put the footer under the browser chrome.

## Changes
- **index.html**: the provider and thinking groups become stacked radio
  CARDS — each option carries a title plus a plain-language description
  (".pilltag" jargon moves into that sentence). Same input names/values, so
  no JS changes.
- **style.css**: .radiocards (column, full-width); .radiopill min-height 44px,
  18px accent-colored radio, checked = accent border + inset ring + ghost bg;
  .rtitle 14px/600 var(--ink); .rdesc 12px var(--muted) (AA-passing);
  .mbody label 12px; inputs 16px/min-height 44px; 88dvh under @supports;
  footer safe-area padding; a 480px breakpoint that stacks every option group.
- **The reset that mattered**: .mbody label is uppercase monospace and a
  .radiopill IS a label, so the card text first rendered as "SKIPS THINKING.
  ANSWERS SOONER..." — .mbody .radiopill/.rtitle/.rdesc now opt back into
  sans + sentence case.

## Rollback
Revert the squash commit. Presentation only — no JS, no storage.

## Verification (headless Playwright at 390x844, iPhone UA)
Cards >=44px, equal full width, title + description each, AA contrast with
alpha compositing, inputs >=16px, distinct checked state, tap selects,
footer on screen, no horizontal scroll, sans/sentence-case text; 1280px
desktop regression.

## Audit
- PLAN approved (this file). EXECUTE/VERIFY/SHIP below.
- EXECUTE markup + CSS as described, including the label-inheritance reset
  caught by screenshot review — PASS.
- VERIFY: 47/47 across BLAST/RECALL/HOOKLAB plus the desktop regression.
- SHIP: committed, PR squash-merged, live poll confirmed.
