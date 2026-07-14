import { generateText, generateFromMedia, providerSupportsVideo } from "./llm.js";

// === Theme (same pattern as RECALL) ===
(function () {
  var saved = localStorage.getItem("blast-theme");
  if (saved) document.documentElement.setAttribute("data-theme", saved);
})();

function $(sel) { return document.querySelector(sel); }

function toast(msg) {
  var el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { el.classList.remove("show"); }, 2600);
}

$("#theme").addEventListener("click", function () {
  var cur = document.documentElement.getAttribute("data-theme");
  var next = cur === "dark" ? "light" : cur === "light" ? "dark" :
    (matchMedia("(prefers-color-scheme: dark)").matches ? "light" : "dark");
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("blast-theme", next);
});

// === Platform targets ===
var PLATFORMS = [
  { icon: "▶️", name: "YouTube Shorts", url: "https://www.youtube.com/upload" },
  { icon: "🎵", name: "TikTok", url: "https://www.tiktok.com/upload" },
  { icon: "📷", name: "Instagram Reels", url: "https://www.instagram.com/", note: "app recommended" },
  { icon: "👻", name: "Snapchat Spotlight", url: "https://www.snapchat.com/", note: "app recommended" },
  { icon: "📘", name: "Facebook Reels", url: "https://www.facebook.com/reels/create", note: "app recommended" },
  { icon: "✖️", name: "X", url: "https://x.com/compose/post" },
  { icon: "🧵", name: "Threads", url: "https://www.threads.net/" },
  { icon: "💼", name: "LinkedIn", url: "https://www.linkedin.com/post/new/" },
  { icon: "📌", name: "Pinterest", url: "https://www.pinterest.com/pin-builder/" },
];

// Per-platform caption rules for soft validation (never a hard block — these
// only drive a live counter + warnings). `limit` is the practical caption
// character cap; `hashtagMax` is a recommended-not-enforced ceiling.
// Notes on the fuzzier ones: YouTube Shorts caps the *title* (the text shown
// under a Short) at 100 — the 5000-char description is a separate box BLAST
// doesn't model, so 100 is the limiting field. Snapchat Spotlight captions are
// a short overlay, so 80 is a deliberately conservative cap.
var PLATFORM_RULES = {
  "YouTube Shorts":     { limit: 100,  hashtagMax: 3 },
  "TikTok":             { limit: 2200, hashtagMax: 5 },
  "Instagram Reels":    { limit: 2200, hashtagMax: 10 },
  "Snapchat Spotlight": { limit: 80,   hashtagMax: 3 },
  "Facebook Reels":     { limit: 2200, hashtagMax: 5 },
  "X":                  { limit: 280,  hashtagMax: 2 },
  "Threads":            { limit: 500,  hashtagMax: 3 },
  "LinkedIn":           { limit: 3000, hashtagMax: 5 },
  "Pinterest":          { limit: 500,  hashtagMax: 5 },
};
var DEFAULT_RULES = { limit: 2200, hashtagMax: 10 };

// Compose-intent URLs — X and Threads accept a prefilled ?text= param, so
// "Copy + open" can land the user in a compose window with the caption already
// in it. Everything else only has an upload page and keeps the plain URL +
// clipboard flow. Clipboard copy always happens first as the backup either way.
var INTENT_URLS = {
  "X":       function (t) { return "https://x.com/intent/post?text=" + encodeURIComponent(t); },
  "Threads": function (t) { return "https://www.threads.net/intent/post?text=" + encodeURIComponent(t); },
};
var INTENT_URL_MAX = 2000; // encoded chars — both platforms' caption limits fit well under this
function openUrlFor(p, text) {
  var build = INTENT_URLS[p.name];
  if (!build) return p.url;
  var u = build(text);
  return u.length <= INTENT_URL_MAX ? u : p.url; // absurdly long → plain page; clipboard is the backup
}
var EMOJI_MAX = 8;            // more than this reads as spammy
var ALLCAPS_MIN_LETTERS = 15; // don't flag short acronyms as "all caps"
var NEAR_RATIO = 0.9;         // amber once the caption hits 90% of the limit

// Per-platform caption overrides, filled in by "Adapt for each platform" or
// "Suggest captions from video" (or left blank to fall back to the shared
// base caption). Keyed by platform name.
var platformCaptions = {};
// AI-suggested caption options per platform, from "Suggest captions from
// video", plus which option (if any) is currently picked for that platform.
var platformSuggestions = {};
var platformPickedIdx = {};
// Per-platform posting status + the live URL after posting. This is what
// makes BLAST a tracker, not just a link launcher — you can see at a glance
// where a clip has and hasn't gone, even with all your tabs already open.
// Status flow: none → copied → opened → posted (or skipped at any point).
var platformStatus = {};   // name -> "none"|"copied"|"opened"|"posted"|"skipped"
var platformPostUrl = {};  // name -> string
// When a platform first becomes "posted": the moment it happened + a snapshot of
// the caption that was live then. PULSE (the analytics app) reads these to anchor
// its 1h/2h/6h check-ins. Caption maps are mutable, so we snapshot here.
var platformPostedAt = {};      // name -> ms epoch
var platformPostedCaption = {};  // name -> string
function stampPosted(name, caption) {
  if (!platformPostedAt[name]) platformPostedAt[name] = Date.now();
  platformPostedCaption[name] = caption || "";
}
function clearPosted(name) { delete platformPostedAt[name]; delete platformPostedCaption[name]; }
function relTimeShort(ms) {
  var m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return m + "m ago";
  var h = Math.round(m / 60);
  return h < 48 ? h + "h ago" : Math.round(h / 24) + "d ago";
}
var STATUS_ORDER = { none: 0, copied: 1, opened: 2, posted: 3, skipped: 3 };
var STATUS_LABEL = { none: "Not started", copied: "Caption copied", opened: "Upload opened", posted: "Posted", skipped: "Skipped" };

function statusOf(name) { return platformStatus[name] || "none"; }
// Only advance status forward (copying after you've already posted shouldn't
// knock it back to "copied"); posted/skipped are set explicitly, not bumped.
function bumpStatus(name, next) {
  var cur = statusOf(name);
  if (STATUS_ORDER[next] > STATUS_ORDER[cur] && cur !== "posted" && cur !== "skipped") {
    platformStatus[name] = next;
  }
}

// === Session persistence (localStorage) ===
// A refresh or a closed tab used to lose everything but the API key. Now the
// whole working session — base caption, per-platform captions/suggestions/
// picks, and posting status — survives, so BLAST feels like a workspace.
var LS_SESSION = "blast_session_v1";
function saveSession() {
  try {
    localStorage.setItem(LS_SESSION, JSON.stringify({
      base: (document.querySelector("#caption") || {}).value || "",
      videoHook: (document.querySelector("#videohook") || {}).value || "",
      transcript: (document.querySelector("#transcript") || {}).value || "",
      captions: platformCaptions,
      suggestions: platformSuggestions,
      picked: platformPickedIdx,
      status: platformStatus,
      postUrl: platformPostUrl,
      postedAt: platformPostedAt,
      postedCaption: platformPostedCaption,
      updatedAt: Date.now(),
    }));
  } catch (e) { /* quota — non-fatal, session just won't persist */ }
}
function loadSession() {
  try {
    var s = JSON.parse(localStorage.getItem(LS_SESSION));
    if (!s) return;
    platformCaptions = s.captions || {};
    platformSuggestions = s.suggestions || {};
    platformPickedIdx = s.picked || {};
    platformStatus = s.status || {};
    platformPostUrl = s.postUrl || {};
    platformPostedAt = s.postedAt || {};
    platformPostedCaption = s.postedCaption || {};
    var cap = document.querySelector("#caption");
    if (cap && typeof s.base === "string") cap.value = s.base;
    var vh = document.querySelector("#videohook");
    if (vh && typeof s.videoHook === "string") vh.value = s.videoHook;
    var tr = document.querySelector("#transcript");
    if (tr && typeof s.transcript === "string") tr.value = s.transcript;
  } catch (e) { /* corrupt — start fresh */ }
}
function resetSession() {
  platformCaptions = {}; platformSuggestions = {}; platformPickedIdx = {};
  platformStatus = {}; platformPostUrl = {};
  platformPostedAt = {}; platformPostedCaption = {};
  var cap = document.querySelector("#caption");
  if (cap) cap.value = "";
  var vh = document.querySelector("#videohook");
  if (vh) vh.value = "";
  var tr = document.querySelector("#transcript");
  if (tr) tr.value = "";
  try { localStorage.removeItem(LS_SESSION); } catch (e) {}
  // NOTE: presets deliberately survive Reset — they're a durable per-creator
  // habit, not part of a single posting session.
}

// === Per-platform presets (localStorage, independent of the session) ===
// A saved caption template per platform, with a {caption} token substituted
// for the current base caption. Stored as a single blob keyed by platform name
// (same shape idea as settings), separate from blast_session_v1 so it persists
// across clips and survives Reset.
var LS_PRESETS = "blast_presets_v1";
function loadPresets() {
  try { return JSON.parse(localStorage.getItem(LS_PRESETS)) || {}; }
  catch (e) { return {}; }
}
function savePresets(o) {
  try { localStorage.setItem(LS_PRESETS, JSON.stringify(o)); return true; }
  catch (e) { return false; }
}
var presets = loadPresets();

// split/join (not .replace) so a "$" in the base caption isn't treated as a
// replacement pattern, and every {caption} occurrence is substituted.
function applyTemplate(tpl, base) {
  return String(tpl).split("{caption}").join(base);
}
function currentBase() {
  return (($("#caption") || {}).value || "").trim();
}

// Suggestion text comes from a model response — escape before it ever goes
// into innerHTML, same as any other untrusted string.
function escHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
  });
}

// Resolve the caption a platform will actually post: its own edited/adapted
// caption if present, else the shared base caption.
function captionFor(p, pcaptionEl) {
  var own = pcaptionEl ? pcaptionEl.value : platformCaptions[p.name];
  return ((own || "").trim() || ($("#caption").value || "")).trim();
}

// Pure, cheap, zero-AI caption check. All findings are advisory — nothing here
// ever blocks a copy or disables a button. Returns counts + a `messages` list.
function validate(caption, rules) {
  rules = rules || DEFAULT_RULES;
  var text = caption || "";
  var count = text.length;
  var limit = rules.limit;
  var over = count > limit;
  var near = !over && count >= Math.round(limit * NEAR_RATIO);
  var hashtagCount = (text.match(/#[\p{L}0-9_]+/gu) || []).length;
  var hashtagOver = hashtagCount > rules.hashtagMax;
  var letters = (text.match(/\p{L}/gu) || []).length;
  var allCaps = letters >= ALLCAPS_MIN_LETTERS &&
    text === text.toUpperCase() && text !== text.toLowerCase();
  var emojiCount = (text.match(/\p{Extended_Pictographic}/gu) || []).length;
  var emojiExcess = emojiCount > EMOJI_MAX;
  var messages = [];
  if (over) messages.push((count - limit) + " over limit");
  if (hashtagOver) messages.push(hashtagCount + " hashtags (max ~" + rules.hashtagMax + ")");
  if (allCaps) messages.push("all caps");
  if (emojiExcess) messages.push(emojiCount + " emoji");
  return { count: count, limit: limit, over: over, near: near,
    hashtagCount: hashtagCount, hashtagOver: hashtagOver,
    allCaps: allCaps, emojiExcess: emojiExcess, messages: messages };
}

function copyText(text) {
  return navigator.clipboard.writeText(text);
}

function renderPlatforms() {
  var wrap = $("#platforms");
  wrap.innerHTML = "";
  PLATFORMS.forEach(function (p) {
    var card = document.createElement("div");
    var st = statusOf(p.name);
    card.className = "platformcard status-" + st;
    var suggestions = platformSuggestions[p.name] || [];
    var pickedIdx = platformPickedIdx[p.name];
    var suggestionsHtml = suggestions.length
      ? '<div class="psuggestions">' + suggestions.map(function (s, i) {
          return '<button class="suggestchip' + (i === pickedIdx ? ' picked' : '') + '" type="button" data-idx="' + i + '">' + escHtml(s) + '</button>';
        }).join('') + '</div>'
      : '';
    var openLabel = INTENT_URLS[p.name] ? 'compose' : (p.note ? 'app' : 'upload');
    var hasPreset = !!(presets[p.name] && presets[p.name].trim());
    card.innerHTML =
      '<div class="pname"><span class="picon">' + p.icon + '</span>' + p.name +
      (p.note ? ' <span style="color:var(--faint);font-weight:400;font-size:11px">(' + p.note + ')</span>' : '') +
      '<button class="presetedit" type="button" aria-label="Edit preset" title="Edit preset">✎</button>' +
      '<span class="statuschip" data-status="' + st + '">' + STATUS_LABEL[st] + '</span>' +
      '</div>' +
      '<div class="presetpanel hidden">' +
      '<textarea class="presetinput" rows="2" placeholder="Template with {caption} — newlines OK (e.g. hashtag block, sign-off)">' + escHtml(presets[p.name] || "") + '</textarea>' +
      '<button class="btn ghost presetsave" type="button">Save</button>' +
      '</div>' +
      suggestionsHtml +
      '<textarea class="pcaption" placeholder="Same as base caption until you Adapt, or type your own">' + escHtml(platformCaptions[p.name] || "") + '</textarea>' +
      '<div class="pmeta"><span class="valcount" data-level="ok"></span><span class="valwarn hidden"></span></div>' +
      '<div class="prow">' +
      '<button class="btn primary copyopenbtn" type="button">Copy + open ' + openLabel + ' →</button>' +
      '<button class="btn ghost copybtn" type="button">Copy only</button>' +
      '</div>' +
      (hasPreset ? '<div class="prow presetrow"><button class="btn ghost applypreset" type="button">Apply preset</button></div>' : '') +
      '<div class="prow statusrow">' +
      '<button class="btn ghost markposted" type="button">✓ Mark posted</button>' +
      '<button class="btn ghost markskip" type="button">Skip</button>' +
      '<span class="postedago"></span>' +
      '</div>' +
      '<input class="posturl" type="url" placeholder="Paste the live post URL (optional)" value="' + escHtml(platformPostUrl[p.name] || "") + '">';

    var pcaption = card.querySelector(".pcaption");
    var posturl = card.querySelector(".posturl");

    // Preset editor: the ✎ toggles an inline template field (classList only,
    // no re-render, so it never blurs a caption mid-edit).
    var presetBtn = card.querySelector(".presetedit");
    var presetPanel = card.querySelector(".presetpanel");
    var presetInput = card.querySelector(".presetinput");
    var presetSave = card.querySelector(".presetsave");
    var applyBtn = card.querySelector(".applypreset"); // null unless a preset exists
    presetBtn.addEventListener("click", function () {
      presetPanel.classList.toggle("hidden");
      if (!presetPanel.classList.contains("hidden")) presetInput.focus();
    });
    presetSave.addEventListener("click", function () {
      var val = presetInput.value.trim();
      if (val) presets[p.name] = val; else delete presets[p.name];
      savePresets(presets);
      toast(val ? "Preset saved for " + p.name : "Preset cleared for " + p.name);
      renderPlatforms(); // re-render so the "Apply preset" button appears/disappears
    });
    // Apply this platform's template to the current base caption — mirrors the
    // Adapt flow: write platformCaptions, re-render, save.
    if (applyBtn) {
      applyBtn.addEventListener("click", function () {
        platformCaptions[p.name] = applyTemplate(presets[p.name], currentBase());
        delete platformPickedIdx[p.name];
        renderPlatforms();
        saveSession();
        toast("Preset applied to " + p.name);
      });
    }

    pcaption.addEventListener("input", function () {
      platformCaptions[p.name] = pcaption.value;
      delete platformPickedIdx[p.name];
      card.querySelectorAll(".suggestchip").forEach(function (c) { c.classList.remove("picked"); });
      saveSession();
      refreshValidation(card, p);
    });
    card.querySelectorAll(".suggestchip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        var idx = parseInt(chip.dataset.idx, 10);
        platformPickedIdx[p.name] = idx;
        platformCaptions[p.name] = suggestions[idx];
        pcaption.value = suggestions[idx];
        card.querySelectorAll(".suggestchip").forEach(function (c) { c.classList.remove("picked"); });
        chip.classList.add("picked");
        // Setting .value in JS doesn't fire "input", so refresh the char-count
        // and over-limit warning here or they'd reflect the previous caption.
        refreshValidation(card, p);
        saveSession();
      });
    });

    // The command-center action: copy this platform's caption, open its
    // upload page, and advance status to "opened" — one click for what used
    // to be copy, switch tab, and remember-you-did-it.
    card.querySelector(".copyopenbtn").addEventListener("click", function () {
      var text = captionFor(p, pcaption);
      if (!text) { toast("Write a caption first"); return; }
      copyText(text).then(function () {
        toast("Copied — opening " + p.name);
      }).catch(function () {
        toast("Couldn't copy — caption's still in the box");
      });
      window.open(openUrlFor(p, text), "_blank", "noopener");
      bumpStatus(p.name, "opened");
      refreshStatus();
      saveSession();
    });

    card.querySelector(".copybtn").addEventListener("click", function () {
      var text = captionFor(p, pcaption);
      if (!text) { toast("Write a caption first"); return; }
      copyText(text).then(function () {
        toast("Caption copied — paste it into " + p.name);
        bumpStatus(p.name, "copied");
        refreshStatus();
        saveSession();
      }).catch(function () {
        toast("Couldn't copy — select and copy manually");
      });
    });

    card.querySelector(".markposted").addEventListener("click", function () {
      var nowPosted = statusOf(p.name) !== "posted";
      platformStatus[p.name] = nowPosted ? "posted" : "none";
      if (nowPosted) stampPosted(p.name, captionFor(p, pcaption)); else clearPosted(p.name);
      refreshStatus();
      saveSession();
    });
    card.querySelector(".markskip").addEventListener("click", function () {
      platformStatus[p.name] = statusOf(p.name) === "skipped" ? "none" : "skipped";
      refreshStatus();
      saveSession();
    });
    posturl.addEventListener("input", function () {
      platformPostUrl[p.name] = posturl.value;
      // Only a plausible URL signals it actually went up — bumping on the first
      // keystroke used to strand the platform on the terminal "posted" state
      // (bumpStatus can't walk back) if the user then cleared the field.
      if (/^https?:\/\//i.test(posturl.value.trim())) { bumpStatus(p.name, "posted"); stampPosted(p.name, captionFor(p, pcaption)); }
      refreshStatus();
      saveSession();
    });
    posturl.addEventListener("change", refreshStatus);

    // Initial pass so the counter is correct on every render path (load, Adapt,
    // Suggest, Apply preset, Apply all, Reset) with no extra call sites.
    refreshValidation(card, p);

    wrap.appendChild(card);
  });
  refreshStatus();
}

// Update just the status chips + card classes + session summary without
// tearing down the whole grid (which would blur a field mid-edit).
function refreshStatus() {
  var cards = document.querySelectorAll("#platforms .platformcard");
  var posted = 0, done = 0;
  PLATFORMS.forEach(function (p, i) {
    var st = statusOf(p.name);
    var card = cards[i];
    if (card) {
      card.className = "platformcard status-" + st;
      var chip = card.querySelector(".statuschip");
      if (chip) { chip.textContent = STATUS_LABEL[st]; chip.setAttribute("data-status", st); }
      var posted_btn = card.querySelector(".markposted");
      if (posted_btn) posted_btn.textContent = st === "posted" ? "✓ Posted" : "✓ Mark posted";
      var skip_btn = card.querySelector(".markskip");
      if (skip_btn) skip_btn.textContent = st === "skipped" ? "Skipped" : "Skip";
      var ago = card.querySelector(".postedago");
      if (ago) ago.textContent = (st === "posted" && platformPostedAt[p.name]) ? "Posted " + relTimeShort(platformPostedAt[p.name]) : "";
    }
    if (st === "posted") posted++;
    if (st === "posted" || st === "skipped") done++;
  });
  var sub = $("#sessionSub");
  if (sub) {
    sub.textContent = posted + " of " + PLATFORMS.length + " posted" +
      (done > posted ? " · " + (done - posted) + " skipped" : "");
  }
  var pulseLink = $("#pulseLink");
  if (pulseLink) pulseLink.classList.toggle("hidden", posted === 0);
  var bar = $("#sessionProgress");
  if (bar) bar.style.setProperty("--pct", Math.round((done / PLATFORMS.length) * 100) + "%");
}

// Surgical, per-card — same discipline as refreshStatus: update only the
// counter/warning elements on keystroke, never re-render the card (which would
// blur the field mid-edit). Reads the resolved caption (own value, else base).
function refreshValidation(card, p) {
  var pcaption = card.querySelector(".pcaption");
  var valcount = card.querySelector(".valcount");
  var valwarn = card.querySelector(".valwarn");
  if (!pcaption || !valcount) return;
  var text = (pcaption.value || "").trim() || ($("#caption").value || "").trim();
  var r = validate(text, PLATFORM_RULES[p.name]);
  valcount.textContent = r.count + " / " + r.limit;
  valcount.setAttribute("data-level", r.over ? "over" : r.near ? "near" : "ok");
  pcaption.classList.toggle("invalid", r.over);
  // The over-limit count is already shown in the counter chip; only surface the
  // other advisories here to avoid saying the same thing twice.
  var warns = r.messages.filter(function (m) { return m.indexOf("over limit") === -1; });
  if (warns.length) {
    valwarn.textContent = "⚠ " + warns.join(" · ");
    valwarn.classList.remove("hidden");
  } else {
    valwarn.classList.add("hidden");
  }
}

loadSession();

// === RECALL → BLAST handoff (first write-channel between the apps) ===
// RECALL's Top Posts "SEND TO BLAST" leaves a caption here (same-origin
// localStorage on the github.io deploy). Consumed only when no caption is in
// progress; otherwise left untouched as a pending import — finish or Reset the
// current session and reload, and the import happens then.
var LS_HANDOFF = "blast_handoff_v1";
function consumeHandoff() {
  var raw;
  try { raw = localStorage.getItem(LS_HANDOFF); } catch (e) { return; }
  if (!raw) return;
  var h;
  try { h = JSON.parse(raw); } catch (e) { h = null; }
  if (!h || typeof h.caption !== "string" || !h.caption.trim()) {
    try { localStorage.removeItem(LS_HANDOFF); } catch (e) {} // garbage-collect junk
    return;
  }
  var cap = $("#caption");
  if (!cap || (cap.value || "").trim()) return; // in-progress session — leave the key
  cap.value = h.caption;
  try { localStorage.removeItem(LS_HANDOFF); } catch (e) {}
  saveSession();
  toast("Caption imported from RECALL");
}
consumeHandoff();

renderPlatforms();
renderHookStatus();

var _resetBtn = $("#resetSession");
if (_resetBtn) _resetBtn.addEventListener("click", function () {
  if (!confirm("Reset this posting session? Captions, picks, and posting status will be cleared. (Your API key stays.)")) return;
  resetSession();
  renderPlatforms();
  toast("Session reset");
});

// Persist the base caption + video hook as they're typed (debounced) so a
// refresh keeps them.
(function () {
  var t;
  var save = function () { clearTimeout(t); t = setTimeout(saveSession, 300); };
  var cap = $("#caption");
  if (cap) cap.addEventListener("input", save);
  var vh = $("#videohook");
  if (vh) vh.addEventListener("input", save);
})();

// === Settings (BYO Gemini API key, same pattern as RECALL) ===
var LS_SETTINGS = "blast_settings_v1";
// A non-Google default so choosing OpenRouter actually escapes Gemini's load —
// a Google model here would just route back to the same busy backend.
var DEFAULT_OR_MODEL = "openai/gpt-4o-mini";
// Slugs OpenRouter has retired — saved settings pointing here now 404
// ("No endpoints found"), so silently upgrade them to the current default.
var DEAD_OR_MODELS = ["google/gemini-2.0-flash-001", "google/gemini-2.0-flash"];
function loadSettings() {
  try {
    var s = JSON.parse(localStorage.getItem(LS_SETTINGS)) || {};
    if (s.openrouterModel && DEAD_OR_MODELS.indexOf(s.openrouterModel) >= 0) {
      s.openrouterModel = DEFAULT_OR_MODEL;
    }
    // Keys are shared across the stack: shared store wins; legacy local key
    // promoted into the shared store on first read.
    if (window.StackData) s = window.StackData.resolveKeys(s, ["geminiKey", "openrouterKey", "openrouterModel"]);
    return s;
  }
  catch (e) { return {}; }
}
function saveSettingsObj(s) {
  try { localStorage.setItem(LS_SETTINGS, JSON.stringify(s)); return true; }
  catch (e) { return false; }
}

var settingscrim = $("#settingscrim"),
    gemkey = $("#gemkey"), keystatus = $("#keystatus"), keyshow = $("#keyshow"),
    orkey = $("#orkey"), orkeystatus = $("#orkeystatus"), orkeyshow = $("#orkeyshow"),
    ormodel = $("#ormodel"),
    geminiFields = $("#geminiFields"), openrouterFields = $("#openrouterFields"),
    providerGemini = $("#providerGemini"), providerOpenrouter = $("#providerOpenrouter");

// Reads current settings into the { provider, geminiKey, openrouterKey,
// openrouterModel } shape llm.js expects.
function getProviderConfig() {
  var s = loadSettings();
  return {
    provider: s.provider === "openrouter" ? "openrouter" : "gemini",
    geminiKey: s.geminiKey || "",
    openrouterKey: s.openrouterKey || "",
    openrouterModel: s.openrouterModel || DEFAULT_OR_MODEL,
  };
}

function keyStatusText(k) { return k ? "Key saved (" + k.slice(0, 4) + "…" + k.slice(-4) + ")" : "No key saved."; }

function showProviderFields(provider) {
  geminiFields.classList.toggle("hidden", provider !== "gemini");
  openrouterFields.classList.toggle("hidden", provider !== "openrouter");
}

function openSettings() {
  settingscrim.classList.add("open");
  var s = loadSettings();
  var provider = s.provider === "openrouter" ? "openrouter" : "gemini";
  providerGemini.checked = provider === "gemini";
  providerOpenrouter.checked = provider === "openrouter";
  showProviderFields(provider);

  gemkey.value = s.geminiKey || "";
  keystatus.textContent = keyStatusText(s.geminiKey);
  keystatus.className = "keystatus " + (s.geminiKey ? "set" : "empty");
  gemkey.type = "password";
  keyshow.textContent = "show";

  orkey.value = s.openrouterKey || "";
  orkeystatus.textContent = keyStatusText(s.openrouterKey);
  orkeystatus.className = "keystatus " + (s.openrouterKey ? "set" : "empty");
  orkey.type = "password";
  orkeyshow.textContent = "show";
  ormodel.value = s.openrouterModel || DEFAULT_OR_MODEL;
  if (window.StackModels) window.StackModels.populate(
    document.getElementById("ormodelselect"), ormodel, document.getElementById("ormodelrefresh"),
    function (ok) { toast(ok ? "Model list updated" : "Couldn't reach OpenRouter"); });

  setTimeout(function () { (provider === "gemini" ? gemkey : orkey).focus(); }, 40);
}
function closeSettings() { settingscrim.classList.remove("open"); updateAnalysisModeAvailability(); }

// Vision mode needs Gemini specifically — proactively disable it rather than
// let someone pick it, click Suggest, and hit an error. Runs on load and
// whenever Settings closes (provider may have just changed).
function updateAnalysisModeAvailability() {
  var modeVision = $("#modeVision");
  if (!modeVision) return;
  var isOpenrouter = getProviderConfig().provider === "openrouter";
  modeVision.disabled = isOpenrouter;
  if (isOpenrouter && modeVision.checked) {
    modeVision.checked = false;
    $("#modeTranscript").checked = true;
  }
}

providerGemini.addEventListener("change", function () { if (providerGemini.checked) showProviderFields("gemini"); });
providerOpenrouter.addEventListener("change", function () { if (providerOpenrouter.checked) showProviderFields("openrouter"); });
updateAnalysisModeAvailability();

keyshow.addEventListener("click", function () {
  if (gemkey.type === "password") { gemkey.type = "text"; keyshow.textContent = "hide"; }
  else { gemkey.type = "password"; keyshow.textContent = "show"; }
});
orkeyshow.addEventListener("click", function () {
  if (orkey.type === "password") { orkey.type = "text"; orkeyshow.textContent = "hide"; }
  else { orkey.type = "password"; orkeyshow.textContent = "show"; }
});

$("#keysave").addEventListener("click", function () {
  var gk = gemkey.value.trim();
  var ok = orkey.value.trim();
  // Accept both Gemini key formats: legacy "AIza…" and the newer "AQ.Ab…"
  // Google began issuing in 2026 (new accounts/projects get AQ. keys).
  if (gk && !/^(AIza[0-9A-Za-z_\-]{20,}|AQ\.[0-9A-Za-z_\-.]{20,})$/.test(gk)) {
    toast("That doesn't look like a Gemini API key");
    return;
  }
  if (ok && ok.length < 20) {
    toast("That doesn't look like an OpenRouter API key");
    return;
  }
  var provider = providerOpenrouter.checked ? "openrouter" : "gemini";
  if (provider === "gemini" && !gk) { toast("Enter a Gemini key first"); return; }
  if (provider === "openrouter" && !ok) { toast("Enter an OpenRouter key first"); return; }
  var saved = saveSettingsObj({
    provider: provider,
    geminiKey: gk,
    openrouterKey: ok,
    openrouterModel: ormodel.value.trim() || DEFAULT_OR_MODEL,
  });
  if (saved) {
    if (window.StackData) window.StackData.writeSharedKeys({
      geminiKey: gk, openrouterKey: ok, openrouterModel: ormodel.value.trim() || DEFAULT_OR_MODEL,
    });
    toast("Settings saved");
    closeSettings();
  } else {
    toast("Couldn't save settings (storage full?)");
  }
});
$("#keyclear").addEventListener("click", function () {
  var s = loadSettings();
  if (providerOpenrouter.checked) {
    orkey.value = "";
    s.openrouterKey = "";
    orkeystatus.textContent = "No key saved.";
    orkeystatus.className = "keystatus empty";
    if (window.StackData) window.StackData.clearSharedKey("openrouterKey");
  } else {
    gemkey.value = "";
    s.geminiKey = "";
    keystatus.textContent = "No key saved.";
    keystatus.className = "keystatus empty";
    if (window.StackData) window.StackData.clearSharedKey("geminiKey");
  }
  saveSettingsObj(s);
  toast("Key cleared everywhere");
});
$("#keycancel").addEventListener("click", closeSettings);
settingscrim.addEventListener("click", function (e) { if (e.target === settingscrim) closeSettings(); });
$("#settings").addEventListener("click", openSettings);
$("#openSettingsFromHint").addEventListener("click", openSettings);

// Whole-stack backup (all 4 apps)
if (window.StackData) {
  $("#stackexport").addEventListener("click", function () {
    window.StackData.exportToFile().then(function () { toast("Stack backup downloaded"); });
  });
  $("#stackimport").addEventListener("click", function () { $("#stackfile").click(); });
  $("#stackfile").addEventListener("change", function (e) {
    var f = e.target.files && e.target.files[0];
    if (f) window.StackData.importFromFile(f, toast);
    e.target.value = "";
  });
}
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape" && settingscrim.classList.contains("open")) closeSettings();
});

// === Adapt caption per platform (provider-aware: Gemini or OpenRouter) ===
async function adaptCaptionsForPlatforms(baseCaption) {
  var names = PLATFORMS.map(function (p) { return p.name; });
  var prompt = "You write short-form video captions. Given this base caption, rewrite it tailored " +
    "to each platform's real conventions (typical length, hashtag style, tone) while keeping the " +
    "core message intact. Platforms: " + names.join(", ") + ".\n\nBase caption:\n" + baseCaption +
    "\n\nRespond with ONLY a JSON object whose keys are exactly the platform names above and whose " +
    "values are the tailored caption strings. No markdown, no explanation, no extra keys.";

  var text = await generateText(getProviderConfig(), { prompt: prompt, jsonMode: true, temperature: 0.4 });
  var parsed;
  try { parsed = JSON.parse(text); }
  catch (e) { throw new Error("Model returned something that wasn't valid JSON"); }
  return parsed;
}

$("#adaptBtn").addEventListener("click", async function () {
  var base = $("#caption").value.trim();
  if (!base) { toast("Write a base caption first"); return; }
  var btn = $("#adaptBtn");
  var label = $("#adaptLabel");
  btn.disabled = true;
  btn.textContent = "Adapting…";
  label.textContent = getProviderConfig().provider === "openrouter" ? "Calling OpenRouter…" : "Calling Gemini…";
  try {
    var adapted = await adaptCaptionsForPlatforms(base);
    PLATFORMS.forEach(function (p) {
      if (typeof adapted[p.name] === "string" && adapted[p.name].trim()) {
        platformCaptions[p.name] = adapted[p.name].trim();
      }
    });
    renderPlatforms();
    saveSession();
    label.textContent = "";
    toast("Captions adapted for every platform");
  } catch (err) {
    console.error(err);
    label.textContent = "";
    var msg = err && err.message ? err.message : "unknown error";
    toast("Couldn't adapt captions: " + msg);
    if (/no (gemini|openrouter) api key/i.test(msg)) openSettings();
  } finally {
    btn.disabled = false;
    btn.textContent = "Adapt for each platform →";
  }
});

// Apply every saved preset to the current base caption at once. Explicit only —
// never auto-applies. Skips platforms without a preset.
$("#applyAllPresets").addEventListener("click", function () {
  var base = currentBase();
  var n = 0;
  PLATFORMS.forEach(function (p) {
    var tpl = presets[p.name];
    if (tpl && tpl.trim()) {
      platformCaptions[p.name] = applyTemplate(tpl, base);
      delete platformPickedIdx[p.name];
      n++;
    }
  });
  if (!n) { toast("No presets saved yet"); return; }
  renderPlatforms();
  saveSession();
  toast("Applied " + n + " preset" + (n > 1 ? "s" : ""));
});

// === Suggest captions from video (vision watches it directly, Gemini-only;
// transcript mode transcribes first, then writes captions from that — works
// on either provider, though a video *file's* audio still needs Gemini
// until an audio-extraction step exists) ===
var TRANSCRIBE_FOR_CAPTIONS_PROMPT = "Transcribe the spoken audio in this clip plainly — no timestamps, " +
  "no speaker labels, just the words said as one block of text. If there's no speech, briefly describe " +
  "what's visually happening instead.";

function captionSuggestPrompt(names, count) {
  return "Propose exactly " + count + " distinct caption option" + (count > 1 ? "s" : "") + " for each of " +
    "these platforms, tailored to each platform's real conventions (typical length, hashtag style, tone): " +
    names.join(", ") + ".\n\nRespond with ONLY a JSON object whose keys are exactly the platform names " +
    "above and whose values are arrays of exactly " + count + " caption string" + (count > 1 ? "s" : "") +
    " each, ordered best-first. No markdown, no explanation, no extra keys.";
}

function parseCaptionJSON(text) {
  try { return JSON.parse(text); }
  catch (e) { throw new Error("Model returned something that wasn't valid JSON"); }
}

// === HOOKLAB evidence (same-origin localStorage read; personalizes prompts) ===
// BLAST is the last stop in RECALL → HOOKLAB → BLAST. When the creator has
// logged winning hooks in HOOKLAB (hooklab_state_v1, same origin), lean the
// caption suggestions on those proven openers — personal ledger > generic.
var HOOKLAB_URL = "https://mjmorrison10.github.io/Hooklabs/";
function loadHooklabEvidence() {
  try {
    var raw = localStorage.getItem("hooklab_state_v1");
    if (!raw) return { winners: [], found: false, reason: "absent" };
    var st = JSON.parse(raw);
    var ledger = st.ledger || [];
    var winners = ledger
      .filter(function (e) { return e && e.outcome === "winner" && e.hook; })
      .slice(0, 15)
      .map(function (e) { return String(e.hook); });
    var reason = winners.length ? "ok" : (ledger.length ? "no-winners" : "empty");
    return { winners: winners, found: true, reason: reason };
  } catch (e) {
    return { winners: [], found: false, reason: "absent" };
  }
}
// Prompt fragment (empty unless there are winners) appended to any suggestion prompt.
function hooklabEvidenceBlock(ev) {
  if (!ev || !ev.winners.length) return "";
  return "\n\nThe creator's own proven winning hooks, from their HOOKLAB ledger " +
    "(these opened clips that actually performed — prefer captions that echo their structure, angle, " +
    "and voice):\n- " + ev.winners.join("\n- ") +
    "\nStill ground every caption in the transcript/clip; never invent claims or numbers it doesn't support.";
}
// Creator-supplied context about the clip's angle/point/tone. A transcript alone
// often misses what a clip is really saying; this frames the captions correctly
// without letting the model invent unsupported claims. Empty => no change.
function clipContextBlock(ctx) {
  ctx = (ctx || "").trim();
  if (!ctx) return "";
  return "\n\nContext from the creator about this clip (its real point, angle, and tone — use it to " +
    "frame the captions correctly, but do not state anything as fact that the transcript or clip " +
    "doesn't actually support):\n" + ctx;
}
// Status line under the transcript box, mirroring RECALL's ledger messaging.
function renderHookStatus() {
  var el = $("#hookStatus");
  if (!el) return;
  var ev = loadHooklabEvidence();
  if (ev.winners.length) {
    el.className = "hookstatus on";
    el.textContent = "HOOKLAB ledger: " + ev.winners.length + " winning hook" +
      (ev.winners.length > 1 ? "s" : "") + " — suggestions will lean on your proven openers.";
    return;
  }
  var msg = !ev.found ? "No HOOKLAB ledger in this browser yet — "
    : ev.reason === "empty" ? "Your HOOKLAB ledger is empty — "
    : "No winning hooks logged in HOOKLAB yet — ";
  el.className = "hookstatus";
  el.innerHTML = msg + '<span class="hooklink" id="hookOpen">open the full HOOKLAB app</span>' +
    " and mark winners to personalize these suggestions.";
  var link = $("#hookOpen");
  if (link) link.addEventListener("click", function () { window.open(HOOKLAB_URL, "_blank", "noopener"); });
}

async function suggestCaptionsFromText(transcript, count, evidenceBlock, contextBlk) {
  var config = getProviderConfig();
  var names = PLATFORMS.map(function (p) { return p.name; });
  var textPrompt = "Here is a transcript of a video clip:\n\n" + transcript + (contextBlk || "") + "\n\n" +
    captionSuggestPrompt(names, count) + (evidenceBlock || "");
  var text = await generateText(config, { prompt: textPrompt, jsonMode: true, temperature: 0.5 });
  return parseCaptionJSON(text);
}

async function suggestCaptionsFromVideo(file, mode, count, evidenceBlock, contextBlk, onPhase) {
  var config = getProviderConfig();
  var names = PLATFORMS.map(function (p) { return p.name; });

  if (mode === "vision") {
    if (!providerSupportsVideo(config)) {
      throw new Error("Video analysis needs Gemini — switch provider in Settings, or use transcript mode.");
    }
    var visionPrompt = "Watch this video clip, then: " + captionSuggestPrompt(names, count) + (contextBlk || "") + (evidenceBlock || "");
    var text = await generateFromMedia(config, { file: file, prompt: visionPrompt, jsonMode: true, mediaKind: "video", onPhase: onPhase });
    return parseCaptionJSON(text);
  }

  onPhase("Transcribing");
  var mediaKind = (file.type || "").indexOf("video/") === 0 ? "video" : "audio";
  var transcript = await generateFromMedia(config, { file: file, prompt: TRANSCRIBE_FOR_CAPTIONS_PROMPT, mediaKind: mediaKind, onPhase: onPhase });
  onPhase("Writing captions");
  return suggestCaptionsFromText(transcript, count, evidenceBlock, contextBlk);
}

$("#suggestBtn").addEventListener("click", async function () {
  var transcriptEl = $("#transcript");
  var transcriptText = (transcriptEl && transcriptEl.value || "").trim();
  // Priority: a pasted transcript wins (no upload needed); else the uploaded
  // clip; else tell the user both routes.
  if (!transcriptText && !pendingFile) {
    toast("Paste a transcript above, or upload a clip in the 9:16 section below");
    return;
  }
  var countInput = document.querySelector('input[name="suggestCount"]:checked');
  var count = parseInt(countInput ? countInput.value : "3", 10);
  var ev = loadHooklabEvidence();
  var evidenceBlock = hooklabEvidenceBlock(ev);
  var ctxEl = $("#clipContext");
  var contextBlk = clipContextBlock(ctxEl ? ctxEl.value : "");
  var btn = $("#suggestBtn");
  var label = $("#suggestLabel");
  btn.disabled = true;
  btn.textContent = "Analyzing…";
  try {
    var results;
    if (transcriptText) {
      label.textContent = "Writing captions…";
      results = await suggestCaptionsFromText(transcriptText, count, evidenceBlock, contextBlk);
    } else {
      var mode = $("#modeVision").checked ? "vision" : "transcript";
      results = await suggestCaptionsFromVideo(pendingFile, mode, count, evidenceBlock, contextBlk, function (phase) {
        label.textContent = phase + "…";
      });
    }
    PLATFORMS.forEach(function (p) {
      var arr = results[p.name];
      if (Array.isArray(arr) && arr.length) {
        platformSuggestions[p.name] = arr.slice(0, count).map(String);
        delete platformPickedIdx[p.name];
      }
    });
    renderPlatforms();
    saveSession();
    label.textContent = "";
    var extra = ev.winners.length ? " (leaning on " + ev.winners.length + " HOOKLAB winner" + (ev.winners.length > 1 ? "s" : "") + ")" : "";
    toast("Caption suggestions ready — pick one per platform" + extra);
  } catch (err) {
    console.error(err);
    label.textContent = "";
    var msg = err && err.message ? err.message : "unknown error";
    toast("Couldn't suggest captions: " + msg);
    if (/no (gemini|openrouter) api key/i.test(msg)) openSettings();
  } finally {
    btn.disabled = false;
    btn.textContent = "Suggest captions →";
  }
});

// Persist the transcript as the user types; refresh the HOOKLAB status when they
// return to the field (they may have logged winners in another tab meanwhile).
(function () {
  var t = $("#transcript");
  if (t) {
    t.addEventListener("input", saveSession);
    t.addEventListener("focus", renderHookStatus);
  }
  var jump = $("#jumpToUpload");
  if (jump) jump.addEventListener("click", function () {
    var panel = $("#uploadPanel");
    if (panel) panel.scrollIntoView({ behavior: "smooth", block: "start" });
  });
})();

// === Upload handling ===
var uploadzone = $("#uploadzone"), videofile = $("#videofile");
var pendingFile = null;
var MAX_BYTES = 200 * 1024 * 1024; // 200MB soft guidance limit for in-browser processing

function fmtBytes(n) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}

function setPendingFile(file) {
  if (!file) { pendingFile = null; renderUploadZone(); return; }
  if (file.size > MAX_BYTES) {
    toast("That's " + fmtBytes(file.size) + " — browser processing gets slow above ~200MB. Trim it shorter first.");
  }
  pendingFile = file;
  renderUploadZone();
  loadSourcePreview(file);
}

function renderUploadZone() {
  if (!pendingFile) {
    uploadzone.classList.remove("has-file");
    uploadzone.innerHTML =
      '<div class="pick">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>' +
      'Choose or drop a video file</div>' +
      '<div class="hint">mp4 · mov · webm — best under 2 min / 200MB, processed entirely in this browser</div>';
    return;
  }
  uploadzone.classList.add("has-file");
  uploadzone.innerHTML =
    '<div class="row"><div class="name">' + escHtml(pendingFile.name) + '</div>' +
    '<button class="x" id="filex" type="button" aria-label="Remove file">×</button></div>' +
    '<div class="size">' + fmtBytes(pendingFile.size) + '</div>';
  $("#filex").addEventListener("click", function (e) {
    e.stopPropagation();
    videofile.value = "";
    setPendingFile(null);
    $("#previewPanel").classList.add("hidden");
  });
}

// Caption/platforms panel is always visible (Step "Start here") — reformatting
// a clip doesn't gate reaching it, per user feedback that the two are
// independent (someone might only want the caption+platform-link flow).
function loadSourcePreview(file) {
  var url = URL.createObjectURL(file);
  var video = $("#sourceVideo");
  video.src = url;
  $("#previewPanel").classList.remove("hidden");
  $("#resultBox").style.display = "none";
  $("#downloadBtn").style.display = "none";
  $("#reformatBtn").disabled = false;
  $("#reformatBtn").textContent = "Reformat to 9:16 →";
}

uploadzone.addEventListener("click", function () { if (!pendingFile) videofile.click(); });
uploadzone.addEventListener("keydown", function (e) {
  if (!pendingFile && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); videofile.click(); }
});
videofile.addEventListener("change", function () { setPendingFile(videofile.files[0] || null); });
["dragenter", "dragover"].forEach(function (ev) {
  uploadzone.addEventListener(ev, function (e) { e.preventDefault(); uploadzone.classList.add("dragover"); });
});
["dragleave", "drop"].forEach(function (ev) {
  uploadzone.addEventListener(ev, function (e) { e.preventDefault(); uploadzone.classList.remove("dragover"); });
});
uploadzone.addEventListener("drop", function (e) {
  var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) { videofile.files = e.dataTransfer.files; setPendingFile(f); }
});

// === FFmpeg (lazy-loaded on first reformat) ===
var ffmpeg = null;
var ffmpegReady = null;
var ffmpegUtilReady = null;

// ffmpeg.wasm is vendored in vendor/ (versions in vendor/VERSIONS.txt) instead
// of loaded from a CDN: browsers refuse to construct a Worker from a
// cross-origin script, so importing @ffmpeg/ffmpeg from unpkg fails at
// ffmpeg.load() with a SecurityError. Same-origin files sidestep that, and
// nothing is fetched from third parties at all.
function getFFmpegUtil() {
  if (!ffmpegUtilReady) {
    ffmpegUtilReady = import("./vendor/ffmpeg-util/index.js");
  }
  return ffmpegUtilReady;
}

async function getFFmpeg() {
  if (ffmpegReady) return ffmpegReady;
  ffmpegReady = (async function () {
    var { FFmpeg } = await import("./vendor/ffmpeg/index.js");
    var { toBlobURL } = await getFFmpegUtil();
    ffmpeg = new FFmpeg();
    ffmpeg.on("progress", function (p) {
      var pct = Math.min(100, Math.round((p.progress || 0) * 100));
      $("#progressFill").style.width = pct + "%";
      $("#progressLabel").textContent = pct + "%";
    });
    var base = new URL("vendor/ffmpeg-core", location.href).href;
    await ffmpeg.load({
      coreURL: await toBlobURL(base + "/ffmpeg-core.js", "text/javascript"),
      wasmURL: await toBlobURL(base + "/ffmpeg-core.wasm", "application/wasm"),
    });
    return ffmpeg;
  })();
  return ffmpegReady;
}

// Crop filter assumes source is landscape or wider than 9:16 (typical for
// podcast/interview footage, the primary RECALL/BLAST use case). A source
// already narrower than 9:16 would produce a negative crop width — out of
// scope for v1.
var CROP_FILTER = "crop=ih*9/16:ih:(iw-ih*9/16)/2:0,scale=1080:1920";

$("#reformatBtn").addEventListener("click", async function () {
  if (!pendingFile) return;
  var btn = $("#reformatBtn");
  btn.disabled = true;
  btn.textContent = "Loading engine…";
  $("#progressBar").style.display = "block";
  $("#progressFill").style.width = "0%";
  $("#progressLabel").textContent = "";

  try {
    var { fetchFile } = await getFFmpegUtil();
    var ff = await getFFmpeg();
    btn.textContent = "Reformatting…";

    var inName = "input" + (pendingFile.name.match(/\.\w+$/) || [".mp4"])[0];
    await ff.writeFile(inName, await fetchFile(pendingFile));

    await ff.exec([
      "-i", inName,
      "-vf", CROP_FILTER,
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23",
      "-c:a", "copy",
      "output.mp4",
    ]);

    var data = await ff.readFile("output.mp4");
    var blob = new Blob([data.buffer], { type: "video/mp4" });
    var url = URL.createObjectURL(blob);

    var resultVideo = $("#resultVideo");
    resultVideo.src = url;
    $("#resultBox").style.display = "block";

    var dl = $("#downloadBtn");
    dl.style.display = "inline-block";
    dl.onclick = function () {
      var a = document.createElement("a");
      a.href = url;
      a.download = "blast-" + pendingFile.name.replace(/\.\w+$/, "") + "-vertical.mp4";
      a.click();
    };

    btn.textContent = "Reformat again";
    btn.disabled = false;
    toast("Vertical clip ready");
  } catch (err) {
    console.error(err);
    toast("Reformat failed: " + (err && err.message ? err.message : "unknown error"));
    btn.textContent = "Reformat to 9:16 →";
    btn.disabled = false;
  }
});
