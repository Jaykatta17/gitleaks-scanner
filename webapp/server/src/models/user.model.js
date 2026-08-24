import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import env from '../config/env.js';

export const ROLES = ['admin', 'security_analyst', 'developer', 'viewer'];
export const AUTH_PROVIDERS = ['local', 'ldap'];

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    displayName: { type: String, required: true, trim: true },
    department: { type: String, trim: true, default: '' },
    passwordHash: { type: String, select: false },
    passwordHistory: { type: [String], select: false, default: [] },
    passwordChangedAt: { type: Date },
    mustChangePassword: { type: Boolean, default: false },
    authProvider: { type: String, enum: AUTH_PROVIDERS, default: 'local', index: true },
    ldapDn: { type: String, default: '' },
    role: { type: String, enum: ROLES, default: 'viewer', index: true },
    status: { type: String, enum: ['active', 'disabled', 'pending'], default: 'active', index: true },
    mfa: {
      enabled: { type: Boolean, default: false },
      secret: { type: String, select: false },
      pendingSecret: { type: String, select: false },
      recoveryCodes: { type: [String], select: false, default: [] },
      enrolledAt: { type: Date },
    },
    failedLoginAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    lastLoginAt: { type: Date },
    lastLoginIp: { type: String },
    notificationPreferences: {
      scanCompleted: { type: Boolean, default: true },
      criticalFinding: { type: Boolean, default: true },
      weeklyDigest: { type: Boolean, default: false },
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_doc, ret) => {
        delete ret.passwordHash;
        delete ret.passwordHistory;
        delete ret.__v;
        if (ret.mfa) {
          delete ret.mfa.secret;
          delete ret.mfa.pendingSecret;
          delete ret.mfa.recoveryCodes;
        }
        return ret;
      },
    },
  },
);

userSchema.virtual('isLocked').get(function isLocked() {
  return Boolean(this.lockedUntil && this.lockedUntil > new Date());
});

userSchema.methods.verifyPassword = function verifyPassword(candidate) {
  if (!this.passwordHash) return Promise.resolve(false);
  return bcrypt.compare(candidate, this.passwordHash);
};

userSchema.methods.setPassword = async function setPassword(plain) {
  const hash = await bcrypt.hash(plain, env.security.bcryptRounds);
  const history = [this.passwordHash, ...(this.passwordHistory || [])].filter(Boolean);
  this.passwordHash = hash;
  this.passwordHistory = history.slice(0, env.security.passwordHistory);
  this.passwordChangedAt = new Date();
  this.mustChangePassword = false;
  return hash;
};

userSchema.methods.isPasswordReused = async function isPasswordReused(plain) {
  const hashes = [this.passwordHash, ...(this.passwordHistory || [])].filter(Boolean);
  for (const hash of hashes) {
    // eslint-disable-next-line no-await-in-loop -- history is capped at PASSWORD_HISTORY entries
    if (await bcrypt.compare(plain, hash)) return true;
  }
  return false;
};

userSchema.index({ displayName: 'text', email: 'text', username: 'text' });

export const User = mongoose.model('User', userSchema);
export default User;
