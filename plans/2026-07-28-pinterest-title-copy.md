---
approved: 2026-07-28
---

# BLAST: "Copy + open" hands Pinterest the Pin title

## Goal
Owner's request: on Pinterest, "copy and open upload" should copy the title and
only the title. "That way if someone wants the description, they can switch
back to the app for the description but otherwise getting the title copied is
sufficient."

## Why it was wrong
Pinterest is the one platform with a separate title and description. The
clipboard holds one thing, and "Copy + open" was handing over the description —
but the pin builder asks for a title first, so the one field you can't proceed
without was the one field not on the clipboard.

## Changes (blast/app.js)
- `copyopenbtn`, Pinterest only: copy the Pin title (`.ptitle` input, else
  `platformTitles["Pinterest"]`); toast "Pin title copied — opening Pinterest".
- With no title yet, keep copying the description rather than stranding a flow
  that also navigates, and say so: "No Pin title yet — copied the description
  instead".
- `copybtn` ("Copy caption") still copies the description — that IS the
  switch-back path the owner described. Status bump and navigation unchanged;
  the URL prefill still receives the description.

## Files
`blast/app.js`

## Rollback
Revert the commit.

## Verification
`pulse-twins-verify.mjs` R6 block (real clipboard reads under granted
clipboard permissions).

## Audit — 2026-07-28

| Step | Result |
|---|---|
| R6 clipboard holds exactly the Pin title after Copy + open | PASS |
| R6 toast names which field was copied | PASS |
| R6 "Copy caption" still yields the description | PASS |
| R6 non-Pinterest platforms still copy their caption | PASS |
| R6b no title → description copied, toast admits it | PASS |
| Regression: blast-verify, blast-batch, blast-sync-truth | PASS |
