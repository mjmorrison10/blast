---
task: Posted-time anchor for PULSE
date: 2026-07-10
approved: 2026-07-10
---

# BLAST: posted-time anchor

Adds `platformPostedAt` (name→ms) and `platformPostedCaption` (name→string),
stamped when a platform first transitions to "posted" (Mark posted click, or a
valid http(s) post URL). Never overwritten on re-toggle; cleared on toggle-off
and Reset. Persisted in `blast_session_v1` (backward compatible). Shows "Posted
Nh ago" on the card and a "Track in PULSE →" link once anything is posted.

PULSE reads these to anchor its 1h/2h/6h check-ins. Verified in the shared
same-origin harness with the PULSE round.
