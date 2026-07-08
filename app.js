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
];

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
      '<div class="prow">' +
      '<button class="btn ghost copybtn" type="button">Copy caption</button>' +
      '<a class="btn primary" href="' + p.url + '" target="_blank" rel="noopener">Open ' + (p.note ? 'app' : 'upload') + ' →</a>' +
      '</div>';
    card.querySelector(".copybtn").addEventListener("click", function () {
      var text = $("#caption").value;
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
    $("#captionPanel").classList.add("hidden");
  });
}

function loadSourcePreview(file) {
  var url = URL.createObjectURL(file);
  var video = $("#sourceVideo");
  video.src = url;
  $("#previewPanel").classList.remove("hidden");
  $("#resultBox").style.display = "none";
  $("#downloadBtn").style.display = "none";
  $("#reformatBtn").disabled = false;
  $("#reformatBtn").textContent = "Reformat to 9:16 →";
  $("#captionPanel").classList.add("hidden");
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

    $("#captionPanel").classList.remove("hidden");
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
