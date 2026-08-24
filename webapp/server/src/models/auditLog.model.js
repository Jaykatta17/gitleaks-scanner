import mongoose from 'mongoose';
import env from '../config/env.js';

export const AUDIT_OUTCOMES = ['success', 'failure', 'denied'];
export const AUDIT_CATEGORIES = [
  'authentication',
  'authorization',
  'user_management',
  'project_management',
  'scan',
  'finding',
  'configuration',
  'data_access',
  'system',
];

const auditLogSchema = new mongoose.Schema(
  {
    eventId: { type: String, required: true, unique: true },
    action: { type: String, required: true, index: true },
    category: { type: String, enum: AUDIT_CATEGORIES, default: 'system', index: true },
    outcome: { type: String, enum: AUDIT_OUTCOMES, default: 'success', index: true },
    severity: { type: String, default: 'info', index: true },
    actor: {
      id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      username: { type: String, default: 'anonymous', index: true },
      displayName: { type: String, default: '' },
      role: { type: String, default: '' },
      authProvider: { type: String, default: '' },
    },
    target: {
      type: { type: String, default: '' },
      id: { type: String, default: '' },
      name: { type: String, default: '' },
    },
    context: {
      ip: { type: String, default: '' },
      userAgent: { type: String, default: '' },
      requestId: { type: String, default: '', index: true },
      method: { type: String, default: '' },
      path: { type: String, default: '' },
      statusCode: { type: Number },
      durationMs: { type: Number },
    },
    message: { type: String, default: '' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    forwardedToSyslog: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ 'actor.username': 1, createdAt: -1 });
auditLogSchema.index({ category: 1, outcome: 1, createdAt: -1 });
// Retention is enforced by Mongo itself so audit trails cannot silently outlive policy.
auditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: env.audit.retentionDays * 24 * 60 * 60 });

export const AuditLog = mongoose.model('AuditLog', auditLogSchema);
export default AuditLog;
