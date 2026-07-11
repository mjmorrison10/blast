---
approved: 2026-07-10
---

# Turn on GoatCounter analytics (blast)

## Goal

Enable the analytics wiring that was staged (commented) in the promo-readiness
pass. User created a GoatCounter account (code: mjmorrisonusa) and provided the
snippet.

## Step

In index.html, replace the commented analytics block (`MJMCODE` placeholder)
with the live snippet:
`<script data-goatcounter="https://mjmorrisonusa.goatcounter.com/count" async
src="//gc.zgo.at/count.js"></script>` (before `</body>`). Same in pulse/index.html.

## Verification

Headless: `document.querySelector('script[data-goatcounter]')` exists and its
value is the mjmorrisonusa URL; no MJMCODE left; no console errors. 15/15
analytics assertions pass across all surfaces.

## Rollback

Revert the branch (re-comment the block). Additive only.
