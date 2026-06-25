# SpeakFit AI MVP

SpeakFit AI is a mobile-first English speaking coach for Korean learners. The first demo focuses on a working flow:

1. Start a speaking level test.
2. Hear an AI coach question.
3. Answer with the microphone or demo text.
4. End the test and receive a CEFR-style speaking report.
5. Sign up or log in before accessing learning data.
6. Complete today's 5-minute mission.
7. Update XP, streak, and weekly score.

The app uses the provided character images as the coach and learner visual system.

## Tech Stack

- Frontend: HTML, CSS, browser JavaScript
- Voice demo: Web Speech API speech recognition and speech synthesis
- Backend: Node.js built-in HTTP server
- Persistence: local JSON data store at `data/db.json`, or PostgreSQL on Railway when `DATABASE_URL` is set
- Auth: email/password, scrypt password hashing, HttpOnly session cookie, login access logs
- Future DB contract: Prisma schema at `prisma/schema.prisma`
- AI integration point: `POST /api/realtime/session`

This MVP intentionally has no external runtime dependencies, so it can run immediately in a restricted local environment.

## Setup

```powershell
node server.js
```

Then open:

```text
http://localhost:4173
```

If you prefer package scripts on Windows PowerShell, use:

```powershell
npm.cmd run dev
```

## Environment Variables

Copy `.env.example` to `.env` and fill the values you need.

```text
PORT=4173
OPENAI_API_KEY=
OPENAI_REALTIME_MODEL=gpt-realtime
OPENAI_ASSESSMENT_MODEL=gpt-4.1-mini
DATABASE_URL=
COOKIE_SECURE=false
```

The client never receives `OPENAI_API_KEY`. The browser asks the local backend for a realtime session.

For Railway production, set `COOKIE_SECURE=true` and use Railway PostgreSQL's `DATABASE_URL`.

## OpenAI Realtime Usage

`POST /api/realtime/session` works in two modes:

- Without `OPENAI_API_KEY`: returns demo mode and the browser uses local speech recognition/synthesis.
- With `OPENAI_API_KEY`: the server attempts to create an OpenAI Realtime session and returns the session payload to the client.

The production version should connect the returned ephemeral client secret to a WebRTC or WebSocket realtime client and stream microphone audio directly from the browser.

## Main Folders

```text
public/
  index.html
  styles.css
  app.js
  assets/
    child-character.png
    coach-character.png
server.js
data/
  db.json
prisma/
  schema.prisma
docs/
  ROADMAP.md
```

## API Endpoints

```text
GET  /api/health
GET  /api/auth/me
POST /api/auth/signup
POST /api/auth/login
POST /api/auth/logout
GET  /api/scenarios
POST /api/realtime/session
POST /api/assessment
POST /api/learning-plan
GET  /api/daily-mission/today
POST /api/daily-mission/complete
GET  /api/streak
POST /api/streak/update
GET  /api/weekly-score
POST /api/weekly-score/update
```

## Data and DB Migration

The working MVP stores data in `data/db.json` locally so it can run with minimal setup.

When `DATABASE_URL` is set, the server creates and uses this PostgreSQL table automatically:

```sql
create table if not exists app_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
```

This keeps the deployable MVP simple while preserving users, auth sessions, access logs, missions, transcripts, reports, streaks, and weekly scores in Railway PostgreSQL.

For a Prisma-backed version:

1. Add Prisma dependencies.
2. Set `DATABASE_URL="file:./dev.db"` in `.env`.
3. Run a migration based on `prisma/schema.prisma`.
4. Replace the JSON helper functions in `server.js` with Prisma client calls.

## Railway Deployment

See `docs/RAILWAY_DEPLOYMENT.md`.

## Roadmap

See `docs/ROADMAP.md`.
