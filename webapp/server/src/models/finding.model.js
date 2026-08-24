import mongoose from 'mongoose';

export const SEVERITIES = ['critical', 'high', 'medium', 'low'];
export const FINDING_STATUSES = ['open', 'triaged', 'false_positive', 'remediated', 'accepted_risk'];

const findingSchema = new mongoose.Schema(
  {
    fingerprint: { type: String, required: true, index: true },
    scan: { type: mongoose.Schema.Types.ObjectId, ref: 'Scan', required: true, index: true },
    scanId: { type: String, required: true, index: true },
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    projectKey: { type: String, required: true, index: true },
    ruleId: { type: String, required: true, index: true },
    description: { type: String, default: '' },
    severity: { type: String, enum: SEVERITIES, default: 'medium', index: true },
    status: { type: String, enum: FINDING_STATUSES, default: 'open', index: true },
    file: { type: String, required: true },
    startLine: { type: Number, default: 0 },
    endLine: { type: Number, default: 0 },
    commit: { type: String, default: '' },
    author: { type: String, default: '' },
    authorEmail: { type: String, default: '' },
    committedAt: { type: Date },
    entropy: { type: Number, default: 0 },
    // Only a redacted preview is persisted; the raw secret never leaves the worker.
    secretPreview: { type: String, default: '' },
    matchPreview: { type: String, default: '' },
    tags: { type: [String], default: [] },
    triage: {
      assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      note: { type: String, default: '' },
      updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      updatedAt: { type: Date },
    },
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

findingSchema.index({ project: 1, fingerprint: 1 }, { unique: false });
findingSchema.index({ projectKey: 1, severity: 1, status: 1 });
findingSchema.index({ createdAt: -1 });

export const Finding = mongoose.model('Finding', findingSchema);
export default Finding;
