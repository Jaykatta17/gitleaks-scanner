import dayjs from 'dayjs';
import { customAlphabet } from 'nanoid';
import { Application } from '../models/application.model.js';
import { Scan } from '../models/scan.model.js';
import { enqueueScan } from '../queues/index.js';
import { badRequest, notFound } from '../utils/errors.js';

const suffix = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 6);

export const generateScanId = () => `GLS-${dayjs().format('YYYYMMDD')}-${suffix()}`;

/**
 * Creates the Scan document first, then enqueues it. If the enqueue fails the
 * scan is marked failed immediately, so the UI never shows a job that no worker
 * will ever pick up.
 *
 * An application can have any number of scans in flight, one per branch: the
 * branch is part of the scan identity, not of the application's.
 */
export const queueScanForApplication = async ({
  applicationId,
  application: preloaded,
  branch,
  commitId = '',
  trigger = 'manual',
  priority,
  registerBranch = true,
  user,
}) => {
  const application = preloaded || (await Application.findById(applicationId));
  if (!application) throw notFound('Application not found');
  if (application.archived) throw badRequest('Cannot scan an archived application');

  const branchName = (branch || application.repository.defaultBranch || 'main').trim();
  let tracked = application.findBranch(branchName);
  if (!tracked && !registerBranch) throw badRequest(`Branch ${branchName} is not registered for ${application.key}`);
  if (!tracked) {
    // Scanning an untracked branch registers it, so the branch list always
    // reflects what has actually been assessed.
    application.branches.push({ name: branchName, environment: 'other', scanEnabled: true, addedBy: user?._id });
    await application.save();
    tracked = application.findBranch(branchName);
  } else if (tracked.scanEnabled === false && trigger === 'scheduled') {
    throw badRequest(`Scheduled scanning is disabled for branch ${branchName}`);
  }

  const scan = await Scan.create({
    scanId: generateScanId(),
    application: application._id,
    applicationKey: application.key,
    applicationName: application.name,
    repoUrl: application.repository.url,
    branch: branchName,
    commitId,
    trigger,
    status: 'queued',
    requestedBy: user?._id,
    requestedByName: user?.username || 'system',
    logs: [{ level: 'info', message: `Queued by ${user?.username || 'system'} for branch ${branchName}` }],
  });

  try {
    const job = await enqueueScan(
      {
        scanId: scan.scanId,
        applicationId: String(application._id),
        repoUrl: application.repository.url,
        branch: branchName,
        commitId,
        spocEmail: application.spoc?.email,
        hodEmail: application.hod?.email,
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

  await Application.updateOne(
    { _id: application._id, 'branches.name': branchName },
    {
      $set: {
        'stats.lastScanStatus': 'queued',
        'stats.lastScanAt': new Date(),
        'branches.$.stats.lastScanStatus': 'queued',
        'branches.$.stats.lastScanAt': new Date(),
        'branches.$.stats.lastScanId': scan.scanId,
      },
      $inc: { 'stats.totalScans': 1, 'branches.$.stats.totalScans': 1 },
    },
  );
  return scan;
};

/** Fans a scan out across several branches of one application. */
export const queueScansForBranches = async ({ applicationId, branches, allBranches, trigger, user }) => {
  const application = await Application.findById(applicationId);
  if (!application) throw notFound('Application not found');

  const targets = allBranches
    ? application.branches.filter((branch) => branch.scanEnabled !== false).map((branch) => branch.name)
    : branches;
  if (!targets?.length) throw badRequest('No scannable branches for this application');

  const results = [];
  for (const branchName of targets) {
    try {
      // Sequential on purpose: keeps queue ordering stable and bounds Mongo load.
      // eslint-disable-next-line no-await-in-loop
      const scan = await queueScanForApplication({ application, branch: branchName, trigger, user });
      results.push({ branch: branchName, scanId: scan.scanId, status: 'queued' });
    } catch (error) {
      results.push({ branch: branchName, status: 'failed', error: error.message });
    }
  }
  return { application, results };
};

export const appendScanLog = (scanId, message, level = 'info') =>
  Scan.updateOne({ scanId }, { $push: { logs: { $each: [{ at: new Date(), level, message }], $slice: -200 } } });
