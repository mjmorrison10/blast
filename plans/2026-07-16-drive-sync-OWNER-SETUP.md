# Google Drive sync — one-time owner setup

Sync ships **disabled** until you create a Google OAuth client and paste its
id into the code. Until then the Sync button shows "Drive setup pending" and
does nothing harmful. This is a ~10 minute, one-time task.

## 1. Create a Google Cloud project
- Go to https://console.cloud.google.com → project picker → **New Project**
  (name it e.g. "mjm-stack-sync"). Select it.

## 2. Enable the Drive API
- APIs & Services → **Enable APIs and Services** → search "Google Drive API"
  → **Enable**.

## 3. Configure the consent screen
- APIs & Services → **OAuth consent screen**.
- User type: **External** → Create.
- Fill app name (e.g. "Morrison Stack"), your support email, developer email.
- **Scopes**: Add scope → add ONLY
  `https://www.googleapis.com/auth/drive.file`
  (this is a *non-sensitive* scope — the app only ever sees files it created,
  so Google does NOT require a verification review).
- Save through to the summary, then **Publish app** → confirm "In production".
  (If you leave it in "Testing", grants expire after 7 days and only test
  users can sign in.)

## 4. Create the OAuth client id
- APIs & Services → **Credentials** → Create credentials → **OAuth client ID**.
- Application type: **Web application**.
- **Authorized JavaScript origins**: add
  `https://mjmorrison10.github.io`
  (and, only if you test sync locally, add each dev origin like
  `http://localhost:8000`).
- Leave **Authorized redirect URIs** empty (the token client uses a popup,
  not a redirect). There is no client secret to copy for this flow.
- Create → copy the **Client ID** (looks like
  `1234567890-abc123.apps.googleusercontent.com`).

## 5. Paste the client id into the code
- In `stackdata.js`, change:
  `var DRIVE_CLIENT_ID = "REPLACE_WITH_OAUTH_CLIENT_ID";`
  to your real client id, then re-vendor the file to all four app dirs
  (recall/Hooklabs/blast/pulse must stay byte-identical) and deploy. (Ask me
  to do this step — it's a small 4-repo PR.)

## 6. Smoke test on two devices
- Laptop: open any app → Settings/backup area → **Sync Google Drive** →
  approve the consent popup once → it names your workspace and creates
  `mjm-stack-sync.json` in your Drive.
- Phone: open the same app → **Sync** → sign in → your laptop's data appears.
- drive.google.com should show exactly one `mjm-stack-sync.json`.

## Notes
- The file in your Drive contains your posts/library/ledger but **never your
  API keys** — those stay on each device (enter them once per device).
- Only you can see or share that Drive file; revoke access any time from your
  Google account's "Third-party apps" settings.
