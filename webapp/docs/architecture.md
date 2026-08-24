# Sentinel Console — architecture

## Component map

```
                    ┌──────────────────────────────┐
  Browser  ───────► │  web (nginx)                 │  React 18 + MUI 6, light glass theme
                    │  serves /  and proxies /api  │
                    └───────────────┬──────────────┘
                                    │ same-origin /api/v1
                    ┌───────────────▼──────────────┐
                    │  api (Express)               │  auth, RBAC, validation, audit
                    │  stateless, horizontally     │
                    │  scalable                    │
                    └───┬───────────┬───────────┬──┘
                        │           │           │
             ┌──────────▼──┐  ┌─────▼─────┐  ┌──▼───────────────┐
             │ MongoDB     │  │ Redis     │  │ syslog collector │
             │ users,      │  │ BullMQ    │  │ RFC 5424 / 3164  │
             │ projects,   │  │ queues    │  │ UDP or TCP       │
             │ scans,      │  └─────┬─────┘  └──────────────────┘
             │ findings,   │        │
             │ audit logs  │        │ jobs
             └─────────────┘  ┌─────▼──────────────┐
                              │ worker             │  scan · email · maintenance
                              │ gitleaks driver    │──► git clone + gitleaks
                              │ nodemailer         │──► SMTP relay
                              └────────────────────┘
                                        │
                                  ┌─────▼──────┐
                                  │ LDAP / AD  │  (bind → search → bind)
                                  └────────────┘
```

## Request lifecycle

1. `requestContext` assigns a correlation id (`x-request-id`, echoed to the client).
2. `helmet`, `cors`, `compression`, body parsing and the global rate limiter run.
3. `authenticate` verifies the access token **and reloads the user**, so a disabled
   account loses access immediately rather than at token expiry.
4. `requireRole` enforces the route's roles; denials are written to the audit trail.
5. `validate(schema)` parses and replaces the payload — handlers never see raw input.
6. The controller does its work and writes a domain audit event.
7. `errorHandler` converts any thrown error into `{ error: { code, message, requestId } }`.

## Authentication

| Flow | Notes |
|------|-------|
| Local | bcrypt (cost 12), password history, lockout after N failures |
| LDAP | service bind → search by filter → re-bind as the user DN → group lookup |
| MFA | TOTP (otplib), 8 single-use recovery codes stored as SHA-256 hashes |
| Sessions | 15-minute access JWT + rotating refresh token (7 days) in an HttpOnly cookie |
| Replay | reuse of a rotated refresh token revokes the entire token family |

LDAP users are provisioned just-in-time on first sign-in, and their role is
re-synced from group membership at every sign-in (`LDAP_ROLE_MAPPINGS`).

## Roles

| Capability | admin | security_analyst | developer | viewer |
|---|:--:|:--:|:--:|:--:|
| View dashboard, projects, scans, findings | ✅ | ✅ | ✅ | ✅ |
| Queue / cancel / retry scans | ✅ | ✅ | ✅ | — |
| Onboard and edit projects | ✅ | ✅ | — | — |
| Triage findings | ✅ | ✅ | — | — |
| Read the audit trail | ✅ | ✅ | — | — |
| Manage users and settings | ✅ | — | — | — |

## Queues (Redis / BullMQ)

| Queue | Producer | Consumer | Jobs |
|---|---|---|---|
| `scan` | API, scheduler | scan worker | clone + gitleaks + persist findings + notify |
| `email` | API, workers | email worker | templated SMTP notifications |
| `maintenance` | boot (repeatable) | maintenance worker | `reap-stale-scans` (15 min), `run-scheduled-scans` (hourly) |

Jobs retry three times with exponential backoff. The scan job is idempotent by
`scanId`, which is also the BullMQ job id, so a duplicate submission cannot
double-queue the same scan.

## Auditing

Every audited action produces one document in `auditlogs` **and** one syslog
record. The syslog record is RFC 5424 by default:

```
<109>1 2026-08-24T10:20:30.000Z app01 sentinel 42 user.role.changed
  [audit@32473 eventId="…" category="user_management" outcome="success" actor="admin" targetName="jdoe"]
  [origin@32473 ip="10.24.8.11" requestId="…" method="PATCH" path="/api/v1/users/…" statusCode="200"]
  admin changed the role of jdoe: viewer -> developer
```

* Priority = `facility * 8 + severity`; failures and denials are raised to `warning`.
* Sensitive keys (`password`, `token`, `secret`, `match`, …) are redacted **before**
  the event is built, so neither MongoDB nor the collector ever sees them.
* Mongo retention is enforced by a TTL index (`AUDIT_RETENTION_DAYS`).
* Delivery is best-effort and never blocks a request; `forwardedToSyslog` records
  whether the collector was reachable.

## Scanning

`SCAN_DRIVER` selects the engine, and all three produce the same output contract:

| Driver | Requirement | Use |
|---|---|---|
| `mock` | none | demos, development, CI |
| `native` | `gitleaks` on PATH | bare-metal workers |
| `docker` | docker socket | containerised workers (`--network none` while scanning) |

Findings are normalised, severity-classified, fingerprinted (rule + file + line +
commit + hash of the secret) and stored with only a **redacted** preview of the
secret. The raw value never leaves the worker process.
