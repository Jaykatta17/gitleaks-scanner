import nodemailer from 'nodemailer';
import env from '../config/env.js';
import logger from '../config/logger.js';
import { renderTemplate, TEMPLATES } from '../templates/email.templates.js';

let transporter = null;

export const getTransporter = () => {
  if (transporter) return transporter;
  if (!env.smtp.enabled) {
    // Streams the message to the log instead of the network so local runs still
    // exercise the full template + queue path.
    transporter = nodemailer.createTransport({ jsonTransport: true });
    return transporter;
  }
  transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.secure,
    pool: true,
    maxConnections: env.smtp.poolSize,
    auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.password } : undefined,
    tls: { rejectUnauthorized: env.smtp.tlsRejectUnauthorized },
  });
  return transporter;
};

export const resetTransporter = () => {
  transporter?.close?.();
  transporter = null;
};

export const sendMail = async ({ to, subject, html, text, cc, bcc, replyTo }) => {
  const message = {
    from: env.smtp.from,
    to,
    cc,
    bcc,
    replyTo: replyTo || env.smtp.replyTo || undefined,
    subject,
    html,
    text: text || html?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  };
  const info = await getTransporter().sendMail(message);
  logger.info('mail sent', {
    event: 'mail.sent',
    to: Array.isArray(to) ? to.join(',') : to,
    subject,
    messageId: info.messageId,
    delivered: env.smtp.enabled,
  });
  return { messageId: info.messageId, accepted: info.accepted ?? [], simulated: !env.smtp.enabled };
};

/** Renders a named template and sends it. Used directly by the email worker. */
export const sendTemplateMail = async ({ to, template, data = {}, subject }) => {
  if (!TEMPLATES[template]) throw new Error(`Unknown email template: ${template}`);
  const rendered = renderTemplate(template, data);
  return sendMail({ to, subject: subject || rendered.subject, html: rendered.html, text: rendered.text });
};

export const verifySmtp = async () => {
  if (!env.smtp.enabled) return { ok: false, enabled: false, message: 'SMTP is disabled (messages are logged only)' };
  const startedAt = Date.now();
  try {
    await getTransporter().verify();
    return { ok: true, enabled: true, host: env.smtp.host, port: env.smtp.port, latencyMs: Date.now() - startedAt };
  } catch (error) {
    return { ok: false, enabled: true, host: env.smtp.host, port: env.smtp.port, message: error.message };
  }
};
