# tts: the coach's natural voice (Kokoro "af_heart")

A small private Cloud Run service that turns English text into MP3 speech
with the Kokoro-82M v1.0 model (Apache-2.0) and the voice `af_heart`,
using sherpa-onnx 1.13.8. Only the API calls it.

```
app ──POST /tts {text}──▶ API (twosetsfitness-api)
                            │ 1. sha256(voice|speed|text) → gs://setsfitness-api-tts-cache/v1/<key>.mp3 ? hit → reply
                            │ 2. miss → POST <tts>/synth with an ID token (google-auth-library) → store → reply
                            ▼
                         tts (this folder, private: --no-allow-unauthenticated)
```

- `POST /synth {"text", "voice": "af_heart", "speed": 1.0, "lang": "en-us"}` → `audio/mpeg`
  (mono, 22.05 kHz, 48 kb/s; header `X-Audio-Duration` in seconds). Text up to 600
  characters; the only voice is `af_heart` (`VOICES` in `server.py`); `lang` must be `en-us`.
- `GET /healthz` → `ok`.
- The API answers the app with `{ audio: <base64 MP3>, duration, cached }` (`src/routes/tts.js`).
- `POST /tts/warm` (API, signed in, 30/hour each): the app's wake-up call on start and back in
  the foreground (at most every 5 min): tts says "Ready.", nothing stored, so a cold instance
  has its model loaded before the coach speaks. No always-on instance needed.
- The app keeps one voice per speech session (a tour, a check-in, a workout: lines < 2 min
  apart): once Heart has played, a slow line waits (12 s for the first after a wake-up, then
  6 s) and is skipped rather than said by the phone. Offline / a server error, or a cold server
  nobody woke (3 s), puts that session on the phone's voice until it ends. Not English, or
  Settings → Coach voice "Phone voice": always the phone (`formcoach-app src/lib/serverVoice.js`).

## Files

| File | |
|---|---|
| `server.py` | the HTTP server (standard library), the model loaded once at start, MP3 via `lameenc` |
| `fetch_model.py` | build step: downloads the model from the official k2-fsa release, checks its SHA-256, keeps only the English files |
| `Dockerfile` | `python:3.12-slim`; model pinned by URL + SHA-256 (`MODEL_URL`, `MODEL_SHA256`) |
| `requirements.txt` | `sherpa-onnx==1.13.8` (2.0.1 returned empty audio), `numpy`, `lameenc` |
| `lifecycle.json` | the cache bucket's rule: delete objects after 90 days |

Model: `kokoro-multi-lang-v1_0.tar.bz2` from
https://github.com/k2-fsa/sherpa-onnx/releases/tag/tts-models, SHA-256
`60703707bc05ccd48d60e1eb723f38b07d6e474795a0b6a588d7220400e0f7a4` (349,886,476 bytes).
fp32, not the int8 build: on 2 CPU threads fp32 rendered a 4.8 s line in about 4 s,
int8 in about 8 s. `af_heart` is speaker id 3.

## Deploy (you run these; nothing has been created yet)

PowerShell, from `C:\Users\Mohammed\Desktop\2setsfitness-api`. The API runs as the
default compute service account `608365314707-compute@developer.gserviceaccount.com`
(DEPLOY.md: no `--service-account` on its deploy). Check with:
```powershell
gcloud run services describe twosetsfitness-api --region europe-west2 --project setsfitness-api --format="value(spec.template.spec.serviceAccountName)"
```
(empty output = the default compute account above).

1. **APIs** (Cloud Run, Build and Artifact Registry are already on):
   ```powershell
   gcloud services enable storage.googleapis.com --project setsfitness-api
   ```
2. **Cache bucket** in London, private, objects deleted after 90 days:
   ```powershell
   gcloud storage buckets create gs://setsfitness-api-tts-cache --project setsfitness-api --location europe-west2 --uniform-bucket-level-access --public-access-prevention
   gcloud storage buckets update gs://setsfitness-api-tts-cache --lifecycle-file=tts/lifecycle.json
   ```
3. **Let the API read and write the bucket** (that bucket only):
   ```powershell
   gcloud storage buckets add-iam-policy-binding gs://setsfitness-api-tts-cache --member="serviceAccount:608365314707-compute@developer.gserviceaccount.com" --role="roles/storage.objectUser"
   ```
4. **A service account for tts with no roles** (it needs no Google access at all; the
   default compute account has Editor):
   ```powershell
   gcloud iam service-accounts create tts-runtime --display-name "tts service (no roles)" --project setsfitness-api
   ```
5. **Deploy tts** (the build downloads the 350 MB model; takes about 5–8 minutes):
   ```powershell
   gcloud run deploy tts --source tts --no-allow-unauthenticated --memory 2Gi --cpu 2 --min-instances 0 --max-instances 3 --concurrency 2 --cpu-boost --timeout 60 --service-account tts-runtime@setsfitness-api.iam.gserviceaccount.com --region europe-west2 --project setsfitness-api
   ```
   If it says you can't act as `tts-runtime`, your user needs **Service Account User**
   on it, or drop `--service-account …` to run as the default account.
6. **Let only the API call tts:**
   ```powershell
   gcloud run services add-iam-policy-binding tts --member="serviceAccount:608365314707-compute@developer.gserviceaccount.com" --role="roles/run.invoker" --region europe-west2 --project setsfitness-api
   ```
7. **Its URL:**
   ```powershell
   gcloud run services describe tts --region europe-west2 --project setsfitness-api --format="value(status.url)"
   ```
8. **Deploy the API with the new `/tts` route**: the DEPLOY.md step C5 command,
   then add the two env vars (`--update-env-vars` keeps the others; C5's
   `--set-env-vars` would replace them, so add them after it, every time):
   ```powershell
   gcloud run services update twosetsfitness-api --update-env-vars "TTS_URL=<the URL from step 7>,TTS_BUCKET=setsfitness-api-tts-cache" --region europe-west2 --project setsfitness-api
   ```
   Optional: `TTS_HOURLY_LIMIT` (default 120 lines per user per hour).
9. **Check:**
   ```powershell
   # tts refuses anyone else (expect 403)
   curl.exe -s -o NUL -w "%{http_code}`n" -X POST "<tts URL>/synth"
   # your own Google account can call it if you're an owner (expect an MP3)
   curl.exe -s -X POST "<tts URL>/synth" -H "Authorization: Bearer $(gcloud auth print-identity-token)" -H "Content-Type: application/json" -d '{\"text\":\"Last set. Own the lockout.\"}' -o test.mp3
   # API without a sign-in token (expect 401)
   curl.exe -s -X POST https://twosetsfitness-api-608365314707.europe-west2.run.app/tts
   ```
   Then in the app (signed in, language English) speak a coach cue: the first time a
   line is new it may come out in the phone voice (render > 3 s); the next time it's Heart.
   Logs: `gcloud run services logs read tts --region europe-west2 --project setsfitness-api --limit 20`
   (one JSON line per render: chars, audio seconds, render ms).

Keep the image storage small: the Artifact Registry cleanup policy in DEPLOY.md
(keep 2) covers the `tts` images too; each is about 0.6 GB.

## Pre-render the app's fixed lines (once, and after the app's spoken lines change)

The app lists every fixed English line it speaks (tours, rep cues, timers, rank-up and boss
lines) in `formcoach-app/scripts/tts_lines.json` (`node scripts/build_tts_lines.mjs` there).
`scripts/prewarm_tts.js` renders the ones not yet cached into the bucket with the route's cache
key, so they play at once. About 400 lines, ~10 minutes, well under £0.20. PowerShell:
```powershell
gcloud auth login                                   # an account that may call tts (an owner)
gcloud auth application-default login               # for the bucket writes
$env:TTS_URL = gcloud run services describe tts --region europe-west2 --project setsfitness-api --format="value(status.url)"
node scripts/prewarm_tts.js --dry-run               # count + samples, no network
node scripts/prewarm_tts.js                         # renders what isn't cached
Remove-Item Env:TTS_URL
```
Run again any time: cached lines are skipped (`--force` renders them again). The 90-day bucket
rule deletes them eventually; re-run it every couple of months, or after a release.

## Cost (rough, at a handful of users)

- **Cloud Run (tts)**: billed only while rendering (request-based billing, min instances 0).
  A new line costs about 2 vCPU × 4–8 s ≈ £0.0003. A cold start (model load, ~10–20 s
  of CPU with `--cpu-boost`) is billed too. Cached lines never reach tts. The free tier
  (180,000 vCPU-s a month, shared with the API) covers thousands of new lines a month.
- **GCS**: europe-west2 has no free storage. About 30 KB a line: 10,000 lines ≈ 0.3 GB
  ≈ £0.01 a month; reads and writes cost fractions of a penny per thousand. The 90-day
  rule keeps it from growing.
- **Artifact Registry**: the tts image takes the project over the 0.5 GB free storage:
  about £0.05–0.15 a month.
- **Egress**: about 40 KB of JSON per spoken line; 10,000 lines ≈ 0.4 GB ≈ £0.05.
- Expect **well under £1 a month**, but above £0. The £1 budget alert may now fire;
  consider raising it to £5.
- Worst case is bounded: 120 lines/hour/user, max 3 instances × 2 vCPU, 600 characters a line.

## Run it locally

Linux/WSL, Python 3.12 (a venv or `pip install --target <dir>` outside the repo):
```sh
pip install -r tts/requirements.txt
python tts/fetch_model.py https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-multi-lang-v1_0.tar.bz2 60703707bc05ccd48d60e1eb723f38b07d6e474795a0b6a588d7220400e0f7a4 /tmp/ttsmodel
MODEL_DIR=/tmp/ttsmodel PORT=8091 python tts/server.py
curl -s -H 'Content-Type: application/json' -d '{"text":"Last set."}' localhost:8091/synth -o line.mp3
```
And the API against it: `TTS_URL=http://localhost:8091 TTS_NO_AUTH=1 npm run dev`
(the cache still uses the GCS bucket via your gcloud application-default login).
