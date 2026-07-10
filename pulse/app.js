// === PULSE app.js ===
// The analytics loop for the RECALL / HOOKLAB / BLAST stack. Tracks each posted
// clip's view velocity at 1h/2h/6h/... , pulls YouTube stats automatically, and
// logs winners back into the HOOKLAB ledger. Zero-build, BYO-key, localStorage.
// Loaded as a plain (non-module) script — same IIFE style as the other apps.
(function () {
  "use strict";

  function $(s) { return document.querySelector(s); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function uid() { return "p_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36); }

  var LS_POSTS = "pulse_posts_v1";
  var LS_SETTINGS = "pulse_settings_v1";
  var LS_BLAST = "blast_session_v1";
  var LS_HOOKLAB = "hooklab_state_v1";
  var HOOKLAB_URL = "https://mjmorrison10.github.io/Hooklabs/";

  // Same nine platforms BLAST posts to, in the same order/names so imports line up.
  var PLATFORMS = ["YouTube Shorts", "TikTok", "Instagram Reels", "Snapchat Spotlight",
    "Facebook Reels", "X", "Threads", "LinkedIn", "Pinterest"];
  var TEXT_PLATFORMS = { "X": 1, "Threads": 1, "LinkedIn": 1, "Pinterest": 1 };
  function mediumFor(name) { return TEXT_PLATFORMS[name] ? "text" : "video"; }

  // Check-in schedule, in hours. A single reading "covers" every checkpoint at or
  // below its elapsed time, so late reads are honest, not backfilled.
  var CHECKPOINTS = [1, 2, 6, 24, 48, 168];
  function ckLabel(h) { return h < 24 ? h + "h" : (h / 24) + "d"; }

  var posts = [];
  var settings = { ytKey: "" };

  function loadAll() {
    try { posts = JSON.parse(localStorage.getItem(LS_POSTS)) || []; } catch (e) { posts = []; }
    if (!Array.isArray(posts)) posts = [];
    try { var s = JSON.parse(localStorage.getItem(LS_SETTINGS)); if (s) Object.assign(settings, s); } catch (e) {}
    // ytKey is shared across the stack (shared store wins; legacy local promoted).
    if (window.StackData) settings.ytKey = window.StackData.resolveKeys(settings, ["ytKey"]).ytKey || "";
  }
  function savePosts() {
    try { localStorage.setItem(LS_POSTS, JSON.stringify(posts)); return true; }
    catch (e) { toast("Couldn't save (storage full or blocked)"); return false; }
  }
  function saveSettings() {
    try { localStorage.setItem(LS_SETTINGS, JSON.stringify(settings)); return true; }
    catch (e) { toast("Couldn't save settings"); return false; }
  }

  // ---------- toast ----------
  var toastT;
  function toast(msg) { var el = $("#toast"); el.textContent = msg; el.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove("show"); }, 2600); }

  // ---------- formatting ----------
  function fmtNum(n) {
    n = Number(n) || 0;
    if (n < 1000) return String(n);
    if (n < 1e6) return (n / 1e3).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, "") + "K";
    return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
  }
  function relTime(ms) {
    var d = Date.now() - ms, m = Math.round(d / 60000);
    if (m < 1) return "just now";
    if (m < 60) return m + "m ago";
    var h = Math.round(m / 60);
    if (h < 48) return h + "h ago";
    return Math.round(h / 24) + "d ago";
  }
  function inHours(ms) {
    var d = ms - Date.now(), h = d / 3600000;
    if (h < 1) return "in " + Math.max(1, Math.round(d / 60000)) + "m";
    if (h < 48) return "in " + Math.round(h) + "h";
    return "in " + Math.round(h / 24) + "d";
  }

  // ---------- checkpoints ----------
  function maxCovered(post) { return post.snapshots.length ? Math.max.apply(null, post.snapshots.map(function (s) { return s.elapsedMin; })) : -1; }
  function nextDue(post, now) {
    var covered = maxCovered(post);
    for (var i = 0; i < CHECKPOINTS.length; i++) {
      var hMin = CHECKPOINTS[i] * 60;
      if (now >= post.postedAt + hMin * 60000 && hMin > covered) return CHECKPOINTS[i];
    }
    return null;
  }
  function latestSnap(post) { return post.snapshots.length ? post.snapshots[post.snapshots.length - 1] : null; }
  function velocityPerHr(post) {
    if (post.snapshots.length < 2) return null;
    var a = post.snapshots[post.snapshots.length - 2], b = post.snapshots[post.snapshots.length - 1];
    var dt = (b.elapsedMin - a.elapsedMin) / 60; if (dt <= 0) return null;
    return Math.round((b.views - a.views) / dt);
  }

  function recordSnapshot(post, data, source) {
    var now = Date.now();
    post.snapshots.push({
      at: now, elapsedMin: Math.max(0, Math.round((now - post.postedAt) / 60000)),
      views: Number(data.views) || 0,
      likes: data.likes != null ? Number(data.likes) : null,
      comments: data.comments != null ? Number(data.comments) : null,
      source: source
    });
    post.snapshots.sort(function (a, b) { return a.elapsedMin - b.elapsedMin; });
  }

  // ---------- YouTube ----------
  function isYouTube(post) { return /youtu\.?be|youtube\.com/i.test(post.url) || post.platform === "YouTube Shorts"; }
  function ytId(url) {
    var m = String(url).match(/(?:youtube\.com\/(?:shorts|live|embed)\/|youtu\.be\/|[?&]v=)([\w-]{6,})/);
    return m ? m[1] : null;
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function isRetryable(s) { return s === 429 || s === 500 || s === 503; }
  async function fetchWithRetry(make) {
    var backoff = [3000, 9000];
    for (var attempt = 1; ; attempt++) {
      var res = await make();
      if (!isRetryable(res.status) || attempt >= 3) return res;
      await sleep(backoff[attempt - 1] || 9000);
    }
  }
  async function fetchYouTubeStats(id, key) {
    var url = "https://www.googleapis.com/youtube/v3/videos?part=statistics&id=" +
      encodeURIComponent(id) + "&key=" + encodeURIComponent(key);
    var res = await fetchWithRetry(function () { return fetch(url); });
    if (!res.ok) {
      if (res.status === 400 || res.status === 403) throw new Error("YouTube API key rejected or quota exhausted — check Settings");
      throw new Error("YouTube error " + res.status);
    }
    var j = await res.json();
    var item = j && j.items && j.items[0];
    if (!item) throw new Error("Video not found (private, deleted, or wrong link)");
    var st = item.statistics || {};
    return { views: parseInt(st.viewCount || "0", 10), likes: st.likeCount != null ? parseInt(st.likeCount, 10) : null, comments: st.commentCount != null ? parseInt(st.commentCount, 10) : null };
  }
  async function checkYouTube(post, opts) {
    opts = opts || {};
    if (!settings.ytKey) { if (opts.loud) toast("Add a YouTube API key in Settings to auto-track"); return false; }
    var id = ytId(post.url);
    if (!id) { if (opts.loud) toast("Couldn't read a video id from that URL"); return false; }
    try {
      var stats = await fetchYouTubeStats(id, settings.ytKey);
      recordSnapshot(post, stats, "auto");
      savePosts();
      return true;
    } catch (e) { if (opts.loud) toast(e.message || "YouTube check failed"); return false; }
  }
  // On load / on demand: snapshot every YouTube post that has a due checkpoint.
  async function autoCheckDue(loud) {
    if (!settings.ytKey) { if (loud) toast("Add a YouTube API key in Settings first"); return; }
    var due = posts.filter(function (p) { return isYouTube(p) && ytId(p.url) && nextDue(p, Date.now()) != null; });
    if (!due.length) { if (loud) toast("No YouTube posts are due for a check right now"); return; }
    if (loud) toast("Checking " + due.length + " YouTube post" + (due.length > 1 ? "s" : "") + "…");
    var ok = 0;
    for (var i = 0; i < due.length; i++) { if (await checkYouTube(due[i])) ok++; }
    render();
    if (loud) toast(ok + " updated");
  }

  // ---------- HOOKLAB ledger write-back ----------
  function logToLedger(post, outcome) {
    var raw = null; try { raw = localStorage.getItem(LS_HOOKLAB); } catch (e) {}
    var st = {}; try { st = raw ? JSON.parse(raw) : {}; } catch (e) { st = {}; }
    if (!st.ledger) st.ledger = [];
    if (!st.comps) st.comps = [];
    var latest = latestSnap(post);
    var entry = {
      id: "pulse_" + post.id,
      hook: (String(post.hook || post.caption || "").split("\n")[0].slice(0, 300)) || "(clip)",
      patternId: "", family: "unknown", outcome: outcome,
      platform: post.platform, medium: mediumFor(post.platform),
      niche: "general", retention: "", views: latest ? String(latest.views) : "",
      notes: "via PULSE: " + post.url,
      createdAt: new Date().toISOString(), source: "pulse"
    };
    // Replace any prior PULSE entry for this post so re-logging updates, not dupes.
    st.ledger = st.ledger.filter(function (e) { return e && e.id !== entry.id; });
    st.ledger.unshift(entry);
    try { localStorage.setItem(LS_HOOKLAB, JSON.stringify(st)); }
    catch (e) { toast("Couldn't write to HOOKLAB ledger (storage full or blocked)"); return false; }
    post.outcome = outcome; post.ledgerLoggedAt = Date.now();
    savePosts();
    return true;
  }

  // ---------- import from BLAST ----------
  function makePost(platform, url, caption, postedAt) {
    return { id: uid(), platform: platform, url: url, caption: caption || "",
      hook: String(caption || "").split("\n")[0].slice(0, 200),
      postedAt: postedAt || Date.now(), snapshots: [], outcome: null, ledgerLoggedAt: null };
  }
  function importFromBlast() {
    var raw = null; try { raw = localStorage.getItem(LS_BLAST); } catch (e) {}
    if (!raw) { toast("No BLAST session found in this browser — post something in BLAST first"); return; }
    var s = null; try { s = JSON.parse(raw); } catch (e) {}
    if (!s) { toast("BLAST session couldn't be read"); return; }
    var status = s.status || {}, postUrl = s.postUrl || {}, postedAt = s.postedAt || {},
      postedCaption = s.postedCaption || {}, captions = s.captions || {};
    var added = 0, skipped = 0, nourl = 0;
    Object.keys(status).forEach(function (name) {
      if (status[name] !== "posted") return;
      var url = (postUrl[name] || "").trim();
      if (!url) { nourl++; return; }
      if (posts.some(function (p) { return p.platform === name && p.url === url; })) { skipped++; return; }
      var cap = postedCaption[name] || captions[name] || s.base || "";
      posts.unshift(makePost(name, url, cap, postedAt[name] || Date.now()));
      added++;
    });
    if (added) savePosts();
    render();
    if (added) toast("Imported " + added + " post" + (added > 1 ? "s" : "") + " from BLAST" + (skipped ? " (" + skipped + " already tracked)" : ""));
    else if (skipped) toast("Those BLAST posts are already tracked");
    else if (nourl) toast("BLAST has posted clips but no post URLs yet — paste the live link in BLAST, then import");
    else toast("Nothing marked Posted in BLAST yet");
    if (added) autoCheckDue(false);
  }

  // ---------- sparkline ----------
  function sparkline(post) {
    var s = post.snapshots;
    if (s.length < 2) return "";
    var W = 120, H = 34, pad = 2;
    var xs = s.map(function (p) { return p.elapsedMin; }), ys = s.map(function (p) { return p.views; });
    var minx = Math.min.apply(null, xs), maxx = Math.max.apply(null, xs);
    var miny = Math.min.apply(null, ys), maxy = Math.max.apply(null, ys);
    var sx = function (x) { return maxx === minx ? pad : pad + (x - minx) / (maxx - minx) * (W - 2 * pad); };
    var sy = function (y) { return maxy === miny ? H / 2 : H - pad - (y - miny) / (maxy - miny) * (H - 2 * pad); };
    var d = s.map(function (p, i) { return (i ? "L" : "M") + sx(p.elapsedMin).toFixed(1) + " " + sy(p.views).toFixed(1); }).join(" ");
    var last = s[s.length - 1];
    return '<svg class="spark" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">' +
      '<path d="' + d + '" fill="none" stroke="var(--brand)" stroke-width="1.8" stroke-linejoin="round"/>' +
      '<circle cx="' + sx(last.elapsedMin).toFixed(1) + '" cy="' + sy(last.views).toFixed(1) + '" r="2.4" fill="var(--brand)"/></svg>';
  }

  // ---------- render ----------
  function checksHTML(post) {
    var now = Date.now(), covered = maxCovered(post), due = nextDue(post, now);
    return '<div class="checks">' + CHECKPOINTS.map(function (h) {
      var hMin = h * 60, dueTime = post.postedAt + hMin * 60000;
      if (hMin <= covered) return '<span class="checkchip done">' + ckLabel(h) + ' ✓</span>';
      if (now >= dueTime) return '<span class="checkchip due' + (due === h ? '' : '') + '" data-act="focusrec" data-id="' + post.id + '">' + ckLabel(h) + ' due</span>';
      return '<span class="checkchip pending">' + ckLabel(h) + ' ' + inHours(dueTime) + '</span>';
    }).join("") + '</div>';
  }
  function metricsHTML(post) {
    var l = latestSnap(post);
    if (!l) return '<div class="metrics"><div class="metric"><span class="n">—</span><span class="l">no reading yet</span></div>' + (post.snapshots.length ? "" : "") + '</div>';
    var vel = velocityPerHr(post);
    var out = '<div class="metrics">' +
      '<div class="metric"><span class="n">' + fmtNum(l.views) + '</span><span class="l">views · ' + relTime(l.at) + '</span></div>';
    if (l.likes != null) out += '<div class="metric"><span class="n">' + fmtNum(l.likes) + '</span><span class="l">likes</span></div>';
    if (l.comments != null) out += '<div class="metric"><span class="n">' + fmtNum(l.comments) + '</span><span class="l">comments</span></div>';
    if (vel != null) out += '<div class="metric"><span class="n vel">' + fmtNum(vel) + '</span><span class="l">views / hr</span></div>';
    out += sparkline(post);
    return out + '</div>';
  }
  function render() {
    var host = $("#posts");
    if (!posts.length) {
      host.innerHTML = '<div class="empty"><b>No posts tracked yet.</b> Import what you shipped from BLAST, or add one by hand above. Then check back at 1h, 2h, 6h.</div>';
      return;
    }
    // sort: due checks first, then most recently posted
    var now = Date.now();
    var sorted = posts.slice().sort(function (a, b) {
      var da = nextDue(a, now) != null ? 1 : 0, db = nextDue(b, now) != null ? 1 : 0;
      if (da !== db) return db - da;
      return b.postedAt - a.postedAt;
    });
    host.innerHTML = sorted.map(function (post) {
      var yt = isYouTube(post) && ytId(post.url);
      var due = nextDue(post, now);
      var head = '<div class="posthead">' +
        '<span class="platformtag">' + esc(post.platform) + '</span>' +
        '<div style="flex:1;min-width:0">' +
        '<p class="hook">' + (esc(post.hook) || '<span style="color:var(--faint)">(no hook noted)</span>') + '</p>' +
        '<div class="sub"><a href="' + esc(post.url) + '" target="_blank" rel="noopener">open post ↗</a>' +
        '<span>posted ' + relTime(post.postedAt) + '</span>' +
        (yt ? '<span class="pilltag">youtube auto</span>' : '<span class="pilltag">manual</span>') + '</div></div>' +
        '<button class="x" data-act="del" data-id="' + post.id + '" title="Stop tracking">×</button></div>';

      var snaprow = '<div class="snaprow">' +
        (yt ? '<button class="btn ghost" data-act="check" data-id="' + post.id + '">Check now</button>' : '') +
        '<span class="lab">Log views:</span>' +
        '<input type="number" min="0" inputmode="numeric" placeholder="e.g. 12400" id="snap-' + post.id + '">' +
        '<button class="btn ghost" data-act="rec" data-id="' + post.id + '">Record</button>' +
        (due != null ? '<span class="lab" style="color:var(--warn)">' + ckLabel(due) + ' check is due</span>' : '') +
        '</div>';

      var oc = post.outcome;
      var outcomerow = '<div class="outcomerow"><span class="lab">Outcome:</span>' +
        ['winner', 'meh', 'dead'].map(function (o) {
          return '<button class="outcomebtn ' + o + (oc === o ? ' on' : '') + '" data-act="outcome" data-id="' + post.id + '" data-outcome="' + o + '">' + o.charAt(0).toUpperCase() + o.slice(1) + '</button>';
        }).join("") +
        (post.ledgerLoggedAt ? '<span class="logged">✓ in HOOKLAB ledger</span>' : '') + '</div>';

      return '<div class="post">' + head + metricsHTML(post) + checksHTML(post) + snaprow + outcomerow + '</div>';
    }).join("");

    // bind
    host.querySelectorAll("[data-act]").forEach(function (el) {
      var id = el.getAttribute("data-id");
      var act = el.getAttribute("data-act");
      el.addEventListener("click", function () {
        var post = findPost(id); if (!post) return;
        if (act === "del") { if (confirm("Stop tracking this post? (Its HOOKLAB ledger entry, if logged, stays.)")) { posts = posts.filter(function (p) { return p.id !== id; }); savePosts(); render(); } }
        else if (act === "check") { checkYouTube(post, { loud: true }).then(function (ok) { if (ok) { render(); toast("Updated from YouTube"); } }); }
        else if (act === "rec") { recordManual(post); }
        else if (act === "focusrec") { var inp = $("#snap-" + id); if (inp) inp.focus(); }
        else if (act === "outcome") { var o = el.getAttribute("data-outcome"); if (logToLedger(post, o)) { render(); toast("Logged as " + o + " in your HOOKLAB ledger"); } }
      });
    });
    host.querySelectorAll("input[id^='snap-']").forEach(function (inp) {
      inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { var id = inp.id.slice(5); var p = findPost(id); if (p) recordManual(p); } });
    });
  }
  function findPost(id) { for (var i = 0; i < posts.length; i++) if (posts[i].id === id) return posts[i]; return null; }
  function recordManual(post) {
    var inp = $("#snap-" + post.id);
    var v = inp ? inp.value.trim() : "";
    if (v === "" || isNaN(Number(v))) { toast("Enter the view count first"); if (inp) inp.focus(); return; }
    recordSnapshot(post, { views: Number(v) }, "manual");
    savePosts(); render();
    toast("Recorded " + fmtNum(Number(v)) + " views");
  }

  // ---------- manual add ----------
  function addManual() {
    var platform = $("#mPlatform").value;
    var url = $("#mUrl").value.trim();
    var hook = $("#mHook").value.trim();
    var at = $("#mPostedAt").value;
    if (!url) { toast("Paste the post URL first"); $("#mUrl").focus(); return; }
    var postedAt = at ? new Date(at).getTime() : Date.now();
    if (!postedAt || isNaN(postedAt)) postedAt = Date.now();
    posts.unshift(makePost(platform, url, hook, postedAt));
    savePosts();
    $("#mUrl").value = ""; $("#mHook").value = "";
    render();
    toast("Now tracking this post");
    var p = posts[0]; if (isYouTube(p) && ytId(p.url) && settings.ytKey) checkYouTube(p, {}).then(function (ok) { if (ok) render(); });
  }

  // ---------- export / import backup ----------
  function exportJSON() {
    var blob = new Blob([JSON.stringify({ posts: posts, exportedAt: new Date().toISOString() }, null, 2)], { type: "application/json" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = "pulse-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 0);
    toast("Backup downloaded");
  }
  function importJSON(file) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var data = JSON.parse(r.result);
        // A whole-stack backup picked here routes to the stack importer.
        if (window.StackData && window.StackData.isStackBackup(data)) {
          if (confirm("This is a whole-stack backup. Restore it? It REPLACES data in all four apps on this device.\n\nContains: " + window.StackData.summary(data))) {
            window.StackData.importAll(data).then(function () { location.reload(); });
          }
          return;
        }
        var incoming = Array.isArray(data) ? data : (data.posts || []);
        var byKey = {}; posts.forEach(function (p) { byKey[p.platform + "|" + p.url] = true; });
        var added = 0;
        incoming.forEach(function (p) {
          if (!p || !p.url) return;
          if (byKey[p.platform + "|" + p.url]) return;
          if (!p.id) p.id = uid();
          if (!Array.isArray(p.snapshots)) p.snapshots = [];
          posts.unshift(p); added++;
        });
        savePosts(); render();
        toast(added + " post" + (added === 1 ? "" : "s") + " imported from backup");
      } catch (e) { toast("That file wasn't valid PULSE JSON"); }
    };
    r.readAsText(file);
  }

  // ---------- settings + theme ----------
  function keyStatus(k) { return k ? "Key saved (" + k.slice(0, 4) + "…" + k.slice(-4) + ")" : "No key saved."; }
  function openSettings() {
    $("#settingscrim").classList.add("open");
    $("#ytkey").value = settings.ytKey || "";
    $("#ytkeystatus").textContent = keyStatus(settings.ytKey);
    $("#ytkeystatus").className = "keystatus " + (settings.ytKey ? "set" : "empty");
    $("#ytkey").type = "password"; $("#ytkeyshow").textContent = "show";
  }
  function closeSettings() { $("#settingscrim").classList.remove("open"); }

  function initSettings() {
    $("#settings").addEventListener("click", openSettings);
    $("#keycancel").addEventListener("click", closeSettings);
    $("#settingscrim").addEventListener("click", function (e) { if (e.target === $("#settingscrim")) closeSettings(); });
    $("#ytkeyshow").addEventListener("click", function () {
      var i = $("#ytkey"); if (i.type === "password") { i.type = "text"; $("#ytkeyshow").textContent = "hide"; } else { i.type = "password"; $("#ytkeyshow").textContent = "show"; }
    });
    $("#ytkeyclear").addEventListener("click", function () { $("#ytkey").value = ""; settings.ytKey = ""; saveSettings(); if (window.StackData) window.StackData.clearSharedKey("ytKey"); $("#ytkeystatus").textContent = "No key saved."; $("#ytkeystatus").className = "keystatus empty"; });
    $("#keysave").addEventListener("click", function () {
      var k = $("#ytkey").value.trim();
      if (k && !/^AIza[0-9A-Za-z_\-]{20,}$/.test(k)) { toast("That doesn't look like a Google API key"); return; }
      settings.ytKey = k; saveSettings();
      if (window.StackData) { if (k) window.StackData.writeSharedKeys({ ytKey: k }); else window.StackData.clearSharedKey("ytKey"); }
      closeSettings(); toast("Settings saved");
      if (k) autoCheckDue(false);
    });
    $("#theme").addEventListener("click", function () {
      var cur = document.documentElement.getAttribute("data-theme");
      var next = cur === "dark" ? "light" : cur === "light" ? "dark" : (matchMedia("(prefers-color-scheme: dark)").matches ? "light" : "dark");
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("pulse-theme", next); } catch (e) {}
    });
  }

  // ---------- boot ----------
  function boot() {
    var t; try { t = localStorage.getItem("pulse-theme"); } catch (e) {}
    if (t) document.documentElement.setAttribute("data-theme", t);

    loadAll();

    // populate platform select + default posted-at = now (local)
    $("#mPlatform").innerHTML = PLATFORMS.map(function (p) { return '<option value="' + esc(p) + '">' + esc(p) + '</option>'; }).join("");
    var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    $("#mPostedAt").value = d.toISOString().slice(0, 16);

    initSettings();
    $("#importBlast").addEventListener("click", importFromBlast);
    $("#mAdd").addEventListener("click", addManual);
    $("#checkAll").addEventListener("click", function () { autoCheckDue(true); });
    $("#exportBtn").addEventListener("click", exportJSON);
    $("#importFileBtn").addEventListener("click", function () { $("#importFile").click(); });
    $("#importFile").addEventListener("change", function (e) { var f = e.target.files && e.target.files[0]; if (f) importJSON(f); e.target.value = ""; });
    if (window.StackData) {
      var sx = $("#stackexport"); if (sx) sx.addEventListener("click", function () { window.StackData.exportToFile(); });
      var si = $("#stackimport"); if (si) si.addEventListener("click", function () { $("#stackfile").click(); });
      var sf = $("#stackfile"); if (sf) sf.addEventListener("change", function (e) { var f = e.target.files && e.target.files[0]; if (f) window.StackData.importFromFile(f, function (msg) { toast(msg); }); e.target.value = ""; });
    }

    render();
    // quietly refresh any due YouTube posts on open
    if (settings.ytKey) autoCheckDue(false);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
