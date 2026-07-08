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
  { icon: "💼", name: "LinkedIn", url: "https://www.linkedin.com/post/new/" },
  { icon: "📌", name: "Pinterest", url: "https://www.pinterest.com/pin-builder/" },
];

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
      captions: platformCaptions,
      suggestions: platformSuggestions,
      picked: platformPickedIdx,
      status: platformStatus,
      postUrl: platformPostUrl,
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
    var cap = document.querySelector("#caption");
    if (cap && typeof s.base === "string") cap.value = s.base;
  } catch (e) { /* corrupt — start fresh */ }
}
function resetSession() {
  platformCaptions = {}; platformSuggestions = {}; platformPickedIdx = {};
  platformStatus = {}; platformPostUrl = {};
  var cap = document.querySelector("#caption");
  if (cap) cap.value = "";
  try { localStorage.removeItem(LS_SESSION); } catch (e) {}
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
    var openLabel = p.note ? 'app' : 'upload';
    card.innerHTML =
      '<div class="pname"><span class="picon">' + p.icon + '</span>' + p.name +
      (p.note ? ' <span style="color:var(--faint);font-weight:400;font-size:11px">(' + p.note + ')</span>' : '') +
      '<span class="statuschip" data-status="' + st + '">' + STATUS_LABEL[st] + '</span>' +
      '</div>' +
      suggestionsHtml +
      '<textarea class="pcaption" placeholder="Same as base caption until you Adapt, or type your own">' + escHtml(platformCaptions[p.name] || "") + '</textarea>' +
      '<div class="prow">' +
      '<button class="btn primary copyopenbtn" type="button">Copy + open ' + openLabel + ' →</button>' +
      '<button class="btn ghost copybtn" type="button">Copy only</button>' +
      '</div>' +
      '<div class="prow statusrow">' +
      '<button class="btn ghost markposted" type="button">✓ Mark posted</button>' +
      '<button class="btn ghost markskip" type="button">Skip</button>' +
      '</div>' +
      '<input class="posturl" type="url" placeholder="Paste the live post URL (optional)" value="' + escHtml(platformPostUrl[p.name] || "") + '">';

    var pcaption = card.querySelector(".pcaption");
    var posturl = card.querySelector(".posturl");

    pcaption.addEventListener("input", function () {
      platformCaptions[p.name] = pcaption.value;
      delete platformPickedIdx[p.name];
      card.querySelectorAll(".suggestchip").forEach(function (c) { c.classList.remove("picked"); });
      saveSession();
    });
    card.querySelectorAll(".suggestchip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        var idx = parseInt(chip.dataset.idx, 10);
        platformPickedIdx[p.name] = idx;
        platformCaptions[p.name] = suggestions[idx];
        pcaption.value = suggestions[idx];
        card.querySelectorAll(".suggestchip").forEach(function (c) { c.classList.remove("picked"); });
        chip.classList.add("picked");
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
      window.open(p.url, "_blank", "noopener");
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
      platformStatus[p.name] = statusOf(p.name) === "posted" ? "none" : "posted";
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
      // Pasting a live URL is a strong signal it actually went up.
      if (posturl.value.trim()) bumpStatus(p.name, "posted");
      saveSession();
    });
    posturl.addEventListener("change", refreshStatus);

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
    }
    if (st === "posted") posted++;
    if (st === "posted" || st === "skipped") done++;
  });
  var sub = $("#sessionSub");
  if (sub) {
    sub.textContent = posted + " of " + PLATFORMS.length + " posted" +
      (done > posted ? " · " + (done - posted) + " skipped" : "");
  }
  var bar = $("#sessionProgress");
  if (bar) bar.style.setProperty("--pct", Math.round((done / PLATFORMS.length) * 100) + "%");
}

loadSession();
renderPlatforms();

var _resetBtn = $("#resetSession");
if (_resetBtn) _resetBtn.addEventListener("click", function () {
  if (!confirm("Reset this posting session? Captions, picks, and posting status will be cleared. (Your API key stays.)")) return;
  resetSession();
  renderPlatforms();
  toast("Session reset");
});

// Persist the base caption as it's typed (debounced) so a refresh keeps it.
(function () {
  var cap = $("#caption");
  if (!cap) return;
  var t;
  cap.addEventListener("input", function () {
    clearTimeout(t);
    t = setTimeout(saveSession, 300);
  });
})();

// === Settings (BYO Gemini API key, same pattern as RECALL) ===
var LS_SETTINGS = "blast_settings_v1";
function loadSettings() {
  try { var s = JSON.parse(localStorage.getItem(LS_SETTINGS)); return s || {}; }
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
    openrouterModel: s.openrouterModel || "google/gemini-2.0-flash-001",
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
  ormodel.value = s.openrouterModel || "google/gemini-2.0-flash-001";

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
  if (gk && !/^AIza[0-9A-Za-z_\-]{20,}$/.test(gk)) {
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
    openrouterModel: ormodel.value.trim() || "google/gemini-2.0-flash-001",
  });
  if (saved) {
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
  } else {
    gemkey.value = "";
    s.geminiKey = "";
    keystatus.textContent = "No key saved.";
    keystatus.className = "keystatus empty";
  }
  saveSettingsObj(s);
  toast("Key cleared");
});
$("#keycancel").addEventListener("click", closeSettings);
settingscrim.addEventListener("click", function (e) { if (e.target === settingscrim) closeSettings(); });
$("#settings").addEventListener("click", openSettings);
$("#openSettingsFromHint").addEventListener("click", openSettings);
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

async function suggestCaptionsFromVideo(file, mode, count, onPhase) {
  var config = getProviderConfig();
  var names = PLATFORMS.map(function (p) { return p.name; });

  if (mode === "vision") {
    if (!providerSupportsVideo(config)) {
      throw new Error("Video analysis needs Gemini — switch provider in Settings, or use transcript mode.");
    }
    var visionPrompt = "Watch this video clip, then: " + captionSuggestPrompt(names, count);
    var text = await generateFromMedia(config, { file: file, prompt: visionPrompt, jsonMode: true, mediaKind: "video", onPhase: onPhase });
    return parseCaptionJSON(text);
  }

  onPhase("Transcribing");
  var mediaKind = (file.type || "").indexOf("video/") === 0 ? "video" : "audio";
  var transcript = await generateFromMedia(config, { file: file, prompt: TRANSCRIBE_FOR_CAPTIONS_PROMPT, mediaKind: mediaKind, onPhase: onPhase });
  onPhase("Writing captions");
  var textPrompt = "Here is a transcript of a video clip:\n\n" + transcript + "\n\n" + captionSuggestPrompt(names, count);
  var text2 = await generateText(config, { prompt: textPrompt, jsonMode: true, temperature: 0.5 });
  return parseCaptionJSON(text2);
}

$("#suggestBtn").addEventListener("click", async function () {
  if (!pendingFile) { toast("Upload a clip in the optional section below first"); return; }
  var mode = $("#modeVision").checked ? "vision" : "transcript";
  var countInput = document.querySelector('input[name="suggestCount"]:checked');
  var count = parseInt(countInput ? countInput.value : "3", 10);
  var btn = $("#suggestBtn");
  var label = $("#suggestLabel");
  btn.disabled = true;
  btn.textContent = "Analyzing…";
  try {
    var results = await suggestCaptionsFromVideo(pendingFile, mode, count, function (phase) {
      label.textContent = phase + "…";
    });
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
    toast("Caption suggestions ready — pick one per platform");
  } catch (err) {
    console.error(err);
    label.textContent = "";
    var msg = err && err.message ? err.message : "unknown error";
    toast("Couldn't suggest captions: " + msg);
    if (/no (gemini|openrouter) api key/i.test(msg)) openSettings();
  } finally {
    btn.disabled = false;
    btn.textContent = "Suggest captions from video →";
  }
});

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
    '<div class="row"><div class="name">' + pendingFile.name + '</div>' +
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
