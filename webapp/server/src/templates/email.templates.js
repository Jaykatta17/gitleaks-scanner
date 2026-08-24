import env from '../config/env.js';

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const layout = ({ title, intro, body, cta, footerNote }) => `
<!doctype html>
<html><body style="margin:0;padding:24px;background:#eef2f9;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2a44">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0"
             style="background:rgba(255,255,255,0.92);border:1px solid #dbe3f0;border-radius:16px;overflow:hidden">
        <tr><td style="padding:22px 28px;background:linear-gradient(135deg,#4f6ef7,#7aa7ff);color:#fff">
          <div style="font-size:13px;letter-spacing:.14em;text-transform:uppercase;opacity:.85">${escapeHtml(env.appName)}</div>
          <div style="font-size:22px;font-weight:600;margin-top:6px">${escapeHtml(title)}</div>
        </td></tr>
        <tr><td style="padding:28px">
          <p style="margin:0 0 16px;font-size:15px;line-height:1.6">${intro}</p>
          ${body || ''}
          ${
            cta
              ? `<p style="margin:26px 0 8px"><a href="${escapeHtml(cta.url)}"
                   style="display:inline-block;padding:12px 22px;background:#4f6ef7;color:#fff;border-radius:10px;
                   text-decoration:none;font-weight:600">${escapeHtml(cta.label)}</a></p>
                 <p style="margin:0;font-size:12px;color:#6b7793">If the button does not work, paste this link into your browser:<br>${escapeHtml(cta.url)}</p>`
              : ''
          }
        </td></tr>
        <tr><td style="padding:16px 28px;background:#f6f8fd;border-top:1px solid #e3e9f4;font-size:12px;color:#6b7793">
          ${escapeHtml(footerNote || 'This is an automated message from the security scanning platform. Please do not reply.')}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

const table = (rows) => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 4px;font-size:14px">
  ${rows
    .map(
      ([label, value]) => `<tr>
        <td style="padding:7px 0;color:#6b7793;width:42%">${escapeHtml(label)}</td>
        <td style="padding:7px 0;font-weight:600">${escapeHtml(value)}</td>
      </tr>`,
    )
    .join('')}
</table>`;

export const TEMPLATES = {
  welcome: (data) => ({
    subject: `Your ${env.appName} account is ready`,
    html: layout({
      title: 'Welcome aboard',
      intro: `Hello ${escapeHtml(data.displayName)}, an account has been created for you on ${escapeHtml(env.appName)}.`,
      body: table([
        ['Username', data.username],
        ['Role', data.role],
        ['Sign-in method', data.authProvider === 'ldap' ? 'Corporate directory (LDAP)' : 'Local password'],
      ]),
      cta: { label: 'Open the console', url: `${env.publicUrl}/login` },
    }),
  }),

  passwordReset: (data) => ({
    subject: 'Reset your password',
    html: layout({
      title: 'Password reset requested',
      intro: `A password reset was requested for <strong>${escapeHtml(data.username)}</strong>. This link expires in ${escapeHtml(data.expiresInMinutes)} minutes.`,
      body: table([
        ['Requested at', data.requestedAt],
        ['Source IP', data.ip || 'unknown'],
      ]),
      cta: { label: 'Choose a new password', url: `${env.publicUrl}/reset-password?token=${encodeURIComponent(data.token)}` },
      footerNote: 'If you did not request this, no action is needed — the link can be ignored and the event has been audited.',
    }),
  }),

  passwordChanged: (data) => ({
    subject: 'Your password was changed',
    html: layout({
      title: 'Password changed',
      intro: `The password for <strong>${escapeHtml(data.username)}</strong> was changed successfully.`,
      body: table([
        ['Changed at', data.changedAt],
        ['Source IP', data.ip || 'unknown'],
      ]),
      footerNote: 'If this was not you, contact your security administrator immediately.',
    }),
  }),

  scanCompleted: (data) => ({
    subject: `[${data.severityLabel}] Scan ${data.scanId} — ${data.projectName}`,
    html: layout({
      title: 'Secret scan completed',
      intro: `Scan <strong>${escapeHtml(data.scanId)}</strong> for <strong>${escapeHtml(data.projectName)}</strong> finished with <strong>${escapeHtml(data.total)}</strong> finding(s).`,
      body: table([
        ['Repository', data.repoUrl],
        ['Branch', data.branch],
        ['Commit', data.commitId || 'HEAD'],
        ['Critical', data.critical],
        ['High', data.high],
        ['Medium', data.medium],
        ['Low', data.low],
        ['Duration', `${data.durationSeconds}s`],
      ]),
      cta: { label: 'Review the findings', url: `${env.publicUrl}/scans/${encodeURIComponent(data.scanId)}` },
    }),
  }),

  scanFailed: (data) => ({
    subject: `[FAILED] Scan ${data.scanId} — ${data.projectName}`,
    html: layout({
      title: 'Secret scan failed',
      intro: `Scan <strong>${escapeHtml(data.scanId)}</strong> for <strong>${escapeHtml(data.projectName)}</strong> could not be completed.`,
      body: table([
        ['Repository', data.repoUrl],
        ['Branch', data.branch],
        ['Stage', data.stage || 'unknown'],
        ['Reason', data.reason || 'unknown'],
        ['Attempts', data.attempts],
      ]),
      cta: { label: 'Inspect the scan', url: `${env.publicUrl}/scans/${encodeURIComponent(data.scanId)}` },
    }),
  }),

  criticalFinding: (data) => ({
    subject: `[CRITICAL] ${data.count} critical secret(s) in ${data.projectName}`,
    html: layout({
      title: 'Critical secrets detected',
      intro: `<strong>${escapeHtml(data.count)}</strong> critical finding(s) were detected in <strong>${escapeHtml(data.projectName)}</strong>. Rotate the affected credentials immediately.`,
      body: `${table([
        ['Scan', data.scanId],
        ['Branch', data.branch],
        ['Maintainer', data.maintainerEmail],
      ])}
      <ul style="font-size:14px;line-height:1.7;padding-left:18px;margin:12px 0 0">
        ${(data.samples || []).map((sample) => `<li><code>${escapeHtml(sample.file)}:${escapeHtml(sample.startLine)}</code> — ${escapeHtml(sample.ruleId)}</li>`).join('')}
      </ul>`,
      cta: { label: 'Open the finding queue', url: `${env.publicUrl}/findings?severity=critical` },
    }),
  }),

  securityAlert: (data) => ({
    subject: `[SECURITY] ${data.title}`,
    html: layout({
      title: data.title,
      intro: escapeHtml(data.summary),
      body: table(Object.entries(data.details || {})),
      footerNote: 'This alert was generated by the platform audit pipeline and mirrored to syslog.',
    }),
  }),
};

export const renderTemplate = (name, data = {}) => {
  const builder = TEMPLATES[name];
  if (!builder) throw new Error(`Unknown email template: ${name}`);
  const { subject, html } = builder(data);
  const text = html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { subject, html, text };
};

export default TEMPLATES;
