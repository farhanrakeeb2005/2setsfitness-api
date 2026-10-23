# Deploying 2SetsFitness (after Railway)

## What is deployed now (2026-10-21)

| | |
|---|---|
| Service | Cloud Run `twosetsfitness-api`, project `setsfitness-api` (number 608365314707), region `europe-west2` |
| URL | https://twosetsfitness-api-608365314707.europe-west2.run.app (the app's `API_BASE_URL`, `formcoach-app/src/config.js`) |
| Settings | min instances 0, max 2, 1 CPU, 512 MiB, timeout 120 s, unauthenticated invocation (every data route checks the Firebase ID token itself) |
| Secrets (Secret Manager, project `setsfitness-api`) | `ANTHROPIC_API_KEY`, `DATABASE_URL` (Neon pooled URL), `JWT_SECRET` |
| Env var | `FIREBASE_PROJECT_ID=fitness-app-5c48a` |
| Database | Neon project `small-dawn-83425002` (London), 14 tables created with `npm run db:setup:node` |
| Billing | account "2SetsFitness API" linked to `setsfitness-api` only; £1 budget alert (50% / 90% / 100%). The Firebase project stays on Spark. |

Check it: `curl https://twosetsfitness-api-608365314707.europe-west2.run.app/health` should answer `{"status":"ok","db":"connected"}`.
Redeploy after a code change: run the `gcloud run deploy` command from step C5 again (add `--project setsfitness-api`); secrets and env vars stay set.

The steps below are how it was set up, in case it has to be done again.

## Setup steps

The new setup, all on free tiers:

| Piece | Where | What it does |
|---|---|---|
| Cloud backup of the app's data | **Cloud Firestore** in the existing Firebase project `fitness-app-5c48a` (Spark, free) | The app writes to it directly, no server involved. Code: `formcoach-app` `src/lib/firestoreSync.js`, rules in `firestore.rules`. |
| This API (AI coach, leaderboard, points, profile, logs) | **Google Cloud Run**, region `europe-west2` (London) | Runs the Docker image from this repo. Scales to zero when idle. |
| Postgres for the API | **Neon** free plan | `DATABASE_URL`. |

You do every step below yourself: no account, service or deploy has been created for you. Expect about 45 minutes.

Before you start, have these ready:
- the Anthropic API key (the one Railway had as `ANTHROPIC_API_KEY`);
- a bank card. Google Cloud won't run Cloud Run without a billing account, even inside the free tier (step C1).

---

## A. Firebase: create the Firestore database and its rules

1. Go to https://console.firebase.google.com and open the project **fitness-app-5c48a**. The plan badge at the bottom left should say **Spark** (free). Leave it on Spark.
2. In the left menu, open **Build → Firestore Database**, then click **Create database**.
3. If you're asked for an edition, pick **Standard edition**. Keep the Database ID as **(default)**. The app uses the default database.
4. **Location:** choose **europe-west2 (London)**. You can't change this later. Nothing in the repos asks for a different region, and London is closest to the users.
5. **Security rules:** choose **Start in production mode**, then **Create**.
6. When the database opens, go to the **Rules** tab. Delete everything there and paste the full contents of `formcoach-app/firestore.rules`. Click **Publish**.
   - Optional, from the CLI instead: in the `formcoach-app` folder run `npx firebase-tools login`, then `npx firebase-tools deploy --only firestore:rules --project fitness-app-5c48a`. `firebase.json` there points at the rules file.
7. Check: in the **Rules** tab, open **Rules Playground** and try a `get` on `/users/abc/history/x`, first unauthenticated, then authenticated with UID `abc`. The first should be **denied** and the second **allowed**.

What the rules allow: a signed-in user can read and write only `users/{their uid}/**`. Writes are limited to the app's known collections. Each document must be `{ updatedAt: server time, json: string under 1 MB, k?: item key }`. Everything else is denied.

Free quota on Spark (per day): 50,000 document reads, 20,000 writes, 20,000 deletes, and 1 GiB stored. One phone uses a few hundred reads and writes a day. If a quota is ever reached on Spark, Firestore stops for the rest of the day. It never bills you. The app keeps working offline and catches up the next day.

---

## B. Neon: the API's Postgres

1. Sign up at https://neon.tech. The **Free** plan needs no card.
2. **Create project**:
   - name: `2setsfitness`
   - Postgres version: the default (16 or 17 both work)
   - region: **AWS Europe (London) – eu-west-2**. If it isn't offered, pick Frankfurt.
3. On the project dashboard, click **Connect**:
   - Turn **Connection pooling** ON. The host then contains `-pooler`.
   - Copy the connection string. It looks like `postgresql://neondb_owner:…@ep-…-pooler.eu-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require`.
   - Keep it somewhere private. It contains the password, and in step C3 it becomes the `DATABASE_URL` secret. Use it exactly as copied: the API handles `sslmode` and `channel_binding` itself (`src/db/config.js`).
4. **Create the tables.** The new database is empty. Use one of these:
   - **Neon SQL Editor** (simplest): in the left menu open **SQL Editor**. Paste the contents of `src/db/schema.sql` and click **Run**. Then paste `src/db/migrate_firebase_auth.sql` and click **Run** again. The second script changes user ids to TEXT so they fit Firebase uids.
   - **Or from this folder** in PowerShell:
     ```powershell
     $env:DATABASE_URL = "<the Neon connection string>"
     npm run db:setup:node
     Remove-Item Env:DATABASE_URL
     ```
     It runs both files and lists the tables it created.
   Both scripts are safe to run again. On every start, `server.js` also adds the later columns and tables (`body_logs`, `user_sync`, …) with `IF NOT EXISTS`.
5. The Railway database left with the trial, so leaderboard and points history starts again from empty. The workout data itself lives on the phones and in the Firestore backup, not in Postgres.

The free plan includes 0.5 GB of storage and a monthly allowance of compute hours. The database suspends after 5 idle minutes, and the first request after that waits about 1 second while it wakes. The API's pool is small (3 connections per instance, `PG_POOL_MAX` to change it) and lets idle connections go.

---

## C. Google Cloud Run: the API

### C1. Project, billing and a £1 budget alert

Cloud Run requires a billing account even when you stay inside the free tier. Google uses the card for anything beyond the free allowance. At this scale that should be nothing (see "Cost" below). The budget alert tells you if that ever changes.

**Use a separate Google Cloud project for the API, not the Firebase one.** Linking billing to `fitness-app-5c48a` would move Firebase from Spark to the pay-as-you-go Blaze plan. A separate project keeps Firebase on Spark. The API only needs the Firebase project id to check sign-in tokens, and that works across projects.

1. Go to https://console.cloud.google.com and use the project picker at the top: **New project**. Name it `2setsfitness-api` and note the **Project ID** it shows, for example `twosetsfitness-api-123456`.
2. Go to **Billing** (≡ menu → Billing). Create a billing account with your card and link it to the new project. If you're offered the free trial credit, it's fine to take it.
3. Go to **Billing → Budgets & alerts → Create budget**:
   - Scope: the `2setsfitness-api` project.
   - Amount: **specified amount, £1**.
   - Alert thresholds: 50%, 90% and 100% of actual spend, with email to billing admins.
   - Click **Finish**.

   A budget only sends alerts. It doesn't stop anything. Settings later in this guide (`--max-instances 2`, minimum instances 0) keep the maximum spend small.

### C2. Install the gcloud CLI and turn on the APIs

1. Install the Google Cloud CLI for Windows from https://cloud.google.com/sdk/docs/install. Then open a new PowerShell window and run:
   ```powershell
   gcloud init                                   # log in, pick the 2setsfitness-api project
   gcloud config set run/region europe-west2
   ```
2. Enable the services. You can do this in the console under **APIs & Services → Library**, or with one command:
   ```powershell
   gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com
   ```
   - **Cloud Run** runs the API.
   - **Artifact Registry** stores the built image.
   - **Cloud Build** builds the image from this folder. `--source` needs it.
   - **Secret Manager** holds the keys.

### C3. Secrets

Open **Security → Secret Manager → Create secret** in the console. For each secret below, enter the name and paste the value. Paste it with no trailing space or newline. The console is safer than piping values in PowerShell, which adds a newline.

| Secret name | Value |
|---|---|
| `ANTHROPIC_API_KEY` | the Anthropic key |
| `DATABASE_URL` | the Neon pooled connection string from B3 |
| `JWT_SECRET` | any long random string, for example from https://www.random.org/strings or `openssl rand -hex 32` |

Then let Cloud Run read the secrets. Go to **IAM & Admin → IAM** and find the principal `<PROJECT_NUMBER>-compute@developer.gserviceaccount.com`. That's the "Default compute service account", and the project number is on the console home page. Click the pencil, then **Add another role**, choose **Secret Manager Secret Accessor**, and click **Save**. Or run:
```powershell
gcloud projects add-iam-policy-binding <PROJECT_ID> --member="serviceAccount:<PROJECT_NUMBER>-compute@developer.gserviceaccount.com" --role="roles/secretmanager.secretAccessor"
```

### C4. Every environment variable the server reads

| Variable | Needed? | How to set it on Cloud Run |
|---|---|---|
| `ANTHROPIC_API_KEY` | **required** (all `/ai/*` routes) | secret |
| `DATABASE_URL` | **required** | secret |
| `FIREBASE_PROJECT_ID` | **required** on Cloud Run: `fitness-app-5c48a` (used to check the app's Firebase sign-in tokens) | plain env var |
| `JWT_SECRET` | signs the one-click unsubscribe links in emails (`src/lib/mailer.js`); keep it set and don't change it, or links already sent stop working | secret |
| `PORT` | set by Cloud Run (8080). Don't set it yourself. | automatic |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | optional, instead of `FIREBASE_PROJECT_ID`: a service-account key's JSON (raw or base64). Not needed, because Cloud Run's own identity plus the project id is enough. | secret |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | local development only: path to the key file (default `./firebase-service-account.json`). Never put the key file in the image (`.dockerignore` and `.gcloudignore` exclude it). | — |
| `RESEND_API_KEY` | optional: welcome emails. When unset, no email is sent. | secret |
| `PG_POOL_MAX` | optional, default 3 | env var |
| `AI_DAILY_LIMIT` | optional, default 150: AI calls one user can make in 24 hours, all `/ai/*` routes together (`src/lib/aiQuota.js`). Past it they get a 429 until older calls drop out of the 24 hours. | env var |
| `AI_SCAN_DAILY_LIMIT` | optional, default 30: meal photo scans one user can make in 24 hours (they cost the most). | env var |
| `AI_MODEL` | optional, default `claude-haiku-5-5`: the Claude model every `/ai/*` route uses (`src/lib/aiModel.js`). | env var |
| `AI_CHAT_MODEL` | optional, defaults to `AI_MODEL`: the model for the coach chat (`/ai/advice`) only, e.g. `claude-sonnet-5-5` for sharper answers at about 20x the cost per reply. | env var |
| `TRUST_PROXY` | optional. It's turned on automatically on Cloud Run (`K_SERVICE` is set there) so rate limits count real client IPs. | — |

`EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER` and `EMAIL_PASS` in `.env.example` aren't read by the code.

### C5. Deploy

From this folder (`C:\Users\Mohammed\Desktop\2setsfitness-api`), run this as one line in PowerShell:
```powershell
gcloud run deploy twosetsfitness-api --source . --region europe-west2 --allow-unauthenticated --min-instances 0 --max-instances 2 --cpu 1 --memory 512Mi --timeout 120 --set-env-vars "FIREBASE_PROJECT_ID=fitness-app-5c48a" --set-secrets "ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest,DATABASE_URL=DATABASE_URL:latest,JWT_SECRET=JWT_SECRET:latest"
```
- If it asks to create an Artifact Registry repository `cloud-run-source-deploy`, answer **Y**.
- Here's what the deploy does:
  - It uploads this folder, minus everything in `.gcloudignore` (no `.env`, no service-account key, no `node_modules`).
  - Cloud Build builds the `Dockerfile`: a slim Node LTS image running `npm ci --omit=dev` as a non-root user.
  - Cloud Run starts it on `$PORT`.
- `--allow-unauthenticated` is right here. Every data route checks the app's Firebase ID token itself (`src/middleware/auth.js`). Cloud Run's own IAM sign-in is for Google accounts, which the app doesn't use.
- `--min-instances 0` means no cost while idle. The first request after a quiet spell takes about 1–3 s longer. `--max-instances 2` caps the spend.
- If the build fails with a permissions error on the compute service account, give that same account the **Cloud Run Builder** role (`roles/run.builder`) in IAM and run the deploy again.

At the end it prints **Service URL: https://twosetsfitness-api-…-nw.a.run.app**. Check it:
```powershell
curl.exe https://<service-url>/health
# {"status":"ok","db":"connected"}
```
If `db` says `"error"`, the `DATABASE_URL` secret is wrong, has a trailing newline, or the Neon tables weren't created (B4).

To redeploy after a code change, run the same command again. The secrets and env vars stay set.

**Keep the image storage free:** the free allowance is 0.5 GB, and each deploy adds an image. Go to **Artifact Registry → cloud-run-source-deploy → Edit repository → Cleanup policies** and add a **Keep most recent versions** policy with count **2**, plus a **Delete** policy for anything older than 7 days. Then click **Save**.

---

## D. Point the app at Cloud Run

1. In `formcoach-app`, open `src/config.js` and replace the old Railway URL in `API_BASE_URL` with the Service URL. Use no trailing slash.
2. Rebuild the app (`npx expo run:android`, or your release build). A native rebuild is needed anyway, because the Firestore backup adds `@react-native-firebase/firestore`.
3. Check:
   - **AI:** ask the Coach something.
   - **Leaderboard/points:** open the leaderboard.
   - **Backup:** Settings → Data & Privacy should show "Last backed up …" a few seconds after a change. In the Firebase console under **Firestore → Data**, you'll see `users/<your uid>/…`.

The first time each phone runs the new version, it uploads all of its local data to Firestore once. After that it only uploads what changed.

---

## Cost at this scale, and how to stay at £0

Assume a handful of users, a few hundred API requests a day, and a few dozen AI calls.

| Service | Free allowance | Expected use | Expected cost |
|---|---|---|---|
| Cloud Run (request-based billing) | 2M requests, 180,000 vCPU-s and 360,000 GiB-s per month | < 20,000 requests, < 20,000 vCPU-s | **£0** |
| Cloud Build | 2,500 build-minutes per month | about 2–3 min per deploy | **£0** |
| Artifact Registry | 0.5 GB | about 2 images with the cleanup policy | **£0** |
| Secret Manager | 6 active secret versions, 10,000 accesses per month | 3 secrets, read at instance start | **£0** |
| Network egress | — | small JSON replies, megabytes per month | pennies at most, usually rounds to **£0** |
| Neon Free | 0.5 GB, monthly compute allowance, no card | tiny | **£0** |
| Firestore on Spark | 50k reads and 20k writes per day, 1 GiB | hundreds per day | **£0**, and Spark can't bill |
| **Total** | | | **£0 a month expected; the £1 budget alert covers surprises** |

The Anthropic API is billed separately by Anthropic, per token, the same as before. It isn't part of the Google bill.

Rules for staying at £0:
- Keep `--min-instances 0`. An always-on instance costs money.
- Keep `--max-instances` low (2).
- Keep the Artifact Registry cleanup policy.
- Leave the Firebase project on Spark: don't link billing to `fitness-app-5c48a`.
- Don't enable anything else in the API's project.
- If the £1 alert ever fires, check **Billing → Reports** grouped by service.

---

## Notes

- **`/sync` routes:** the app no longer calls them, because its backup goes straight to Firestore. They're kept because they're harmless and still work for any older app build. The `user_sync` table and its code stay in place, and `npm test` still covers them. They can be removed once no phone runs a build from before the Firestore backup.
- **Local development is unchanged:**
  - a `.env` with `DATABASE_URL`, or none for local Postgres over the Unix socket;
  - `./firebase-service-account.json`, or `FIREBASE_SERVICE_ACCOUNT_PATH`;
  - `npm run dev`.
- `npm test` needs no database, Firebase or secrets.
