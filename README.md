# Barangay League Manager

Barangay League Manager is an offline-first local tournament management application for basketball, volleyball, and pickleball. It covers tournament setup, teams and participants, schedules, live scoring, clocks, result approval, standings, brackets, and public venue views.

This repository is a sanitized public developer edition. It contains source code, schema, synthetic demo seeding, tests, and dependency manifests only. Production databases, runtime backups, deployment keys, operational QA evidence, private screenshots, and internal infrastructure details are intentionally excluded.

## Features

- Tournament formats including round robin, groups plus playoffs, and single elimination where supported.
- Team, player, participant, and competition-entry management.
- Basketball clocks, volleyball set state, and pickleball match state with versioned actions.
- Scorer workflows with pending final-result approval and separate unofficial live scores.
- Public schedules, live scores, results, standings, and brackets.
- Role-based authentication for super admins, admins, and scorers.
- SQLite persistence with integrity checks and audit logging.
- React scorer and public views designed for phones, tablets, and venue displays.

## Architecture

- `frontend/` — React 18 application built with Vite.
- `backend/` — Express API, SQLite persistence, authentication, scoring services, and tests.
- `backend/db/schema.sql` — database schema and indexes.
- `backend/db/seed.js` — synthetic demo data generator; it never imports production data.

The application is designed for a trusted local network. It currently serves HTTP and does not provide TLS or internet-facing deployment configuration. Do not expose an authenticated instance to an untrusted network.

## Requirements

- Node.js 20.19+ or 22.12+ (or a newer supported LTS release).
- npm.
- A modern browser for the frontend.

## Getting started

From the repository root:

```bash
npm install --prefix backend
npm install --prefix frontend
node backend/scripts/ensure-config.js
node backend/db/seed.js
npm run build --prefix frontend
npm start --prefix backend
```

Open `http://localhost:3100`. The first database initialization creates a temporary super-admin account and prints its credentials once. Change that password immediately. The demo seed creates synthetic scorer accounts and prints a temporary demo password; do not reuse it outside the local demo.

For a blank database, omit the seed step. The backend creates the SQLite database next to the backend source by default. To place it elsewhere for local testing, set `BLM_DATABASE_PATH` to a disposable path outside the repository.

On Windows PowerShell, copy `backend/.env.example` to `backend/.env` if you want to set a port manually, then run the same Node/npm commands. `ensure-config.js` generates a unique session secret when `JWT_SECRET` is empty or too short.

## Development

Run the frontend development server and backend separately when working on the UI:

```bash
npm run dev --prefix frontend
npm start --prefix backend
```

The Vite development server proxies `/api` requests to the backend at `http://localhost:3100`. Use the built frontend served by the backend when checking the integrated local flow.

## Verification

The focused checks can be run independently:

```bash
npm test --prefix backend
npm test --prefix frontend
npm run build --prefix frontend
```

The root verification command runs the backend tests, frontend build, and dependency audits:

```bash
npm run verify
```

The current locked dependency set may report upstream `npm audit` advisories. Review and upgrade those dependencies before any production or internet-facing use; this developer edition does not claim production deployment readiness.

## Data and privacy

Never commit `.env` files, SQLite databases or sidecar files, backups, logs, uploads, credentials, signing keys, or exported operational records. The checked-in seed data is synthetic and exists only to demonstrate the application locally. Replace it with newly generated demo data if you add screenshots or examples.

The public export does not include production release packages, trust-anchor files, Windows QA packages, or screenshots. Those artifacts remain outside this repository by design.

## Project status

This is a source-code showcase and developer edition extracted from a local-first tournament system. It is not a production deployment package and does not claim internet hosting, resident-record integration, payments, or cloud operations.

## License

This project's original source code is licensed under the MIT License. See LICENSE for details.
