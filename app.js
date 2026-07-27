import { generateText, generateFromMedia, providerSupportsVideo } from "./llm.js";

// === Theme (same pattern as RECALL) ===
(function () {
  var saved = localStorage.getItem("blast-theme");
  if (saved) document.documentElement.setAttribute("data-theme", saved);
})();

function $(sel) { return document.querySelector(sel); }

function toast(msg, ms) {
  var el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(function () { el.classList.remove("show"); }, ms || 2600);
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

// Per-platform target caption lengths for the Short/Medium/Long preference, in
// characters. The hard cap always comes from PLATFORM_RULES[name].limit and is
// never exceeded; these targets just steer the model within it. Snapchat stays
// short at every setting (it's a tiny overlay); YouTube's cap dominates because
// it's the visible Short title.
var LENGTH_TARGETS = {
  "YouTube Shorts":     { short: "under 50",  medium: "60-90",    long: "90-100" },
  "TikTok":             { short: "under 100", medium: "150-300",  long: "400-700" },
  "Instagram Reels":    { short: "under 125", medium: "300-600",  long: "900-1500" },
  "Snapchat Spotlight": { short: "under 40",  medium: "under 80", long: "under 80" },
  "Facebook Reels":     { short: "under 100", medium: "200-400",  long: "700-1200" },
  "X":                  { short: "under 120", medium: "180-260",  long: "260-280" },
  "Threads":            { short: "under 120", medium: "200-350",  long: "400-500" },
  "LinkedIn":           { short: "under 200", medium: "400-800",  long: "1200-2000" },
  "Pinterest":          { short: "under 120", medium: "200-350",  long: "400-500" },
};
// Caption-length preference (Short/Medium/Long). Kept in its OWN localStorage
// key on purpose — the Settings save handler rewrites blast_settings_v1 wholesale
// (provider + keys only), so a pref stored there would be wiped on every save.
var LS_CAPTION_LEN = "blast_caption_len_v1";
function getCaptionLengthPref() {
  var v = "";
  try { v = localStorage.getItem(LS_CAPTION_LEN) || ""; } catch (e) {}
  return (v === "short" || v === "long") ? v : "medium";
}

// === AI ops UX: learned durations, thinking preference, run wrapper ===
// Durations: one key, op-keyed, last 5 runs each — powers "typically ~Ns".
var LS_AI_MS = "blast_ai_ms_v1";
function recordAiMs(op, ms) {
  try {
    var all = JSON.parse(localStorage.getItem(LS_AI_MS) || "{}"); if (!all || typeof all !== "object") all = {};
    var a = Array.isArray(all[op]) ? all[op] : [];
    a.push(ms); while (a.length > 5) a.shift();
    all[op] = a;
    localStorage.setItem(LS_AI_MS, JSON.stringify(all));
  } catch (e) {}
}
function typicalAiMs(op) {
  try {
    var a = (JSON.parse(localStorage.getItem(LS_AI_MS) || "{}") || {})[op];
    if (!Array.isArray(a) || !a.length) return 0;
    var s = 0; for (var i = 0; i < a.length; i++) s += a[i]; return Math.round(s / a.length);
  } catch (e) { return 0; }
}
// Thinking preference ("on" = best quality, "off" = fastest). Own key (the
// Settings save handler rewrites blast_settings_v1 wholesale) + the StackData
// shared store so RECALL/HOOKLAB/BLAST follow one switch on this device.
// Shared value wins on read; default is ON.
var LS_THINKING = "blast_thinking_v1";
function getThinkingPref() {
  var v = "";
  try { v = (window.StackData && window.StackData.readSharedKeys().aiThinking) || localStorage.getItem(LS_THINKING) || ""; } catch (e) {}
  return v === "off" ? "off" : "on";
}
function setThinkingPref(v) {
  try { localStorage.setItem(LS_THINKING, v); } catch (e) {}
  if (window.StackData) window.StackData.writeSharedKeys({ aiThinking: v });
}
// Run one AI operation with an elapsed ticker + learned ETA + persistent error
// line. fn(onPhase) returns a promise. Rethrows so callers keep their existing
// toast/openSettings catch and button-restoring finally.
async function aiRun(op, labelEl, errEl, baseText, fn) {
  var typ = typicalAiMs(op);
  var eta = typ ? " (typically ~" + Math.round(typ / 1000) + "s)" : "";
  var start = Date.now(), phase = "";
  var model = activeModelLabel();
  if (errEl) { errEl.textContent = ""; errEl.classList.remove("on"); }
  function tick() {
    labelEl.textContent = (phase || baseText) + " · " + model + "… " +
      Math.round((Date.now() - start) / 1000) + "s" + eta;
  }
  tick();
  if (activeModelIsRouter()) toast("The free model router can queue for minutes — a paid fast model in Settings is pennies per batch", 6000);
  else if (activeModelIsSlow()) toast(model + " is a slow reasoning model — switch to a fast one in Settings if this drags", 6000);
  var timer = setInterval(tick, 1000);
  try {
    var out = await fn(function (msg) { phase = msg || ""; tick(); });
    recordAiMs(op, Date.now() - start);
    return out;
  } catch (err) {
    if (errEl) {
      errEl.textContent = baseText + " failed after " + Math.round((Date.now() - start) / 1000) + "s — " +
        (err && err.message || "unknown error");
      errEl.classList.add("on");
    }
    throw err;
  } finally {
    clearInterval(timer);
    labelEl.textContent = "";
  }
}
// The length instruction block appended to both AI prompts. Feeds the model the
// hard caps (which it never otherwise sees) plus a target range per platform,
// and asks IG/FB/LinkedIn for genuinely long, story-style captions on "long".
// names (optional) restricts the block to the platforms actually being asked
// for — a shorter prompt and a smaller answer when the user only posts a clip
// to two or three places.
function lengthGuidanceBlock(pref, names) {
  var story = { "Instagram Reels": 1, "Facebook Reels": 1, "LinkedIn": 1 };
  var wanted = names && names.length ? PLATFORMS.filter(function (p) { return names.indexOf(p.name) >= 0; }) : PLATFORMS;
  var lines = wanted.map(function (p) {
    var cap = (PLATFORM_RULES[p.name] || DEFAULT_RULES).limit;
    var tgt = (LENGTH_TARGETS[p.name] || {})[pref] || "";
    var line = "- " + p.name + ": hard cap " + cap + " chars (never exceed); aim for " + tgt + " chars.";
    if (p.name === "Snapchat Spotlight") line += " Always <=80 no matter the preference — it's a short overlay.";
    if (p.name === "YouTube Shorts") line += " This is the Short's visible title, so keep it tight.";
    if (pref === "long" && story[p.name]) {
      line += " Write a genuinely long, story-style caption: a scroll-stopping first line, then several short" +
        " paragraphs of real substance the reader will stop to read while the video plays, a clear call to" +
        " action, and hashtags last.";
    }
    return line;
  });
  return "\n\nCaption length — the creator wants " + pref.toUpperCase() + " captions. The hard caps below are" +
    " ABSOLUTE; land each caption inside its target range:\n" + lines.join("\n") +
    "\nFor \"Pinterest\" the value is an object (see below); its title has a hard cap of 100 chars and its" +
    " description follows the Pinterest target above.";
}

// An output ceiling sized to what was actually asked for. Without one, a slow
// model can spend minutes emitting captions nobody capped — the single biggest
// contributor to a run that "takes forever and then nothing".
function captionTokenBudget(names, count, pref) {
  var per = ({ short: 150, medium: 300, long: 800 })[pref] || 300;
  var n = (names && names.length) || PLATFORMS.length;
  return Math.min(16000, 400 + n * (count || 1) * per);
}

// Which model is actually running — shown in the progress label, because "it's
// been 200 seconds" means something very different on a fast model than on a
// reasoning-tier one, and the shared key store can change this from another app.
function activeModelLabel() {
  var cfg = getProviderConfig();
  if (cfg.provider === "openrouter") {
    return String(cfg.openrouterModel || "").split("/").pop() || "openrouter";
  }
  return "gemini-flash";
}
// Reasoning/heavyweight tiers: correct answers, minutes-long waits on a
// multi-platform caption job.
var SLOW_MODEL_RE = /opus|o1|o3(?!-mini)|gpt-4-turbo|deepseek-r1|\br1\b|qwq|qwen-?3|glm-4\.[5-9]|kimi|minimax|magistral|sonar-reasoning|grok-[3-9]|reason|think|405b/i;
// The free/auto routers hand each request to whatever model has spare
// capacity, behind everyone else's free usage — so runs queue for minutes or
// time out. Slow for a completely different reason than a reasoning model, so
// it gets its own message.
var ROUTER_MODEL_RE = /openrouter\/(free|auto)/i;
function activeModelIsRouter() {
  var cfg = getProviderConfig();
  return cfg.provider === "openrouter" && ROUTER_MODEL_RE.test(String(cfg.openrouterModel || ""));
}
function activeModelIsSlow() {
  var cfg = getProviderConfig();
  return cfg.provider === "openrouter" && SLOW_MODEL_RE.test(String(cfg.openrouterModel || ""));
}

// Compose-intent URLs — X and Threads accept a prefilled ?text= param, so
// "Copy + open" can land the user in a compose window with the caption already
// in it. Everything else only has an upload page and keeps the plain URL +
// clipboard flow. Clipboard copy always happens first as the backup either way.
var INTENT_URLS = {
  "X":       function (t) { return "https://x.com/intent/post?text=" + encodeURIComponent(t); },
  "Threads": function (t) { return "https://www.threads.net/intent/post?text=" + encodeURIComponent(t); },
};
var INTENT_URL_MAX = 2000; // encoded chars — both platforms' caption limits fit well under this

// On a phone, a couple of web URLs misbehave inside the platform's in-app
// browser. X's web intent gets hijacked by the X app into an in-app browser
// that then freezes; TikTok's web upload page is useless without a desktop
// login. For those two we launch the native app instead. Everything else keeps
// its https URL on every device. The clipboard copy still happens first, so an
// app that isn't installed just does nothing and the caption is already saved.
var IS_MOBILE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
var SCHEME_URLS = {
  "X":      function (t) { return "twitter://post?message=" + encodeURIComponent(t); },
  // TikTok has no public upload deep link; snssdk1233:// just foregrounds the
  // app (1233 is its iOS app id). If this ever no-ops on a device, try tiktok://.
  "TikTok": function ()  { return "snssdk1233://"; },
};
// Chooses where "Copy + open" sends the user: { url, mode }. mode "scheme"
// launches a native app via location.href (the reliable iOS pattern — a
// window.open on a custom scheme leaves a blank or popup-blocked tab); mode
// "tab" opens a web URL in a new tab, exactly as before.
function navTarget(p, text) {
  if (IS_MOBILE && SCHEME_URLS[p.name]) {
    var u = SCHEME_URLS[p.name](text);
    return { url: u.length <= INTENT_URL_MAX ? u : u.split("?")[0], mode: "scheme" };
  }
  var build = INTENT_URLS[p.name];
  if (!build) return { url: p.url, mode: "tab" };
  var w = build(text);
  return { url: w.length <= INTENT_URL_MAX ? w : p.url, mode: "tab" }; // absurdly long → plain page
}
// Test hook — lets the headless suite assert the per-platform target under a
// mobile UA without a real device. Harmless in production.
if (typeof window !== "undefined") window.__navTarget = navTarget;
var EMOJI_MAX = 8;            // more than this reads as spammy
var ALLCAPS_MIN_LETTERS = 15; // don't flag short acronyms as "all caps"
var NEAR_RATIO = 0.9;         // amber once the caption hits 90% of the limit

// Per-platform caption overrides, filled in by "Adapt for each platform" or
// "Suggest captions from video" (or left blank to fall back to the shared
// base caption). Keyed by platform name.
var platformCaptions = {};
// Pinterest is the one platform with a separate title + description. The title
// lives here (keyed by name, though only "Pinterest" is ever set); the
// description reuses platformCaptions like every other platform's single caption.
var platformTitles = {};
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
// === Multi-post model ===
// BLAST used to hold exactly one clip. It now holds a LIST of posts — the
// batch RECALL sends over, plus a permanent "Quick post" that is the old
// paste-a-caption-and-go flow. `posts` is the source of truth; the
// platform* maps below are live references into whichever post is open, so
// every existing handler mutates the post itself rather than a copy.
var LS_QUEUE = "blast_queue_v1";
var LS_BATCH_COUNT = "blast_batch_count_v1";
var posts = [];
var activeKey = "quick";
function blankPost(key, extra) {
  var p = {
    key: key, srcId: "", srcTitle: "", t: "", sec: 0,
    text: "", hookText: "", label: "", platforms: null,
    captions: {}, titles: {}, suggestions: {}, picked: {},
    status: {}, postUrl: {}, postedAt: {}, postedCaption: {},
    genState: "pending", genError: "",
    source: key === "quick" ? "quick" : "recall", createdAt: Date.now(), updatedAt: Date.now(),
  };
  if (extra) for (var k in extra) p[k] = extra[k];
  return p;
}
function findPost(key) {
  for (var i = 0; i < posts.length; i++) if (posts[i].key === key) return posts[i];
  return null;
}
function activePost() { return findPost(activeKey) || posts[0]; }
function quickPost() { return findPost("quick"); }
// Which platforms this post is for. A per-clip choice keeps the AI (and the
// card) from covering places this particular clip was never going to.
var queueDefaultPlatforms = null;
function selectedNames(post) {
  var sel = (post && post.platforms) || queueDefaultPlatforms;
  if (!sel || !sel.length) return PLATFORMS.map(function (p) { return p.name; });
  return PLATFORMS.filter(function (p) { return sel.indexOf(p.name) >= 0; }).map(function (p) { return p.name; });
}
function selectedPlatforms(post) {
  var names = selectedNames(post);
  return PLATFORMS.filter(function (p) { return names.indexOf(p.name) >= 0; });
}
// Point the working maps at this post's own objects (by reference — mutating
// them mutates the post). This is what lets ~240 lines of existing card
// wiring keep working untouched against whichever post is open.
function bindPost(post) {
  if (!post) return;
  activeKey = post.key;
  platformCaptions = post.captions = post.captions || {};
  platformTitles = post.titles = post.titles || {};
  platformSuggestions = post.suggestions = post.suggestions || {};
  platformPickedIdx = post.picked = post.picked || {};
  platformStatus = post.status = post.status || {};
  platformPostUrl = post.postUrl = post.postUrl || {};
  platformPostedAt = post.postedAt = post.postedAt || {};
  platformPostedCaption = post.postedCaption = post.postedCaption || {};
}
function loadPosts() {
  var q = null;
  try { q = JSON.parse(localStorage.getItem(LS_QUEUE)); } catch (e) {}
  posts = (q && q.v === 1 && Array.isArray(q.clips)) ? q.clips : [];
  queueDefaultPlatforms = (q && q.defaultPlatforms) || null;
  // The Quick post always exists and always sorts first.
  var quick = findPost("quick");
  if (!quick) { quick = blankPost("quick"); posts.unshift(quick); }
  else if (posts[0] !== quick) { posts = [quick].concat(posts.filter(function (p) { return p !== quick; })); }
  return quick;
}
// One-way migration: an in-flight single-clip session becomes the Quick post,
// so upgrading mid-session loses nothing.
function migrateSessionIntoQuick(quick) {
  var s = null;
  try { s = JSON.parse(localStorage.getItem(LS_SESSION)); } catch (e) {}
  if (!s) return;
  var untouched = !quick.text && !Object.keys(quick.captions || {}).length &&
                  !Object.keys(quick.status || {}).length;
  if (!untouched) return;
  quick.text = typeof s.base === "string" ? s.base : "";
  quick.hookText = typeof s.videoHook === "string" ? s.videoHook : "";
  quick.captions = s.captions || {};
  quick.titles = s.titles || {};
  quick.suggestions = s.suggestions || {};
  quick.picked = s.picked || {};
  quick.status = s.status || {};
  quick.postUrl = s.postUrl || {};
  quick.postedAt = s.postedAt || {};
  quick.postedCaption = s.postedCaption || {};
}
function savePosts() {
  try {
    localStorage.setItem(LS_QUEUE, JSON.stringify({
      v: 1, updatedAt: Date.now(), defaultPlatforms: queueDefaultPlatforms,
      batchCount: getBatchCount(), clips: posts,
    }));
  } catch (e) {
    // Suggestion arrays are by far the biggest thing in here — drop the ones
    // the user hasn't picked (oldest clips first) and try once more, so a full
    // batch degrades to "captions kept, extra options lost" instead of
    // "nothing saved".
    var freed = false;
    for (var i = posts.length - 1; i >= 0 && !freed; i--) {
      if (posts[i].key === "quick") continue;
      if (Object.keys(posts[i].suggestions || {}).length) { posts[i].suggestions = {}; freed = true; }
    }
    if (freed) { toast("Storage is full — dropped unused caption options to keep your captions", 6000); savePosts(); }
    else toast("Couldn't save the batch (storage full)", 6000);
  }
}
function getBatchCount() {
  var v = 1;
  try { v = parseInt(localStorage.getItem(LS_BATCH_COUNT), 10) || 1; } catch (e) {}
  return v === 2 || v === 3 ? v : 1;
}
function setBatchCount(v) { try { localStorage.setItem(LS_BATCH_COUNT, String(v)); } catch (e) {} }

function syncQuickInputs() {
  var quick = quickPost();
  if (!quick) return;
  var cap = document.querySelector("#caption");
  var vh = document.querySelector("#videohook");
  if (cap) quick.text = cap.value;
  if (vh) quick.hookText = vh.value;
}
function saveSession() {
  syncQuickInputs();
  savePosts();
  // blast_session_v1 stays the Quick post's projection: PULSE and the rest of
  // the stack read that shape, so it must keep working exactly as before.
  if (activeKey !== "quick") return;
  try {
    localStorage.setItem(LS_SESSION, JSON.stringify({
      base: (document.querySelector("#caption") || {}).value || "",
      videoHook: (document.querySelector("#videohook") || {}).value || "",
      transcript: (document.querySelector("#transcript") || {}).value || "",
      captions: platformCaptions,
      titles: platformTitles,
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
  var quick = loadPosts();
  migrateSessionIntoQuick(quick);
  bindPost(quick);
  savePosts();   // persist the migrated/created Quick post immediately, so the
                 // posts model is on disk even if the user never types
  var cap = document.querySelector("#caption");
  if (cap) cap.value = quick.text || "";
  var vh = document.querySelector("#videohook");
  if (vh) vh.value = quick.hookText || "";
  var tr = document.querySelector("#transcript");
  if (tr) {
    var t = ""; try { t = (JSON.parse(localStorage.getItem(LS_SESSION)) || {}).transcript || ""; } catch (e) {}
    tr.value = t;
  }
}
// Resets the Quick post only — a queued batch is the user's work, not session
// scratch, and is cleared per-clip from its card instead.
function resetSession() {
  var quick = quickPost() || blankPost("quick");
  quick.text = ""; quick.hookText = "";
  quick.captions = {}; quick.titles = {}; quick.suggestions = {}; quick.picked = {};
  quick.status = {}; quick.postUrl = {}; quick.postedAt = {}; quick.postedCaption = {};
  bindPost(quick);
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
  var post = activePost();
  if (post && post.key !== "quick") return String(post.text || "").trim();
  return (($("#caption") || {}).value || "").trim();
}

// Suggestion text comes from a model response — escape before it ever goes
// into innerHTML, same as any other untrusted string.
function escHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
  });
}

// A suggestion is a plain string for every platform except Pinterest, whose
// suggestions are { title, description } objects. These three helpers read
// either shape so the render/pick code stays branch-light (legacy sessions with
// string Pinterest suggestions degrade to description-only, as before).
function suggestLabel(s) {
  if (s && typeof s === "object") return (s.title ? s.title + " — " : "") + (s.description || "");
  return String(s == null ? "" : s);
}
function suggestDesc(s) { return (s && typeof s === "object") ? String(s.description || "") : String(s == null ? "" : s); }
function suggestTitle(s) { return (s && typeof s === "object") ? String(s.title || "") : ""; }

// Resolve the caption a platform will actually post: its own edited/adapted
// caption if present, else the shared base caption.
function captionFor(p, pcaptionEl) {
  var own = pcaptionEl ? pcaptionEl.value : platformCaptions[p.name];
  return ((own || "").trim() || currentBase()).trim();
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

// Renders ONE post's platform cards into `wrap`. Every existing card handler
// reads the module-level platform* maps, so a capture-phase binder points
// those maps at this post before any handler body runs — that is what lets
// several posts' sections coexist in the DOM without a "load this one first"
// step.
function renderPlatformSection(post, wrap) {
  if (!wrap) return;
  bindPost(post);
  wrap.innerHTML = "";
  if (!wrap.__bound) {
    wrap.__bound = 1;
    ["click", "input", "change", "focusin"].forEach(function (ev) {
      wrap.addEventListener(ev, function () { bindPost(post); }, true);
    });
  }
  selectedPlatforms(post).forEach(function (p) {
    var card = document.createElement("div");
    var st = statusOf(p.name);
    card.className = "platformcard status-" + st;
    var suggestions = platformSuggestions[p.name] || [];
    var pickedIdx = platformPickedIdx[p.name];
    var suggestionsHtml = suggestions.length
      ? '<div class="psuggestions">' + suggestions.map(function (s, i) {
          return '<button class="suggestchip' + (i === pickedIdx ? ' picked' : '') + '" type="button" data-idx="' + i + '">' + escHtml(suggestLabel(s)) + '</button>';
        }).join('') + '</div>'
      : '';
    var openLabel = (IS_MOBILE && SCHEME_URLS[p.name]) ? 'app' : (INTENT_URLS[p.name] ? 'compose' : (p.note ? 'app' : 'upload'));
    var isPin = p.name === "Pinterest";
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
      (isPin ? '<input class="ptitle" maxlength="100" placeholder="Pin title (up to 100 chars)" value="' + escHtml(platformTitles[p.name] || "") + '">' : '') +
      '<textarea class="pcaption" placeholder="' + (isPin ? 'Pin description' : 'Same as base caption until you Adapt, or type your own') + '">' + escHtml(platformCaptions[p.name] || "") + '</textarea>' +
      '<div class="pmeta"><span class="valcount" data-level="ok"></span><span class="valwarn hidden"></span></div>' +
      '<div class="prow">' +
      '<button class="btn primary copyopenbtn" type="button">Copy + open ' + openLabel + ' →</button>' +
      (isPin ? '<button class="btn ghost copytitlebtn" type="button">Copy title</button>' : '') +
      '<button class="btn ghost copybtn" type="button">' + (isPin ? 'Copy description' : 'Copy only') + '</button>' +
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
    var ptitle = card.querySelector(".ptitle"); // Pinterest only, else null
    if (ptitle) {
      ptitle.addEventListener("input", function () {
        platformTitles[p.name] = ptitle.value;
        saveSession();
      });
    }

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
        platformCaptions[p.name] = suggestDesc(suggestions[idx]);
        pcaption.value = platformCaptions[p.name];
        if (ptitle) { platformTitles[p.name] = suggestTitle(suggestions[idx]).slice(0, 100); ptitle.value = platformTitles[p.name]; }
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
      // Launch synchronously inside the click gesture (don't defer into the
      // clipboard .then, or iOS may block the scheme navigation for losing the
      // user-activation). Scheme → same-page handoff to the app; web → new tab.
      var target = navTarget(p, text);
      if (target.mode === "scheme") window.location.href = target.url;
      else window.open(target.url, "_blank", "noopener");
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

    var copyTitleBtn = card.querySelector(".copytitlebtn"); // Pinterest only
    if (copyTitleBtn) {
      copyTitleBtn.addEventListener("click", function () {
        var t = (ptitle ? ptitle.value : platformTitles[p.name]) || "";
        if (!t.trim()) { toast("Write a Pin title first"); return; }
        copyText(t).then(function () {
          toast("Pin title copied — paste it into the title field");
        }).catch(function () {
          toast("Couldn't copy — select and copy manually");
        });
      });
    }

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


// The Quick post owns the original #platforms grid; each queued clip owns the
// grid inside its own card. renderPlatforms() refreshes whatever is on screen,
// so every existing call site keeps working.
var expandedKeys = Object.create(null);
function renderPlatforms() {
  var quick = quickPost();
  if (quick) renderPlatformSection(quick, $("#platforms"));
  renderQueue();
  bindPost(activePost() || quick);
}

// --- queue UI ---
function postPreview(post) {
  var t = (post.hookText || post.text || "").replace(/\s+/g, " ").trim();
  return t.length > 70 ? t.slice(0, 69) + "…" : (t || "(no caption yet)");
}
function postPostedCount(post) {
  var n = 0;
  selectedNames(post).forEach(function (name) { if ((post.status || {})[name] === "posted") n++; });
  return n;
}
var GEN_BADGE = { pending: "Not written", ready: "Captions ready", partial: "Partly written", error: "Failed" };
function queueClips() { return posts.filter(function (p) { return p.key !== "quick"; }); }

function renderQueue() {
  var host = $("#queue");
  if (!host) return;
  var clips = queueClips();
  var panel = $("#queuePanel");
  if (panel) panel.classList.toggle("hidden", clips.length === 0);
  if (!clips.length) { host.innerHTML = ""; return; }
  host.innerHTML = clips.map(function (c) {
    var open = !!expandedKeys[c.key];
    var names = selectedNames(c);
    return '<div class="clipcard' + (open ? " open" : "") + '" data-key="' + escHtml(c.key) + '">' +
      '<div class="cliphead">' +
        '<button class="clipexpand" type="button" aria-expanded="' + open + '">' + (open ? "▾" : "▸") + '</button>' +
        '<div class="clipmeta"><div class="clippreview">' + escHtml(postPreview(c)) + '</div>' +
        '<div class="clipsub">' + escHtml(c.srcTitle || "") + (c.t ? " · " + escHtml(c.t) : "") + '</div></div>' +
        '<span class="clipbadge" data-gen="' + c.genState + '">' + (GEN_BADGE[c.genState] || c.genState) + '</span>' +
        '<span class="clipcount">' + postPostedCount(c) + "/" + names.length + '</span>' +
        '<button class="linkbtn clipplat" type="button">Platforms</button>' +
        '<button class="linkbtn clipdrop" type="button" aria-label="Remove clip">×</button>' +
      '</div>' +
      (c.genError ? '<div class="ai-error on cliperr">' + escHtml(c.genError) + '</div>' : "") +
      '<div class="clipbody"' + (open ? "" : ' hidden') + '>' +
        '<label class="fieldlabel">Base caption for this clip</label>' +
        '<textarea class="clipbase" rows="2">' + escHtml(c.text || "") + '</textarea>' +
        '<div class="platforms" data-key="' + escHtml(c.key) + '"></div>' +
      '</div>' +
    '</div>';
  }).join("");

  host.querySelectorAll(".clipcard").forEach(function (el) {
    var key = el.dataset.key;
    var post = findPost(key);
    if (!post) return;
    el.querySelector(".clipexpand").addEventListener("click", function () {
      if (expandedKeys[key]) delete expandedKeys[key]; else expandedKeys[key] = 1;
      renderQueue();
    });
    el.querySelector(".clipdrop").addEventListener("click", function () {
      if (!confirm("Remove this clip from the batch? Captions for it are lost.")) return;
      posts = posts.filter(function (p) { return p.key !== key; });
      delete expandedKeys[key];
      if (activeKey === key) bindPost(quickPost());
      savePosts(); renderPlatforms(); refreshStatus();
    });
    el.querySelector(".clipplat").addEventListener("click", function () { openPlatformPicker(post); });
    var base = el.querySelector(".clipbase");
    if (base) base.addEventListener("input", function () {
      post.text = base.value;
      post.updatedAt = Date.now();
      savePosts();
    });
    // Only expanded cards pay for a 9-platform grid — 24 collapsed cards stay cheap.
    if (expandedKeys[key]) renderPlatformSection(post, el.querySelector('.platforms[data-key="' + CSS.escape(key) + '"]'));
  });
}
function renderQueueBadges() {
  document.querySelectorAll(".clipcard").forEach(function (el) {
    var post = findPost(el.dataset.key);
    if (!post) return;
    var count = el.querySelector(".clipcount");
    if (count) count.textContent = postPostedCount(post) + "/" + selectedNames(post).length;
    var badge = el.querySelector(".clipbadge");
    if (badge) { badge.textContent = GEN_BADGE[post.genState] || post.genState; badge.setAttribute("data-gen", post.genState); }
  });
}

// Per-clip platform choice. Skipping the platforms a clip was never going to
// means fewer cards to scroll AND a smaller, faster, cheaper AI request.
function openPlatformPicker(post) {
  var cur = selectedNames(post);
  var box = $("#platpicker");
  if (!box) return;
  box.innerHTML =
    '<div class="pickhead">Platforms for “' + escHtml(postPreview(post)) + '”</div>' +
    '<div class="pickgrid">' + PLATFORMS.map(function (p) {
      return '<label class="radiopill"><input type="checkbox" value="' + escHtml(p.name) + '"' +
        (cur.indexOf(p.name) >= 0 ? " checked" : "") + '><span class="rbody"><span class="rtitle">' +
        escHtml(p.name) + '</span></span></label>';
    }).join("") + '</div>' +
    '<label class="radiopill pickdefault"><input type="checkbox" id="pickAsDefault"><span class="rbody">' +
    '<span class="rtitle">Use this set for new clips too</span></span></label>' +
    '<div class="pickfoot"><button class="btn ghost" id="pickCancel" type="button">Cancel</button>' +
    '<button class="btn primary" id="pickSave" type="button">Save platforms</button></div>';
  $("#pickscrim").classList.add("open");
  $("#pickCancel").addEventListener("click", closePlatformPicker);
  $("#pickSave").addEventListener("click", function () {
    var chosen = [].slice.call(box.querySelectorAll('.pickgrid input:checked')).map(function (i) { return i.value; });
    if (!chosen.length) { toast("Pick at least one platform"); return; }
    post.platforms = chosen;
    post.updatedAt = Date.now();
    if ($("#pickAsDefault").checked) queueDefaultPlatforms = chosen.slice();
    savePosts();
    closePlatformPicker();
    renderPlatforms(); refreshStatus();
    toast(chosen.length + " platform" + (chosen.length === 1 ? "" : "s") + " for this clip");
  });
}
function closePlatformPicker() {
  var sc = $("#pickscrim");
  if (sc) sc.classList.remove("open");
}

// Update just the status chips + card classes + session summary without
// tearing down the whole grid (which would blur a field mid-edit).
function refreshStatus() {
  var post = activePost();
  var names = selectedNames(post);
  var section = document.querySelector('.platforms[data-key="' + (post ? post.key : "quick") + '"]') || $("#platforms");
  var cards = section ? section.querySelectorAll(".platformcard") : [];
  var posted = 0, done = 0;
  names.forEach(function (name, i) {
    var p = { name: name };
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
  // The bar summarizes the whole batch, not just the post you happen to have
  // open — with 24 clips queued, "3 of 9" would be meaningless.
  var totPosted = 0, totDone = 0, totSlots = 0, clipsWithPosts = 0;
  posts.forEach(function (pt) {
    var ns = selectedNames(pt), any = 0;
    totSlots += ns.length;
    ns.forEach(function (n) {
      var st = (pt.status && pt.status[n]) || "none";
      if (st === "posted") { totPosted++; any++; }
      if (st === "posted" || st === "skipped") totDone++;
    });
    if (any) clipsWithPosts++;
  });
  var sub = $("#sessionSub");
  if (sub) {
    sub.textContent = posts.length > 1
      ? totPosted + " of " + totSlots + " posted across " + posts.length + " clips" +
        (totDone > totPosted ? " · " + (totDone - totPosted) + " skipped" : "")
      : totPosted + " of " + totSlots + " posted" +
        (totDone > totPosted ? " · " + (totDone - totPosted) + " skipped" : "");
  }
  var pulseLink = $("#pulseLink");
  if (pulseLink) pulseLink.classList.toggle("hidden", totPosted === 0);
  var bar = $("#sessionProgress");
  if (bar) bar.style.setProperty("--pct", (totSlots ? Math.round((totDone / totSlots) * 100) : 0) + "%");
  renderQueueBadges();
}

// Surgical, per-card — same discipline as refreshStatus: update only the
// counter/warning elements on keystroke, never re-render the card (which would
// blur the field mid-edit). Reads the resolved caption (own value, else base).
function refreshValidation(card, p) {
  var pcaption = card.querySelector(".pcaption");
  var valcount = card.querySelector(".valcount");
  var valwarn = card.querySelector(".valwarn");
  if (!pcaption || !valcount) return;
  var text = (pcaption.value || "").trim() || String((activePost() || {}).text || "").trim();
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

// Keep the slow-model warning honest as the user types or picks a model.
(function () {
  var sel = document.getElementById("ormodelselect");
  if (ormodel) ormodel.addEventListener("input", function () { refreshSlowModelHint(); });
  if (sel) sel.addEventListener("change", function () { setTimeout(refreshSlowModelHint, 0); });
})();

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
  // Re-reflect the thinking pref — another stack app may have changed the
  // shared value since load.
  var think = document.querySelector('input[name="aiThinking"][value="' + getThinkingPref() + '"]');
  if (think) think.checked = true;

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
  refreshSlowModelHint();

  setTimeout(function () { (provider === "gemini" ? gemkey : orkey).focus(); }, 40);
}

// Warn in Settings when the chosen model is a reasoning tier — those are the
// runs that take minutes on a multi-platform caption job.
function refreshSlowModelHint() {
  var el = $("#slowModelHint");
  if (!el) return;
  var val = (ormodel && ormodel.value) || "";
  var router = ROUTER_MODEL_RE.test(val);
  var slow = router || SLOW_MODEL_RE.test(val);
  el.textContent = router
    ? "The free router hands your request to whatever free model has capacity, behind everyone else's free usage — runs regularly queue for minutes or time out. openai/gpt-4o-mini costs about a cent per full batch and answers in seconds."
    : slow
    ? "This is a slow reasoning model — captions can take several minutes. Pick a flash/mini/haiku model for everyday runs."
    : "";
  el.classList.toggle("on", slow);
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
  if (window.StackData.bindSyncUI) window.StackData.bindSyncUI(toast);
}
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape" && settingscrim.classList.contains("open")) closeSettings();
});


// === Batch generate ===
// The whole point of the batch: set each clip's platforms, hit one button, and
// come back to a set of ready-to-post captions instead of waiting on the AI
// once per clip while you're out.
var batchCancel = false;
async function generateAllQueued() {
  var clips = queueClips().filter(function (c) { return c.genState !== "ready"; });
  if (!clips.length) { toast("Every queued clip already has captions"); return; }
  var count = getBatchCount();
  var btn = $("#genAll"), stop = $("#genStop");
  var label = $("#genAllLabel"), err = $("#genAllError");
  batchCancel = false;
  btn.disabled = true;
  if (stop) stop.classList.remove("hidden");
  var ok = 0, failed = 0;
  try {
    for (var i = 0; i < clips.length; i++) {
      if (batchCancel) break;
      var clip = clips[i];
      var names = selectedNames(clip);
      var base = (clip.text || "").trim();
      if (!base) { clip.genState = "error"; clip.genError = "This clip has no caption text to work from."; failed++; savePosts(); renderQueue(); continue; }
      var seed = clip.hookText ? base + "\n\nOpening hook: " + clip.hookText : base;
      try {
        var res = await aiRun("queue-" + (count > 1 ? "suggest" : "adapt"), label, err,
          "Clip " + (i + 1) + "/" + clips.length, (function (c, ns, sd, n) {
            return function (onPhase) { return generateForClip(c, ns, sd, n, onPhase); };
          })(clip, names, seed, count));
        clip.genState = res.partial ? "partial" : "ready";
        clip.genError = res.partial ? "Some platforms were cut off — run this clip again for the rest." : "";
        ok++;
      } catch (e) {
        // One clip failing must not end the batch — mark it and keep going.
        clip.genState = "error";
        clip.genError = (e && e.message) || "Generation failed";
        failed++;
      }
      clip.updatedAt = Date.now();
      savePosts();          // after EVERY clip, so a reload mid-batch keeps the finished ones
      renderQueue();
    }
  } finally {
    btn.disabled = false;
    if (stop) stop.classList.add("hidden");
    if (label) label.textContent = "";
    renderPlatforms(); refreshStatus();
  }
  var msg = ok + " clip" + (ok === 1 ? "" : "s") + " captioned";
  if (failed) msg += ", " + failed + " failed — open a clip to see why";
  if (batchCancel) msg += " (stopped)";
  toast(msg, failed || batchCancel ? 6000 : undefined);
}

// One clip: either a single caption per platform (count 1) or a set of options
// the card's existing picker can switch between (count 2-3).
async function generateForClip(clip, names, seed, count, onPhase) {
  if (count > 1) {
    var out = await suggestCaptionsForNames(seed, names, count, onPhase);
    names.forEach(function (name) {
      var arr = out[name];
      if (!Array.isArray(arr) || !arr.length) return;
      clip.suggestions[name] = arr.slice(0, count).map(function (x) {
        if (name === "Pinterest" && x && typeof x === "object") {
          return { title: String(x.title || "").slice(0, 100), description: String(x.description || "") };
        }
        return String(x);
      });
      // Apply the first option so every card is copy-ready without a click;
      // the existing suggestion chips still let you switch.
      clip.picked[name] = 0;
      var first = clip.suggestions[name][0];
      if (name === "Pinterest" && first && typeof first === "object") {
        clip.captions[name] = first.description || "";
        clip.titles[name] = first.title || "";
      } else {
        clip.captions[name] = String(first);
      }
    });
    return { partial: !!out.__partial };
  }
  var adapted = await adaptCaptionsForPlatforms(seed, onPhase, names);
  names.forEach(function (name) {
    var v = adapted[name];
    if (name === "Pinterest" && v && typeof v === "object") {
      if (v.description != null) clip.captions[name] = String(v.description).trim();
      if (v.title != null) clip.titles[name] = String(v.title).trim().slice(0, 100);
    } else if (typeof v === "string" && v.trim()) {
      clip.captions[name] = v.trim();
    }
  });
  return { partial: !!adapted.__partial };
}


// When OpenRouter can't deliver — timed out, spent the whole reply thinking,
// still refused JSON after the retry, or rate-limited — and a Gemini key is
// configured, rerun the same job on Gemini rather than failing. The free
// router in particular can queue for minutes; a rescued run beats a correct
// error message when you're mid-batch.
function isProviderFailure(err) {
  var msg = (err && err.message) || "";
  return !!(err && (err.spentThinking || err.nonJson)) ||
    /timed out after/i.test(msg) || /rate limited/i.test(msg) ||
    /overloaded/i.test(msg) || /no longer available on OpenRouter/i.test(msg);
}
async function withGeminiFallback(onPhase, run) {
  var cfg = getProviderConfig();
  try {
    return await run(cfg);
  } catch (err) {
    if (cfg.provider !== "openrouter" || !cfg.geminiKey || !isProviderFailure(err)) throw err;
    if (onPhase) onPhase("OpenRouter didn't answer — trying Gemini");
    var out = await run({
      provider: "gemini", geminiKey: cfg.geminiKey,
      openrouterKey: cfg.openrouterKey, openrouterModel: cfg.openrouterModel,
    });
    toast("OpenRouter didn't answer — these captions came from your Gemini key", 6000);
    return out;
  }
}

// A model that replied with prose (or spent its budget reasoning) usually
// complies when told bluntly. Retry the SAME prompt once with a hard
// instruction before surfacing the failure — cheaper than making the user
// notice, re-read the error and click again.
var JSON_ONLY_NUDGE = "\n\nIMPORTANT: Respond with ONLY the JSON object described above. " +
  "Your reply must start with '{' and contain no reasoning, explanation, or markdown.";
function shouldRetryAsJson(err) { return !!(err && (err.nonJson || err.spentThinking)); }
async function withJsonRetry(onPhase, run) {
  try {
    return await run("");
  } catch (err) {
    if (!shouldRetryAsJson(err)) throw err;
    if (onPhase) onPhase("Model didn't return JSON — asking again");
    return await run(JSON_ONLY_NUDGE);
  }
}

// === Adapt caption per platform (provider-aware: Gemini or OpenRouter) ===
async function adaptCaptionsForPlatforms(baseCaption, onPhase, only) {
  var names = (only && only.length ? only : PLATFORMS.map(function (p) { return p.name; }));
  var prompt = "You write short-form video captions. Given this base caption, rewrite it tailored " +
    "to each platform's real conventions (typical length, hashtag style, tone) while keeping the " +
    "core message intact. Platforms: " + names.join(", ") + ".\n\nBase caption:\n" + baseCaption +
    lengthGuidanceBlock(getCaptionLengthPref(), names) +
    "\n\nFor \"Pinterest\" only, the value must be an object with keys \"title\" (a punchy, searchable Pin " +
    "title, hard cap 100 chars) and \"description\" (the Pin description, hard cap 500 chars) instead of a " +
    "plain string.\n\nRespond with ONLY a JSON object whose keys are exactly the platform names above and " +
    "whose values are the tailored caption strings (for \"Pinterest\", the object described). No markdown, " +
    "no explanation, no extra keys.";

  return withGeminiFallback(onPhase, function (cfg) {
   return withJsonRetry(onPhase, async function (nudge) {
    var text = await generateText(cfg, {
      prompt: prompt + nudge, jsonMode: true, temperature: 0.4,
      thinking: getThinkingPref() === "on",
      maxTokens: captionTokenBudget(names, 1, getCaptionLengthPref()),
      partialOnTruncate: true,
      onPhase: onPhase,
    });
    return parseCaptionJSON(text);
   });
  });
}

$("#adaptBtn").addEventListener("click", async function () {
  var base = $("#caption").value.trim();
  if (!base) { toast("Write a base caption first"); return; }
  var btn = $("#adaptBtn");
  var label = $("#adaptLabel");
  btn.disabled = true;
  btn.textContent = "Adapting…";
  try {
    var adapted = await aiRun("adapt", label, $("#adaptError"), "Adapting", function (onPhase) {
      return adaptCaptionsForPlatforms(base, onPhase);
    });
    PLATFORMS.forEach(function (p) {
      var v = adapted[p.name];
      if (p.name === "Pinterest" && v && typeof v === "object") {
        if (v.description != null) platformCaptions[p.name] = String(v.description).trim();
        if (v.title != null) platformTitles[p.name] = String(v.title).trim().slice(0, 100);
      } else if (typeof v === "string" && v.trim()) {
        platformCaptions[p.name] = v.trim();
      }
    });
    renderPlatforms();
    saveSession();
    if (adapted.__partial) {
      var got = PLATFORMS.filter(function (p) { return adapted[p.name] != null; }).length;
      toast("Adapted " + got + " of " + PLATFORMS.length + " platforms (the response was cut off) — run again for the rest", 6000);
    } else {
      toast("Captions adapted for every platform");
    }
  } catch (err) {
    console.error(err);
    var msg = err && err.message ? err.message : "unknown error";
    toast("Couldn't adapt captions: " + msg, 6000);
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

function captionSuggestPromptFor(names, count) { return captionSuggestPrompt(names, count); }
function captionSuggestPrompt(names, count) {
  return "Propose exactly " + count + " distinct caption option" + (count > 1 ? "s" : "") + " for each of " +
    "these platforms, tailored to each platform's real conventions (typical length, hashtag style, tone): " +
    names.join(", ") + "." + lengthGuidanceBlock(getCaptionLengthPref(), names) +
    "\n\nFor \"Pinterest\" only, each option must be an object with keys \"title\" (a punchy, searchable Pin " +
    "title, hard cap 100 chars) and \"description\" (hard cap 500 chars) instead of a plain string.\n\n" +
    "Respond with ONLY a JSON object whose keys are exactly the platform names above and whose values are " +
    "arrays of exactly " + count + " option" + (count > 1 ? "s" : "") + " each (for Pinterest, an array of " +
    "those objects), ordered best-first. No markdown, no explanation, no extra keys.";
}

// Pull whole "Platform": <value> pairs out of a response that was cut off
// mid-generation. String/escape aware, so a brace inside a caption can't
// confuse it, and each pair is JSON.parsed on its own — a garbled pair is
// dropped rather than guessed at. Returns null when nothing survives.
function salvageCaptionObject(text) {
  var t = String(text == null ? "" : text);
  var start = t.indexOf("{");
  if (start < 0) return null;
  function scanString(j) {
    if (t[j] !== '"') return -1;
    j++;
    while (j < t.length) {
      var c = t[j];
      if (c === "\\") { j += 2; continue; }
      if (c === '"') return j + 1;
      j++;
    }
    return -1;                       // string ran off the end — truncated
  }
  function scanValue(j) {
    var c = t[j];
    if (c === '"') return scanString(j);
    if (c === "{" || c === "[") {
      var depth = 0;
      while (j < t.length) {
        var ch = t[j];
        if (ch === '"') { var e = scanString(j); if (e < 0) return -1; j = e; continue; }
        if (ch === "{" || ch === "[") depth++;
        else if (ch === "}" || ch === "]") { depth--; if (depth === 0) return j + 1; }
        j++;
      }
      return -1;                     // container never closed — truncated
    }
    var k = j;
    while (k < t.length && ",}]".indexOf(t[k]) < 0) k++;
    return k >= t.length ? -1 : k;   // primitive with no delimiter — truncated
  }
  var out = {}, found = 0, i = start + 1;
  while (i < t.length) {
    while (i < t.length && /\s/.test(t[i])) i++;
    if (t[i] === "}" || i >= t.length) break;
    if (t[i] === ",") { i++; continue; }
    var kEnd = scanString(i);
    if (kEnd < 0) break;
    var rawKey = t.slice(i, kEnd);
    var j = kEnd;
    while (j < t.length && /\s/.test(t[j])) j++;
    if (t[j] !== ":") break;
    j++;
    while (j < t.length && /\s/.test(t[j])) j++;
    var vEnd = scanValue(j);
    if (vEnd < 0) break;             // truncated tail — keep everything before it
    try {
      var pair = JSON.parse("{" + rawKey + ":" + t.slice(j, vEnd) + "}");
      for (var key in pair) { out[key] = pair[key]; found++; }
    } catch (e) { /* garbled pair — skip it */ }
    i = vEnd;
  }
  return found ? out : null;
}

function parseCaptionJSON(text) {
  // Reasoning models leak their monologue into the reply; llm.js strips the
  // tagged form, this catches anything that arrives by another path.
  var t = String(text == null ? "" : text).replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "").trim();
  // Rescue the common near-miss: valid JSON wrapped in a markdown fence.
  var fenced = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenced) t = fenced[1];
  try { return JSON.parse(t); }
  catch (e) {
    // Truncated mid-generation? Keep the platforms that did come through
    // instead of discarding a mostly-good response. __partial is
    // non-enumerable so callers iterating platform keys never see it.
    var salvaged = salvageCaptionObject(t);
    if (salvaged) {
      Object.defineProperty(salvaged, "__partial", { value: true, enumerable: false });
      return salvaged;
    }
    // Providers under rate pressure often return the limit notice as PROSE
    // with HTTP 200, which sails past the status-code checks in llm.js and
    // lands here. Name the real problem instead of a generic JSON error —
    // on a phone this toast is the only diagnostics the user gets.
    if (/rate.?limit|too many requests|\b429\b|quota|resource.?exhausted/i.test(t)) {
      throw new Error("Provider rate limited — wait a minute and retry, or switch provider/key in Settings");
    }
    var snip = t.replace(/\s+/g, " ").trim().slice(0, 120);
    if (!snip) throw new Error("Model returned an empty response");
    var nj = new Error("Model didn't return JSON — it said: “" + snip + (t.length > 120 ? "…" : "") + "”");
    nj.nonJson = true;   // callers retry once with a blunter instruction
    throw nj;
  }
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

// Batch variant: same prompt, restricted to the platforms this clip is for.
async function suggestCaptionsForNames(seed, names, count, onPhase) {
  var config = getProviderConfig();
  var prompt = "Here is a short-form video clip's caption seed:\n\n" + seed + "\n\n" +
    captionSuggestPromptFor(names, count);
  return withGeminiFallback(onPhase, function (cfg) {
   return withJsonRetry(onPhase, async function (nudge) {
    var text = await generateText(cfg, {
      prompt: prompt + nudge, jsonMode: true, temperature: 0.5,
      thinking: getThinkingPref() === "on",
      maxTokens: captionTokenBudget(names, count, getCaptionLengthPref()),
      partialOnTruncate: true,
      onPhase: onPhase,
    });
    return parseCaptionJSON(text);
   });
  });
}

async function suggestCaptionsFromText(transcript, count, evidenceBlock, contextBlk, onPhase) {
  var config = getProviderConfig();
  var names = PLATFORMS.map(function (p) { return p.name; });
  var textPrompt = "Here is a transcript of a video clip:\n\n" + transcript + (contextBlk || "") + "\n\n" +
    captionSuggestPrompt(names, count) + (evidenceBlock || "");
  return withGeminiFallback(onPhase, function (cfg) {
   return withJsonRetry(onPhase, async function (nudge) {
    var text = await generateText(cfg, {
      prompt: textPrompt + nudge, jsonMode: true, temperature: 0.5,
      thinking: getThinkingPref() === "on",
      maxTokens: captionTokenBudget(names, count, getCaptionLengthPref()),
      partialOnTruncate: true,
      onPhase: onPhase,
    });
    return parseCaptionJSON(text);
   });
  });
}

async function suggestCaptionsFromVideo(file, mode, count, evidenceBlock, contextBlk, onPhase) {
  var config = getProviderConfig();
  var names = PLATFORMS.map(function (p) { return p.name; });

  if (mode === "vision") {
    if (!providerSupportsVideo(config)) {
      throw new Error("Video analysis needs Gemini — switch provider in Settings, or use transcript mode.");
    }
    var visionPrompt = "Watch this video clip, then: " + captionSuggestPrompt(names, count) + (contextBlk || "") + (evidenceBlock || "");
    return withJsonRetry(onPhase, async function (nudge) {
      var text = await generateFromMedia(config, {
        file: file, prompt: visionPrompt + nudge, jsonMode: true, mediaKind: "video",
        thinking: getThinkingPref() === "on",
        maxTokens: captionTokenBudget(names, count, getCaptionLengthPref()),
        partialOnTruncate: true,
        onPhase: onPhase,
      });
      return parseCaptionJSON(text);
    });
  }

  onPhase("Transcribing");
  var mediaKind = (file.type || "").indexOf("video/") === 0 ? "video" : "audio";
  // Pure transcription — thinking is wasted tokens here; never enable it.
  var transcript = await generateFromMedia(config, { file: file, prompt: TRANSCRIBE_FOR_CAPTIONS_PROMPT, mediaKind: mediaKind, thinking: false, maxTokens: 8000, onPhase: onPhase });
  onPhase("Writing captions");
  return suggestCaptionsFromText(transcript, count, evidenceBlock, contextBlk, onPhase);
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
      results = await aiRun("suggest-text", label, $("#suggestError"), "Writing captions", function (onPhase) {
        return suggestCaptionsFromText(transcriptText, count, evidenceBlock, contextBlk, onPhase);
      });
    } else {
      var mode = $("#modeVision").checked ? "vision" : "transcript";
      // The transcribe route is two AI calls timed as ONE op — its total is
      // what the user actually waits for.
      results = await aiRun(mode === "vision" ? "suggest-vision" : "suggest-transcribe", label, $("#suggestError"), "Analyzing", function (onPhase) {
        return suggestCaptionsFromVideo(pendingFile, mode, count, evidenceBlock, contextBlk, onPhase);
      });
    }
    PLATFORMS.forEach(function (p) {
      var arr = results[p.name];
      if (Array.isArray(arr) && arr.length) {
        platformSuggestions[p.name] = arr.slice(0, count).map(function (s) {
          if (p.name === "Pinterest" && s && typeof s === "object") {
            return { title: String(s.title || "").slice(0, 100), description: String(s.description || "") };
          }
          return String(s);
        });
        delete platformPickedIdx[p.name];
      }
    });
    renderPlatforms();
    saveSession();
    if (results.__partial) {
      var got = PLATFORMS.filter(function (p) { return Array.isArray(results[p.name]); }).length;
      toast("Suggestions for " + got + " of " + PLATFORMS.length + " platforms (the response was cut off) — run again for the rest", 6000);
    } else {
      var extra = ev.winners.length ? " (leaning on " + ev.winners.length + " HOOKLAB winner" + (ev.winners.length > 1 ? "s" : "") + ")" : "";
      toast("Caption suggestions ready — pick one per platform" + extra);
    }
  } catch (err) {
    console.error(err);
    var msg = err && err.message ? err.message : "unknown error";
    toast("Couldn't suggest captions: " + msg, 6000);
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

// Caption-length preference (Short/Medium/Long): reflect the saved choice into
// the radios on load, and persist any change. Feeds both Adapt and Suggest.
(function () {
  var pref = getCaptionLengthPref();
  var checked = document.querySelector('input[name="captionLength"][value="' + pref + '"]');
  if (checked) checked.checked = true;
  document.querySelectorAll('input[name="captionLength"]').forEach(function (r) {
    r.addEventListener("change", function () {
      if (r.checked) { try { localStorage.setItem(LS_CAPTION_LEN, r.value); } catch (e) {} }
    });
  });
})();

// Thinking preference: reflect on load, persist on change (NOT via the save
// button — #keysave rewrites blast_settings_v1 wholesale). Also mirrored into
// the StackData shared store so the other apps follow.
(function () {
  var pref = getThinkingPref();
  var checked = document.querySelector('input[name="aiThinking"][value="' + pref + '"]');
  if (checked) checked.checked = true;
  document.querySelectorAll('input[name="aiThinking"]').forEach(function (r) {
    r.addEventListener("change", function () { if (r.checked) setThinkingPref(r.value); });
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

// === Batch controls ===
(function () {
  var genAll = $("#genAll");
  if (genAll) genAll.addEventListener("click", generateAllQueued);
  var stop = $("#genStop");
  if (stop) stop.addEventListener("click", function () { batchCancel = true; toast("Stopping after this clip…"); });
  var clear = $("#queueClear");
  if (clear) clear.addEventListener("click", function () {
    var n = queueClips().length;
    if (!n) return;
    if (!confirm("Clear all " + n + " queued clips? Their captions are lost.")) return;
    posts = posts.filter(function (p) { return p.key === "quick"; });
    expandedKeys = Object.create(null);
    bindPost(quickPost());
    savePosts(); renderPlatforms(); refreshStatus();
    toast("Batch cleared");
  });
  document.querySelectorAll('input[name="batchCount"]').forEach(function (r) {
    r.checked = String(getBatchCount()) === r.value;
    r.addEventListener("change", function () {
      if (!r.checked) return;
      setBatchCount(parseInt(r.value, 10));
      savePosts();
      var hint = $("#batchCostHint");
      if (hint) hint.textContent = batchCostHint();
    });
  });
  var hint = $("#batchCostHint");
  if (hint) hint.textContent = batchCostHint();
  var sc = $("#pickscrim");
  if (sc) sc.addEventListener("click", function (e) { if (e.target === sc) closePlatformPicker(); });
})();
function batchCostHint() {
  var clips = queueClips();
  if (!clips.length) return "";
  var slots = 0;
  clips.forEach(function (c) { slots += selectedNames(c).length; });
  var n = getBatchCount();
  return clips.length + " clips · " + slots + " platform captions" +
    (n > 1 ? " · " + n + " options each (about " + n + "x the tokens and time)" : "");
}
