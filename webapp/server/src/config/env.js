import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(here, '..', '..');

// .env.<NODE_ENV> wins over .env so that test/CI runs can override safely.
const envName = process.env.NODE_ENV || 'development';
for (const file of [`.env.${envName}.local`, `.env.${envName}`, '.env']) {
  const candidate = path.join(ROOT_DIR, file);
  if (fs.existsSync(candidate)) dotenv.config({ path: candidate });
}

const bool = (value, fallback = false) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const int = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const list = (value, fallback = []) =>
  value ? String(value).split(',').map((item) => item.trim()).filter(Boolean) : fallback;

export const env = {
  nodeEnv: envName,
  isProd: envName === 'production',
  isTest: envName === 'test',
  port: int(process.env.PORT, 4000),
  appName: process.env.APP_NAME || 'Sentinel Console',
  publicUrl: process.env.PUBLIC_URL || 'http://localhost:5173',
  trustProxy: bool(process.env.TRUST_PROXY, false),
  corsOrigins: list(process.env.CORS_ORIGINS, ['http://localhost:5173', 'http://localhost:4173']),

  mongo: {
    uri: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/sentinel',
    maxPoolSize: int(process.env.MONGO_MAX_POOL, 20),
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
    prefix: process.env.REDIS_PREFIX || 'sentinel',
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'dev-access-secret-change-me',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-me',
    accessTtl: process.env.JWT_ACCESS_TTL || '15m',
    refreshTtlDays: int(process.env.JWT_REFRESH_TTL_DAYS, 7),
    issuer: process.env.JWT_ISSUER || 'sentinel-console',
  },

  security: {
    bcryptRounds: int(process.env.BCRYPT_ROUNDS, 12),
    maxFailedLogins: int(process.env.MAX_FAILED_LOGINS, 5),
    lockoutMinutes: int(process.env.LOCKOUT_MINUTES, 15),
    passwordMinLength: int(process.env.PASSWORD_MIN_LENGTH, 12),
    passwordHistory: int(process.env.PASSWORD_HISTORY, 5),
    mfaIssuer: process.env.MFA_ISSUER || 'Sentinel Console',
    requireMfaForAdmins: bool(process.env.REQUIRE_MFA_FOR_ADMINS, false),
    resetTokenMinutes: int(process.env.RESET_TOKEN_MINUTES, 30),
  },

  ldap: {
    enabled: bool(process.env.LDAP_ENABLED, false),
    url: process.env.LDAP_URL || 'ldap://127.0.0.1:389',
    bindDn: process.env.LDAP_BIND_DN || '',
    bindCredentials: process.env.LDAP_BIND_PASSWORD || '',
    searchBase: process.env.LDAP_SEARCH_BASE || '',
    searchFilter: process.env.LDAP_SEARCH_FILTER || '(|(uid={{username}})(sAMAccountName={{username}}))',
    groupSearchBase: process.env.LDAP_GROUP_SEARCH_BASE || '',
    groupSearchFilter: process.env.LDAP_GROUP_SEARCH_FILTER || '(member={{dn}})',
    attributes: {
      username: process.env.LDAP_ATTR_USERNAME || 'uid',
      email: process.env.LDAP_ATTR_EMAIL || 'mail',
      displayName: process.env.LDAP_ATTR_DISPLAY_NAME || 'cn',
      department: process.env.LDAP_ATTR_DEPARTMENT || 'departmentNumber',
    },
    // "cn=secops,ou=groups,dc=corp,dc=local:admin" — LDAP group DN mapped to an app role.
    roleMappings: list(process.env.LDAP_ROLE_MAPPINGS),
    defaultRole: process.env.LDAP_DEFAULT_ROLE || 'viewer',
    tlsRejectUnauthorized: bool(process.env.LDAP_TLS_REJECT_UNAUTHORIZED, true),
    timeoutMs: int(process.env.LDAP_TIMEOUT_MS, 8000),
  },

  smtp: {
    enabled: bool(process.env.SMTP_ENABLED, false),
    host: process.env.SMTP_HOST || 'localhost',
    port: int(process.env.SMTP_PORT, 587),
    secure: bool(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASSWORD || '',
    from: process.env.SMTP_FROM || 'Sentinel Console <no-reply@sentinel.local>',
    replyTo: process.env.SMTP_REPLY_TO || '',
    tlsRejectUnauthorized: bool(process.env.SMTP_TLS_REJECT_UNAUTHORIZED, true),
    poolSize: int(process.env.SMTP_POOL_SIZE, 3),
  },

  syslog: {
    enabled: bool(process.env.SYSLOG_ENABLED, false),
    host: process.env.SYSLOG_HOST || '127.0.0.1',
    port: int(process.env.SYSLOG_PORT, 514),
    protocol: (process.env.SYSLOG_PROTOCOL || 'udp').toLowerCase(), // udp | tcp
    facility: int(process.env.SYSLOG_FACILITY, 13), // 13 = log audit
    appName: process.env.SYSLOG_APP_NAME || 'sentinel',
    hostname: process.env.SYSLOG_HOSTNAME || '',
    rfc: (process.env.SYSLOG_RFC || '5424').toString(), // 5424 | 3164
  },

  queue: {
    scanConcurrency: int(process.env.SCAN_CONCURRENCY, 2),
    emailConcurrency: int(process.env.EMAIL_CONCURRENCY, 5),
    attempts: int(process.env.QUEUE_ATTEMPTS, 3),
    backoffMs: int(process.env.QUEUE_BACKOFF_MS, 10000),
    removeOnCompleteCount: int(process.env.QUEUE_KEEP_COMPLETED, 500),
    removeOnFailCount: int(process.env.QUEUE_KEEP_FAILED, 1000),
  },

  scanner: {
    // mock  -> deterministic synthetic findings, no external tooling required
    // native -> `gitleaks` binary on PATH
    // docker -> gitleaks container image
    driver: (process.env.SCAN_DRIVER || 'mock').toLowerCase(),
    gitleaksImage: process.env.GITLEAKS_IMAGE || 'zricethezav/gitleaks:latest',
    gitleaksBin: process.env.GITLEAKS_BIN || 'gitleaks',
    workDir: process.env.SCAN_WORKDIR || path.join(ROOT_DIR, '.scanwork'),
    cloneDepth: int(process.env.SCAN_CLONE_DEPTH, 50),
    timeoutMs: int(process.env.SCAN_TIMEOUT_MS, 15 * 60 * 1000),
    maxFindingsStored: int(process.env.SCAN_MAX_FINDINGS, 5000),
    redactSecrets: bool(process.env.SCAN_REDACT_SECRETS, true),
  },

  audit: {
    retentionDays: int(process.env.AUDIT_RETENTION_DAYS, 400),
    logRequestBodies: bool(process.env.AUDIT_LOG_REQUEST_BODIES, true),
  },

  logLevel: process.env.LOG_LEVEL || (envName === 'test' ? 'error' : 'info'),
};

export default env;
