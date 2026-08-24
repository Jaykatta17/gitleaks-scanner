import mongoose from 'mongoose';

export const SCAN_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled'];

const scanSchema = new mongoose.Schema(
  {
    scanId: { type: String, required: true, unique: true, index: true },
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    projectKey: { type: String, required: true, index: true },
    projectName: { type: String, required: true },
    repoUrl: { type: String, required: true },
    branch: { type: String, required: true },
    commitId: { type: String, default: '' },
    status: { type: String, enum: SCAN_STATUSES, default: 'queued', index: true },
    trigger: { type: String, enum: ['manual', 'scheduled', 'api', 'webhook'], default: 'manual' },
    jobId: { type: String, default: '' },
    attempts: { type: Number, default: 0 },
    queuedAt: { type: Date, default: Date.now, index: true },
    startedAt: { type: Date },
    finishedAt: { type: Date },
    durationMs: { type: Number, default: 0 },
    driver: { type: String, default: 'mock' },
    summary: {
      total: { type: Number, default: 0 },
      critical: { type: Number, default: 0 },
      high: { type: Number, default: 0 },
      medium: { type: Number, default: 0 },
      low: { type: Number, default: 0 },
      filesScanned: { type: Number, default: 0 },
      commitsScanned: { type: Number, default: 0 },
      truncated: { type: Boolean, default: false },
    },
    error: {
      message: { type: String },
      stage: { type: String },
    },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    requestedByName: { type: String, default: '' },
    logs: {
      type: [
        {
          at: { type: Date, default: Date.now },
          level: { type: String, default: 'info' },
          message: { type: String },
        },
      ],
      default: [],
    },
  },
  { timestamps: true, toJSON: { virtuals: true } },
);

scanSchema.index({ project: 1, createdAt: -1 });
scanSchema.index({ status: 1, createdAt: -1 });

export const Scan = mongoose.model('Scan', scanSchema);
export default Scan;
