# Operations runbook

## Environments

Everything is configured through environment variables; `server/.env.example`
is the reference. Nothing secret is stored in MongoDB or shown in the UI.

Generate real secrets before the first production boot:

```bash
openssl rand -base64 48   # JWT_ACCESS_SECRET
openssl rand -base64 48   # JWT_REFRESH_SECRET
```

## Health and probes

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/v1/system/health/live` | none | liveness — process is up |
| `GET /api/v1/system/health/ready` | none | readiness — Mongo **and** Redis reachable (503 when not) |
| `GET /api/v1/system/health` | analyst+ | full dependency report incl. SMTP, LDAP, syslog, queue depths |
| `GET /api/v1/system/auth-methods` | none | which sign-in methods the login screen should offer |

## Wiring the SIEM

```bash
SYSLOG_ENABLED=true
SYSLOG_HOST=siem.corp.local
SYSLOG_PORT=514
SYSLOG_PROTOCOL=udp     # tcp uses RFC 6587 octet framing, survives multi-line messages
SYSLOG_FACILITY=13      # log audit
SYSLOG_RFC=5424
```

Verify from the UI: **Audit trail → Send syslog probe**, then confirm the record
arrived. The tile row on that page shows how many records were forwarded, how
many were only persisted, and the last collector error.

rsyslog example that files Sentinel events separately:

```
:app-name, isequal, "sentinel" /var/log/sentinel-audit.log
& stop
```

## Mail

`SMTP_ENABLED=false` keeps the full template and queue path but writes the
rendered message to the log instead of sending it — useful in development and in
locked-down environments. Test a real relay from **Settings → Mail relay → Send**.

## Scaling

* `api` is stateless: run as many replicas as needed behind the load balancer.
* `worker` scales horizontally; `SCAN_CONCURRENCY` bounds parallel scans per replica.
* Scans are long-running, so the worker's BullMQ lock is derived from
  `SCAN_TIMEOUT_MS`; raise both together for very large repositories.

## Common tasks

```bash
# create the demo dataset (users + applications with HOD/SPOC + branch scans)
cd server && npm run seed

# wipe the operational collections first
npm run seed -- --reset

# migrate an install that predates applications (projects → applications)
npm run migrate:applications -- --dry-run
npm run migrate:applications

# run API and workers separately
npm start
npm run worker
```

## Failure modes

| Symptom | Likely cause | Action |
|---|---|---|
| Scans stay `queued` | no worker running, or Redis unreachable | check `worker` logs and `/system/health` |
| Scans stuck `running` | worker died mid-scan | the maintenance job reaps them after 6 h; check disk and timeouts |
| `refresh_replay` on sign-in | refresh token reused (or stolen) | all sessions for that user were revoked by design; sign in again |
| Audit rows with `forwardedToSyslog: false` | collector down when the event was written | events are still in MongoDB; export them for the gap window |
| Account locked | repeated failed sign-ins | **Users → unlock**, or wait `LOCKOUT_MINUTES` |
| A branch scans but never appears in the list | it was scanned ad hoc | it is registered automatically on first scan; refresh the application |
| Scheduled scans skip a branch | the branch is paused or unscheduled | check **Scheduled** and the paused chip on the branches tab |
