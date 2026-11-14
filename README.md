# SKYZEN-by-CX797

Cathay Hackathon 2026 — consent-first in-flight wellness prototype.

## Run locally

Requires **Node.js 22 or later**. No third-party packages, installation or build step is needed.

```sh
export DATA_ENCRYPTION_KEY="$(node -p "require('node:crypto').randomBytes(32).toString('hex')")"
export CREW_TOKEN="$(node -p "require('node:crypto').randomBytes(32).toString('hex')")"
npm start
```

Open <http://localhost:3000/> for passengers and <http://localhost:3000/crew.html> for crew. Retrieve the locally generated crew credential from your shell (`printf '%s\n' "$CREW_TOKEN"`) and enter it in the crew sign-in form. Never share it with passengers or commit it. For a demo, both dashboards can be opened in separate tabs; passenger and crew sessions are independent.

Keep the encryption key securely outside the repository if you want to reopen existing records. Generating a new key **does not** decrypt old records; startup fails rather than overwriting them. Use an empty `DATA_DIR` for disposable demos. The default directory is `data/`, ignored by Git.

Optional environment variables:

| Variable | Default / purpose |
| --- | --- |
| `PORT` | `3000` |
| `DATA_DIR` | Repository `data/` directory; encrypted local persistence |
| `PUBLIC_ORIGIN` | `http://localhost:<PORT>`; exact browser origin permitted for writes |
| `COOKIE_SECURE` | Set to `true` behind HTTPS |
| `NODE_ENV` | Setting `production` requires secure cookies and an HTTPS `PUBLIC_ORIGIN` |

The server listens only on `127.0.0.1`. Before network deployment, use an HTTPS reverse proxy, configure its exact `PUBLIC_ORIGIN`, and set `COOKIE_SECURE=true`. At-rest encryption does **not** encrypt HTTP traffic. Local HTTP is only for development with synthetic data.

## Demo workflow

1. Read and explicitly accept the passenger consent notice to enable personal-data entry. Enter a seat, flight number, departure and arrival in **UTC**, meal preference, allergy notes, early/late rest preference and optional herbal/caffeine preferences, then submit.
2. Enter current heart rate, oxygen saturation, self-reported hydration (0–100) and stress (1–5). The backend validates input and recomputes the plan immediately.
3. Sign into the crew dashboard. Both dashboards poll every ten seconds, including flight phase changes and freshness warnings. Readings older than 30 minutes are marked provisional.
4. Choose a passenger and a current/upcoming meal in the galley form. Enter approved temperature and duration and confirm ingredient/heating checks. Heating is scheduled to finish at the meal time (or as soon as possible for a due meal). Overlapping jobs on the same oven and duplicate meal jobs are rejected.
5. Cancel a simulated job on a crew card, or withdraw passenger consent to delete the entire passenger record and associated jobs. Sessions are browser cookies; there is no passenger account recovery in this prototype.

## Structure

```text
frontend/
  passenger.html   Passenger dashboard and consent form
  crew.html        Authenticated crew dashboard and simulated galley controls
  passenger.js     Passenger API integration
  crew.js          Crew API integration
  common.js        Safe DOM rendering and shared API helpers
  styles.css       Shared responsive dashboard styling
backend/
  server.js        HTTP API, authentication, consent and galley scheduling
  store.js         AES-256-GCM encrypted local storage
  wellness.js      Validation and deterministic flight-aware wellness engine
  *.test.js        Node built-in tests
```

## Recommendation rules

- Flight phases: pre-flight, in-flight, arrival preparation (last 45 minutes), arrived. Flight times are manually entered, not linked to airline operations or delay feeds.
- Balanced or vegetarian meal suggestions start 60 minutes after departure (20 minutes on flights of two hours or less), then every four hours, stopping 45 minutes before arrival. Meal slots inside the chosen sleep block are omitted. Very short flights may have no meal window. Meals are suggestions, not orders against real catering inventory.
- Hydration guidance and meal portion/less-salty-option notes respond to self-reported hydration and stress, subject to any prescribed diet. Optional caffeine-free, TCM-inspired ginger infusion requires opt-in, fresh readings, no reported allergies and no concerning-reading warning. Plain warm water is offered otherwise. No therapeutic claims are made.
- Flights of at least four hours get a suggested rest block: early rest starts two hours after departure and lasts at most six hours; late rest uses up to four hours near arrival. All rest ends at least 90 minutes before arrival. Shorter flights get brief-rest guidance instead.
- Caffeine cutoff is six hours before suggested sleep, or six hours before arrival when no sleep block fits. If that cutoff precedes departure, no onboard caffeine window is suggested. Reported caffeine sensitivity, high stress or any plan warning overrides an otherwise available window.
- Heart rate below 45 or above 120 bpm, or oxygen saturation below 92%, produces a recheck/contact-crew notice, **not** a diagnosis or emergency alert. These are illustrative, unvalidated prototype thresholds, not clinical rules.
- Galley jobs are **simulations only**. Demo limits (60–220°C, 1–45 minutes) are not food-safe cooking prescriptions. Crew must use approved catering/equipment instructions. No physical machine command, aircraft interface or wearable integration exists.

## Privacy and security boundaries

- Versioned explicit consent is required before profile storage; biomarker submission additionally requires the passenger's own authenticated session.
- Entire passenger records, consent receipts and simulated jobs are encrypted with AES-256-GCM, random nonces and authentication tags. The file is owner-readable/writable only. The key is supplied separately; decryption/tamper errors stop startup.
- Storage mutations persist an encrypted candidate snapshot before replacing live state. Failed writes do not silently accept readings or make failed consent deletion impossible to retry.
- Random session credentials are held in HttpOnly, SameSite=Strict cookies. Passenger credentials are stored only as hashes inside encrypted records. Crew sessions expire after eight hours and are lost on server restart. Write requests reject mismatched browser origins. Credentials are not embedded in frontend code or browser storage.
- Passenger access is limited to that session's record. The shared crew credential grants access to **all records in this demo instance**; it is not production identity verification or per-flight authorisation. Initial passenger seat identity is self-asserted, not verified against a manifest.
- Consent withdrawal deletes the current record and jobs; records otherwise expire 24 hours after arrival, checked each minute, on API requests and at startup. The server must run to perform deletion. This is logical deletion, not secure erasure of historical filesystem snapshots/backups or data already viewed by crew.
- No raw biomarker request logging, analytics or external data services are used. Live views can lag by up to a polling interval; do not treat them as monitoring systems.
- This single-process, local-file prototype is not a production medical or aviation system. Before real passenger use it needs qualified clinical review, regulatory/privacy assessment, verified passenger/crew identity, scoped crew access, operational safety validation, managed key rotation, backup/erasure policies and approved equipment integrations. Use synthetic data only.

## Test

```sh
npm test
```

Uses Node's built-in test runner; covers validation, personalised flight timing, warning rules, consent, role separation, encrypted persistence/tamper rejection, retention, withdrawal and simulated galley conflict checks. No separate lint/build tooling is configured.
