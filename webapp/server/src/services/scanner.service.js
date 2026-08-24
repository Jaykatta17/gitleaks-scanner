import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import env from '../config/env.js';
import logger from '../config/logger.js';

/**
 * Secret-scanning engine wrapper.
 *
 * Three drivers share one output contract so the queue, API and UI never care
 * which one produced the findings:
 *   mock   — deterministic synthetic results (demo/dev/CI, no tooling needed)
 *   native — `gitleaks` binary on PATH
 *   docker — gitleaks container image
 */

const SEVERITY_RULES = [
  { match: /aws|private[-_ ]?key|rsa|pgp|ssh|gcp|azure|stripe[-_]?live|payment/i, severity: 'critical' },
  { match: /token|secret|password|credential|api[-_ ]?key|jwt|bearer/i, severity: 'high' },
  { match: /webhook|slack|telegram|smtp|database[-_ ]?url|connection[-_ ]?string/i, severity: 'medium' },
];

export const severityForRule = (ruleId = '', description = '') => {
  const haystack = `${ruleId} ${description}`;
  return SEVERITY_RULES.find((rule) => rule.match.test(haystack))?.severity || 'low';
};

/** Keeps a recognisable prefix so responders can identify the credential, hides the rest. */
export const redactSecret = (secret = '') => {
  if (!env.scanner.redactSecrets) return secret;
  const value = String(secret);
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}${'*'.repeat(Math.min(20, value.length - 8))}${value.slice(-4)}`;
};

export const fingerprintOf = ({ ruleId, file, startLine, secret, commit }) =>
  crypto
    .createHash('sha256')
    .update([ruleId, file, startLine, commit || '', crypto.createHash('sha1').update(String(secret || '')).digest('hex')].join('|'))
    .digest('hex')
    .slice(0, 32);

export const normalizeFinding = (raw) => {
  const ruleId = raw.RuleID || raw.ruleId || 'unknown-rule';
  const description = raw.Description || raw.description || '';
  const file = raw.File || raw.file || 'unknown';
  const startLine = raw.StartLine ?? raw.startLine ?? 0;
  const commit = raw.Commit || raw.commit || '';
  const secret = raw.Secret || raw.secret || '';
  return {
    fingerprint: raw.Fingerprint || fingerprintOf({ ruleId, file, startLine, secret, commit }),
    ruleId,
    description,
    severity: severityForRule(ruleId, description),
    file,
    startLine,
    endLine: raw.EndLine ?? raw.endLine ?? startLine,
    commit,
    author: raw.Author || raw.author || '',
    authorEmail: raw.Email || raw.email || '',
    committedAt: raw.Date ? new Date(raw.Date) : undefined,
    entropy: Number(raw.Entropy ?? raw.entropy ?? 0),
    secretPreview: redactSecret(secret),
    matchPreview: redactSecret((raw.Match || raw.match || '').slice(0, 160)),
    tags: Array.isArray(raw.Tags) ? raw.Tags : [],
  };
};

export const summarize = (findings) =>
  findings.reduce(
    (acc, finding) => {
      acc.total += 1;
      acc[finding.severity] += 1;
      return acc;
    },
    { total: 0, critical: 0, high: 0, medium: 0, low: 0 },
  );

const run = (command, args, { cwd, timeoutMs = env.scanner.timeoutMs, allowedExitCodes = [0] } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 2_000_000) stdout = stdout.slice(-2_000_000);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 200_000) stderr = stderr.slice(-200_000);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (allowedExitCodes.includes(code)) resolve({ code, stdout, stderr });
      else reject(new Error(`${command} exited with ${code}: ${stderr.slice(-500) || stdout.slice(-500)}`));
    });
  });

const mockFindings = (scan) => {
  // Deterministic per scan target so demo dashboards stay stable between runs.
  const seed = crypto.createHash('sha256').update(`${scan.repoUrl}|${scan.branch}`).digest();
  const count = seed[0] % 9;
  const rules = [
    ['aws-access-token', 'AWS Access Key detected', 'src/config/aws.js'],
    ['generic-api-key', 'Generic API key detected', 'services/payment/client.ts'],
    ['private-key', 'RSA private key material', 'deploy/keys/id_rsa'],
    ['slack-webhook', 'Slack webhook URL', 'scripts/notify.sh'],
    ['jwt-token', 'Hardcoded JWT bearer token', 'tests/fixtures/auth.json'],
    ['database-url', 'Database connection string with password', '.env.staging'],
  ];
  return Array.from({ length: count }, (_, index) => {
    const [ruleId, description, file] = rules[seed[index + 1] % rules.length];
    return {
      RuleID: ruleId,
      Description: description,
      File: file,
      StartLine: (seed[index + 2] % 240) + 1,
      EndLine: (seed[index + 2] % 240) + 1,
      Commit: seed.subarray(index, index + 4).toString('hex'),
      Author: ['a.kumar', 'j.doe', 'ci-bot'][seed[index + 3] % 3],
      Email: 'engineer@example.com',
      Date: new Date(Date.now() - (seed[index + 4] % 90) * 86_400_000).toISOString(),
      Entropy: 3 + (seed[index + 5] % 100) / 50,
      Secret: `${ruleId.toUpperCase()}-${seed.subarray(0, 12).toString('hex')}`,
      Match: `const key = "${ruleId}-${seed.subarray(0, 8).toString('hex')}"`,
    };
  });
};

const cloneRepository = async (scan, workspace, onLog) => {
  const target = path.join(workspace, 'repo');
  const args = ['clone', '--depth', String(env.scanner.cloneDepth), '--branch', scan.branch, '--single-branch', scan.repoUrl, target];
  onLog?.(`cloning ${scan.repoUrl} (${scan.branch})`);
  await run('git', args, { timeoutMs: env.scanner.timeoutMs });
  if (scan.commitId) {
    onLog?.(`checking out ${scan.commitId}`);
    await run('git', ['fetch', '--depth', String(env.scanner.cloneDepth), 'origin', scan.commitId], { cwd: target }).catch(
      () => onLog?.('shallow fetch of the requested commit failed; scanning branch head'),
    );
    await run('git', ['checkout', '--detach', scan.commitId], { cwd: target }).catch(() =>
      onLog?.(`commit ${scan.commitId} not reachable; scanning branch head`),
    );
  }
  const head = await run('git', ['rev-parse', 'HEAD'], { cwd: target });
  const count = await run('git', ['rev-list', '--count', 'HEAD'], { cwd: target }).catch(() => ({ stdout: '0' }));
  return { path: target, commit: head.stdout.trim(), commits: Number.parseInt(count.stdout.trim(), 10) || 0 };
};

const readReport = async (reportPath) => {
  const content = await fs.readFile(reportPath, 'utf8').catch(() => '[]');
  if (!content.trim()) return [];
  try {
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    logger.warn('unreadable gitleaks report', { event: 'scan.report_unreadable', error: error.message });
    return [];
  }
};

const countFiles = async (dir) => {
  let total = 0;
  const walk = async (current) => {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name === '.git') continue;
      if (entry.isDirectory()) await walk(path.join(current, entry.name));
      else total += 1;
    }
  };
  await walk(dir);
  return total;
};

/**
 * Executes one scan and returns `{ findings, summary, commit, driver }`.
 * `onLog` receives human-readable progress lines that are stored on the scan.
 */
export const executeScan = async (scan, { onLog } = {}) => {
  const driver = env.scanner.driver;
  const startedAt = Date.now();

  if (driver === 'mock') {
    onLog?.('running mock scanner (SCAN_DRIVER=mock)');
    const findings = mockFindings(scan).map(normalizeFinding);
    await new Promise((resolve) => setTimeout(resolve, 400));
    return {
      driver,
      findings,
      summary: { ...summarize(findings), filesScanned: 120 + (findings.length * 7), commitsScanned: 50 },
      commit: scan.commitId || crypto.randomBytes(4).toString('hex'),
      durationMs: Date.now() - startedAt,
    };
  }

  await fs.mkdir(env.scanner.workDir, { recursive: true });
  const workspace = await fs.mkdtemp(path.join(env.scanner.workDir, 'scan-'));
  try {
    const repo = await cloneRepository(scan, workspace, onLog);
    const reportPath = path.join(workspace, 'report.json');
    onLog?.(`running gitleaks via ${driver} driver`);

    if (driver === 'docker') {
      await run(
        'docker',
        [
          'run', '--rm', '--network', 'none',
          '-v', `${repo.path}:/repo:ro`,
          '-v', `${workspace}:/out`,
          env.scanner.gitleaksImage,
          'detect', '--source=/repo', '--report-format=json', '--report-path=/out/report.json', '--exit-code=0',
        ],
        { timeoutMs: env.scanner.timeoutMs, allowedExitCodes: [0, 1] },
      );
    } else {
      await run(
        env.scanner.gitleaksBin,
        ['detect', `--source=${repo.path}`, '--report-format=json', `--report-path=${reportPath}`, '--exit-code=0'],
        { timeoutMs: env.scanner.timeoutMs, allowedExitCodes: [0, 1] },
      );
    }

    const raw = await readReport(reportPath);
    const truncated = raw.length > env.scanner.maxFindingsStored;
    const findings = raw.slice(0, env.scanner.maxFindingsStored).map(normalizeFinding);
    const filesScanned = await countFiles(repo.path).catch(() => 0);
    onLog?.(`gitleaks reported ${raw.length} finding(s)`);

    return {
      driver,
      findings,
      summary: { ...summarize(findings), filesScanned, commitsScanned: repo.commits, truncated },
      commit: repo.commit,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await fs.rm(workspace, { recursive: true, force: true }).catch((error) =>
      logger.warn('workspace cleanup failed', { event: 'scan.cleanup_failed', workspace, error: error.message }),
    );
  }
};

export default executeScan;
