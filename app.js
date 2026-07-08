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

// Per-platform caption overrides, filled in by "Adapt for each platform" (or
// left blank to fall back to the shared base caption). Keyed by platform name.
var platformCaptions = {};

function renderPlatforms() {
  var wrap = $("#platforms");
  wrap.innerHTML = "";
  PLATFORMS.forEach(function (p) {
    var card = document.createElement("div");
    card.className = "platformcard";
    card.innerHTML =
      '<div class="pname"><span class="picon">' + p.icon + '</span>' + p.name +
      (p.note ? ' <span style="color:var(--faint);font-weight:400;font-size:11px">(' + p.note + ')</span>' : '') +
      '</div>' +
      '<textarea class="pcaption" placeholder="Same as base caption until you Adapt, or type your own">' + (platformCaptions[p.name] || "") + '</textarea>' +
      '<div class="prow">' +
      '<button class="btn ghost copybtn" type="button">Copy caption</button>' +
      '<a class="btn primary" href="' + p.url + '" target="_blank" rel="noopener">Open ' + (p.note ? 'app' : 'upload') + ' →</a>' +
      '</div>';
    var pcaption = card.querySelector(".pcaption");
    pcaption.addEventListener("input", function () {
      platformCaptions[p.name] = pcaption.value;
    });
    card.querySelector(".copybtn").addEventListener("click", function () {
      var text = (pcaption.value || "").trim() || $("#caption").value;
      if (!text.trim()) { toast("Write a caption first"); return; }
      navigator.clipboard.writeText(text).then(function () {
        toast("Caption copied — paste it into " + p.name);
      }).catch(function () {
        toast("Couldn't copy — select and copy manually");
      });
    });
    wrap.appendChild(card);
  });
}
renderPlatforms();

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
    gemkey = $("#gemkey"),
    keystatus = $("#keystatus"),
    keyshow = $("#keyshow");

function openSettings() {
  settingscrim.classList.add("open");
  var k = loadSettings().geminiKey || "";
  gemkey.value = k;
  keystatus.textContent = k ? "Key saved (" + k.slice(0, 4) + "…" + k.slice(-4) + ")" : "No key saved.";
  keystatus.className = "keystatus " + (k ? "set" : "empty");
  gemkey.type = "password";
  keyshow.textContent = "show";
  setTimeout(function () { gemkey.focus(); gemkey.select(); }, 40);
}
function closeSettings() { settingscrim.classList.remove("open"); }

keyshow.addEventListener("click", function () {
  if (gemkey.type === "password") { gemkey.type = "text"; keyshow.textContent = "hide"; }
  else { gemkey.type = "password"; keyshow.textContent = "show"; }
});
$("#keysave").addEventListener("click", function () {
  var k = gemkey.value.trim();
  if (!k) { toast("Enter a key first"); return; }
  if (!/^AIza[0-9A-Za-z_\-]{20,}$/.test(k)) {
    toast("That doesn't look like a Gemini API key");
    return;
  }
  if (saveSettingsObj({ geminiKey: k })) {
    keystatus.textContent = "Key saved (" + k.slice(0, 4) + "…" + k.slice(-4) + ")";
    keystatus.className = "keystatus set";
    toast("API key saved");
    closeSettings();
  } else {
    toast("Couldn't save key (storage full?)");
  }
});
$("#keyclear").addEventListener("click", function () {
  gemkey.value = "";
  localStorage.removeItem(LS_SETTINGS);
  keystatus.textContent = "No key saved.";
  keystatus.className = "keystatus empty";
  toast("API key cleared");
});
$("#keycancel").addEventListener("click", closeSettings);
settingscrim.addEventListener("click", function (e) { if (e.target === settingscrim) closeSettings(); });
$("#settings").addEventListener("click", openSettings);
$("#openSettingsFromHint").addEventListener("click", openSettings);
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape" && settingscrim.classList.contains("open")) closeSettings();
});

// === Adapt caption per platform (Gemini) ===
var GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

async function adaptCaptionsForPlatforms(baseCaption) {
  var key = loadSettings().geminiKey;
  if (!key) throw new Error("No Gemini API key — open Settings to add one");

  var names = PLATFORMS.map(function (p) { return p.name; });
  var prompt = "You write short-form video captions. Given this base caption, rewrite it tailored " +
    "to each platform's real conventions (typical length, hashtag style, tone) while keeping the " +
    "core message intact. Platforms: " + names.join(", ") + ".\n\nBase caption:\n" + baseCaption +
    "\n\nRespond with ONLY a JSON object whose keys are exactly the platform names above and whose " +
    "values are the tailored caption strings. No markdown, no explanation, no extra keys.";

  var res = await fetch(GEMINI_ENDPOINT + "?key=" + encodeURIComponent(key), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.4, responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) {
    var body = await res.text().catch(function () { return ""; });
    throw new Error("Gemini error " + res.status + ": " + body.slice(0, 150));
  }
  var json = await res.json();
  var candidate = json && json.candidates && json.candidates[0];
  var text = candidate && candidate.content && candidate.content.parts &&
             candidate.content.parts[0] && candidate.content.parts[0].text;
  if (!text) throw new Error("Empty response from Gemini");
  var parsed;
  try { parsed = JSON.parse(text); }
  catch (e) { throw new Error("Gemini returned something that wasn't valid JSON"); }
  return parsed;
}

$("#adaptBtn").addEventListener("click", async function () {
  var base = $("#caption").value.trim();
  if (!base) { toast("Write a base caption first"); return; }
  var btn = $("#adaptBtn");
  var label = $("#adaptLabel");
  btn.disabled = true;
  btn.textContent = "Adapting…";
  label.textContent = "Calling Gemini…";
  try {
    var adapted = await adaptCaptionsForPlatforms(base);
    PLATFORMS.forEach(function (p) {
      if (typeof adapted[p.name] === "string" && adapted[p.name].trim()) {
        platformCaptions[p.name] = adapted[p.name].trim();
      }
    });
    renderPlatforms();
    label.textContent = "";
    toast("Captions adapted for every platform");
  } catch (err) {
    console.error(err);
    label.textContent = "";
    var msg = err && err.message ? err.message : "unknown error";
    toast("Couldn't adapt captions: " + msg);
    if (/no gemini api key/i.test(msg)) openSettings();
  } finally {
    btn.disabled = false;
    btn.textContent = "Adapt for each platform →";
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
