---
task: Host PULSE at blast/pulse/ (temporary home)
date: 2026-07-10
approved: 2026-07-10
---

# PULSE parked in the blast repo

The `mjmorrison10/pulse` repo couldn't be pushed from the build session (egress
proxy repo-allowlist policy denial; not a credential issue). To ship PULSE now
without losing the work, it lives at `blast/pulse/` and deploys at
`mjmorrison10.github.io/blast/pulse/`.

- `pulse/` holds the full app (index.html, app.js, style.css, manifest.json,
  README.md), unchanged from the pulse repo. All asset paths are relative, so it
  runs fine from the subfolder. Same origin as /blast/ and /Hooklabs/, so
  reading blast_session_v1 and writing hooklab_state_v1 works identically.
- `index.html` "Track in PULSE" link updated to /blast/pulse/.

Relocation later: a session with both `blast` and `pulse` connected copies
`blast/pulse/*` into the pulse repo root, pushes (deploys /pulse/), then deletes
this folder and flips the links back.
