import env from './env.js';
import syslogClient, { SEVERITY, buildStructuredData } from './syslog.js';

const LEVELS = { error: 0, warn: 1, info: 2, http: 3, debug: 4 };
const LEVEL_TO_SYSLOG = {
  error: SEVERITY.error,
  warn: SEVERITY.warning,
  info: SEVERITY.info,
  http: SEVERITY.info,
  debug: SEVERITY.debug,
};

const threshold = LEVELS[env.logLevel] ?? LEVELS.info;

const REDACTED = '[redacted]';
const SENSITIVE_KEYS = /^(password|passwd|newPassword|currentPassword|token|accessToken|refreshToken|secret|authorization|cookie|apiKey|api_key|otp|totp|mfaCode|bindCredentials|match)$/i;

export const redact = (value, depth = 0) => {
  if (value === null || value === undefined || depth > 6) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redact(item, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const out = {};
    for (const [key, val] of Object.entries(value)) {
      out[key] = SENSITIVE_KEYS.test(key) ? REDACTED : redact(val, depth + 1);
    }
    return out;
  }
  return value;
};

const write = (level, message, meta = {}) => {
  if ((LEVELS[level] ?? LEVELS.info) > threshold) return;
  const safeMeta = redact(meta);
  const record = {
    ts: new Date().toISOString(),
    level,
    service: env.syslog.appName,
    env: env.nodeEnv,
    msg: message,
    ...safeMeta,
  };
  const line = JSON.stringify(record);
  if (level === 'error') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);

  if (syslogClient.enabled) {
    syslogClient.send({
      severity: LEVEL_TO_SYSLOG[level] ?? SEVERITY.info,
      msgId: safeMeta.event || 'app',
      structuredData: buildStructuredData('app@32473', {
        level,
        env: env.nodeEnv,
        requestId: safeMeta.requestId,
        actor: safeMeta.actor,
      }),
      message: `${message} ${JSON.stringify(safeMeta)}`.trim(),
    });
  }
};

export const logger = {
  error: (message, meta) => write('error', message, meta),
  warn: (message, meta) => write('warn', message, meta),
  info: (message, meta) => write('info', message, meta),
  http: (message, meta) => write('http', message, meta),
  debug: (message, meta) => write('debug', message, meta),
  child: (bindings = {}) => ({
    error: (message, meta) => write('error', message, { ...bindings, ...meta }),
    warn: (message, meta) => write('warn', message, { ...bindings, ...meta }),
    info: (message, meta) => write('info', message, { ...bindings, ...meta }),
    http: (message, meta) => write('http', message, { ...bindings, ...meta }),
    debug: (message, meta) => write('debug', message, { ...bindings, ...meta }),
  }),
};

export default logger;
