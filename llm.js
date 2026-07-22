// === llm.js — pluggable AI provider (Gemini default, OpenRouter optional) ===
// Called directly from the browser with the user's own key. No server
// involved — same BYO-key/localStorage model this app already uses.
//
// Gemini is the full-power path: a resumable Files API for large media (up
// to 2GB) and native video understanding. OpenRouter is an OpenAI-compatible
// TEXT api — no large-file upload, and video input isn't reliably supported
// by OpenRouter models. So: text ops work on both providers; media ops need
// Gemini for anything beyond a small inlined file, and video specifically
// is Gemini-only.

// Rolling alias — always points to the current Flash model, so a pinned
// version being retired (gemini-2.0-flash, then gemini-2.5-flash both 404'd
// "no longer available to new users") can't break the app again.
var GEMINI_TEXT_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent";
var GEMINI_FILES_UPLOAD = "https://generativelanguage.googleapis.com/upload/v1beta/files";
var GEMINI_FILES_BASE = "https://generativelanguage.googleapis.com/v1beta/files";
var OPENROUTER_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export var GEMINI_INLINE_MAX_BYTES = 14 * 1024 * 1024;
export var GEMINI_MAX_BYTES = 2 * 1024 * 1024 * 1024;
export var OPENROUTER_INLINE_MAX_BYTES = 15 * 1024 * 1024;

function yield_() { return new Promise(function (r) { setTimeout(r, 0); }); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// === Rate-limit retry ===
// Free-tier Gemini (and OpenRouter) return HTTP 429 under light load. A single
// 429 used to fail the whole AI pass; instead retry a few times with backoff,
// honoring the server's own RetryInfo delay when present.
var MAX_ATTEMPTS = 3;                      // 1 original + 2 retries
var RETRY_BACKOFF_MS = [4000, 12000];      // waits before attempt 2, 3
var RETRY_DELAY_CAP_MS = 20000;            // never wait absurdly long
// Transient conditions worth retrying: rate-limit (429) and server overload
// (500/503 — Gemini's "high demand" spikes), which usually clear in seconds.
function isRetryable(status) { return status === 429 || status === 500 || status === 503; }

function parseRetryDelayMs(bodyText) {
  try {
    var j = JSON.parse(bodyText);
    var details = (j && j.error && j.error.details) || [];
    for (var i = 0; i < details.length; i++) {
      var d = details[i];
      if (d && /RetryInfo/.test(d["@type"] || "") && d.retryDelay) {
        var m = String(d.retryDelay).match(/([\d.]+)s/);
        if (m) return Math.ceil(parseFloat(m[1]) * 1000);
      }
    }
  } catch (e) {}
  return null;
}

// makeRequest: () => Promise<Response>. Retries on HTTP 429 with backoff, then
// returns the final Response (ok or not) for the caller's own error handling.
// onRetry(attempt, maxAttempts, waitMs) is optional/best-effort.
async function fetchWithRetry(makeRequest, onRetry) {
  for (var attempt = 1; ; attempt++) {
    var res = await makeRequest();
    if (!isRetryable(res.status) || attempt >= MAX_ATTEMPTS) return res;
    var serverDelay = null;
    try { serverDelay = parseRetryDelayMs(await res.clone().text()); } catch (e) {}
    var wait = serverDelay != null ? serverDelay : (RETRY_BACKOFF_MS[attempt - 1] || 12000);
    wait = Math.min(wait, RETRY_DELAY_CAP_MS);
    if (onRetry) { try { onRetry(attempt, MAX_ATTEMPTS, wait); } catch (e) {} }
    await sleep(wait);
  }
}

function retryReporter(onPhase) {
  if (!onPhase) return null;
  return function (attempt, maxAttempts, waitMs) {
    onPhase("Rate limited — retrying in " + Math.round(waitMs / 1000) + "s (" + attempt + "/" + (maxAttempts - 1) + ")");
  };
}

function fileToBase64(file) {
  return new Promise(function (resolve, reject) {
    var r = new FileReader();
    r.onload = function () {
      var s = String(r.result);
      var i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = function () { reject(new Error("Could not read file")); };
    r.readAsDataURL(file);
  });
}

function guessMime(name) {
  var ext = (name.split(".").pop() || "").toLowerCase();
  return ({
    mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav",
    ogg: "audio/ogg", flac: "audio/flac", aac: "audio/aac",
    mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
    mpeg: "audio/mpeg",
  })[ext] || "application/octet-stream";
}

// === Gemini Files API (resumable upload, for files > GEMINI_INLINE_MAX_BYTES) ===
async function uploadToGeminiFilesAPI(file, mime, apiKey, onPhase) {
  var startRes = await fetchWithRetry(function () {
    return fetch(GEMINI_FILES_UPLOAD + "?key=" + encodeURIComponent(apiKey), {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(file.size),
        "X-Goog-Upload-Header-Content-Type": mime,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ file: { display_name: file.name } }),
    });
  }, retryReporter(onPhase));
  if (!startRes.ok) {
    if (startRes.status === 401 || startRes.status === 403) throw new Error("Gemini API key rejected — open Settings");
    if (startRes.status === 429) throw new Error("Rate limited — try again in a minute");
    if (startRes.status === 413) throw new Error("File too large for Gemini");
    throw new Error("Upload start failed (HTTP " + startRes.status + ")");
  }
  var uploadUrl = startRes.headers.get("X-Goog-Upload-URL");
  if (!uploadUrl) throw new Error("No upload URL returned by Gemini");
  var uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Command": "upload, finalize",
      "X-Goog-Upload-Offset": "0",
      "Content-Length": String(file.size),
    },
    body: file,
  });
  if (!uploadRes.ok) throw new Error("File upload failed (HTTP " + uploadRes.status + ")");
  var data = await uploadRes.json();
  return data && data.file ? data.file : data;
}

async function waitForGeminiFileActive(fileName, apiKey) {
  var deadline = Date.now() + 120000;
  var url = GEMINI_FILES_BASE + "/" + encodeURIComponent(fileName) + "?key=" + encodeURIComponent(apiKey);
  while (Date.now() < deadline) {
    var r = await fetch(url);
    if (!r.ok) throw new Error("File status check failed (HTTP " + r.status + ")");
    var f = await r.json();
    if (f.state === "ACTIVE") return f;
    if (f.state === "FAILED") throw new Error("Gemini could not process this file");
    await new Promise(function (resolve) { setTimeout(resolve, 2000); });
  }
  throw new Error("File processing timed out (2 min)");
}

// Best-effort cleanup — files auto-expire after 48h anyway.
async function deleteGeminiFile(fileName, apiKey) {
  try {
    await fetch(GEMINI_FILES_BASE + "/" + encodeURIComponent(fileName) + "?key=" + encodeURIComponent(apiKey), { method: "DELETE" });
  } catch (e) { /* silent */ }
}

async function extractGeminiText(res) {
  if (!res.ok) {
    var body = "";
    try { body = await res.text(); } catch (e) {}
    if (res.status === 400) throw new Error("Gemini rejected the request — check key + file type");
    if (res.status === 401 || res.status === 403) throw new Error("Gemini API key rejected — open Settings");
    if (res.status === 413 || /too large/i.test(body)) throw new Error("File too large for Gemini");
    if (res.status === 429) throw new Error("Rate limited — try again in a minute");
    if (res.status === 503 || res.status === 500) throw new Error("Gemini is overloaded right now (still busy after a few retries) — try again in a moment, or switch to OpenRouter in Settings.");
    throw new Error("Gemini error " + res.status + ": " + body.slice(0, 150));
  }
  var json = await res.json();
  var candidate = json && json.candidates && json.candidates[0];
  var text = candidate && candidate.content && candidate.content.parts &&
             candidate.content.parts[0] && candidate.content.parts[0].text;
  if (!text) throw new Error("Empty response from Gemini");
  var finishReason = candidate && candidate.finishReason;
  if (finishReason === "MAX_TOKENS") {
    throw new Error("Response hit the token limit and was truncated. Try shorter input.");
  }
  return text;
}

async function geminiGenerateText(apiKey, opts) {
  var generationConfig = { temperature: opts.temperature != null ? opts.temperature : 0.4, thinkingConfig: { thinkingBudget: 0 } };
  if (opts.jsonMode) generationConfig.responseMimeType = "application/json";
  if (opts.maxTokens) generationConfig.maxOutputTokens = opts.maxTokens;
  var res = await fetchWithRetry(function () {
    return fetch(GEMINI_TEXT_ENDPOINT + "?key=" + encodeURIComponent(apiKey), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: opts.prompt }] }], generationConfig: generationConfig }),
    });
  }, retryReporter(opts.onPhase));
  return extractGeminiText(res);
}

async function geminiGenerateFromMedia(apiKey, opts) {
  var file = opts.file;
  var onPhase = opts.onPhase || function () {};
  var mime = file.type || guessMime(file.name);
  var useFilesAPI = file.size > GEMINI_INLINE_MAX_BYTES;
  var mediaPart, uploadedFileName = null;

  if (useFilesAPI) {
    onPhase("Uploading to Gemini");
    await yield_();
    var uploaded = await uploadToGeminiFilesAPI(file, mime, apiKey, onPhase);
    uploadedFileName = uploaded.name;
    var fileUri = uploaded.uri;
    if (!fileUri) throw new Error("File upload didn't return a URI");
    onPhase("Processing");
    await yield_();
    await waitForGeminiFileActive(uploadedFileName, apiKey);
    mediaPart = { file_data: { file_uri: fileUri, mime_type: mime } };
  } else {
    onPhase("Reading");
    await yield_();
    var b64 = await fileToBase64(file);
    onPhase("Uploading to Gemini");
    await yield_();
    mediaPart = { inline_data: { mime_type: mime, data: b64 } };
  }

  onPhase("Analyzing");
  await yield_();
  try {
    var generationConfig = { temperature: 0.1, thinkingConfig: { thinkingBudget: 0 } };
    if (opts.jsonMode) generationConfig.responseMimeType = "application/json";
    if (opts.maxTokens) generationConfig.maxOutputTokens = opts.maxTokens;
    var res = await fetchWithRetry(function () {
      return fetch(GEMINI_TEXT_ENDPOINT + "?key=" + encodeURIComponent(apiKey), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: opts.prompt }, mediaPart] }], generationConfig: generationConfig }),
      });
    }, retryReporter(onPhase));
    return await extractGeminiText(res);
  } finally {
    if (uploadedFileName) await deleteGeminiFile(uploadedFileName, apiKey);
  }
}

// === OpenRouter (text-only; media only for small, capable models) ===
// X-Title is a hardcoded ASCII string, not document.title: HTTP header
// values must be ISO-8859-1, and this app's title has an em dash — using
// it directly throws at fetch() time and breaks every OpenRouter call.
function openrouterHeaders(apiKey) {
  return {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + apiKey,
    "HTTP-Referer": location.origin,
    "X-Title": "BLAST",
  };
}

async function extractOpenrouterText(res) {
  if (!res.ok) {
    var body = await res.text().catch(function () { return ""; });
    if (res.status === 401) throw new Error("OpenRouter API key rejected — open Settings");
    if (res.status === 429) throw new Error("Rate limited — try again in a minute");
    if (res.status === 404 || /no endpoints found/i.test(body)) {
      throw new Error("This model is no longer available on OpenRouter — pick another in Settings.");
    }
    throw new Error("OpenRouter error " + res.status + ": " + body.slice(0, 150));
  }
  var json = await res.json();
  var choice = json && json.choices && json.choices[0];
  var text = choice && choice.message && choice.message.content;
  if (!text) throw new Error("Empty response from OpenRouter");
  if (choice.finish_reason === "length") {
    throw new Error("Response hit the token limit and was truncated. Try shorter input.");
  }
  return text;
}

async function openrouterGenerateText(apiKey, model, opts) {
  var body = { model: model, messages: [{ role: "user", content: opts.prompt }], temperature: opts.temperature != null ? opts.temperature : 0.4 };
  if (opts.jsonMode) body.response_format = { type: "json_object" };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  var res = await fetchWithRetry(function () {
    return fetch(OPENROUTER_ENDPOINT, { method: "POST", headers: openrouterHeaders(apiKey), body: JSON.stringify(body) });
  }, retryReporter(opts.onPhase));
  return extractOpenrouterText(res);
}

async function openrouterGenerateFromMedia(apiKey, model, opts) {
  var file = opts.file;
  var onPhase = opts.onPhase || function () {};
  if (opts.mediaKind === "video") {
    throw new Error("Video analysis needs Gemini — OpenRouter models don't reliably support video input. Switch provider in Settings.");
  }
  if (file.size > OPENROUTER_INLINE_MAX_BYTES) {
    throw new Error("File too large for OpenRouter (no large-file upload like Gemini's — max ~15MB inlined). Switch to Gemini in Settings, or use a smaller/shorter file.");
  }
  onPhase("Reading");
  await yield_();
  var mime = file.type || guessMime(file.name);
  var b64 = await fileToBase64(file);
  onPhase("Uploading");
  await yield_();

  var content = [{ type: "text", text: opts.prompt }];
  if (opts.mediaKind === "audio") {
    var fmt = (mime.split("/")[1] || "mp3").split(";")[0];
    content.push({ type: "input_audio", input_audio: { data: b64, format: fmt } });
  } else {
    content.push({ type: "image_url", image_url: { url: "data:" + mime + ";base64," + b64 } });
  }

  onPhase("Analyzing");
  await yield_();
  var body = { model: model, messages: [{ role: "user", content: content }], temperature: 0.1 };
  if (opts.jsonMode) body.response_format = { type: "json_object" };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;
  var res = await fetchWithRetry(function () {
    return fetch(OPENROUTER_ENDPOINT, { method: "POST", headers: openrouterHeaders(apiKey), body: JSON.stringify(body) });
  }, retryReporter(onPhase));
  return extractOpenrouterText(res);
}

// === Public API ===
// config = { provider: "gemini"|"openrouter", geminiKey, openrouterKey, openrouterModel }

export async function generateText(config, opts) {
  if (config.provider === "openrouter") {
    if (!config.openrouterKey) throw new Error("No OpenRouter API key — open Settings to add one");
    return openrouterGenerateText(config.openrouterKey, config.openrouterModel, opts);
  }
  if (!config.geminiKey) throw new Error("No Gemini API key — open Settings to add one");
  return geminiGenerateText(config.geminiKey, opts);
}

// opts.mediaKind: "audio" | "video" | "image" — picks the right OpenRouter
// content part and enforces the video-is-Gemini-only rule.
export async function generateFromMedia(config, opts) {
  if (config.provider === "openrouter") {
    if (!config.openrouterKey) throw new Error("No OpenRouter API key — open Settings to add one");
    return openrouterGenerateFromMedia(config.openrouterKey, config.openrouterModel, opts);
  }
  if (!config.geminiKey) throw new Error("No Gemini API key — open Settings to add one");
  return geminiGenerateFromMedia(config.geminiKey, opts);
}

export function providerSupportsVideo(config) {
  return config.provider === "gemini";
}
