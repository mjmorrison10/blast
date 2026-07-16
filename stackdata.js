// === stackdata.js — shared across RECALL / HOOKLAB / BLAST / PULSE ===
// One origin (mjmorrison10.github.io) means one localStorage + one IndexedDB,
// so this vendored helper gives the four apps suite-wide behaviors:
//   1. Shared API keys  — a single `stack_settings_v1` store so a key entered
//      in any app works in all of them.
//   2. Full-stack backup — export/import EVERY app's data (incl RECALL's
//      IndexedDB library) as one JSON file.
//   3. Google Drive sync — the same backup, round-tripped through the user's
//      OWN Drive (drive.file scope: the app only ever sees files it created),
//      with a conflict-safe MERGE so two devices converge instead of clobber.
// Plain classic script (no ES module) so it loads identically in the module
// apps (HOOKLAB/BLAST) and the classic apps (RECALL/PULSE). Byte-identical copy
// in each app directory — edit recall/stackdata.js then re-vendor.
(function () {
  "use strict";

  // Bumped on every deploy that users should reload for. checkForUpdate()
  // compares this baked-in value against a cache-busted fetch of the live
  // stackdata.js and shows an "update available" banner when they differ.
  var STACK_BUILD = "2026-07-16.1";

  var LS_SHARED = "stack_settings_v1";
  var LS_WORKSPACE = "stack_workspace_v1";
  var LS_TOMBSTONES = "stack_tombstones_v1";
  var LS_SYNC_META = "stack_sync_meta_v1";
  // RECALL's IndexedDB library (same constants as recall/app.js).
  var IDB_NAME = "recall", IDB_VERSION = 1, IDB_STORE = "library", IDB_KEY = "current";

  // Google Drive sync config. DRIVE_CLIENT_ID is a public OAuth Web client id
  // (no secret in the token flow); it stays a placeholder until the owner
  // completes the one-time Google Cloud setup — until then sync is a no-op
  // with a friendly toast.
  var DRIVE_CLIENT_ID = "695946260157-i2mlinkucs93c4le05buv5lcj0cceln1.apps.googleusercontent.com";
  var DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
  function isConfigured() { return DRIVE_CLIENT_ID && DRIVE_CLIENT_ID.indexOf("REPLACE_WITH") === -1; }
  // Each workspace gets its OWN sync file in the same Drive, so one Google
  // account can run several stacks (two social accounts) without them fighting
  // over one file. Discovery is by appProperties (app + ws id); the filename
  // just carries the workspace name so it's recognizable in the Drive UI.
  function syncMarker(ws) { return { app: "mjm-stack", ws: (ws && ws.id) || "default" }; }
  function syncFileName(ws) {
    var slug = ((ws && ws.name) || "workspace").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "workspace";
    return "mjm-stack-sync-" + slug + ".json";
  }

  // Keys that NEVER leave the device via Drive/merge: secrets, device prefs,
  // regenerable caches, and transient inboxes. mergeStates strips these from
  // BOTH inputs, so the Drive payload and any merged file are structurally
  // guaranteed to carry no API keys.
  var SYNC_EXCLUDE = [
    "stack_settings_v1",     // shared API keys
    "recall_settings_v1", "hooklab_settings_v1", "blast_settings_v1", "pulse_settings_v1", // keys + prefs
    "hooklab_theme", "blast-theme", "pulse-theme", // device themes
    "stack_models_cache_v1", // 24h model-list cache
    "blast_handoff_v1",      // transient consumed inbox
    "recall_state_v2"        // legacy LS library fallback (library syncs via recallLibrary)
  ];
  // Excluded from EVERY export, including local file backups (device-specific
  // Drive bookkeeping must not travel to another machine).
  var ALWAYS_EXCLUDE = ["stack_sync_meta_v1"];

  // On a REPLACE restore we wipe all stack app-data keys first (so switching
  // to a stack that lacks PULSE/BLAST data doesn't leave the old stack's data
  // behind). These device-scoped keys survive the wipe, because a backup that
  // simply doesn't carry API keys/themes shouldn't blank them on this device;
  // when the backup DOES carry them, the overlay overwrites them anyway.
  var DEVICE_PRESERVE = [
    "stack_settings_v1",
    "recall_settings_v1", "hooklab_settings_v1", "blast_settings_v1", "pulse_settings_v1",
    "hooklab_theme", "blast-theme", "pulse-theme"
  ];

  // ---------- shared API keys (Part A) ----------
  function readShared() {
    try { return JSON.parse(localStorage.getItem(LS_SHARED)) || {}; }
    catch (e) { return {}; }
  }
  function writeShared(partial) {
    try {
      var cur = readShared();
      for (var k in partial) { var v = partial[k]; if (v != null && v !== "") cur[k] = v; }
      cur.updatedAt = new Date().toISOString();
      localStorage.setItem(LS_SHARED, JSON.stringify(cur));
      return true;
    } catch (e) { return false; }
  }
  function clearShared(field) {
    try {
      var cur = readShared();
      cur[field] = "";
      cur.updatedAt = new Date().toISOString();
      localStorage.setItem(LS_SHARED, JSON.stringify(cur));
      return true;
    } catch (e) { return false; }
  }
  function resolveKeys(local, fields) {
    local = local || {};
    var shared = readShared(), out = {}, promote = {}, has = false;
    for (var k in local) out[k] = local[k];
    (fields || []).forEach(function (f) {
      var sv = shared[f], lv = local[f];
      if (sv != null && sv !== "") { out[f] = sv; }
      else if (lv != null && lv !== "") { out[f] = lv; promote[f] = lv; has = true; }
    });
    if (has) writeShared(promote);
    return out;
  }

  // ---------- which localStorage keys belong to the stack ----------
  function isStackKey(k) { return /^(recall|hooklab|blast|pulse|stack)[-_]/i.test(k); }
  function stackKeys() {
    var out = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (isStackKey(k)) out.push(k);
    }
    return out;
  }

  // ---------- RECALL IndexedDB library (readable from any app on the origin) ----------
  function openIDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }
  function readRecallLibrary() {
    return openIDB().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(IDB_KEY);
          tx.onsuccess = function () { resolve(tx.result || null); };
          tx.onerror = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
    }).catch(function () { return null; });
  }
  function writeRecallLibrary(value) {
    if (!value) return Promise.resolve(false);
    return openIDB().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(IDB_STORE, "readwrite").objectStore(IDB_STORE).put(value, IDB_KEY);
          tx.onsuccess = function () { resolve(true); };
          tx.onerror = function () { resolve(false); };
        } catch (e) { resolve(false); }
      });
    }).catch(function () { return false; });
  }
  // Only used by a REPLACE restore whose backup carries no library — clears the
  // old stack's library so it can't leak. (Sync/merge never call this: an
  // apply must never destroy the library on a transient read failure.)
  function clearRecallLibrary() {
    return openIDB().then(function (db) {
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(IDB_STORE, "readwrite").objectStore(IDB_STORE)["delete"](IDB_KEY);
          tx.onsuccess = function () { resolve(true); };
          tx.onerror = function () { resolve(false); };
        } catch (e) { resolve(false); }
      });
    }).catch(function () { return false; });
  }

  // ---------- workspace identity ----------
  function getWorkspace() { try { return JSON.parse(localStorage.getItem(LS_WORKSPACE)) || null; } catch (e) { return null; } }
  function ensureWorkspace() {
    var w = getWorkspace();
    if (w && w.id) return w;
    var name = "";
    try { name = (window.prompt("Name this workspace (shown when syncing/merging — e.g. your name or brand):", "") || "").trim(); } catch (e) {}
    w = { id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36), name: name || "My workspace", createdAt: Date.now() };
    try { localStorage.setItem(LS_WORKSPACE, JSON.stringify(w)); } catch (e) {}
    return w;
  }
  function wsOf(exp) { try { return JSON.parse((exp.localStorage || {})[LS_WORKSPACE]); } catch (e) { return null; } }
  // Returns {localName, remoteName} when the two exports carry DIFFERENT
  // workspace ids (the hard-block case), else null.
  function workspaceConflict(a, b) {
    var wa = wsOf(a || {}), wb = wsOf(b || {});
    if (wa && wb && wa.id && wb.id && wa.id !== wb.id) return { localName: wa.name || "(unnamed)", remoteName: wb.name || "(unnamed)" };
    return null;
  }

  // ---------- tombstones (so a delete on one device isn't resurrected by merge) ----------
  var TOMB_TTL = 90 * 86400000;
  function readTombstones() { try { return JSON.parse(localStorage.getItem(LS_TOMBSTONES)) || {}; } catch (e) { return {}; } }
  function pruneTomb(map) { var cut = Date.now() - TOMB_TTL, out = {}; for (var k in map) { if (map[k] && map[k] >= cut) out[k] = map[k]; } return out; }
  function tombstone(kind, id) {
    if (!kind || id == null) return false;
    var m = readTombstones(); m[kind + ":" + id] = Date.now(); m = pruneTomb(m);
    try { localStorage.setItem(LS_TOMBSTONES, JSON.stringify(m)); } catch (e) {}
    return true;
  }
  function mergeTomb(a, b) { var out = {}, k; for (k in a) out[k] = a[k]; for (k in b) { if (!(k in out) || b[k] > out[k]) out[k] = b[k]; } return pruneTomb(out); }

  // ---------- merge engine (pure) ----------
  function pj(s, fb) { if (s == null) return fb; try { var v = JSON.parse(s); return v == null ? fb : v; } catch (e) { return fb; } }

  function snapAt(p) { var s = p.snapshots || [], m = 0; for (var i = 0; i < s.length; i++) { if ((s[i].at || 0) > m) m = s[i].at; } return m || p.postedAt || 0; }
  // Merge two PULSE posts into one (same logical clip). `keep` supplies the id.
  function mergePost(keep, other) {
    var byMin = {};
    (keep.snapshots || []).concat(other.snapshots || []).forEach(function (sn) {
      if (!sn) return; var ex = byMin[sn.elapsedMin];
      if (!ex || (sn.at || 0) > (ex.at || 0)) byMin[sn.elapsedMin] = sn;
    });
    var snaps = Object.keys(byMin).map(function (k) { return byMin[k]; }).sort(function (x, y) { return x.elapsedMin - y.elapsedMin; });
    var base = snapAt(keep) >= snapAt(other) ? keep : other, alt = base === keep ? other : keep;
    var out = {}, k;
    for (k in alt) out[k] = alt[k];
    for (k in base) out[k] = base[k];
    out.snapshots = snaps;
    var pa = keep.postedAt, pb = other.postedAt;
    out.postedAt = Math.min(pa == null ? Infinity : pa, pb == null ? Infinity : pb);
    if (!isFinite(out.postedAt)) out.postedAt = base.postedAt;
    out.outcome = base.outcome != null ? base.outcome : alt.outcome;
    out.ledgerLoggedAt = base.ledgerLoggedAt != null ? base.ledgerLoggedAt : alt.ledgerLoggedAt;
    out.id = keep.id;
    return out;
  }

  // Union two id'd arrays: newer-export items added after older so ties go to
  // newer; per-item conflict resolved by timeOf (max wins). Tombstoned items
  // dropped when the tombstone is newer than the item's own timestamp.
  function mergeById(arrA, arrB, aNew, kind, tomb, timeOf) {
    var map = {}, order = [];
    function suppressed(it) { var key = kind + ":" + it.id; if (!tomb.hasOwnProperty(key)) return false; return tomb[key] > (timeOf(it) || 0); }
    function add(arr) {
      (arr || []).forEach(function (it) {
        if (!it || it.id == null) return;
        if (suppressed(it)) return;
        if (!map[it.id]) { map[it.id] = it; order.push(it.id); }
        else if (timeOf(it) >= timeOf(map[it.id])) map[it.id] = it;
      });
    }
    add(aNew ? arrB : arrA); add(aNew ? arrA : arrB);
    var res = order.map(function (id) { return map[id]; }).filter(Boolean);
    res.sort(function (x, y) { return (Date.parse(y.createdAt) || 0) - (Date.parse(x.createdAt) || 0); });
    return res;
  }

  // When PULSE dupes collapse (drop id B into kept id A), fold their
  // pulse_<id> HOOKLAB ledger entries together too.
  function applyLedgerCollapses(ledger, collapses) {
    if (!collapses || !Object.keys(collapses).length) return ledger;
    var byId = {}; ledger.forEach(function (e) { byId[e.id] = e; });
    Object.keys(collapses).forEach(function (dropId) {
      var keepLid = "pulse_" + collapses[dropId], dropLid = "pulse_" + dropId;
      var de = byId[dropLid], ke = byId[keepLid];
      if (de && ke) {
        if ((Date.parse(de.createdAt) || 0) > (Date.parse(ke.createdAt) || 0)) { ke.hook = de.hook; ke.outcome = de.outcome; ke.createdAt = de.createdAt; }
        delete byId[dropLid];
      } else if (de && !ke) { de.id = keepLid; byId[keepLid] = de; delete byId[dropLid]; }
    });
    return Object.keys(byId).map(function (k) { return byId[k]; }).sort(function (x, y) { return (Date.parse(y.createdAt) || 0) - (Date.parse(x.createdAt) || 0); });
  }

  // The core: merge two exports (v1 or v2) into one v2 export + a report.
  // Throws {code:"WORKSPACE_MISMATCH", localName, remoteName} on the guard.
  // Every rule is union + deterministic max/precedence, so it's idempotent:
  // merge(merge(a,b), b) === merge(a,b).
  function mergeStates(a, b) {
    a = a || {}; b = b || {};
    var aLS = a.localStorage || {}, bLS = b.localStorage || {};
    var conflict = workspaceConflict(a, b);
    if (conflict) throw { code: "WORKSPACE_MISMATCH", localName: conflict.localName, remoteName: conflict.remoteName };

    var ta = Date.parse(a.exportedAt) || 0, tb = Date.parse(b.exportedAt) || 0;
    var aNew = ta >= tb; // tie → local (a) wins, deterministic
    var report = { added: { sources: 0, posts: 0, ledger: 0, comps: 0 }, tombstoned: 0, conflicts: 0, unknownKeys: [] };
    var out = {};

    var tomb = mergeTomb(pj(aLS[LS_TOMBSTONES], {}), pj(bLS[LS_TOMBSTONES], {}));
    function tombHard(kind, id) { return tomb.hasOwnProperty(kind + ":" + id); }

    // ---- RECALL library (sources / enabled / bin) ----
    var libA = a.recallLibrary, libB = b.recallLibrary, mergedLib = null, srcIds = {};
    if (libA || libB) {
      var lA = libA || {}, lB = libB || {};
      var older = aNew ? lB : lA, newer = aNew ? lA : lB;
      var smap = {}, sorder = [];
      (older.sources || []).forEach(function (s) { if (!s || !s.id || tombHard("recallSource", s.id)) return; if (!smap[s.id]) { smap[s.id] = s; sorder.push(s.id); } });
      (newer.sources || []).forEach(function (s) {
        if (!s || !s.id || tombHard("recallSource", s.id)) return;
        if (!smap[s.id]) { smap[s.id] = s; sorder.push(s.id); }
        else if ((s.segments || []).length >= (smap[s.id].segments || []).length) smap[s.id] = s;
      });
      srcIds = smap;
      var enSet = {}; (lA.enabled || []).concat(lB.enabled || []).forEach(function (id) { if (smap[id]) enSet[id] = 1; });
      var bmap = {}, border = [];
      function addBin(arr) { (arr || []).forEach(function (bn) { if (!bn || bn.key == null || !smap[bn.srcId]) return; if (!bmap[bn.key]) border.push(bn.key); bmap[bn.key] = bn; }); }
      addBin(older.bin); addBin(newer.bin);
      // Stable ordering (by id / key) so the merged output is a pure function
      // of the DATA, not of which side happened to be "newer" — this makes the
      // merge strictly idempotent (merge(merge(a,b),b) === merge(a,b)). RECALL
      // re-lists sources from this array; order is post-merge canonical.
      sorder.sort(); border.sort();
      mergedLib = { sources: sorder.map(function (id) { return smap[id]; }), enabled: Object.keys(enSet).sort(), bin: border.map(function (k) { return bmap[k]; }) };
    }

    // ---- recall_topclips_v1 (per-source scan cache; greater savedAt wins) ----
    var tcA = pj(aLS["recall_topclips_v1"], {}), tcB = pj(bLS["recall_topclips_v1"], {}), tcOut = {}, allTc = {}, id2;
    for (id2 in tcA) allTc[id2] = 1; for (id2 in tcB) allTc[id2] = 1;
    for (id2 in allTc) {
      if (mergedLib && !srcIds[id2]) continue; // drop scans for sources that no longer exist
      var ea = tcA[id2], eb = tcB[id2];
      tcOut[id2] = (ea && eb) ? (((ea.savedAt || 0) >= (eb.savedAt || 0)) ? ea : eb) : (ea || eb);
    }
    // Emit whenever either side had the key, even if the merged result is
    // empty, so a tombstone that clears the last entry propagates on an
    // overlay (sync) apply instead of leaving a stale local value behind.
    // Sorted keys keep the serialized output stable (idempotence).
    if (aLS["recall_topclips_v1"] != null || bLS["recall_topclips_v1"] != null) {
      var tcSorted = {}; Object.keys(tcOut).sort().forEach(function (k) { tcSorted[k] = tcOut[k]; });
      out["recall_topclips_v1"] = JSON.stringify(tcSorted);
    }

    // ---- PULSE posts (union by id, then dupe-collapse, snapshots merged) ----
    var paA = pj(aLS["pulse_posts_v1"], []), paB = pj(bLS["pulse_posts_v1"], []);
    if (!Array.isArray(paA)) paA = []; if (!Array.isArray(paB)) paB = [];
    var pmap = {}, porder = [];
    function addPost(p) { if (!p || p.id == null || tombHard("pulsePost", p.id)) return; if (!pmap[p.id]) { pmap[p.id] = p; porder.push(p.id); } else pmap[p.id] = mergePost(pmap[p.id], p); }
    (aNew ? paB : paA).forEach(addPost); (aNew ? paA : paB).forEach(addPost);
    var byDupe = {}, collapses = {};
    porder.forEach(function (id) {
      var p = pmap[id]; if (!p) return;
      var dkeys = []; if (p.blastKey) dkeys.push("bk:" + p.blastKey); if (p.url) dkeys.push("pu:" + p.platform + "|" + p.url);
      var hit = null, i;
      for (i = 0; i < dkeys.length; i++) { if (byDupe[dkeys[i]] != null) { hit = byDupe[dkeys[i]]; break; } }
      if (hit != null && hit !== id) {
        var keep = hit < id ? hit : id, drop = hit < id ? id : hit;
        pmap[keep] = mergePost(pmap[keep], pmap[drop]); pmap[drop] = null; collapses[drop] = keep;
        dkeys.forEach(function (dk) { byDupe[dk] = keep; });
      } else dkeys.forEach(function (dk) { if (byDupe[dk] == null) byDupe[dk] = id; });
    });
    // Stable order by id (PULSE re-sorts by postedAt on render, so display is
    // unaffected; this only fixes serialization order for idempotence).
    var finalPosts = porder.map(function (id) { return pmap[id]; }).filter(Boolean).sort(function (x, y) { return x.id < y.id ? -1 : x.id > y.id ? 1 : 0; });
    if (aLS["pulse_posts_v1"] != null || bLS["pulse_posts_v1"] != null) out["pulse_posts_v1"] = JSON.stringify(finalPosts);

    // ---- HOOKLAB ledger + comps (union by id, newest edit wins, tombstoned) ----
    var hA = pj(aLS["hooklab_state_v1"], {}), hB = pj(bLS["hooklab_state_v1"], {});
    var ledgerOut = mergeById(hA.ledger || [], hB.ledger || [], aNew, "hooklabLedger", tomb, function (x) { return Date.parse(x.editedAt || x.createdAt) || 0; });
    ledgerOut = applyLedgerCollapses(ledgerOut, collapses);
    var compsOut = mergeById(hA.comps || [], hB.comps || [], aNew, "hooklabComp", tomb, function (x) { return Date.parse(x.createdAt) || 0; });
    if (aLS["hooklab_state_v1"] != null || bLS["hooklab_state_v1"] != null) {
      var hMerged = {}, hk; var hNewer = aNew ? hA : hB, hOlder = aNew ? hB : hA;
      for (hk in hOlder) hMerged[hk] = hOlder[hk];
      for (hk in hNewer) hMerged[hk] = hNewer[hk];
      hMerged.ledger = ledgerOut; hMerged.comps = compsOut;
      out["hooklab_state_v1"] = JSON.stringify(hMerged);
    }

    // ---- BLAST session (single workspace; greater updatedAt wins) ----
    var sA = pj(aLS["blast_session_v1"], null), sB = pj(bLS["blast_session_v1"], null);
    if (sA || sB) {
      var ua = (sA && sA.updatedAt) || -1, ub = (sB && sB.updatedAt) || -1;
      out["blast_session_v1"] = JSON.stringify(ua >= ub ? (sA || sB) : (sB || sA));
    }

    // ---- BLAST presets (per-platform-key union) ----
    var prA = pj(aLS["blast_presets_v1"], {}), prB = pj(bLS["blast_presets_v1"], {}), prOut = {}, pk;
    var prNewer = aNew ? prA : prB, prOlder = aNew ? prB : prA, prTmp = {};
    for (pk in prOlder) prTmp[pk] = prOlder[pk];
    for (pk in prNewer) prTmp[pk] = prNewer[pk];
    Object.keys(prTmp).sort().forEach(function (k) { prOut[k] = prTmp[k]; }); // sorted for idempotence
    if (aLS["blast_presets_v1"] != null || bLS["blast_presets_v1"] != null) out["blast_presets_v1"] = JSON.stringify(prOut);

    // ---- workspace + tombstones ----
    var ws = pj(aLS[LS_WORKSPACE], null) || pj(bLS[LS_WORKSPACE], null);
    if (ws) out[LS_WORKSPACE] = JSON.stringify(ws);
    if (Object.keys(tomb).length) { var tombSorted = {}; Object.keys(tomb).sort().forEach(function (k) { tombSorted[k] = tomb[k]; }); out[LS_TOMBSTONES] = JSON.stringify(tombSorted); }

    // ---- unknown / future stack-prefixed keys (forward-compatible) ----
    var HANDLED = { "recall_topclips_v1": 1, "pulse_posts_v1": 1, "hooklab_state_v1": 1, "blast_session_v1": 1, "blast_presets_v1": 1 };
    HANDLED[LS_WORKSPACE] = 1; HANDLED[LS_TOMBSTONES] = 1;
    var excl = {}; SYNC_EXCLUDE.concat(ALWAYS_EXCLUDE).forEach(function (k) { excl[k] = 1; });
    var allKeys = {}, uk;
    for (uk in aLS) allKeys[uk] = 1; for (uk in bLS) allKeys[uk] = 1;
    Object.keys(allKeys).sort().forEach(function (uk) { // sorted for idempotence
      if (HANDLED[uk] || excl[uk] || !isStackKey(uk)) return;
      var va = aLS[uk], vb = bLS[uk];
      if (va != null && vb != null) { if (va !== vb) { out[uk] = aNew ? va : vb; report.unknownKeys.push(uk); } else out[uk] = va; }
      else out[uk] = va != null ? va : vb;
    });

    report.added.sources = mergedLib ? mergedLib.sources.length : 0;
    report.added.posts = finalPosts.length;
    report.added.ledger = ledgerOut.length;
    report.added.comps = compsOut.length;
    report.tombstoned = Object.keys(tomb).length;

    return {
      data: { format: "mjm-stack-backup", version: 2, exportedAt: new Date().toISOString(), localStorage: out, recallLibrary: mergedLib },
      report: report
    };
  }

  // ---------- full-stack export/import (Part B) ----------
  function exportAll(opts) {
    opts = opts || {};
    return readRecallLibrary().then(function (lib) {
      var ls = {}, excl = {};
      ALWAYS_EXCLUDE.forEach(function (k) { excl[k] = 1; });
      if (opts.forSync) SYNC_EXCLUDE.forEach(function (k) { excl[k] = 1; });
      stackKeys().forEach(function (k) { if (!excl[k]) ls[k] = localStorage.getItem(k); });
      return { format: "mjm-stack-backup", version: 2, exportedAt: new Date().toISOString(), localStorage: ls, recallLibrary: lib };
    });
  }
  function isStackBackup(data) { return !!(data && data.format === "mjm-stack-backup"); }
  function summary(data) {
    var ls = (data && data.localStorage) || {};
    function count(key, path) {
      try { var o = JSON.parse(ls[key]); path.forEach(function (p) { o = o && o[p]; }); return (o && o.length) || 0; }
      catch (e) { return 0; }
    }
    var parts = [];
    var srcs = (data.recallLibrary && data.recallLibrary.sources && data.recallLibrary.sources.length) || 0;
    if (srcs) parts.push(srcs + " RECALL source" + (srcs === 1 ? "" : "s"));
    var led = count("hooklab_state_v1", ["ledger"]);
    if (led) parts.push(led + " ledger entr" + (led === 1 ? "y" : "ies"));
    var posts = 0; try { posts = (JSON.parse(ls["pulse_posts_v1"]) || []).length; } catch (e) {}
    if (posts) parts.push(posts + " tracked post" + (posts === 1 ? "" : "s"));
    if (ls["blast_session_v1"]) parts.push("a BLAST session");
    var keys = readSharedFrom(ls);
    var nk = ["geminiKey", "openrouterKey", "ytKey"].filter(function (f) { return keys[f]; }).length;
    if (nk) parts.push(nk + " saved API key" + (nk === 1 ? "" : "s"));
    var wsp = null; try { wsp = JSON.parse(ls[LS_WORKSPACE]); } catch (e) {}
    var prefix = wsp && wsp.name ? ('workspace "' + wsp.name + '" · ') : "";
    return prefix + (parts.length ? parts.join(", ") : "no app data (keys/settings only)");
  }
  function readSharedFrom(ls) { try { return JSON.parse(ls["stack_settings_v1"]) || {}; } catch (e) { return {}; } }

  // opts.replace = true → REPLACE semantics (STACK RESTORE): wipe all stack
  // app-data keys first so switching to a backup that lacks some apps' data
  // doesn't leave the previous stack's data behind. Device keys/themes are
  // preserved. Without replace it's a per-key OVERLAY (used by sync/merge).
  function importAll(data, opts) {
    if (!isStackBackup(data)) return Promise.reject(new Error("Not a stack backup file"));
    if ((data.version || 1) > 2) return Promise.reject(new Error("This backup is from a newer version of the app — update first"));
    var replace = !!(opts && opts.replace);
    var ls = data.localStorage || {};
    if (replace) {
      var preserve = {}; DEVICE_PRESERVE.forEach(function (k) { preserve[k] = 1; });
      stackKeys().forEach(function (k) {
        if (preserve[k]) return;
        try { localStorage.removeItem(k); } catch (e) {}
      });
    }
    Object.keys(ls).forEach(function (k) {
      try { if (ls[k] != null) localStorage.setItem(k, ls[k]); } catch (e) {}
    });
    // In replace mode a backup with no library must CLEAR the old one (else the
    // previous stack's RECALL library leaks). Overlay mode keeps the no-op.
    if (data.recallLibrary) return writeRecallLibrary(data.recallLibrary).then(function () { return true; });
    if (replace) return clearRecallLibrary().then(function () { return true; });
    return Promise.resolve(true);
  }

  // ---------- Google Drive layer ----------
  var tokenClient = null;
  function loadGis() {
    return new Promise(function (resolve, reject) {
      if (window.google && google.accounts && google.accounts.oauth2) return resolve();
      var existing = document.getElementById("gis-script");
      if (existing) { existing.addEventListener("load", function () { resolve(); }); existing.addEventListener("error", function () { reject(new Error("Couldn't load Google sign-in")); }); return; }
      var s = document.createElement("script"); s.id = "gis-script"; s.src = "https://accounts.google.com/gsi/client"; s.async = true; s.defer = true;
      var to = setTimeout(function () { reject(new Error("Couldn't load Google sign-in (network?)")); }, 10000);
      s.onload = function () { clearTimeout(to); resolve(); };
      s.onerror = function () { clearTimeout(to); reject(new Error("Couldn't load Google sign-in (network?)")); };
      document.head.appendChild(s);
    });
  }
  function mapGisError(err) {
    var t = (err && (err.type || err.message)) || "";
    if (/popup_closed|closed/i.test(t)) return new Error("Sign-in was cancelled");
    if (/popup_failed|blocked/i.test(t)) return new Error("Sign-in popup was blocked — allow popups and retry");
    return new Error("Google sign-in failed");
  }
  function getAccessToken(forcePrompt) {
    return loadGis().then(function () {
      return new Promise(function (resolve, reject) {
        function onResp(resp) { if (resp && resp.access_token) resolve(resp.access_token); else reject(new Error("No access token")); }
        if (!tokenClient) {
          tokenClient = google.accounts.oauth2.initTokenClient({ client_id: DRIVE_CLIENT_ID, scope: DRIVE_SCOPE, callback: onResp, error_callback: function (e) { reject(mapGisError(e)); } });
        } else {
          tokenClient.callback = onResp;
          tokenClient.error_callback = function (e) { reject(mapGisError(e)); };
        }
        var meta = getSyncMeta();
        tokenClient.requestAccessToken({ prompt: forcePrompt ? "consent" : (meta.lastSyncAt ? "" : "consent") });
      });
    });
  }
  function driveFetch(token, url, opts, retried) {
    opts = opts || {}; opts.headers = opts.headers || {};
    opts.headers["Authorization"] = "Bearer " + token;
    return fetch(url, opts).then(function (res) {
      if (res.status === 401 && !retried) return getAccessToken(true).then(function (t2) { return driveFetch(t2, url, opts, true); });
      return res;
    });
  }
  function httpErr(res) { return { status: res.status, message: "Drive error " + res.status }; }
  function driveFind(token, wsId) {
    // Scope the search to THIS workspace's file (one file per workspace in the
    // same Drive), so two stacks on one Google account don't share a file.
    var q = "appProperties has { key='app' and value='mjm-stack' } and appProperties has { key='ws' and value='" + wsId + "' } and trashed=false";
    var url = "https://www.googleapis.com/drive/v3/files?q=" + encodeURIComponent(q) + "&fields=files(id,modifiedTime)&pageSize=10";
    return driveFetch(token, url, { method: "GET" }).then(function (res) {
      if (!res.ok) throw httpErr(res); return res.json();
    }).then(function (j) {
      var files = (j && j.files) || []; if (!files.length) return null;
      var meta = getSyncMeta();
      // Only trust a stored fileId if it belongs to this same workspace.
      if (meta.fileId && meta.wsId === wsId) { for (var i = 0; i < files.length; i++) if (files[i].id === meta.fileId) return files[i]; }
      return files[0];
    });
  }
  function driveDownload(token, id) {
    return driveFetch(token, "https://www.googleapis.com/drive/v3/files/" + id + "?alt=media", { method: "GET" }).then(function (res) {
      if (res.status === 404) { setSyncMeta({ fileId: null }); return null; }
      if (!res.ok) throw httpErr(res);
      return res.json();
    });
  }
  function driveCreate(token, name, props, obj) {
    var boundary = "mjmstack" + Math.random().toString(36).slice(2);
    var meta = { name: name, mimeType: "application/json", appProperties: props };
    var body = "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + JSON.stringify(meta) +
      "\r\n--" + boundary + "\r\nContent-Type: application/json\r\n\r\n" + JSON.stringify(obj) + "\r\n--" + boundary + "--";
    return driveFetch(token, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
      { method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + boundary }, body: body })
      .then(function (res) { if (!res.ok) throw httpErr(res); return res.json(); }).then(function (j) { return j.id; });
  }
  function driveUpdate(token, id, obj) {
    return driveFetch(token, "https://www.googleapis.com/upload/drive/v3/files/" + id + "?uploadType=media&fields=id",
      { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) })
      .then(function (res) { if (!res.ok) throw httpErr(res); return res.json(); }).then(function (j) { return j.id; });
  }
  function driveErrMsg(e) {
    var s = e && e.status;
    if (s === 403) return "Google Drive upload failed — your Drive may be full or access was revoked";
    if (e && e.message) return e.message;
    return "Drive sync failed — check your connection and try again";
  }

  function getSyncMeta() { try { return JSON.parse(localStorage.getItem(LS_SYNC_META)) || {}; } catch (e) { return {}; } }
  function setSyncMeta(patch) { var m = getSyncMeta(); for (var k in patch) m[k] = patch[k]; try { localStorage.setItem(LS_SYNC_META, JSON.stringify(m)); } catch (e) {} }

  // Full manual sync: pull Drive copy, merge, apply locally, push result.
  function syncDrive(opts) {
    opts = opts || {};
    var status = opts.onStatus || function () {}, onErr = opts.onErr || function () {}, onDone = opts.onDone || function () {};
    if (!isConfigured()) { onErr("Drive sync isn't set up yet (owner setup pending)"); return Promise.resolve(false); }
    var ws = ensureWorkspace();
    var token;
    status("Connecting to Google Drive…");
    return getAccessToken().then(function (t) {
      token = t; return exportAll({ forSync: true });
    }).then(function (local) {
      status("Checking Drive…");
      return driveFind(token, ws.id).then(function (found) {
        return (found ? driveDownload(token, found.id) : Promise.resolve(null)).then(function (remote) {
          return { found: found, local: local, remote: remote };
        });
      });
    }).then(function (ctx) {
      var local = ctx.local, remote = ctx.remote, found = ctx.found, payload, report = null;
      var apply = Promise.resolve();
      if (!remote) { payload = local; }
      else if (!isStackBackup(remote)) {
        if (!confirm("The file already in your Drive isn't a recognizable stack backup. Overwrite it with this device's data?")) return false;
        payload = local;
      } else {
        var conflict = workspaceConflict(local, remote);
        if (conflict) { onErr('Sync blocked: your Drive holds workspace "' + conflict.remoteName + '", but this device is "' + conflict.localName + '". Use STACK RESTORE to switch this device entirely.'); return false; }
        status("Merging…");
        var merged = mergeStates(local, remote);
        payload = merged.data; report = merged.report;
        apply = importAll(payload);
      }
      return apply.then(function () {
        // defense in depth: never upload a payload carrying excluded secrets
        var lsp = payload.localStorage || {};
        var leaked = SYNC_EXCLUDE.filter(function (k) { return lsp[k] != null; });
        if (leaked.length) { onErr("Sync aborted: refused to upload sensitive keys"); return false; }
        status("Uploading…");
        var storedMeta = getSyncMeta();
        var fileId = found ? found.id : ((storedMeta.wsId === ws.id) ? (storedMeta.fileId || null) : null);
        var up = fileId
          ? driveUpdate(token, fileId, payload).catch(function () { return driveCreate(token, syncFileName(ws), syncMarker(ws), payload); })
          : driveCreate(token, syncFileName(ws), syncMarker(ws), payload);
        return up.then(function (id) {
          setSyncMeta({ fileId: id, wsId: ws.id, lastSyncAt: Date.now() });
          onDone(report);
          status(remote ? "Synced" : "First sync — uploaded this device");
          if (opts.reload !== false) location.reload();
          return true;
        });
      });
    }).catch(function (e) { onErr(driveErrMsg(e)); return false; });
  }

  // ---------- one-call convenience for the app UIs ----------
  function download(obj, filename) {
    var blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 0);
  }
  function exportToFile() {
    ensureWorkspace();
    return exportAll().then(function (data) {
      download(data, "mjm-stack-backup-" + new Date().toISOString().slice(0, 10) + ".json");
      return data;
    });
  }
  function importFromFile(file, onErr) {
    return new Promise(function (resolve) {
      var r = new FileReader();
      r.onload = function () {
        var data; try { data = JSON.parse(r.result); } catch (e) { if (onErr) onErr("That file isn't valid JSON"); return resolve(false); }
        if (!isStackBackup(data)) { if (onErr) onErr("That isn't a stack backup file"); return resolve(false); }
        var note = "";
        var wsHere = getWorkspace(), wsFile = wsOf(data);
        if (wsHere && wsFile && wsHere.id !== wsFile.id) note = '\n\nNOTE: this backup is from workspace "' + (wsFile.name || "?") + '" — restoring switches this device to that workspace.';
        if (!confirm("Restore this backup? It REPLACES the data in RECALL, HOOKLAB, BLAST, and PULSE on this device.\n\nContains: " + summary(data) + note)) return resolve(false);
        importAll(data, { replace: true }).then(function () { location.reload(); resolve(true); })
          .catch(function (e) { if (onErr) onErr(e.message || "Import failed"); resolve(false); });
      };
      r.readAsText(file);
    });
  }
  // Merge a backup FILE into this device (non-destructive union), unlike the
  // REPLACE that importFromFile does.
  function mergeFromFile(file, opts) {
    opts = opts || {}; var onErr = opts.onErr || function () {};
    return new Promise(function (resolve) {
      var r = new FileReader();
      r.onload = function () {
        var data; try { data = JSON.parse(r.result); } catch (e) { onErr("That file isn't valid JSON"); return resolve(false); }
        if (!isStackBackup(data)) { onErr("That isn't a stack backup file"); return resolve(false); }
        if ((data.version || 1) > 2) { onErr("That backup is from a newer version of the app"); return resolve(false); }
        ensureWorkspace();
        exportAll({ forSync: true }).then(function (local) {
          var conflict = workspaceConflict(local, data);
          if (conflict) { onErr('Merge blocked: that file belongs to workspace "' + conflict.remoteName + '", but this device is "' + conflict.localName + '". Use STACK RESTORE to switch entirely.'); return resolve(false); }
          var merged;
          try { merged = mergeStates(local, data); }
          catch (e) { onErr(e && e.code === "WORKSPACE_MISMATCH" ? "Merge blocked: different workspaces" : "Merge failed"); return resolve(false); }
          if (!confirm("Merge this backup into this device? Nothing is deleted; newer versions win conflicts.\n\nAdds: " + summary(merged.data))) return resolve(false);
          importAll(merged.data).then(function () {
            var meta = getSyncMeta();
            if (meta.fileId && isConfigured() && confirm("Merged. Also push the combined result to your Google Drive now?")) { syncDrive({ onStatus: opts.onStatus, onErr: onErr }); resolve(true); }
            else { if (opts.reload !== false) location.reload(); resolve(true); }
          }).catch(function () { onErr("Import failed"); resolve(false); });
        });
      };
      r.readAsText(file);
    });
  }

  // ---------- "update available" banner ----------
  // GitHub Pages caches every file for ~10 min (max-age=600, not
  // configurable), so after a deploy a browser can run stale JS for a while.
  // We can't force an instant in-window refresh uniformly (the module apps'
  // import URLs are fixed), so we DETECT a new build and prompt a reload.
  var SS_UPDATE_TRIED = "stack_update_tried", SS_UPDATE_DISMISSED = "stack_update_dismissed";
  var lastUpdateCheck = 0;
  function injectUpdateBanner(deployedBuild) {
    if (document.getElementById("stackupdatebar")) return;
    var tried = "";
    try { tried = sessionStorage.getItem(SS_UPDATE_TRIED) || ""; } catch (e) {}
    var second = tried === deployedBuild; // already reloaded once for this build, still stale
    var bar = document.createElement("div");
    bar.id = "stackupdatebar";
    bar.setAttribute("role", "status");
    bar.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:2147483000;" +
      "display:flex;align-items:center;gap:12px;justify-content:center;flex-wrap:wrap;" +
      "padding:10px 14px;background:#111827;color:#f3f4f6;font:14px/1.4 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;" +
      "box-shadow:0 -2px 12px rgba(0,0,0,.35)";
    var msg = document.createElement("span");
    msg.textContent = second
      ? "Still updating — GitHub is serving a cached copy for a few minutes; it will refresh on its own shortly."
      : "A newer version is available.";
    var btn = document.createElement("button");
    btn.textContent = second ? "Try again" : "Reload";
    btn.style.cssText = "cursor:pointer;border:0;border-radius:8px;padding:7px 14px;font:inherit;font-weight:700;background:#22d3ee;color:#08131a";
    btn.addEventListener("click", function () {
      try { sessionStorage.setItem(SS_UPDATE_TRIED, deployedBuild); } catch (e) {}
      location.reload();
    });
    var x = document.createElement("button");
    x.textContent = "✕"; x.setAttribute("aria-label", "Dismiss");
    x.style.cssText = "cursor:pointer;border:0;background:none;color:#9ca3af;font:inherit;font-size:16px;line-height:1;padding:4px";
    x.addEventListener("click", function () {
      try { sessionStorage.setItem(SS_UPDATE_DISMISSED, deployedBuild); } catch (e) {}
      bar.parentNode && bar.parentNode.removeChild(bar);
    });
    bar.appendChild(msg); bar.appendChild(btn); bar.appendChild(x);
    (document.body || document.documentElement).appendChild(bar);
  }
  // Fire-and-forget: fetch the live stackdata.js (cache-busted) and compare its
  // baked-in STACK_BUILD to ours. Never throws, never blocks the app.
  function checkForUpdate() {
    var now = Date.now();
    if (now - lastUpdateCheck < 120000) return; // throttle to once / 2 min
    lastUpdateCheck = now;
    try {
      var url = new URL("stackdata.js", location.href);
      url.searchParams.set("bust", String(now));
      fetch(url.toString(), { cache: "no-store" }).then(function (r) { return r.ok ? r.text() : ""; }).then(function (txt) {
        var m = txt.match(/STACK_BUILD\s*=\s*"([^"]+)"/);
        var deployed = m && m[1];
        if (!deployed || deployed === STACK_BUILD) return;
        var dismissed = ""; try { dismissed = sessionStorage.getItem(SS_UPDATE_DISMISSED) || ""; } catch (e) {}
        if (dismissed === deployed) return; // user dismissed this exact build this session
        injectUpdateBanner(deployed);
      }).catch(function () {});
    } catch (e) {}
  }

  // Wire the shared Sync/Merge UI (identical ids in every app). Takes the
  // app's own toast(msg) so status/errors surface in that app's style.
  function bindSyncUI(toast) {
    toast = toast || function () {};
    var sy = document.getElementById("stacksync");
    var mg = document.getElementById("stackmerge");
    var mf = document.getElementById("stackmergefile");
    var ss = document.getElementById("syncstatus");
    function relSync(ms) {
      if (!ms) return "not synced yet";
      var m = Math.round((Date.now() - ms) / 60000);
      if (m < 1) return "synced just now";
      if (m < 60) return "synced " + m + "m ago";
      var h = Math.round(m / 60);
      if (h < 48) return "synced " + h + "h ago";
      return "synced " + Math.round(h / 24) + "d ago";
    }
    function refresh() {
      if (!ss) return;
      var w = getWorkspace(), meta = getSyncMeta();
      ss.textContent = (w ? ('“' + w.name + '” · ') : "") + relSync(meta.lastSyncAt) + (isConfigured() ? "" : " · Drive setup pending");
    }
    var busy = false;
    if (sy) sy.addEventListener("click", function () {
      if (busy) return; busy = true; sy.disabled = true;
      syncDrive({ onStatus: toast, onErr: function (m) { toast(m); busy = false; sy.disabled = false; refresh(); }, onDone: function () {} })
        .then(function () { busy = false; sy.disabled = false; refresh(); });
    });
    if (mg && mf) {
      mg.addEventListener("click", function () { mf.click(); });
      mf.addEventListener("change", function (e) { var f = e.target.files && e.target.files[0]; if (f) mergeFromFile(f, { onStatus: toast, onErr: toast }); e.target.value = ""; });
    }
    refresh();
    // Check for a newer deploy now, and again whenever the tab regains focus
    // (catches a deploy that landed while this tab sat open).
    checkForUpdate();
    document.addEventListener("visibilitychange", function () { if (!document.hidden) checkForUpdate(); });
  }

  window.StackData = {
    // Part A — shared keys
    resolveKeys: resolveKeys, writeSharedKeys: writeShared, clearSharedKey: clearShared, readSharedKeys: readShared,
    // Part B — full-stack file backup
    exportAll: exportAll, importAll: importAll, summary: summary, isStackBackup: isStackBackup,
    exportToFile: exportToFile, importFromFile: importFromFile,
    // Part C — Drive sync + merge
    syncDrive: syncDrive, mergeFromFile: mergeFromFile, mergeStates: mergeStates,
    tombstone: tombstone, getWorkspace: getWorkspace, ensureWorkspace: ensureWorkspace,
    workspaceConflict: workspaceConflict, getSyncMeta: getSyncMeta, isSyncConfigured: isConfigured,
    bindSyncUI: bindSyncUI, checkForUpdate: checkForUpdate, build: STACK_BUILD,
  };
})();
