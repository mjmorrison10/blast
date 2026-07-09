# BLAST

**Cut once, post everywhere.**

BLAST is the posting command center of the creator ops stack — RECALL finds it, HOOKLAB underwrites
the open, BLAST gets it out the door. Write a caption, get it tailored per platform
(or let AI suggest captions straight from your video), and jump to each platform's upload page —
YouTube Shorts, TikTok, Instagram Reels, Snapchat Spotlight, Facebook Reels, X, LinkedIn, and
Pinterest. Optionally reformat a clip to 9:16 first, entirely in your browser.

## What it does today

1. **Caption once, post everywhere** — write a base caption, jump straight to each of the 8
   platforms' upload pages. This works with zero upload; it's the primary flow, not gated behind
   anything else.
   - **Posting session tracker** — each platform shows a status (not started → caption copied →
     upload opened → posted, or skipped), and the whole session — base caption, per-platform
     captions, AI suggestions, status, and live post URLs — is saved to your browser so a refresh
     or a closed tab doesn't lose it. A progress bar shows how many of the 8 you've actually posted.
     This is what makes BLAST a tracker rather than a bookmark folder: even with all your upload
     tabs already open, it's the one place that remembers where a clip has and hasn't gone.
   - **Copy + open in one click** — the primary button on each platform copies that platform's
     caption, opens its upload page, and marks it "opened" in a single action. "Copy only" and
     manual "mark posted / skip" are there too. Pasting a live post URL auto-marks it posted.
2. **Adapt for each platform** — one AI call rewrites your base caption per platform's real
   conventions (length, hashtag style, tone). Each platform gets its own editable result.
3. **Suggest captions from video** — upload your edited clip and get AI-proposed captions instead
   of writing one from scratch, with a choice of how many options per platform (1, 3, or 5):
   - **Watch the video** (Gemini only) — the model watches the actual clip (visuals + audio).
   - **From transcript** (any provider) — transcribes first, then writes captions from that. For an
     actual video *file*, this still needs Gemini for now — there's no path to read a video's audio
     track through OpenRouter yet, even for transcription only.
4. **Reformat to 9:16** (optional) — crops and scales to a centered vertical clip, entirely in your
   browser via [ffmpeg.wasm](https://ffmpegwasm.netlify.app/). Nothing is uploaded to a server. Not
   required to use any of the caption/platform features above — useful only if you need a quick crop
   without opening editing software.

## AI provider

**Gemini is the default** — add a free API key in Settings and everything works. Power users can
switch to **OpenRouter** instead and pick any text model. The two aren't equivalent, though:
Gemini has a resumable upload path for large files (up to 2GB) and can watch video directly.
OpenRouter is an OpenAI-compatible **text** API — no large-file upload (~15MB inline ceiling) and no
reliable video input. So: caption adaptation and transcript-based suggestions work on either
provider (small files); watching the video directly is Gemini-only, and the app disables that
option automatically if OpenRouter is selected rather than let you hit an error. Your key is stored
only in this browser's localStorage and sent only to whichever provider you pick — never to a
BLAST server, because there isn't one.

## What it doesn't do yet

BLAST doesn't auto-post. Real auto-posting requires registering a developer app with each platform
(TikTok Content Posting API, Instagram Graph API, YouTube Data API, Snapchat, Meta, X, LinkedIn) —
most of which gate this behind business verification and app review. That's a later feature once
those credentials exist. Until then, this ships the part that's actually buildable today: kill the
manual reformatting/captioning tax, keep the manual posting step.

## Run it

Static site, no build step.

- Serve the folder statically — `python3 -m http.server` locally, or GitHub Pages /
  Vercel / Netlify for a shareable link. (Opening `index.html` via `file://` won't
  work: the ffmpeg engine loads as an ES module worker, which needs an HTTP origin.)

ffmpeg.wasm is vendored in `vendor/` (exact versions in `vendor/VERSIONS.txt`)
rather than pulled from a CDN — browsers block cross-origin worker scripts, so the
CDN approach fails at engine load, and self-hosting means no third-party requests
at all.

The 9:16 crop assumes landscape or wide source footage (typical for podcast/interview clips — the
same content RECALL indexes). A source already narrower than 9:16 isn't handled in v1.

## Roadmap

- Auto-posting once platform developer API access is set up.
- Multiple aspect ratios / platform-specific crops instead of one shared 9:16.
- Extract audio client-side (BLAST already vendors ffmpeg.wasm) before transcript mode, so OpenRouter
  can handle video files too instead of needing Gemini for anything beyond audio-only uploads.
- Batch mode: process multiple clips from a RECALL export in one pass.

## The stack

BLAST is one third of the creator ops stack:

- **RECALL** — finds the moment: https://mjmorrisonusa.com/#/recall
- **HOOKLAB** — underwrites the open: https://mjmorrisonusa.com/#/hooklab
- **Portfolio** — https://mjmorrisonusa.com

---

Built by Michael Morrison. Client-side only — your video never leaves your device except to whichever
AI provider you choose, with your own key.
