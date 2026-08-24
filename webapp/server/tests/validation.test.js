import { describe, it, expect } from 'vitest';
import {
  loginSchema,
  passwordSchema,
  createProjectSchema,
  createScanSchema,
  listFindingsSchema,
  createUserSchema,
} from '../src/validators/index.js';
import { renderTemplate } from '../src/templates/email.templates.js';
import { parsePagination, buildSort, paginated } from '../src/utils/pagination.js';

describe('password policy', () => {
  it('rejects anything shorter than the configured minimum', () => {
    expect(passwordSchema.safeParse('Ab1!xyz').success).toBe(false);
  });

  it('rejects long but single-class passwords', () => {
    expect(passwordSchema.safeParse('aaaaaaaaaaaaaaaaaaaa').success).toBe(false);
  });

  it('accepts a password with three of the four character classes', () => {
    expect(passwordSchema.safeParse('Correct-Horse-42').success).toBe(true);
  });
});

describe('login payload', () => {
  it('normalises the username to lower case', () => {
    expect(loginSchema.parse({ username: 'JDoe', password: 'x' }).username).toBe('jdoe');
  });

  it('defaults the provider to auto-detect', () => {
    expect(loginSchema.parse({ username: 'a', password: 'b' }).provider).toBe('auto');
  });

  it('accepts a six-digit TOTP code and a recovery code', () => {
    expect(loginSchema.safeParse({ username: 'a', password: 'b', mfaCode: '123456' }).success).toBe(true);
    expect(loginSchema.safeParse({ username: 'a', password: 'b', mfaCode: 'ABCD-EF12' }).success).toBe(true);
    expect(loginSchema.safeParse({ username: 'a', password: 'b', mfaCode: '12' }).success).toBe(false);
  });
});

describe('project payload', () => {
  it('upper-cases the key and defaults the branch', () => {
    const project = createProjectSchema.parse({
      key: 'pay',
      name: 'Payments API',
      repoUrl: 'https://github.com/acme/payments.git',
      maintainerEmail: 'Lead@Corp.local',
    });
    expect(project.key).toBe('PAY');
    expect(project.defaultBranch).toBe('main');
    expect(project.maintainerEmail).toBe('lead@corp.local');
  });

  it('rejects a repository URL with an unsupported scheme', () => {
    const result = createProjectSchema.safeParse({
      key: 'XY',
      name: 'Repo XY',
      repoUrl: 'file:///etc/passwd',
      maintainerEmail: 'a@b.com',
    });
    expect(result.success).toBe(false);
  });

  it('accepts ssh and scp-style git URLs', () => {
    for (const repoUrl of ['git@github.com:acme/x.git', 'ssh://git@github.com/acme/x.git']) {
      expect(
        createProjectSchema.safeParse({ key: 'XY', name: 'Repo XY', repoUrl, maintainerEmail: 'a@b.com' }).success,
      ).toBe(true);
    }
  });
});

describe('scan and finding queries', () => {
  it('requires a valid object id for the project', () => {
    expect(createScanSchema.safeParse({ projectId: 'nope' }).success).toBe(false);
    expect(createScanSchema.safeParse({ projectId: '651f1f77bcf86cd799439011' }).success).toBe(true);
  });

  it('rejects a non-hex commit id', () => {
    expect(
      createScanSchema.safeParse({ projectId: '651f1f77bcf86cd799439011', commitId: 'zzz; rm -rf /' }).success,
    ).toBe(false);
  });

  it('coerces pagination values from query strings', () => {
    expect(listFindingsSchema.parse({ page: '2', limit: '50' })).toMatchObject({ page: 2, limit: 50 });
  });

  it('rejects an unknown severity', () => {
    expect(listFindingsSchema.safeParse({ severity: 'catastrophic' }).success).toBe(false);
  });
});

describe('user payload', () => {
  it('rejects usernames with characters that would break LDAP filters or URLs', () => {
    expect(createUserSchema.safeParse({ username: 'bad user!', email: 'a@b.com', displayName: 'Bad User' }).success).toBe(false);
  });

  it('defaults new accounts to the least-privileged role', () => {
    const user = createUserSchema.parse({ username: 'jdoe', email: 'j@b.com', displayName: 'J Doe' });
    expect(user.role).toBe('viewer');
    expect(user.authProvider).toBe('local');
  });
});

describe('pagination helpers', () => {
  it('clamps the page size to the maximum', () => {
    expect(parsePagination({ limit: '5000' }, { maxLimit: 200 }).limit).toBe(200);
  });

  it('falls back to page one for junk input', () => {
    expect(parsePagination({ page: '-3' })).toMatchObject({ page: 1, skip: 0 });
  });

  it('only sorts by allow-listed fields', () => {
    expect(buildSort('-createdAt', ['createdAt'])).toEqual({ createdAt: -1 });
    expect(buildSort('password', ['createdAt'])).toEqual({ createdAt: -1 });
  });

  it('reports whether another page exists', () => {
    expect(paginated([], 120, { page: 2, limit: 25 })).toMatchObject({ totalPages: 5, hasNext: true });
    expect(paginated([], 30, { page: 2, limit: 25 }).hasNext).toBe(false);
  });
});

describe('email templates', () => {
  it('renders the scan summary with a severity-tagged subject', () => {
    const { subject, html, text } = renderTemplate('scanCompleted', {
      scanId: 'GLS-20260201-AB12CD',
      projectName: 'Payments API',
      repoUrl: 'https://github.com/acme/payments.git',
      branch: 'main',
      commitId: 'abc1234',
      total: 4,
      critical: 1,
      high: 1,
      medium: 1,
      low: 1,
      durationSeconds: 42,
      severityLabel: 'CRITICAL',
    });
    expect(subject).toBe('[CRITICAL] Scan GLS-20260201-AB12CD — Payments API');
    expect(html).toContain('Payments API');
    expect(text).not.toContain('<');
  });

  it('escapes HTML in user-controlled values', () => {
    const { html } = renderTemplate('welcome', {
      displayName: '<script>alert(1)</script>',
      username: 'jdoe',
      role: 'viewer',
      authProvider: 'local',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('builds a reset link that carries an encoded token', () => {
    const { html } = renderTemplate('passwordReset', {
      username: 'jdoe',
      token: 'a b/c+d',
      expiresInMinutes: 30,
      requestedAt: '2026-02-01T00:00:00Z',
      ip: '10.0.0.1',
    });
    expect(html).toContain('reset-password?token=a%20b%2Fc%2Bd');
  });

  it('refuses to render an unknown template', () => {
    expect(() => renderTemplate('nope')).toThrow(/Unknown email template/);
  });
});
