---
task: Relocate PULSE from blast/pulse/ into the standalone pulse repo
date: 2026-07-11
approved: 2026-07-11
---

# PULSE moves out of blast into its own repo

Executes the relocation anticipated by `2026-07-10-pulse-subfolder.md`
("Relocation later: a session with both blast and pulse connected copies
blast/pulse/* into the pulse repo root, pushes (deploys /pulse/), then deletes
this folder and flips the links back."). PULSE now deploys at
`https://mjmorrison10.github.io/pulse/` instead of `/blast/pulse/`.

Both repos work on branch `claude/handoff-doctrine-fable-opus-5bs5cv`.
Pushes go to that feature branch only — GitHub Pages deploys from `main`, so
nothing goes live until the PRs merge (user-controlled).

## Steps

### pulse repo (mjmorrison10/pulse)
1. Copy `blast/pulse/*` into the pulse repo root, unchanged:
   `index.html, app.js, style.css, manifest.json, stackdata.js,
   stacknav.js, README.md` (overwriting the placeholder README).
2. In pulse `stacknav.js`, change the PULSE entry url from
   `https://mjmorrison10.github.io/blast/pulse/` to
   `https://mjmorrison10.github.io/pulse/`, and update the app-detection
   comment (detection logic is unchanged — `/pulse/` still contains "pulse").
3. Commit + push -u origin claude/handoff-doctrine-fable-opus-5bs5cv.

### blast repo (mjmorrison10/blast)
4. Delete the `blast/pulse/` folder (PULSE no longer ships from blast).
5. Repoint `/blast/pulse/` -> `/pulse/`:
   - `index.html` — `#pulseLink` href and footer PULSE link.
   - `stacknav.js` — PULSE entry url + the "/blast/pulse/" comment.
6. Commit + push -u origin claude/handoff-doctrine-fable-opus-5bs5cv.

## Files/systems touched
- pulse repo: 7 new/updated files (the app), `stacknav.js` url edit.
- blast repo: delete `pulse/`, edit `index.html`, `stacknav.js`.
- No production deploy in this step (feature branch only).

## Rollback
- Nothing is merged to `main`, so revert = discard/reset the feature
  branches (or `git revert` the commits). The old `/blast/pulse/` deploy
  remains live on `main` until a PR merges. localStorage data is unaffected
  either way (all apps share the `mjmorrison10.github.io` origin regardless
  of path).

## Verification
- Serve the pulse repo over http headlessly; load `index.html`; assert
  stacknav renders, PULSE is the current app, its url is `/pulse/`, other
  app links intact, no console errors, app.js boots.
- Serve blast `index.html`; assert `#pulseLink` and footer PULSE link both
  point to `/pulse/`, and no remaining `/blast/pulse/` strings in live code.

## Execution log (2026-07-11)
- Copied 7 files into pulse repo root (byte-identical to blast/pulse/*),
  overwrote placeholder README. Fixed pulse stacknav.js PULSE url + comment.
- Removed blast/pulse/ (git rm -r). Repointed index.html #pulseLink + footer
  link and stacknav.js PULSE url to /pulse/; updated the detection comment.
- grep confirms no /blast/pulse/ in live code (plans/ history left as-is).
- Headless Playwright (serving /home/user): ALL PASS — PULSE renders at
  /pulse/ as current app; BLAST's three PULSE links -> /pulse/; old
  /blast/pulse/ 404s. Only console noise was the external GoatCounter beacon
  (gc.zgo.at, unreachable offline) — not a regression.
- Pushed both repos to claude/handoff-doctrine-fable-opus-5bs5cv (feature
  branch; no production deploy until merged to main).
