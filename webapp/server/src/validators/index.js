import { z } from 'zod';
import env from '../config/env.js';
import { ROLES } from '../models/user.model.js';
import {
  ASSESSMENT_TYPES,
  CRITICALITIES,
  GIT_PROVIDERS,
  BRANCH_ENVIRONMENTS,
} from '../models/application.model.js';
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

const branchName = z
  .string()
  .min(1)
  .max(200)
  .trim()
  .refine(
    (value) => !/[\s~^:?*\[\\]/.test(value) && !value.startsWith('-') && !value.endsWith('.lock'),
    'Not a valid git branch name',
  );

export const contactSchema = z.object({
  name: z.string().min(2).max(120).trim(),
  email: z.string().email().toLowerCase(),
  employeeId: z.string().max(40).trim().optional().default(''),
  department: z.string().max(120).trim().optional().default(''),
  designation: z.string().max(120).trim().optional().default(''),
  phone: z.string().max(40).trim().optional().default(''),
});

export const branchInputSchema = z.object({
  name: branchName,
  environment: z.enum(BRANCH_ENVIRONMENTS).default('other'),
  isDefault: z.boolean().default(false),
  scanEnabled: z.boolean().default(true),
  schedule: z.object({ enabled: z.boolean().default(false), cron: z.string().max(64).default('0 3 * * *') }).optional(),
  notes: z.string().max(500).trim().optional().default(''),
});

export const createApplicationSchema = z.object({
  key: z
    .string()
    .min(2)
    .max(24)
    .regex(/^[A-Za-z0-9_-]+$/, 'Letters, digits, underscore and dash only')
    .transform((value) => value.toUpperCase()),
  name: z.string().min(2).max(160).trim(),
  description: z.string().max(2000).trim().optional().default(''),
  applicationId: z.string().max(64).trim().optional().default(''),
  businessUnit: z.string().max(120).trim().optional().default(''),
  criticality: z.enum(CRITICALITIES).default('medium'),
  assessmentType: z.enum(ASSESSMENT_TYPES).default('internal'),
  environmentTier: z.string().max(60).trim().optional().default(''),

  hod: contactSchema,
  spoc: contactSchema,
  backupSpoc: contactSchema.optional(),

  repository: z.object({
    url: gitUrl,
    provider: z.enum(GIT_PROVIDERS).default('other'),
    defaultBranch: branchName.default('main'),
    visibility: z.enum(['private', 'internal', 'public']).default('private'),
    credentialRef: z.string().max(120).trim().optional().default(''),
  }),

  // Branches may be registered up front; the default branch is added automatically.
  branches: z.array(branchInputSchema).max(50).default([]),
  tags: z.array(z.string().max(40)).max(20).default([]),
});

export const updateApplicationSchema = createApplicationSchema
  .partial()
  .extend({ archived: z.boolean().optional() })
  // Branches have their own endpoints so a partial update cannot silently drop history.
  .omit({ branches: true });

export const listApplicationsSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  q: z.string().max(160).optional(),
  criticality: z.enum(CRITICALITIES).optional(),
  businessUnit: z.string().max(120).optional(),
  tag: z.string().max(40).optional(),
  archived: z.enum(['true', 'false']).optional(),
  sort: z.string().max(40).optional(),
});

export const branchParamSchema = z.object({ id: objectId, branch: branchName });
export const updateBranchSchema = branchInputSchema.partial().omit({ name: true });

export const createScanSchema = z.object({
  applicationId: objectId,
  branch: branchName.optional(),
  // Scanning a branch that is not registered yet adds it to the application.
  registerBranch: z.boolean().default(true),
  commitId: z.string().max(64).regex(/^[0-9a-fA-F]*$/, 'Commit must be a hex sha').optional().default(''),
  priority: z.coerce.number().int().min(1).max(10).optional(),
  trigger: z.enum(['manual', 'scheduled', 'api', 'webhook']).default('manual'),
});

/**
 * Two fan-out shapes:
 *   { applicationIds: [...] }              → default branch of each application
 *   { applicationId, branches: [...] }     → several branches of one application
 */
export const bulkScanSchema = z
  .object({
    applicationIds: z.array(objectId).min(1).max(100).optional(),
    applicationId: objectId.optional(),
    branches: z.array(branchName).min(1).max(50).optional(),
    allBranches: z.boolean().default(false),
    trigger: z.enum(['manual', 'scheduled', 'api', 'webhook']).default('manual'),
  })
  .refine(
    (value) => Boolean(value.applicationIds?.length) || Boolean(value.applicationId),
    'Provide either applicationIds, or an applicationId with branches',
  )
  .refine(
    (value) => !value.applicationId || value.allBranches || Boolean(value.branches?.length),
    'Specify branches or set allBranches when scanning a single application',
  );

export const listScansSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']).optional(),
  applicationId: objectId.optional(),
  branch: z.string().max(200).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sort: z.string().max(40).optional(),
});

export const listFindingsSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  severity: z.enum(SEVERITIES).optional(),
  status: z.enum(FINDING_STATUSES).optional(),
  applicationId: objectId.optional(),
  branch: z.string().max(200).optional(),
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
