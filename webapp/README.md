# Sentinel Console

An enterprise web application for registering applications and governing their
repository secret scans — the operational front end for the gitleaks scanner in
this repository.

Applications are registered with their **head of department**, **SPOC** and **git
repository**, and each one can be scanned on **as many branches as it has** —
every branch keeps its own scan history, findings and counters.

**Stack:** React 18 + Material UI 6 (light glassmorphic theme) · Node.js 22 + Express ·
MongoDB (Mongoose) · Redis (BullMQ queues) · LDAP/AD · SMTP · RFC 5424 syslog auditing.

```
webapp/
├── server/            Express API, workers, models, services
│   ├── src/
│   │   ├── config/    env, structured logger, syslog client
│   │   ├── models/    User, Application (+branches), Scan, Finding, AuditLog, tokens, settings
│   │   ├── services/  ldap, mail, audit, tokens, scanner engine, scan orchestration
│   │   ├── queues/    Redis connection + BullMQ queues
│   │   ├── workers/   scan, email, maintenance workers
│   │   ├── routes/    /api/v1 surface
│   │   └── scripts/   seed, project→application migration
│   └── tests/         vitest unit + HTTP + API integration suites
├── web/               React single-page console (Vite)
├── docs/              architecture and operations runbook
└── docker-compose.yml mongo · redis · api · worker · web
```

## Quick start (local)

```bash
# 1. dependencies
cd webapp/server && npm install
cd ../web && npm install

# 2. configuration
cd ../server && cp .env.example .env      # then set the two JWT secrets

# 3. infrastructure (any MongoDB 6+/Redis 7 will do)
docker run -d -p 27017:27017 --name sentinel-mongo mongo:7
docker run -d -p 6379:6379   --name sentinel-redis redis:7-alpine

# 4. demo data — creates admin/analyst/developer/auditor plus projects and scans
npm run seed

# 5. run it (three terminals)
npm start          # API      → http://localhost:4000
npm run worker     # queue workers
cd ../web && npm run dev    # console → http://localhost:5173
```

Sign in with `admin` and the password the seed script prints. Every seeded account
must change its password at first sign-in.

## Quick start (containers)

```bash
cd webapp
cp server/.env.example server/.env    # set the JWT secrets first
docker compose up --build             # console on http://localhost:8080
docker compose exec api npm run seed
```

## What it does

| Area | Capability |
|---|---|
| **Sign-in** | local password **or** corporate LDAP/AD, optional TOTP MFA with recovery codes, lockout, password history and reset-by-email |
| **Access** | four roles — administrator, security analyst, developer, viewer — enforced on every route; LDAP groups map to roles |
| **Applications** | register with key, inventory id, business unit, criticality, the HOD (name and email), the SPOC with full contact details (plus an optional backup SPOC), and the git repository (provider, visibility, credential reference) |
| **Branches** | register any number of branches per application, each with its own environment, nightly schedule, scan history and finding counters; add, pause, re-default or stop tracking at any time |
| **Scans** | run per branch — one branch, several selected branches, or every branch at once — queued through Redis and executed by workers (`mock`/`native`/`docker` gitleaks drivers), with live status, logs, cancel and retry |
| **Findings** | severity-classified, fingerprinted, **redacted** secrets, attributed to an application *and* a branch; triage workflow, bulk actions and CSV export |
| **Notifications** | SMTP through a queued worker: welcome, password reset/changed, scan completed/failed (naming the branch), critical finding, security alerts — addressed to the SPOC with the HOD copied |
| **Auditing** | every mutating action persisted to MongoDB **and** mirrored to syslog (RFC 5424/3164, UDP/TCP) with structured data, TTL retention and evidence export |
| **Operations** | liveness/readiness probes, dependency health, queue depths, rate limiting, correlation ids on every request and log line |

## Configuration

`server/.env.example` documents every variable. The defaults run the whole
platform with no external dependencies beyond MongoDB and Redis:
`SCAN_DRIVER=mock` produces deterministic synthetic findings, `SMTP_ENABLED=false`
renders and logs mail instead of sending it, and `LDAP_ENABLED=false` hides the
directory option on the sign-in screen.

To go live, point the app at real infrastructure:

```bash
LDAP_ENABLED=true   LDAP_URL=ldaps://dc01.corp.local:636   LDAP_ROLE_MAPPINGS=CN=SecOps,…:admin
SMTP_ENABLED=true   SMTP_HOST=smtp.corp.local
SYSLOG_ENABLED=true SYSLOG_HOST=siem.corp.local SYSLOG_PROTOCOL=tcp
SCAN_DRIVER=docker
```

## Tests

```bash
cd webapp/server && npm test
```

### Upgrading an existing install

Installations created before applications replaced projects can migrate in place:

```bash
cd webapp/server
npm run migrate:applications -- --dry-run   # report what would change
npm run migrate:applications                # move projects → applications
```

The maintainer becomes the SPOC (and provisionally the HOD — correct it in the
console), the repository fields fold into the repository block, the default
branch is registered, and scans and findings are repointed and back-filled with
their branch.

The unit and HTTP suites run anywhere. The API integration suite needs a real
MongoDB: set `MONGO_TEST_URI=mongodb://127.0.0.1:27017/sentinel-test` (or let
`mongodb-memory-server` download a binary). Without one it skips itself rather
than failing.

## Design notes

The console is deliberately light-themed. Frosted panels
(`backdrop-filter: blur(20px) saturate(160%)` over translucent white) sit on a
fixed multi-stop colour wash, which is what makes the glass read as glass.

Chart colours are not decorative: the two-series trend uses a blue/red pair
validated for colour-vision-deficient separation on this surface, and severity
uses a reserved status palette that is **always** paired with its text label, so
colour never carries meaning on its own.

Further reading: [`docs/architecture.md`](docs/architecture.md) ·
[`docs/operations.md`](docs/operations.md)
