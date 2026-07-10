# PULSE

The analytics loop for the creator stack. **RECALL** finds the moment,
**HOOKLAB** underwrites the hook, **BLAST** ships it, and **PULSE** tells you
what actually happened, then feeds that truth back to HOOKLAB.

It's a single static `index.html` + `app.js` + `style.css`. No build step, no
dependencies, no server. Everything lives in this browser's localStorage.

## What it does

- **Import from BLAST** — one click pulls in every clip you marked "Posted"
  (with its live URL, caption, and the time you posted it).
- **Check-ins on a schedule** — 1h / 2h / 6h / 24h / 48h / 7d. PULSE tells you
  which posts are due for a look and records the *actual* elapsed time, so a late
  check is logged honestly instead of pretending it happened on the dot.
- **YouTube on autopilot** — add a free YouTube Data API key and PULSE pulls
  view/like/comment counts for YouTube links by itself, on open and on demand.
- **Everything else, 5 seconds** — TikTok, Instagram, and the rest have no public
  per-video API, so those are quick manual entries: open the post, type the
  number, hit Enter. That is the honest version of "automatic," not a scraper
  that breaks the first time a platform changes its HTML.
- **Velocity, not just totals** — a sparkline of views over time and a
  views/hour figure between your last two readings, because a clip's *slope* in
  the first two hours is the signal.
- **Close the loop** — mark a post Winner / Meh / Dead and PULSE writes it
  straight into your HOOKLAB ledger (same browser). Next time you scout in
  RECALL or underwrite in HOOKLAB, that outcome is already proof.
- **Backup** — export/import your tracked posts as JSON.

## The honest limitation

Auto-fetching view counts from TikTok/Instagram/etc. from a plain web page is not
possible (login walls and cross-origin rules). PULSE automates **YouTube** fully
and makes every other platform a two-second manual log. A browser extension could
close that gap later; this version does not need one to be useful.

## Privacy

BYO-key, no backend. Your YouTube key and your data never leave this browser
except for the direct calls to Google's YouTube API that you trigger.

## The stack

[RECALL](https://mjmorrison10.github.io/recall/) ·
[HOOKLAB](https://mjmorrison10.github.io/Hooklabs/) ·
[BLAST](https://mjmorrison10.github.io/blast/) ·
PULSE ·
[the workflow](https://mjmorrisonusa.com/#/workflow)
