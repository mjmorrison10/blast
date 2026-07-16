---
task: Surface the real Drive-API 403 reason instead of "Drive may be full"
date: 2026-07-16
approved: 2026-07-16
---

# Surface the real Drive-API error

## Goal
Sync auth works, but the Drive files.list call 403'd and the app mislabeled
every 403 as "your Drive may be full or access was revoked" — misleading the
owner. Cause: httpErr discarded Google's error body (which carries the real
reason, e.g. accessNotConfigured = Drive API not enabled).

## What changed (canonical recall/stackdata.js, re-vendored x4)
- httpErr now reads the JSON error body and returns {status, reason, message}.
- The 4 drive call-sites (find/download/create/update) updated to the async
  throw.
- driveErrMsg maps the real 403 reason to actionable text: accessNotConfigured
  -> enable the Drive API; insufficientPermissions -> re-approve; storageQuota
  -> Drive full; rate-limit -> wait; unknown 403 -> quote Google's message.
- STACK_BUILD bumped to 2026-07-16.2 (update banner prompts a reload).

## Owner's parallel unblock (no code)
Enable the Google Drive API in the Cloud project (APIs & Services > Library >
Google Drive API > Enable), confirm the drive.file scope on the consent
screen, add the owner as a test user if the screen is still in Testing.

## Rollback
Revert the commit. No data touched.

## Verification (headless Playwright — all green)
Stubbed 403 bodies: accessNotConfigured -> "enable the Drive API" (not "may be
full"); storageQuotaExceeded -> full; insufficientPermissions -> re-approve;
rate-limit -> wait; unknown -> quotes message. Drive-sync suite re-run green.

## Execution log (2026-07-16)
Implemented + verified as above; no divergences.
