---
approved: 2026-07-10
---

# Refreshable arena.ai ranking: weekly Action + in-app refresh button (BLAST side)

## Goal

Let the OpenRouter model dropdown's arena.ai ranking be refreshed instead of
staying a code-baked snapshot. A pure in-app "fetch arena.ai" button is
impossible (arena.ai sends no CORS headers and sits behind Cloudflare; all
public CORS proxies are blocked), so the leaderboard refresh runs server-side in
a GitHub Action; the in-app button live-refreshes the OpenRouter model list &
pricing (OpenRouter is CORS-open).

## Steps (RECALL)

1. `arena-ranking.json` (new, vendored, byte-identical across the 3 apps):
   `{updatedAt, source, models:[{pat,score}]}` — the ranking as data. Committed
   with today's arena.ai top 22.
2. `scripts/refresh-leaderboard.mjs` (new, vendored): fetches
   `arena.ai/leaderboard/text` (browser UA, 3 retries), extracts the ordered
   names via `/font-mono text-sm" title="([^"]+)">/g`, normalizes to family keys
   (strip org/`:suffix`/`-thinking|-high|-preview|…`/date/context; `(\d)-(\d)`→
   `$1.$2`), dedupes in rank order, keeps only families matching a live
   OpenRouter id, writes the top 22.
3. `.github/workflows/refresh-leaderboard.yml` (new): `workflow_dispatch` +
   weekly cron, `contents: write`; runs the script and commits
   `arena-ranking.json` to main if changed (`[skip ci]`). Pages redeploys.
4. `stackmodels.js`: `loadRanking()` fetches `arena-ranking.json` same-origin
   and replaces the embedded `ARENA` fallback; `arenaScore()` reads the active
   ranking; `refresh(select,input,onDone)` clears the OpenRouter cache + re-reads
   the ranking + re-fetches + re-renders; `populate()` gains optional
   `refreshBtnEl` + `onRefreshDone` args.
5. `index.html`: a small "↻ Refresh" button (`#ormodelrefresh`) beside the Model
   label. `app.js`: pass the button + a toast callback to `populate()`.

## Files touched

NEW `arena-ranking.json`, `scripts/refresh-leaderboard.mjs`,
`.github/workflows/refresh-leaderboard.yml`; edited `stackmodels.js`,
`index.html`, `app.js`. No `llm.js` change.

## Verification

- Ran `refresh-leaderboard.mjs` live → wrote a well-formed 22-family
  `arena-ranking.json` (claude-fable-5 #1, correct order).
- Headless (OpenRouter intercepted): ranking loads from the file; refresh button
  clears the cache, re-fetches, and toasts success/failure; embedded fallback
  still ranks when the file 404s. 9/9 new + 40/40 prior picker assertions pass.

## Rollback

Revert the branch; `arena-ranking.json` is additive with an in-code fallback;
the workflow writes only that one file; settings format unchanged.

## Note on the Action

If arena.ai challenges the runner (Cloudflare), the job fails visibly and the
committed ranking stays — safe degradation. The refresh runs weekly and via the
Actions-tab "Run workflow" button.
