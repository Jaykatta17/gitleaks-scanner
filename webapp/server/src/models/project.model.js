import mongoose from 'mongoose';

export const ASSESSMENT_TYPES = ['internal', 'external', 'third_party', 'regulatory'];
export const CRITICALITIES = ['low', 'medium', 'high', 'critical'];

const projectSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, default: '', trim: true },
    repoUrl: { type: String, required: true, trim: true },
    defaultBranch: { type: String, default: 'main', trim: true },
    businessUnit: { type: String, default: '', trim: true },
    criticality: { type: String, enum: CRITICALITIES, default: 'medium', index: true },
    assessmentType: { type: String, enum: ASSESSMENT_TYPES, default: 'internal' },
    maintainerEmail: { type: String, required: true, lowercase: true, trim: true },
    tags: { type: [String], default: [], index: true },
    credentialRef: { type: String, default: '' }, // name of the secret in the vault; never the secret itself
    schedule: {
      enabled: { type: Boolean, default: false },
      cron: { type: String, default: '0 3 * * *' },
    },
    archived: { type: Boolean, default: false, index: true },
    stats: {
      lastScanAt: { type: Date },
      lastScanStatus: { type: String, default: 'never' },
      totalScans: { type: Number, default: 0 },
      openFindings: { type: Number, default: 0 },
      criticalFindings: { type: Number, default: 0 },
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

projectSchema.index({ name: 'text', key: 'text', repoUrl: 'text' });

export const Project = mongoose.model('Project', projectSchema);
export default Project;
