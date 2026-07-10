#!/usr/bin/env node
// refresh-leaderboard.mjs — regenerate arena-ranking.json from arena.ai.
//
// Runs in GitHub Actions (server-side, so no browser CORS limit). Fetches the
// arena.ai text leaderboard in rank order, normalizes each model name to a
// family key, keeps only families that match a live OpenRouter model id, and
// writes the top ~22 to arena-ranking.json — which stackmodels.js reads to rank
// the OpenRouter model dropdown. Vendored byte-identical in recall/ Hooklabs/
// blast/. Node 20+ (global fetch). Usage: node scripts/refresh-leaderboard.mjs
import fs from "node:fs";
import path from "node:path";

const ARENA_URL = "https://arena.ai/leaderboard/text";
const OR_URL = "https://openrouter.ai/api/v1/models";
const OUT = path.join(process.cwd(), "arena-ranking.json");
const TOP_N = 22;
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

async function getText(url, tries) {
  var lastErr;
  for (var i = 0; i < (tries || 3); i++) {
    try {
      var r = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/json" } });
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.text();
    } catch (e) {
      lastErr = e;
      await new Promise(function (res) { setTimeout(res, 1500 * (i + 1)); });
    }
  }
  throw lastErr;
}

// Normalize a leaderboard name OR an OpenRouter id to a comparable family key.
function familyKey(s) {
  return String(s).toLowerCase()
    .replace(/^.*\//, "")            // strip "org/"
    .replace(/:.*$/, "")             // strip ":free" etc
    .replace(/-(thinking|high|low|instant|preview|latest|fast|reasoning|exp|chat|search|customtools|custom-tools|multi-agent)(-|$)/g, "$2")
    .replace(/-beta[0-9.]*/g, "")
    .replace(/-[0-9]{6,}/g, "")      // date stamps
    .replace(/-[0-9]+k$/, "")        // context window suffix
    .replace(/([0-9])-([0-9])/g, "$1.$2") // opus-4-6 -> opus-4.6
    .replace(/-+$/, "");
}

async function main() {
  var html = await getText(ARENA_URL);
  var re = /font-mono text-sm" title="([^"]+)">/g;
  var m, names = [];
  while ((m = re.exec(html)) !== null) names.push(m[1]);
  if (names.length < 20) throw new Error("arena parse found only " + names.length + " rows — page format may have changed");

  // dedupe families in rank order
  var seen = {}, fams = [];
  names.forEach(function (n) {
    var k = familyKey(n);
    if (k && !seen[k]) { seen[k] = 1; fams.push(k); }
  });

  var orJson = JSON.parse(await getText(OR_URL));
  var orIds = (orJson.data || []).map(function (x) { return x.id; });

  var models = [];
  for (var i = 0; i < fams.length && models.length < TOP_N; i++) {
    var key = fams[i];
    var hit = orIds.some(function (id) { return id.indexOf(key) !== -1; });
    if (hit) models.push({ pat: key, score: 2000 - models.length });
  }
  if (models.length < 8) throw new Error("only " + models.length + " families matched OpenRouter — refusing to write a thin ranking");

  var out = {
    updatedAt: new Date().toISOString().slice(0, 10),
    source: ARENA_URL,
    models: models,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log("wrote " + OUT + " with " + models.length + " ranked families; top: " + models.slice(0, 5).map(function (x) { return x.pat; }).join(", "));
}

main().catch(function (e) { console.error("refresh-leaderboard failed:", e.message); process.exit(1); });
