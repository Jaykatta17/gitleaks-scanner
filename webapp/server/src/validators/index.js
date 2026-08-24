import { z } from 'zod';
import env from '../config/env.js';
import { ROLES } from '../models/user.model.js';
import { ASSESSMENT_TYPES, CRITICALITIES } from '../models/project.model.js';
import { SEVERITIES, FINDING_STATUSES } from '../models/finding.model.js';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Must be a valid id');

/** Enterprise password policy: length + 3 of 4 character classes + no reuse (checked in the service). */
export const passwordSchema = z
  .string()
  .min(env.security.passwordMinLength, `Password must be at least ${env.security.passwordMinLength} characters`)
  .max(128)
  .refine((value) => {
    const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(value)).length;
    return classes >= 3;
  }, 'Password must combine at least three of: lowercase, uppercase, digits, symbols');

export const loginSchema = z.object({
  username: z.string().min(1).max(128).trim().toLowerCase(),
  password: z.string().min(1).max(256),
  provider: z.enum(['local', 'ldap', 'auto']).default('auto'),
  mfaCode: z.string().regex(/^\d{6}$|^[A-Z0-9-]{8,24}$/, 'Invalid verification code').optional(),
});

export const refreshSchema = z.object({ refreshToken: z.string().min(10).optional() });

export const forgotPasswordSchema = z.object({ email: z.string().email().toLowerCase() });

export const resetPasswordSchema = z.object({
  token: z.string().min(10),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema,
});

export const mfaVerifySchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });

export const updateProfileSchema = z.object({
  displayName: z.string().min(2).max(120).trim().optional(),
  department: z.string().max(120).trim().optional(),
  notificationPreferences: z
    .object({
      scanCompleted: z.boolean().optional(),
      criticalFinding: z.boolean().optional(),
      weeklyDigest: z.boolean().optional(),
    })
    .optional(),
});

export const createUserSchema = z.object({
  username: z.string().min(2).max(64).regex(/^[a-zA-Z0-9._-]+$/, 'Letters, digits, dot, underscore and dash only').toLowerCase(),
  email: z.string().email().toLowerCase(),
  displayName: z.string().min(2).max(120).trim(),
  department: z.string().max(120).trim().optional().default(''),
  role: z.enum(ROLES).default('viewer'),
  authProvider: z.enum(['local', 'ldap']).default('local'),
  password: passwordSchema.optional(),
  sendWelcomeEmail: z.boolean().default(true),
});

export const updateUserSchema = z.object({
  email: z.string().email().toLowerCase().optional(),
  displayName: z.string().min(2).max(120).trim().optional(),
  department: z.string().max(120).trim().optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(['active', 'disabled', 'pending']).optional(),
  mustChangePassword: z.boolean().optional(),
});

export const listUsersSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  q: z.string().max(120).optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(['active', 'disabled', 'pending']).optional(),
  authProvider: z.enum(['local', 'ldap']).optional(),
  sort: z.string().max(40).optional(),
});

const gitUrl = z
  .string()
  .min(4)
  .max(512)
  .refine(
    (value) => /^(https?:\/\/|git@|ssh:\/\/)/.test(value),
    'Repository URL must start with http(s)://, ssh:// or git@',
  );

export const createProjectSchema = z.object({
  key: z.string().min(2).max(24).regex(/^[A-Za-z0-9_-]+$/, 'Letters, digits, underscore and dash only').transform((v) => v.toUpperCase()),
  name: z.string().min(2).max(160).trim(),
  description: z.string().max(2000).trim().optional().default(''),
  repoUrl: gitUrl,
  defaultBranch: z.string().min(1).max(120).default('main'),
  businessUnit: z.string().max(120).trim().optional().default(''),
  criticality: z.enum(CRITICALITIES).default('medium'),
  assessmentType: z.enum(ASSESSMENT_TYPES).default('internal'),
  maintainerEmail: z.string().email().toLowerCase(),
  tags: z.array(z.string().max(40)).max(20).default([]),
  credentialRef: z.string().max(120).optional().default(''),
  schedule: z.object({ enabled: z.boolean().default(false), cron: z.string().max(64).default('0 3 * * *') }).optional(),
});

export const updateProjectSchema = createProjectSchema.partial().extend({ archived: z.boolean().optional() });

export const listProjectsSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  q: z.string().max(160).optional(),
  criticality: z.enum(CRITICALITIES).optional(),
  tag: z.string().max(40).optional(),
  archived: z.enum(['true', 'false']).optional(),
  sort: z.string().max(40).optional(),
});

export const createScanSchema = z.object({
  projectId: objectId,
  branch: z.string().min(1).max(120).optional(),
  commitId: z.string().max(64).regex(/^[0-9a-fA-F]*$/, 'Commit must be a hex sha').optional().default(''),
  priority: z.coerce.number().int().min(1).max(10).optional(),
  trigger: z.enum(['manual', 'scheduled', 'api', 'webhook']).default('manual'),
});

export const bulkScanSchema = z.object({
  projectIds: z.array(objectId).min(1).max(100),
  trigger: z.enum(['manual', 'scheduled', 'api', 'webhook']).default('manual'),
});

export const listScansSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']).optional(),
  projectId: objectId.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sort: z.string().max(40).optional(),
});

export const listFindingsSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  severity: z.enum(SEVERITIES).optional(),
  status: z.enum(FINDING_STATUSES).optional(),
  projectId: objectId.optional(),
  scanId: z.string().max(64).optional(),
  ruleId: z.string().max(80).optional(),
  q: z.string().max(160).optional(),
  sort: z.string().max(40).optional(),
});

export const updateFindingSchema = z.object({
  status: z.enum(FINDING_STATUSES).optional(),
  severity: z.enum(SEVERITIES).optional(),
  note: z.string().max(2000).optional(),
  assignee: objectId.nullable().optional(),
});

export const bulkFindingSchema = z.object({
  ids: z.array(objectId).min(1).max(500),
  status: z.enum(FINDING_STATUSES),
  note: z.string().max(2000).optional(),
});

export const listAuditSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  action: z.string().max(80).optional(),
  category: z.string().max(40).optional(),
  outcome: z.enum(['success', 'failure', 'denied']).optional(),
  actor: z.string().max(80).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  q: z.string().max(160).optional(),
});

export const idParamSchema = z.object({ id: objectId });
export const settingsSchema = z.object({
  key: z.string().min(2).max(80),
  value: z.union([z.string().max(2000), z.number(), z.boolean(), z.record(z.any())]),
  description: z.string().max(300).optional(),
});
export const testEmailSchema = z.object({ to: z.string().email() });
