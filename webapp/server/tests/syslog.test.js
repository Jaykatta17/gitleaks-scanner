import { describe, it, expect } from 'vitest';
import { formatRfc5424, formatRfc3164, buildStructuredData, SEVERITY, SyslogClient } from '../src/config/syslog.js';
import { buildAuditEvent } from '../src/services/audit.service.js';

describe('RFC 5424 framing', () => {
  const at = new Date('2026-02-01T10:20:30.000Z');

  it('encodes priority as facility * 8 + severity', () => {
    const line = formatRfc5424({ facility: 13, severity: SEVERITY.warning, timestamp: at, hostname: 'app01', appName: 'sentinel', procId: '42', msgId: 'auth.login.failed', message: 'nope' });
    expect(line.startsWith('<108>1 ')).toBe(true);
  });

  it('emits the header fields in order with a BOM before the message', () => {
    const line = formatRfc5424({ facility: 13, severity: SEVERITY.info, timestamp: at, hostname: 'app01', appName: 'sentinel', procId: '42', msgId: 'scan.completed', message: 'done' });
    const [pri, ts, host, app, proc, msgId] = line.split(' ');
    expect(pri).toBe('<110>1');
    expect(ts).toBe('2026-02-01T10:20:30.000Z');
    expect([host, app, proc, msgId]).toEqual(['app01', 'sentinel', '42', 'scan.completed']);
    expect(line).toContain('﻿done');
  });

  it('escapes structured-data values so a quote cannot break out of the element', () => {
    const sd = buildStructuredData('audit@32473', { actor: 'a"b]c\\d', empty: '' });
    expect(sd).toBe('[audit@32473 actor="a\\"b\\]c\\\\d"]');
  });

  it('uses a nil structured-data marker when there is nothing to attach', () => {
    expect(buildStructuredData('audit@32473', {})).toBe('-');
  });

  it('falls back to nil tokens for unprintable host or app names', () => {
    const line = formatRfc5424({ facility: 1, severity: 6, timestamp: at, hostname: '\n\t', appName: 'sentinel', procId: '1', msgId: '-', message: 'x' });
    expect(line.split(' ')[2]).toBe('-');
  });

  it('formats RFC 3164 with a BSD timestamp and bracketed pid', () => {
    const line = formatRfc3164({ facility: 13, severity: SEVERITY.error, timestamp: at, hostname: 'app01', appName: 'sentinel', procId: '42', message: 'boom' });
    expect(line).toMatch(/^<107>[A-Z][a-z]{2} [ \d]\d \d{2}:\d{2}:\d{2} app01 sentinel\[42\]: boom$/);
  });
});

describe('audit event to syslog record', () => {
  it('carries actor, target and origin as structured data', () => {
    const client = new SyslogClient({ enabled: true, facility: 13, hostname: 'app01', appName: 'sentinel', rfc: '5424' });
    const event = buildAuditEvent({
      action: 'user.role.changed',
      category: 'user_management',
      outcome: 'success',
      actor: { username: 'admin', role: 'admin', authProvider: 'local' },
      target: { type: 'user', id: '651f', name: 'jdoe' },
      context: { ip: '10.1.2.3', requestId: 'req-1', method: 'PATCH', path: '/api/v1/users/651f', statusCode: 200 },
      message: 'admin changed the role of jdoe',
    });
    const line = client.format({
      severity: SEVERITY.notice,
      msgId: event.action,
      structuredData:
        buildStructuredData('audit@32473', { actor: event.actor.username, targetName: event.target.name }) +
        buildStructuredData('origin@32473', { ip: event.context.ip, requestId: event.context.requestId }),
      message: event.message,
    });
    expect(line).toContain('user.role.changed');
    expect(line).toContain('[audit@32473 actor="admin" targetName="jdoe"]');
    expect(line).toContain('[origin@32473 ip="10.1.2.3" requestId="req-1"]');
  });

  it('escalates failures to warning severity', () => {
    const failure = buildAuditEvent({ action: 'auth.login.failed', outcome: 'failure', actor: { username: 'jdoe' } });
    const success = buildAuditEvent({ action: 'auth.login.success', outcome: 'success', actor: { username: 'jdoe' } });
    expect(failure.severity).toBe('warning');
    expect(success.severity).toBe('info');
  });

  it('redacts sensitive metadata before it can reach a collector', () => {
    const event = buildAuditEvent({
      action: 'auth.login.failed',
      outcome: 'failure',
      actor: { username: 'jdoe' },
      metadata: { password: 'hunter2', nested: { refreshToken: 'abc' }, attempts: 2 },
    });
    expect(event.metadata.password).toBe('[redacted]');
    expect(event.metadata.nested.refreshToken).toBe('[redacted]');
    expect(event.metadata.attempts).toBe(2);
  });

  it('does not send when disabled', () => {
    const client = new SyslogClient({ enabled: false });
    expect(client.send({ message: 'x' })).toBe(false);
  });
});
