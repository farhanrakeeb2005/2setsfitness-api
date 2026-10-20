# 2SetsFitness API

Backend REST API for **2SetsFitness** — a workout tracking app with AI-powered coaching, form scoring, nutrition logging, and a weekly leaderboard. Built with Node.js, Express, and PostgreSQL, with Claude (Anthropic) powering the AI features.

## Features

- 🔐 **Auth** — email/password, Google OAuth (both implicit and PKCE code flow), and phone OTP verification
- 🤖 **AI Coaching** — powered by Claude Haiku: live set-by-set coaching tips, AI-generated workout plans, weekly progress summaries, plateau detection, sport-specific training plans, and meal photo nutrition scanning (vision)
- 🏋️ **Workout Tracking** — routines, workout history, personal records, form scores
- 📊 **Progress Tracking** — body weight logs, recovery scores, nutrition logs, water intake, weekly schedule
- 🏆 **Gamification** — points system and weekly leaderboard
- 🛡️ **Security** — Helmet, CORS, rate limiting on AI endpoints, bcrypt password hashing, JWT auth

## Tech Stack

| Layer          | Technology                        |
|----------------|------------------------------------|
| Runtime        | Node.js + Express 5                |
| Database       | PostgreSQL (`pg`)                  |
| Auth           | JWT (`jsonwebtoken`) + `bcrypt`    |
| AI             | Anthropic SDK (Claude Haiku)       |
| Email          | Nodemailer / Resend                |
| SMS (OTP)      | Twilio                             |
| Security       | Helmet, CORS, express-rate-limit   |

## API Overview

All routes except `/auth/*` and `/health` require a `Authorization: Bearer <token>` header.

### Auth — `/auth`
| Method | Route              | Description                                    |
|--------|---------------------|------------------------------------------------|
| POST   | `/register`          | Create an account, returns a JWT               |
| POST   | `/login`              | Email/password login, returns a JWT            |
| POST   | `/google`             | Sign in with a Google access token             |
| POST   | `/google-code`        | Sign in via Google PKCE authorization code     |
| POST   | `/send-otp`           | Send a phone verification code (SMS)           |
| POST   | `/verify-otp`         | Verify the phone OTP code                      |

### AI Coaching — `/ai` (rate limited: 20 req/min)
| Method | Route              | Description                                          |
|--------|---------------------|-------------------------------------------------------|
| POST   | `/coach`              | Real-time coaching tip for the athlete's next set     |
| POST   | `/plan`                | Generate a full weekly workout programme (JSON)       |
| POST   | `/summary`             | Written summary of the athlete's last 7 days          |
| POST   | `/advice`              | Free-form fitness Q&A with athlete context             |
| POST   | `/plateau`             | Detect a training plateau and suggest a fix            |
| POST   | `/sports-workout`      | Generate a sport-specific training session             |
| POST   | `/meal-scan`           | Estimate nutrition from a meal photo (Claude vision)   |

### Data Resources
| Resource            | Base Route            | Methods              |
|----------------------|------------------------|------------------------|
| Profile               | `/profile`               | GET, PUT                |
| Routines               | `/routines`               | GET, POST, PUT `/:id`, DELETE `/:id` |
| Workout History         | `/history`                | GET, POST, DELETE `/:id` |
| Leaderboard             | `/leaderboard`            | GET, POST `/submit`      |
| Points                  | `/points`                 | GET, GET `/leaderboard`  |
| Personal Records         | `/personal-records`        | GET, PUT                |
| Form Scores              | `/form-scores`             | GET, POST                |
| Body Weight              | `/body`                    | GET, POST                |
| Recovery                 | `/recovery`                 | GET, POST                |
| Nutrition                 | `/nutrition`                | GET, POST                |
| Sports                    | `/sports`                    | GET, POST                |
| Water Intake                | `/water`                     | GET, PUT                |
| Weekly Schedule              | `/schedule`                   | GET, PUT                |
| Cloud Backup (app data)      | `/sync`                       | GET `?since=<ms>`, PUT, DELETE |

(The app now backs up to Firestore directly and no longer calls `/sync`; the routes stay for older builds.) `/sync` keeps one JSON document per user and collection (routines, history, logs, schedule, profile, fighter… — see `src/lib/syncMerge.js`). A PUT is merged into the stored copy with the app's own rules (union by id, newer copy wins, deletions only by tombstone), so a phone with less data can't wipe the backup. Bodies up to 5 MB, 3 MB per collection, 60 requests/min per user. `npm test` runs its tests against an in-memory database (no secrets needed).

### Health Check
`GET /health` — returns API and database connection status.

## Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL database

### Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy the example env file and fill in your own values
cp .env.example .env

# 3. Create the database schema
npm run db:setup

# 4. Start the server
npm start        # production
npm run dev       # development (auto-restart via nodemon)
```

### Environment Variables

See [`.env.example`](.env.example) for the full list. Required:

| Variable         | Description                                  |
|-------------------|-----------------------------------------------|
| `DATABASE_URL`     | PostgreSQL connection string                  |
| `JWT_SECRET`        | Long random secret for signing JWTs           |
| `ANTHROPIC_API_KEY`  | Claude API key, for all `/ai/*` endpoints     |

Optional (only needed if you use these features): `TWILIO_*` (phone OTP), `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` (Google sign-in), `EMAIL_*` or `RESEND_API_KEY` (welcome emails).

## Project Structure

```
├── server.js              # Entry point — runs startup migrations, then starts Express
├── src/
│   ├── app.js               # Express app: middleware + route mounting
│   ├── db/
│   │   ├── index.js           # PostgreSQL connection pool
│   │   └── schema.sql          # Full database schema
│   ├── middleware/
│   │   ├── auth.js             # JWT verification middleware
│   │   └── validate.js         # Request validation
│   └── routes/                # One file per resource (see API Overview above)
```

## Deployment

Runs on **Google Cloud Run** (the `Dockerfile` here, `gcloud run deploy --source .`) with Postgres on **Neon**; the app's cloud backup lives in Firestore, not here. Step-by-step setup, every environment variable and the expected cost: **[DEPLOY.md](DEPLOY.md)**. `server.js` runs idempotent startup migrations (`ALTER TABLE ... ADD COLUMN IF NOT EXISTS`) on boot, so schema changes ship safely with each deploy; a new empty database is set up once with `npm run db:setup:node` (or the two SQL files in Neon's SQL editor).

## License

ISC
