# Orbit on your phone

This is a separate, single-owner cloud edition of Orbit. Your Mac can be off.
It uses the official Ollama Cloud API for chat and memory planning. Web research
also falls back to Bing HTML/RSS, DuckDuckGo HTML/Lite and direct public HTTPS
page reading when Ollama's web service is unavailable or quota limited.
The existing document, spreadsheet, chart, upload and preview code is included.

## First deployment on Render

1. Create accounts at https://github.com and https://dashboard.render.com if needed.
2. Unzip **Orbit-Cloud.zip**. Create an empty **private** GitHub repository called `orbit-cloud`.
   In GitHub, choose **uploading an existing file** (or **Add file → Upload files**).
   Drag the contents of the extracted `Orbit-Cloud` folder into the upload area and commit them.
   `render.yaml`, `server.py`, `cloud` and `public` must be at the repository's top level.
   Upload only this prepared package, not your original Orbit workspace.
3. In Render choose **New → Blueprint**, connect GitHub and select that private repository.
   Render reads `render.yaml`, selects a free Docker web service and generates the session secret.
4. When prompted, fill in the two private environment values:
   - `OLLAMA_API_KEY`: create a key at https://ollama.com/settings/keys and paste it into Render.
   - `ORBIT_PASSWORD`: choose a unique password of at least 8 characters for your personal Orbit login.
   Do not put either value in GitHub, a screenshot, or chat. The API key never goes to the browser.
5. Deploy. Open the `https://...onrender.com` address Render gives you and sign in with your Orbit password.
6. In iPhone Safari, open that same address. Optionally choose **Share → Add to Home Screen**.
   Test a simple chat first, then a web-search request and a small spreadsheet or chart.

No local installer, certificates, Mac password or Ollama app is needed for this edition.
Render supplies HTTPS. Free services can sleep after 15 minutes without traffic and take about
a minute to wake. Free hosting has usage limits; Ollama account limits also apply separately.
Check the provider's current terms before adding a payment method or upgrading.

## What stays on each device

Chats, memories, preferences and stored file previews remain in that browser's local storage.
They are **not automatically synced** with your Mac or another browser. Export chats before
clearing site data. Signing out ends cloud access; it does not erase local chats or previews.
This edition is for one owner on their own devices, not a multi-user shared service.
Prompts and attachments used in replies pass through your hosting server to Ollama Cloud.
Avoid closing or backgrounding Safari during a long generation; iOS may suspend the page.
The cloud edition intentionally does not register the offline service worker, so authenticated
pages are not stored in its shared offline cache.

## Updating and troubleshooting

- Upload a newer cloud package into the same repository, commit and redeploy in Render.
- Empty model list: confirm the API key and Ollama account access in Render's Environment settings.
- Incorrect password: update `ORBIT_PASSWORD` in Render and redeploy. Existing sessions are invalidated.
- Never remove login protection or expose the local Ollama port publicly.
- Do not increase the Gunicorn worker count: the request limiter and concurrency budgets are
  intentionally held in one process. More workers require a shared rate-limit store.
- For a custom domain you own, set `ORBIT_PUBLIC_ORIGIN` to its exact HTTPS origin and redeploy.
  Otherwise Render's hostname is detected automatically. Your Mac's local `orbit.com` mapping
  does not give you ownership of the public domain.

## Validation and limits

The test suite uses a fake upstream to check authentication, origin/CSRF checks, secret isolation,
model discovery, streaming, errors and web research without charging an account. A real Ollama
API key and Render account are still required to verify a deployed end-to-end request.
Docker deployment should also be verified by Render's build; the development Mac may not have Docker.

Run server tests from the source workspace with `python -m unittest tests/test_cloud.py`
in an environment containing `cloud/requirements.txt`. Build a fresh package with
`python3 scripts/package-cloud.py`. The desktop installer package stays separate.

References: https://docs.ollama.com/cloud · https://render.com/docs/blueprint-spec · https://render.com/docs/free
