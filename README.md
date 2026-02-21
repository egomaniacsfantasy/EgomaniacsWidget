# Egomaniacs "What Are the Odds?" MVP

This version uses the OpenAI API through a local backend server.

## 1) One-time setup

1. Open Terminal.
2. Go to your folder:
   `cd "~/Desktop/EgomaniacsWidget"`
3. Install dependencies:
   `npm install`
4. Create your env file:
   `cp .env.example .env`
5. Open `.env` and paste your real OpenAI API key.

## 2) Run

1. In Terminal:
   `npm start`
2. Open this URL in your browser:
   `http://localhost:3000`

## 2.5) Phase 2 calibration

Build/rebuild the Phase 2 calibration artifact:
`npm run phase2:rebuild`

Run golden regression checks:
`npm run test:regression`

Run expanded golden suite:
`npm run test:golden`

Optional strict startup gate:
`STRICT_BOOT_SELFTEST=true npm start`

Architecture + rollout blueprint:
`docs/ARCHITECTURE.md`

Phase 2 API endpoints:
- `GET /api/phase2/status`
- `POST /api/phase2/reload`
- `GET /api/metrics`
- `GET /api/version`
- `POST /api/player/outcomes` body: `{"player":"Joe Burrow"}`
- `POST /api/player/performance-threshold` body:
  `{"player":"Joe Burrow","metric":"passing_tds","threshold":40}`

Version handshake:
- Frontend sends `x-ewa-client-version` on `/api/odds`.
- If frontend and backend are out of sync, API returns `409 outdated_client`.
- Hard refresh browser (`Cmd+Shift+R`) after backend updates.

## 3) If you see errors

- `npm: command not found`: install Node.js from https://nodejs.org then retry.
- `Missing OPENAI_API_KEY in .env`: your key is missing or not saved.
- If port 3000 is busy, set `PORT=3001` in `.env` and rerun.

## Important

Do not put your API key in `app.js` or `index.html`. Keep it in `.env` only.
