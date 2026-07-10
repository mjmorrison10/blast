---
approved: 2026-07-10
---

# Promotion readiness: services bridge + analytics wiring (blast)

## Goal

Prep for promotion (see mjmorrisonusa/LAUNCH.md). Two additive changes only, no
features: a services bridge line in the footer so app users discover the paid
offer, and analytics wiring left commented until the user creates an account.

## Steps

1. `index.html` footer: add a "Built by Michael Morrison — 314K followers, 50M+
   monthly views. Want this workflow customized for your show?" line linking to
   `https://mjmorrisonusa.com/#/webdev?utm_source=<app>`, reusing footer styles.
2. `index.html` before `</body>`: a **commented-out** GoatCounter snippet with a
   `TODO(user)` to create a free account, replace MJMCODE, and uncomment. No
   network calls until then.

## Verification

Headless: footer shows the bridge line with the correct utm_source; the
analytics block is present but the `<script data-goatcounter>` is NOT loaded
(stays off). Existing app suites unaffected. 18/18 promo assertions pass across
the apps + site.

## Rollback

Revert the branch; both changes are additive markup/comments.
