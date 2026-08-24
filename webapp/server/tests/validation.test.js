import { describe, it, expect } from 'vitest';
import {
  loginSchema,
  passwordSchema,
  createApplicationSchema,
  branchInputSchema,
  bulkScanSchema,
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

const validApplication = {
  key: 'pay',
  name: 'Payments API',
  repository: { url: 'https://github.com/acme/payments.git' },
  hod: { name: 'Meera Iyer', email: 'Meera.Iyer@Corp.local' },
  spoc: { name: 'Arjun Kumar', email: 'arjun.kumar@corp.local' },
};

describe('application registration payload', () => {
  it('upper-cases the key, defaults the branch and normalises contact emails', () => {
    const application = createApplicationSchema.parse(validApplication);
    expect(application.key).toBe('PAY');
    expect(application.repository.defaultBranch).toBe('main');
    expect(application.hod.email).toBe('meera.iyer@corp.local');
    expect(application.criticality).toBe('medium');
  });

  it('requires both a head of department and a SPOC', () => {
    const { hod, ...withoutHod } = validApplication;
    const { spoc, ...withoutSpoc } = validApplication;
    expect(createApplicationSchema.safeParse(withoutHod).success).toBe(false);
    expect(createApplicationSchema.safeParse(withoutSpoc).success).toBe(false);
  });

  it('rejects a contact without a usable email', () => {
    const result = createApplicationSchema.safeParse({
      ...validApplication,
      spoc: { name: 'No Mail', email: 'not-an-email' },
    });
    expect(result.success).toBe(false);
    expect(result.error.issues[0].path).toEqual(['spoc', 'email']);
  });

  it('accepts an optional backup SPOC', () => {
    const application = createApplicationSchema.parse({
      ...validApplication,
      backupSpoc: { name: 'Neha Verma', email: 'neha@corp.local', phone: '+91 98450 11223' },
    });
    expect(application.backupSpoc.phone).toBe('+91 98450 11223');
  });

  it('rejects a repository URL with an unsupported scheme', () => {
    const result = createApplicationSchema.safeParse({
      ...validApplication,
      repository: { url: 'file:///etc/passwd' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts ssh and scp-style git URLs', () => {
    for (const url of ['git@github.com:acme/x.git', 'ssh://git@github.com/acme/x.git']) {
      expect(createApplicationSchema.safeParse({ ...validApplication, repository: { url } }).success).toBe(true);
    }
  });

  it('takes a list of branches to register up front', () => {
    const application = createApplicationSchema.parse({
      ...validApplication,
      branches: [
        { name: 'main', isDefault: true, environment: 'production' },
        { name: 'release/2.4', environment: 'release' },
        { name: 'develop' },
      ],
    });
    expect(application.branches.map((branch) => branch.name)).toEqual(['main', 'release/2.4', 'develop']);
    expect(application.branches[1].scanEnabled).toBe(true);
  });
});

describe('branch names', () => {
  it('accepts the shapes git actually allows', () => {
    for (const name of ['main', 'develop', 'release/2.4', 'feature/JIRA-123_add-auth', 'hotfix.1']) {
      expect(branchInputSchema.safeParse({ name }).success).toBe(true);
    }
  });

  it('rejects names git would refuse or that could smuggle arguments', () => {
    for (const name of ['has space', 'tilde~1', 'caret^', 'colon:name', 'star*', 'question?', '-leading-dash', 'x.lock', 'back\\slash']) {
      expect(branchInputSchema.safeParse({ name }).success).toBe(false);
    }
  });
});

describe('bulk scan payload', () => {
  const id = '651f1f77bcf86cd799439011';

  it('accepts a list of applications', () => {
    expect(bulkScanSchema.safeParse({ applicationIds: [id] }).success).toBe(true);
  });

  it('accepts several branches of one application', () => {
    const parsed = bulkScanSchema.parse({ applicationId: id, branches: ['main', 'release/2.4'] });
    expect(parsed.branches).toHaveLength(2);
  });

  it('accepts an all-branches request', () => {
    expect(bulkScanSchema.safeParse({ applicationId: id, allBranches: true }).success).toBe(true);
  });

  it('rejects a single application with no branch selection', () => {
    expect(bulkScanSchema.safeParse({ applicationId: id }).success).toBe(false);
  });

  it('rejects an empty request', () => {
    expect(bulkScanSchema.safeParse({}).success).toBe(false);
  });
});

describe('scan and finding queries', () => {
  it('requires a valid object id for the application', () => {
    expect(createScanSchema.safeParse({ applicationId: 'nope' }).success).toBe(false);
    expect(createScanSchema.safeParse({ applicationId: '651f1f77bcf86cd799439011' }).success).toBe(true);
  });

  it('carries the branch to scan', () => {
    const parsed = createScanSchema.parse({ applicationId: '651f1f77bcf86cd799439011', branch: 'release/2.4' });
    expect(parsed.branch).toBe('release/2.4');
    expect(parsed.registerBranch).toBe(true);
  });

  it('rejects a branch name git would refuse', () => {
    expect(
      createScanSchema.safeParse({ applicationId: '651f1f77bcf86cd799439011', branch: 'main; rm -rf /' }).success,
    ).toBe(false);
  });

  it('rejects a non-hex commit id', () => {
    expect(
      createScanSchema.safeParse({ applicationId: '651f1f77bcf86cd799439011', commitId: 'zzz; rm -rf /' }).success,
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
      applicationKey: 'PAY',
      applicationName: 'Payments API',
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
    expect(subject).toBe('[CRITICAL] PAY main — scan GLS-20260201-AB12CD');
    expect(html).toContain('Payments API');
    expect(html).toContain('main');
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
