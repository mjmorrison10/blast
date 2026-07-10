// === stackmodels.js — OpenRouter model picker for RECALL / HOOKLAB / BLAST ===
// Turns the free-text "model" box into a ranked dropdown:
//   1. Live list  — fetched from OpenRouter's public models API (no key), so it
//      stays current as new models ship. Cached 24h in localStorage.
//   2. Pricing     — each option shows FREE (rate-limited) or $/1M token rates.
//   3. Ranking     — top group ordered by arena.ai's text leaderboard.
// Plain classic script exposing window.StackModels, vendored byte-identical in
// recall/ Hooklabs/ blast/ (NOT pulse/ — it has no LLM). Loads before app.js.
(function () {
  "use strict";

  var MODELS_URL = "https://openrouter.ai/api/v1/models";
  var CACHE_KEY = "stack_models_cache_v1";
  var TTL_MS = 24 * 60 * 60 * 1000; // 24h
  var CUSTOM = "__custom__";

  // arena.ai text-leaderboard snapshot (2026-07-10), mapped to OpenRouter id
  // substrings. Most-specific patterns first; a model gets the score of the
  // first pattern its id contains. Refresh this list to re-rank.
  var ARENA = [
    { pat: "claude-fable",      score: 1509 },
    { pat: "claude-opus-4.6",   score: 1504 },
    { pat: "claude-opus-4.7",   score: 1502 },
    { pat: "gemini-3.1-pro",    score: 1486 },
    { pat: "gemini-3-pro",      score: 1486 },
    { pat: "claude-opus-4.8",   score: 1484 },
    { pat: "gpt-5.5",           score: 1481 },
    { pat: "gemini-3.5-flash",  score: 1479 },
    { pat: "gpt-5.4",           score: 1478 },
    { pat: "gpt-5.2",           score: 1476 },
    { pat: "qwen3.7",           score: 1475 },
    { pat: "grok-4.20",         score: 1475 },
    { pat: "gemini-3-flash",    score: 1473 },
    { pat: "glm-5.1",           score: 1472 },
    { pat: "claude-sonnet-4.6", score: 1472 },
    { pat: "glm-5.2",           score: 1469 },
    { pat: "mimo-v2.5",         score: 1466 },
    { pat: "grok-4.1",          score: 1466 },
  ];

  // Active ranking. Starts as the embedded ARENA fallback, then gets replaced by
  // arena-ranking.json (regenerated weekly by the repo's refresh-leaderboard
  // GitHub Action) once it loads — a same-origin file, so no CORS limit.
  var RANKING = ARENA;
  var rankingPromise = null;
  function loadRanking(force) {
    if (rankingPromise && !force) return rankingPromise;
    var url = "arena-ranking.json" + (force ? "?t=" + new Date().getTime() : "");
    rankingPromise = fetch(url)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && j.models && j.models.length) RANKING = j.models; return RANKING; })
      .catch(function () { return RANKING; });
    return rankingPromise;
  }

  function arenaScore(id) {
    var low = String(id).toLowerCase();
    for (var i = 0; i < RANKING.length; i++) {
      if (low.indexOf(RANKING[i].pat) !== -1) return RANKING[i].score;
    }
    return 0;
  }

  // A model id that produces images/music/speech rather than a chat reply.
  function isNonChat(id) {
    return /(-image|lyria|whisper|tts|sora|veo|-music|dall-e)/i.test(id);
  }

  // --- map the raw API model to a compact record --------------------------
  function mapModel(m) {
    var arch = m.architecture || {};
    var inMods = arch.input_modalities || [];
    var outMods = arch.output_modalities || [];
    var pr = m.pricing || {};
    var inP = parseFloat(pr.prompt) || 0;
    var outP = parseFloat(pr.completion) || 0;
    return {
      id: m.id,
      name: shortName(m.name || m.id),
      inPerM: inP * 1e6,
      outPerM: outP * 1e6,
      free: inP === 0 && outP === 0,
      media: inMods.indexOf("image") !== -1 || inMods.indexOf("audio") !== -1 || inMods.indexOf("video") !== -1,
      textOut: outMods.indexOf("text") !== -1,
      score: arenaScore(m.id),
    };
  }

  // "Anthropic: Claude Opus 4.8" -> "Claude Opus 4.8"; drop trailing "(free)".
  function shortName(name) {
    var n = String(name).replace(/\s*\(free\)\s*$/i, "");
    var idx = n.indexOf(": ");
    return idx > 0 && idx < 20 ? n.slice(idx + 2) : n;
  }

  function money(perM) {
    if (perM <= 0) return "$0";
    if (perM < 0.1) return "$" + perM.toFixed(3);
    return "$" + perM.toFixed(2);
  }

  function label(m) {
    var price = m.free ? "FREE (rate-limited)" : money(m.inPerM) + " in / " + money(m.outPerM) + " out per 1M";
    return (m.media ? "🎬 " : "") + m.name + " — " + price;
  }

  // --- cache ---------------------------------------------------------------
  function readCache() {
    try {
      var raw = JSON.parse(localStorage.getItem(CACHE_KEY));
      if (raw && raw.models && raw.models.length) return raw;
    } catch (e) {}
    return null;
  }
  function writeCache(models) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: new Date().toISOString(), models: models })); }
    catch (e) {}
  }
  function isFresh(cache) {
    if (!cache) return false;
    var age = Date.now() - new Date(cache.at).getTime();
    return age >= 0 && age < TTL_MS;
  }

  // --- fetch ---------------------------------------------------------------
  // Resolves to the mapped+filtered model array, or rejects.
  function fetchModels() {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var t = ctrl ? setTimeout(function () { ctrl.abort(); }, 8000) : null;
    return fetch(MODELS_URL, ctrl ? { signal: ctrl.signal } : undefined)
      .then(function (r) { if (!r.ok) throw new Error("models " + r.status); return r.json(); })
      .then(function (j) {
        if (t) clearTimeout(t);
        var list = (j && j.data ? j.data : []).map(mapModel).filter(function (m) { return m.textOut; });
        if (!list.length) throw new Error("empty models list");
        writeCache(list);
        return list;
      })
      .catch(function (e) { if (t) clearTimeout(t); throw e; });
  }

  // --- build the <select> --------------------------------------------------
  function optionEl(value, text) {
    var o = document.createElement("option");
    o.value = value; o.textContent = text;
    return o;
  }

  function render(selectEl, inputEl, models) {
    var current = (inputEl.value || "").trim();
    selectEl.innerHTML = "";

    var ranked = models.filter(function (m) { return m.score > 0 && !isNonChat(m.id); })
      .sort(function (a, b) { return b.score - a.score || a.name.localeCompare(b.name); })
      .slice(0, 30);
    var rankedIds = {};
    ranked.forEach(function (m) { rankedIds[m.id] = 1; });

    var free = models.filter(function (m) { return m.free && !rankedIds[m.id] && !isNonChat(m.id); })
      .sort(function (a, b) { return b.score - a.score || a.name.localeCompare(b.name); });
    var freeIds = {};
    free.forEach(function (m) { freeIds[m.id] = 1; });

    var others = models.filter(function (m) { return !rankedIds[m.id] && !freeIds[m.id] && !isNonChat(m.id); })
      .sort(function (a, b) { return a.name.localeCompare(b.name); });

    // If the saved model isn't anywhere in the list, surface it up top.
    var known = models.some(function (m) { return m.id === current; });
    if (current && !known) {
      var gCur = document.createElement("optgroup");
      gCur.label = "Current";
      gCur.appendChild(optionEl(current, "Current: " + current));
      selectEl.appendChild(gCur);
    }

    function group(name, arr) {
      if (!arr.length) return;
      var g = document.createElement("optgroup");
      g.label = name;
      arr.forEach(function (m) {
        var text = label(m);
        if (m.id === "openrouter/free") text = "⚡ Auto: best free model";
        g.appendChild(optionEl(m.id, text));
      });
      selectEl.appendChild(g);
    }
    group("Top ranked (arena.ai)", ranked);
    group("Free models", free);
    group("All other models", others);

    var gc = document.createElement("optgroup");
    gc.label = " ";
    gc.appendChild(optionEl(CUSTOM, "Custom model id…"));
    selectEl.appendChild(gc);

    // Select the current value; default to the top-ranked model otherwise.
    if (current) selectEl.value = current;
    if (!selectEl.value) {
      selectEl.value = ranked.length ? ranked[0].id : (models[0] && models[0].id) || CUSTOM;
      inputEl.value = selectEl.value === CUSTOM ? "" : selectEl.value;
    }
    syncInputVisibility(selectEl, inputEl);
  }

  function syncInputVisibility(selectEl, inputEl) {
    var custom = selectEl.value === CUSTOM;
    inputEl.style.display = custom ? "" : "none";
    if (custom && !inputEl.value) inputEl.focus();
  }

  // Show the dropdown, hide/show the text input as fallback.
  function setMode(selectEl, inputEl, useSelect) {
    selectEl.style.display = useSelect ? "" : "none";
    inputEl.style.display = useSelect ? "none" : "";
  }

  // Public: wire a select + the existing text input. The text input stays the
  // value carrier (save handlers read it), so no app-side save changes needed.
  // refreshBtnEl (optional) becomes a "refresh model list" button; onRefreshDone
  // (optional) is called with true/false so the app can toast the result.
  function populate(selectEl, inputEl, refreshBtnEl, onRefreshDone) {
    if (!selectEl || !inputEl) return;
    if (!selectEl.__wired) {
      selectEl.__wired = 1;
      selectEl.addEventListener("change", function () {
        if (selectEl.value === CUSTOM) { inputEl.style.display = ""; inputEl.value = ""; inputEl.focus(); }
        else { inputEl.value = selectEl.value; inputEl.style.display = "none"; }
      });
    }
    if (refreshBtnEl && !refreshBtnEl.__wired) {
      refreshBtnEl.__wired = 1;
      refreshBtnEl.addEventListener("click", function () {
        refreshBtnEl.disabled = true;
        refresh(selectEl, inputEl, function (ok) { refreshBtnEl.disabled = false; if (onRefreshDone) onRefreshDone(ok); });
      });
    }

    loadRanking().then(function () {
      var cache = readCache();
      if (cache) { setMode(selectEl, inputEl, true); render(selectEl, inputEl, cache.models); }

      if (!cache || !isFresh(cache)) {
        fetchModels().then(function (models) {
          // Re-render only if the user hasn't since switched to Custom editing.
          if (selectEl.value !== CUSTOM) { setMode(selectEl, inputEl, true); render(selectEl, inputEl, models); }
        }).catch(function () {
          if (!cache) setMode(selectEl, inputEl, false); // no data: fall back to text input
        });
      }
    });
  }

  // Force a fresh pull: drop the cached model list, re-read the ranking file,
  // re-fetch OpenRouter, re-render. onDone(ok) reports success for a toast.
  function refresh(selectEl, inputEl, onDone) {
    try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
    loadRanking(true).then(function () { return fetchModels(); })
      .then(function (models) { setMode(selectEl, inputEl, true); render(selectEl, inputEl, models); if (onDone) onDone(true); })
      .catch(function () { if (onDone) onDone(false); });
  }

  window.StackModels = {
    populate: populate,
    refresh: refresh,
    fetchModels: fetchModels,
    label: label,
    mapModel: mapModel,
    _arenaScore: arenaScore,
  };
})();
