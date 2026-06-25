# GitHub + Railway Deployment Guide

## Information You Need

- GitHub account or organization name
- Repository name, for example `speakfit-ai`
- Repository visibility: public or private
- Railway account
- OpenAI API key
- Production app URL after Railway deploy
- Optional custom domain

## GitHub Steps

```powershell
git init
git add .
git commit -m "Initial SpeakFit AI MVP with auth"
git branch -M main
git remote add origin https://github.com/YOUR_ACCOUNT/speakfit-ai.git
git push -u origin main
```

Do not commit `.env`, `data/db.json`, or `node_modules`.

## Railway Steps

1. Create a new Railway project.
2. Choose **Deploy from GitHub repo**.
3. Select the `speakfit-ai` repository.
4. Add a Railway PostgreSQL service in the same project.
5. In the web service variables, add:

```text
PORT=4173
OPENAI_API_KEY=your_openai_key
OPENAI_REALTIME_MODEL=gpt-realtime
OPENAI_ASSESSMENT_MODEL=gpt-4.1-mini
DATABASE_URL=${{Postgres.DATABASE_URL}}
COOKIE_SECURE=true
```

Railway usually injects `PORT`; if Railway provides its own `PORT`, let Railway's value win.

## Build and Start

Railway reads `package.json`.

```text
Build: npm install
Start: npm start
```

The included `railway.json` sets the start command to `npm start`.

## Database

The app automatically creates this table when `DATABASE_URL` exists:

```sql
create table if not exists app_state (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
```

The MVP stores the full app state in `app_state.data`, including:

- users
- auth sessions
- access logs
- conversation sessions
- speaking assessments
- learning plans
- daily missions
- streaks
- weekly scores
- achievement badges

`prisma/schema.prisma` documents the normalized schema for the next production step.

## Access Control Included

- Signup
- Login
- Logout
- HttpOnly session cookie
- Password hashing with Node `scrypt`
- Login failure count
- Account lock for 15 minutes after 5 failed attempts
- Access logs with event, IP, user agent, and timestamp
- Protected learning APIs

## Post-Deploy Checks

Open these URLs after deployment:

```text
https://YOUR_APP.up.railway.app/api/health
https://YOUR_APP.up.railway.app/
```

`/api/health` should return:

```json
{
  "ok": true,
  "mode": "openai-ready",
  "store": "postgres"
}
```

If `mode` is `demo`, check `OPENAI_API_KEY`.
If `store` is `json-file`, check `DATABASE_URL`.
