# BLAST

**Cut once, post everywhere.**

RECALL finds the moment. BLAST gets it out the door. Upload a clip, get it reformatted to 9:16 for
YouTube Shorts, TikTok, Instagram Reels, and Snapchat Spotlight, then write one caption and jump
straight to each platform's upload page.

## What it does today (v1)

1. **Upload** a video (mp4/mov/webm).
2. **Reformat** — crops and scales to a centered 9:16 vertical clip, entirely in your browser via
   [ffmpeg.wasm](https://ffmpegwasm.netlify.app/). Nothing is uploaded to a server.
3. **Download** the vertical clip.
4. **Caption once** — write it once, copy it per platform, and jump to each platform's upload page
   with one click.

## What it doesn't do yet

BLAST doesn't auto-post. Real auto-posting requires registering a developer app with each platform
(TikTok Content Posting API, Instagram Graph API, YouTube Data API, Snapchat) — most of which gate
this behind business verification and app review. That's a v2 feature once those credentials exist.
Until then, this ships the part that's actually buildable today: kill the manual reformatting step,
keep the manual posting step.

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
- Per-platform caption variants (character limits, hashtag conventions) instead of one shared caption.
- Batch mode: reformat multiple clips from a RECALL export in one pass.

---

Built by Michael Morrison. Client-side only — your video never leaves your device.
