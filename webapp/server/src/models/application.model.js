import mongoose from 'mongoose';

export const ASSESSMENT_TYPES = ['internal', 'external', 'third_party', 'regulatory'];
export const CRITICALITIES = ['low', 'medium', 'high', 'critical'];
export const GIT_PROVIDERS = ['github', 'gitlab', 'bitbucket', 'azure_devops', 'gitea', 'other'];
export const BRANCH_ENVIRONMENTS = ['production', 'staging', 'development', 'release', 'feature', 'other'];

/** Head of department / SPOC contact block — who answers for this application. */
const contactSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    employeeId: { type: String, default: '', trim: true },
    department: { type: String, default: '', trim: true },
    designation: { type: String, default: '', trim: true },
    phone: { type: String, default: '', trim: true },
  },
  { _id: false },
);

/**
 * A branch registered for scanning. Each one carries its own rolling statistics,
 * so an application can be scanned repeatedly across several branches and the
 * results stay separated per branch.
 */
const branchSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    environment: { type: String, enum: BRANCH_ENVIRONMENTS, default: 'other' },
    isDefault: { type: Boolean, default: false },
    scanEnabled: { type: Boolean, default: true },
    schedule: {
      enabled: { type: Boolean, default: false },
      cron: { type: String, default: '0 3 * * *' },
    },
    notes: { type: String, default: '', trim: true },
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    stats: {
      lastScanId: { type: String, default: '' },
      lastScanAt: { type: Date },
      lastScanStatus: { type: String, default: 'never' },
      totalScans: { type: Number, default: 0 },
      openFindings: { type: Number, default: 0 },
      criticalFindings: { type: Number, default: 0 },
    },
  },
  { _id: false },
);

const applicationSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    applicationId: { type: String, default: '', trim: true, index: true }, // CMDB / inventory reference
    businessUnit: { type: String, default: '', trim: true, index: true },
    criticality: { type: String, enum: CRITICALITIES, default: 'medium', index: true },
    assessmentType: { type: String, enum: ASSESSMENT_TYPES, default: 'internal' },
    environmentTier: { type: String, default: '', trim: true },

    hod: { type: contactSchema, required: true },
    spoc: { type: contactSchema, required: true },
    backupSpoc: { type: contactSchema, default: undefined },

    repository: {
      url: { type: String, required: true, trim: true },
      provider: { type: String, enum: GIT_PROVIDERS, default: 'other' },
      defaultBranch: { type: String, default: 'main', trim: true },
      visibility: { type: String, enum: ['private', 'internal', 'public'], default: 'private' },
      // Name of the credential in the vault — never the credential itself.
      credentialRef: { type: String, default: '', trim: true },
    },

    branches: { type: [branchSchema], default: [] },

    tags: { type: [String], default: [], index: true },
    archived: { type: Boolean, default: false, index: true },

    stats: {
      lastScanAt: { type: Date },
      lastScanStatus: { type: String, default: 'never' },
      totalScans: { type: Number, default: 0 },
      openFindings: { type: Number, default: 0 },
      criticalFindings: { type: Number, default: 0 },
      branchCount: { type: Number, default: 0 },
    },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

applicationSchema.index({ name: 'text', key: 'text', 'repository.url': 'text', 'hod.name': 'text', 'spoc.name': 'text' });

/**
 * Branch names are unique per application and exactly one branch is the default;
 * the repository's default branch always names that branch.
 *
 * Exported so the rule can be unit-tested without a database — it decides which
 * branch a scan runs against when the caller does not name one.
 */
export const normalizeBranches = (branches = [], preferredDefault = '') => {
  const seen = new Set();
  const unique = branches.filter((branch) => {
    const name = branch?.name?.trim();
    if (!name || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
  if (!unique.length) return { branches: unique, defaultBranch: preferredDefault };

  const declared = unique.filter((branch) => branch.isDefault);
  let chosen = declared.length === 1 ? declared[0] : null;
  if (!chosen) chosen = unique.find((branch) => branch.name === preferredDefault) || unique[0];
  unique.forEach((branch) => {
    branch.isDefault = branch === chosen;
  });
  return { branches: unique, defaultBranch: chosen.name };
};

applicationSchema.pre('save', function applyBranchRules(next) {
  const { branches, defaultBranch } = normalizeBranches(this.branches, this.repository.defaultBranch);
  this.branches = branches;
  if (defaultBranch) this.repository.defaultBranch = defaultBranch;
  this.stats.branchCount = this.branches.length;
  next();
});

applicationSchema.methods.findBranch = function findBranch(name) {
  return this.branches.find((branch) => branch.name === name);
};

export const Application = mongoose.model('Application', applicationSchema);
export default Application;
