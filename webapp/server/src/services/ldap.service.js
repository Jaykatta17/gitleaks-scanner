import { Client } from 'ldapts';
import env from '../config/env.js';
import logger from '../config/logger.js';
import { AppError } from '../utils/errors.js';

/**
 * Directory integration. Uses the classic bind → search → re-bind flow:
 *   1. bind as the service account
 *   2. search for the user entry by the configured filter
 *   3. bind as the found DN with the supplied password (the actual auth check)
 *   4. resolve group memberships and map them onto application roles
 */

const escapeFilterValue = (value) =>
  String(value).replace(/[\\*()\0]/g, (char) => `\\${char.charCodeAt(0).toString(16).padStart(2, '0')}`);

export const renderFilter = (template, values) =>
  Object.entries(values).reduce(
    (acc, [key, value]) => acc.replaceAll(`{{${key}}}`, escapeFilterValue(value)),
    template,
  );

export const parseRoleMappings = (mappings = env.ldap.roleMappings) => {
  const parsed = [];
  for (const mapping of mappings) {
    const separator = mapping.lastIndexOf(':');
    if (separator === -1) continue;
    const groupDn = mapping.slice(0, separator).trim().toLowerCase();
    const role = mapping.slice(separator + 1).trim();
    if (groupDn && role) parsed.push({ groupDn, role });
  }
  return parsed;
};

const ROLE_PRIORITY = ['admin', 'security_analyst', 'developer', 'viewer'];

export const resolveRoleFromGroups = (groupDns = [], mappings = parseRoleMappings()) => {
  const normalized = groupDns.map((dn) => String(dn).toLowerCase());
  const matched = mappings.filter((mapping) => normalized.includes(mapping.groupDn)).map((mapping) => mapping.role);
  if (!matched.length) return env.ldap.defaultRole;
  return ROLE_PRIORITY.find((role) => matched.includes(role)) || matched[0];
};

const attr = (entry, name) => {
  const value = entry?.[name];
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
};

const createClient = () =>
  new Client({
    url: env.ldap.url,
    timeout: env.ldap.timeoutMs,
    connectTimeout: env.ldap.timeoutMs,
    tlsOptions: { rejectUnauthorized: env.ldap.tlsRejectUnauthorized },
  });

export const isLdapEnabled = () => env.ldap.enabled;

/**
 * @returns {Promise<{dn,username,email,displayName,department,groups,role}|null>}
 *          null when the credentials are rejected; throws on infrastructure errors.
 */
export const authenticateLdapUser = async (username, password) => {
  if (!env.ldap.enabled) throw new AppError('LDAP authentication is disabled', { status: 400, code: 'ldap_disabled' });
  if (!password) return null;

  const client = createClient();
  let userClient = null;
  try {
    if (env.ldap.bindDn) await client.bind(env.ldap.bindDn, env.ldap.bindCredentials);

    const { searchEntries } = await client.search(env.ldap.searchBase, {
      scope: 'sub',
      filter: renderFilter(env.ldap.searchFilter, { username }),
      attributes: [
        env.ldap.attributes.username,
        env.ldap.attributes.email,
        env.ldap.attributes.displayName,
        env.ldap.attributes.department,
        'memberOf',
      ],
      sizeLimit: 2,
    });

    if (!searchEntries.length) {
      logger.warn('ldap user not found', { event: 'ldap.user_not_found', username });
      return null;
    }
    if (searchEntries.length > 1) {
      logger.warn('ldap filter matched multiple entries', { event: 'ldap.ambiguous_user', username });
      return null;
    }

    const entry = searchEntries[0];
    userClient = createClient();
    try {
      await userClient.bind(entry.dn, password);
    } catch (error) {
      logger.warn('ldap bind rejected', { event: 'ldap.bind_rejected', username, error: error.message });
      return null;
    }

    let groups = Array.isArray(entry.memberOf) ? entry.memberOf : [entry.memberOf].filter(Boolean);
    if (env.ldap.groupSearchBase) {
      const { searchEntries: groupEntries } = await client.search(env.ldap.groupSearchBase, {
        scope: 'sub',
        filter: renderFilter(env.ldap.groupSearchFilter, { dn: entry.dn, username }),
        attributes: ['dn', 'cn'],
      });
      groups = [...new Set([...groups, ...groupEntries.map((group) => group.dn)])];
    }

    return {
      dn: entry.dn,
      username: (attr(entry, env.ldap.attributes.username) || username).toLowerCase(),
      email: (attr(entry, env.ldap.attributes.email) || '').toLowerCase(),
      displayName: attr(entry, env.ldap.attributes.displayName) || username,
      department: attr(entry, env.ldap.attributes.department) || '',
      groups,
      role: resolveRoleFromGroups(groups),
    };
  } finally {
    await Promise.allSettled([client.unbind(), userClient?.unbind()]);
  }
};

/** Connectivity probe used by the settings screen and the health endpoint. */
export const testLdapConnection = async () => {
  if (!env.ldap.enabled) return { ok: false, enabled: false, message: 'LDAP is disabled' };
  const client = createClient();
  const startedAt = Date.now();
  try {
    if (env.ldap.bindDn) await client.bind(env.ldap.bindDn, env.ldap.bindCredentials);
    const { searchEntries } = await client.search(env.ldap.searchBase, {
      scope: 'base',
      filter: '(objectClass=*)',
      attributes: ['dn'],
      sizeLimit: 1,
    });
    return {
      ok: true,
      enabled: true,
      url: env.ldap.url,
      searchBase: env.ldap.searchBase,
      baseFound: searchEntries.length > 0,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return { ok: false, enabled: true, url: env.ldap.url, message: error.message, latencyMs: Date.now() - startedAt };
  } finally {
    await client.unbind().catch(() => {});
  }
};
