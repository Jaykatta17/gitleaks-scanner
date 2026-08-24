import { describe, it, expect } from 'vitest';
import { renderFilter, parseRoleMappings, resolveRoleFromGroups } from '../src/services/ldap.service.js';

describe('LDAP filter rendering', () => {
  it('substitutes the username placeholder', () => {
    expect(renderFilter('(|(uid={{username}})(sAMAccountName={{username}}))', { username: 'jdoe' })).toBe(
      '(|(uid=jdoe)(sAMAccountName=jdoe))',
    );
  });

  it('escapes filter metacharacters so an injected wildcard cannot widen the search', () => {
    expect(renderFilter('(uid={{username}})', { username: '*)(objectClass=*' })).toBe(
      '(uid=\\2a\\29\\28objectClass=\\2a)',
    );
  });

  it('escapes backslashes and NUL bytes', () => {
    const nul = String.fromCharCode(0);
    expect(renderFilter('(uid={{username}})', { username: `a\\b${nul}c` })).toBe('(uid=a\\5cb\\00c)');
  });

  it('renders DN placeholders for group lookups', () => {
    expect(renderFilter('(member={{dn}})', { dn: 'CN=J Doe,OU=Users,DC=corp,DC=local' })).toBe(
      '(member=CN=J Doe,OU=Users,DC=corp,DC=local)',
    );
  });
});

describe('group to role mapping', () => {
  const mappings = parseRoleMappings([
    'CN=SecOps,OU=Groups,DC=corp,DC=local:admin',
    'CN=AppSec,OU=Groups,DC=corp,DC=local:security_analyst',
    'CN=Developers,OU=Groups,DC=corp,DC=local:developer',
  ]);

  it('parses groupDn:role pairs, keeping DNs that contain colons intact', () => {
    const parsed = parseRoleMappings(['CN=Team: Alpha,DC=corp:developer']);
    expect(parsed).toEqual([{ groupDn: 'cn=team: alpha,dc=corp', role: 'developer' }]);
  });

  it('ignores malformed entries', () => {
    expect(parseRoleMappings(['no-role-here', ':', 'CN=X:admin'])).toEqual([{ groupDn: 'cn=x', role: 'admin' }]);
  });

  it('matches group DNs case-insensitively', () => {
    expect(resolveRoleFromGroups(['cn=appsec,ou=groups,dc=corp,dc=local'], mappings)).toBe('security_analyst');
  });

  it('grants the most privileged role when a user is in several mapped groups', () => {
    const role = resolveRoleFromGroups(
      ['CN=Developers,OU=Groups,DC=corp,DC=local', 'CN=SecOps,OU=Groups,DC=corp,DC=local'],
      mappings,
    );
    expect(role).toBe('admin');
  });

  it('falls back to the default role when nothing matches', () => {
    expect(resolveRoleFromGroups(['CN=Interns,DC=corp,DC=local'], mappings)).toBe('viewer');
    expect(resolveRoleFromGroups([], mappings)).toBe('viewer');
  });
});
