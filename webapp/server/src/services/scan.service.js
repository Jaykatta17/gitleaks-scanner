import dayjs from 'dayjs';
import { customAlphabet } from 'nanoid';
import { Project } from '../models/project.model.js';
import { Scan } from '../models/scan.model.js';
import { enqueueScan } from '../queues/index.js';
import { badRequest, notFound } from '../utils/errors.js';

const suffix = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

export const generateScanId = () => `GLS-${dayjs().format('YYYYMMDD')}-${suffix()}`;

/**
 * Creates the Scan document first, then enqueues it. If the enqueue fails the
 * scan is marked failed immediately, so the UI never shows a job that no worker
 * will ever pick up.
 */
export const queueScanForProject = async ({ projectId, branch, commitId = '', trigger = 'manual', priority, user }) => {
  const project = await Project.findById(projectId);
  if (!project) throw notFound('Project not found');
  if (project.archived) throw badRequest('Cannot scan an archived project');

  const scan = await Scan.create({
    scanId: generateScanId(),
    project: project._id,
    projectKey: project.key,
    projectName: project.name,
    repoUrl: project.repoUrl,
    branch: branch || project.defaultBranch,
    commitId,
    trigger,
    status: 'queued',
    requestedBy: user?._id,
    requestedByName: user?.username || 'system',
    logs: [{ level: 'info', message: `Queued by ${user?.username || 'system'}` }],
  });

  try {
    const job = await enqueueScan(
      {
        scanId: scan.scanId,
        projectId: String(project._id),
        repoUrl: project.repoUrl,
        branch: scan.branch,
        commitId,
        maintainerEmail: project.maintainerEmail,
        requestedByEmail: user?.email,
      },
      { priority },
    );
    scan.jobId = job.id;
    await scan.save();
  } catch (error) {
    scan.status = 'failed';
    scan.error = { message: `Could not enqueue job: ${error.message}`, stage: 'enqueue' };
    scan.finishedAt = new Date();
    await scan.save();
    throw error;
  }

  await Project.updateOne(
    { _id: project._id },
    { $set: { 'stats.lastScanStatus': 'queued', 'stats.lastScanAt': new Date() }, $inc: { 'stats.totalScans': 1 } },
  );
  return scan;
};

export const appendScanLog = (scanId, message, level = 'info') =>
  Scan.updateOne({ scanId }, { $push: { logs: { $each: [{ at: new Date(), level, message }], $slice: -200 } } });
