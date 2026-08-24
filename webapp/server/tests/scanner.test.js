import { describe, it, expect } from 'vitest';
import {
  normalizeFinding,
  severityForRule,
  redactSecret,
  summarize,
  fingerprintOf,
  executeScan,
} from '../src/services/scanner.service.js';

describe('severity classification', () => {
  it('treats key material and cloud credentials as critical', () => {
    expect(severityForRule('aws-access-token', 'AWS key')).toBe('critical');
    expect(severityForRule('private-key', 'RSA private key')).toBe('critical');
  });

  it('treats generic tokens as high', () => {
    expect(severityForRule('generic-api-key', 'API key detected')).toBe('high');
  });

  it('treats integration URLs as medium and unknown rules as low', () => {
    expect(severityForRule('slack-webhook', 'Slack webhook')).toBe('medium');
    expect(severityForRule('todo-comment', 'A TODO')).toBe('low');
  });
});

describe('secret redaction', () => {
  it('keeps only four characters at each end', () => {
    expect(redactSecret('ABCD1234567890WXYZ')).toBe('ABCD**********WXYZ');
  });

  it('fully masks short values', () => {
    expect(redactSecret('abc')).toBe('***');
  });
});

describe('gitleaks output normalisation', () => {
  const raw = {
    RuleID: 'aws-access-token',
    Description: 'AWS Access Key',
    File: 'src/config.js',
    StartLine: 12,
    EndLine: 12,
    Commit: 'abc123',
    Author: 'jdoe',
    Email: 'jdoe@corp.local',
    Date: '2026-01-05T00:00:00Z',
    Entropy: 4.2,
    Secret: 'AKIAIOSFODNN7EXAMPLE',
    Match: 'const key = "AKIAIOSFODNN7EXAMPLE"',
  };

  it('maps gitleaks fields onto the storage shape', () => {
    const finding = normalizeFinding(raw);
    expect(finding).toMatchObject({
      ruleId: 'aws-access-token',
      severity: 'critical',
      file: 'src/config.js',
      startLine: 12,
      author: 'jdoe',
      authorEmail: 'jdoe@corp.local',
    });
    expect(finding.committedAt instanceof Date).toBe(true);
  });

  it('never stores the raw secret', () => {
    const finding = normalizeFinding(raw);
    expect(JSON.stringify(finding)).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(finding.secretPreview.startsWith('AKIA')).toBe(true);
  });

  it('derives a stable fingerprint for the same location and secret', () => {
    expect(normalizeFinding(raw).fingerprint).toBe(normalizeFinding({ ...raw }).fingerprint);
    expect(fingerprintOf({ ruleId: 'a', file: 'b', startLine: 1, secret: 's', commit: 'c' })).toHaveLength(32);
  });

  it('changes the fingerprint when the location moves', () => {
    expect(normalizeFinding(raw).fingerprint).not.toBe(normalizeFinding({ ...raw, StartLine: 99 }).fingerprint);
  });

  it('survives a report with missing optional fields', () => {
    const finding = normalizeFinding({ File: 'x.js' });
    expect(finding.ruleId).toBe('unknown-rule');
    expect(finding.severity).toBe('low');
    expect(finding.startLine).toBe(0);
  });
});

describe('summaries', () => {
  it('counts findings per severity', () => {
    const summary = summarize([
      { severity: 'critical' },
      { severity: 'critical' },
      { severity: 'high' },
      { severity: 'low' },
    ]);
    expect(summary).toEqual({ total: 4, critical: 2, high: 1, medium: 0, low: 1 });
  });
});

describe('mock driver', () => {
  it('is deterministic for the same repository and branch', async () => {
    const target = { repoUrl: 'https://github.com/acme/payments-api.git', branch: 'main' };
    const first = await executeScan(target);
    const second = await executeScan(target);
    expect(first.summary).toEqual(second.summary);
    expect(first.findings.map((f) => f.fingerprint)).toEqual(second.findings.map((f) => f.fingerprint));
  });

  it('produces a summary whose parts add up to the total', async () => {
    const { summary, findings } = await executeScan({
      repoUrl: 'https://github.com/acme/web-portal.git',
      branch: 'main',
    });
    expect(summary.critical + summary.high + summary.medium + summary.low).toBe(summary.total);
    expect(findings).toHaveLength(summary.total);
  });
});
