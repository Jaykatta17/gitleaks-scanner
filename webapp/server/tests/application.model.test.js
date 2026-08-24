import { describe, it, expect } from 'vitest';
import { Application, normalizeBranches } from '../src/models/application.model.js';

// These run against Mongoose documents in memory — no database required.
const validApplication = {
  key: 'PAY',
  name: 'Payments API',
  repository: { url: 'https://github.com/acme/payments.git', defaultBranch: 'main' },
  hod: { name: 'Meera Iyer', email: 'meera.iyer@corp.local' },
  spoc: { name: 'Arjun Kumar', email: 'arjun.kumar@corp.local' },
};

describe('branch rules', () => {
  it('keeps the branch that declares itself default', () => {
    const result = normalizeBranches(
      [{ name: 'main' }, { name: 'develop', isDefault: true }, { name: 'release/2.4' }],
      'main',
    );
    expect(result.defaultBranch).toBe('develop');
    expect(result.branches.filter((branch) => branch.isDefault)).toHaveLength(1);
  });

  it('falls back to the repository default when nothing is declared', () => {
    const result = normalizeBranches([{ name: 'develop' }, { name: 'main' }], 'main');
    expect(result.defaultBranch).toBe('main');
  });

  it('falls back to the first branch when the repository default is not tracked', () => {
    const result = normalizeBranches([{ name: 'develop' }, { name: 'release/2.4' }], 'main');
    expect(result.defaultBranch).toBe('develop');
  });

  it('collapses two declared defaults down to one', () => {
    const result = normalizeBranches(
      [{ name: 'main', isDefault: true }, { name: 'develop', isDefault: true }],
      'main',
    );
    expect(result.branches.filter((branch) => branch.isDefault)).toHaveLength(1);
    expect(result.defaultBranch).toBe('main');
  });

  it('drops duplicate and blank branch names, keeping the first', () => {
    const result = normalizeBranches(
      [{ name: 'main' }, { name: 'main' }, { name: '  ' }, { name: 'develop' }],
      'main',
    );
    expect(result.branches.map((branch) => branch.name)).toEqual(['main', 'develop']);
  });

  it('leaves an application with no branches alone', () => {
    expect(normalizeBranches([], 'main')).toEqual({ branches: [], defaultBranch: 'main' });
  });
});

describe('application document', () => {
  it('validates a complete registration', () => {
    const application = new Application({
      ...validApplication,
      branches: [{ name: 'main', isDefault: true }, { name: 'release/2.4' }],
    });
    expect(application.validateSync()).toBeUndefined();
    expect(application.findBranch('release/2.4')).toBeTruthy();
    expect(application.findBranch('missing')).toBeUndefined();
  });

  it('requires the head of department and the SPOC', () => {
    const { hod, ...withoutHod } = validApplication;
    const errors = new Application(withoutHod).validateSync().errors;
    expect(Object.keys(errors)).toContain('hod');
  });

  it('requires a name and an email on each contact', () => {
    const errors = new Application({ ...validApplication, spoc: { name: 'Only Name' } }).validateSync().errors;
    expect(Object.keys(errors)).toContain('spoc.email');
  });

  it('requires a repository URL', () => {
    const errors = new Application({ ...validApplication, repository: { defaultBranch: 'main' } }).validateSync().errors;
    expect(Object.keys(errors)).toContain('repository.url');
  });

  it('normalises the key and contact emails', () => {
    const application = new Application({
      ...validApplication,
      key: 'pay',
      spoc: { name: 'Arjun Kumar', email: 'Arjun.Kumar@Corp.local' },
    });
    expect(application.key).toBe('PAY');
    expect(application.spoc.email).toBe('arjun.kumar@corp.local');
  });

  it('rejects an unknown git provider or branch environment', () => {
    const providerErrors = new Application({
      ...validApplication,
      repository: { ...validApplication.repository, provider: 'sourceforge' },
    }).validateSync().errors;
    expect(Object.keys(providerErrors)).toContain('repository.provider');

    const branchErrors = new Application({
      ...validApplication,
      branches: [{ name: 'main', environment: 'nowhere' }],
    }).validateSync().errors;
    expect(Object.keys(branchErrors).some((key) => key.includes('environment'))).toBe(true);
  });
});
