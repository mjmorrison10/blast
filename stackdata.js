// === stackdata.js — shared across RECALL / HOOKLAB / BLAST / PULSE ===
// One origin (mjmorrison10.github.io) means one localStorage + one IndexedDB,
// so this vendored helper gives the four apps two suite-wide behaviors:
//   1. Shared API keys  — a single `stack_settings_v1` store so a key entered
//      in any app works in all of them.
//   2. Full-stack backup — export/import EVERY app's data (incl RECALL's
//      IndexedDB library) as one JSON file.
// Plain classic script (no ES module) so it loads identically in the module
// apps (HOOKLAB/BLAST) and the classic apps (RECALL/PULSE). Byte-identical copy
// in each app directory.
(function () {
  "use strict";

  var LS_SHARED = "stack_settings_v1";
  // RECALL's IndexedDB library (same constants as recall/app.js).
  var IDB_NAME = "recall", IDB_VERSION = 1, IDB_STORE = "library", IDB_KEY = "current";

  // ---------- shared API keys (Part A) ----------
  function readShared() {
    try { return JSON.parse(localStorage.getItem(LS_SHARED)) || {}; }
    catch (e) { return {}; }
  }
  // Write-through on save: only NON-EMPTY values, so saving one app (e.g. just a
  // Gemini key) never blanks a key another app set. Clearing is explicit below.
  function writeShared(partial) {
    try {
      var cur = readShared();
      for (var k in partial) { var v = partial[k]; if (v != null && v !== "") cur[k] = v; }
      cur.updatedAt = new Date().toISOString();
      localStorage.setItem(LS_SHARED, JSON.stringify(cur));
      return true;
    } catch (e) { return false; }
  }
  // Explicit clear (from a "Clear this key" button): blanks the field everywhere.
  function clearShared(field) {
    try {
      var cur = readShared();
      cur[field] = "";
      cur.updatedAt = new Date().toISOString();
      localStorage.setItem(LS_SHARED, JSON.stringify(cur));
      return true;
    } catch (e) { return false; }
  }
  // Merge shared key fields over a local settings object. Shared wins; when
  // shared lacks a field but the app's legacy local settings have it, promote
  // it into the shared store (so the first app opened seeds the rest).
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
  function stackKeys() {
    var out = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (/^(recall|hooklab|blast|pulse|stack)[-_]/i.test(k)) out.push(k);
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

  // ---------- full-stack export/import (Part B) ----------
  function exportAll() {
    return readRecallLibrary().then(function (lib) {
      var ls = {};
      stackKeys().forEach(function (k) { ls[k] = localStorage.getItem(k); });
      return {
        format: "mjm-stack-backup", version: 1,
        exportedAt: new Date().toISOString(),
        localStorage: ls,
        recallLibrary: lib
      };
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
    return parts.length ? parts.join(", ") : "no app data (keys/settings only)";
  }
  function readSharedFrom(ls) { try { return JSON.parse(ls["stack_settings_v1"]) || {}; } catch (e) { return {}; } }

  function importAll(data) {
    if (!isStackBackup(data)) return Promise.reject(new Error("Not a stack backup file"));
    var ls = data.localStorage || {};
    Object.keys(ls).forEach(function (k) {
      try { if (ls[k] != null) localStorage.setItem(k, ls[k]); } catch (e) {}
    });
    return writeRecallLibrary(data.recallLibrary).then(function () { return true; });
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
    return exportAll().then(function (data) {
      download(data, "mjm-stack-backup-" + new Date().toISOString().slice(0, 10) + ".json");
      return data;
    });
  }
  // Reads a File, confirms (with a summary), imports, then reloads. onErr(msg)
  // optional for a toast. Returns a promise resolving true if imported.
  function importFromFile(file, onErr) {
    return new Promise(function (resolve) {
      var r = new FileReader();
      r.onload = function () {
        var data; try { data = JSON.parse(r.result); } catch (e) { if (onErr) onErr("That file isn't valid JSON"); return resolve(false); }
        if (!isStackBackup(data)) { if (onErr) onErr("That isn't a stack backup file"); return resolve(false); }
        if (!confirm("Restore this backup? It REPLACES the data in RECALL, HOOKLAB, BLAST, and PULSE on this device.\n\nContains: " + summary(data))) return resolve(false);
        importAll(data).then(function () { location.reload(); resolve(true); })
          .catch(function (e) { if (onErr) onErr(e.message || "Import failed"); resolve(false); });
      };
      r.readAsText(file);
    });
  }

  window.StackData = {
    // Part A — shared keys
    resolveKeys: resolveKeys, writeSharedKeys: writeShared, clearSharedKey: clearShared, readSharedKeys: readShared,
    // Part B — full-stack backup
    exportAll: exportAll, importAll: importAll, summary: summary, isStackBackup: isStackBackup,
    exportToFile: exportToFile, importFromFile: importFromFile,
  };
})();
