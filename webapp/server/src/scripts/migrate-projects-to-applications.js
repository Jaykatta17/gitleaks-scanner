/**
 * One-off migration for installations seeded before applications replaced projects.
 *
 *   node src/scripts/migrate-projects-to-applications.js [--dry-run]
 *
 * Moves `projects` → `applications`, promotes the maintainer to SPOC (and HOD,
 * pending a real value), folds `repoUrl`/`defaultBranch` into the repository
 * block, registers the default branch, and repoints scans and findings.
 * Safe to re-run: it stops if the applications collection already has data.
 */
import mongoose from 'mongoose';
import env from '../config/env.js';
import logger from '../config/logger.js';
import { connectMongo, disconnectMongo } from '../db/mongoose.js';

const dryRun = process.argv.includes('--dry-run');

const run = async () => {
  await connectMongo();
  const db = mongoose.connection.db;
  const collections = (await db.listCollections().toArray()).map((collection) => collection.name);

  if (!collections.includes('projects')) {
    logger.info('nothing to migrate: no projects collection', { event: 'migrate.skip' });
    return { migrated: 0 };
  }
  if (collections.includes('applications') && (await db.collection('applications').countDocuments())) {
    logger.warn('applications collection already populated; aborting', { event: 'migrate.abort' });
    return { migrated: 0 };
  }

  const projects = await db.collection('projects').find({}).toArray();
  const applications = projects.map((project) => {
    const email = project.maintainerEmail || 'unknown@example.invalid';
    const name = project.maintainerEmail?.split('@')[0] || 'Unknown';
    const defaultBranch = project.defaultBranch || 'main';
    return {
      _id: project._id,
      key: project.key,
      name: project.name,
      description: project.description || '',
      applicationId: '',
      businessUnit: project.businessUnit || '',
      criticality: project.criticality || 'medium',
      assessmentType: project.assessmentType || 'internal',
      environmentTier: '',
      // The maintainer becomes the SPOC; the HOD must be corrected by an admin.
      hod: { name, email },
      spoc: { name, email, employeeId: '', department: project.businessUnit || '', designation: '', phone: '' },
      repository: {
        url: project.repoUrl,
        provider: 'other',
        defaultBranch,
        visibility: 'private',
        credentialRef: project.credentialRef || '',
      },
      branches: [
        {
          name: defaultBranch,
          environment: 'production',
          isDefault: true,
          scanEnabled: true,
          schedule: project.schedule || { enabled: false, cron: '0 3 * * *' },
          notes: '',
          stats: {
            lastScanId: '',
            lastScanAt: project.stats?.lastScanAt,
            lastScanStatus: project.stats?.lastScanStatus || 'never',
            totalScans: project.stats?.totalScans || 0,
            openFindings: project.stats?.openFindings || 0,
            criticalFindings: project.stats?.criticalFindings || 0,
          },
        },
      ],
      tags: project.tags || [],
      archived: Boolean(project.archived),
      stats: { ...(project.stats || {}), branchCount: 1 },
      createdBy: project.createdBy,
      updatedBy: project.updatedBy,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    };
  });

  if (dryRun) {
    logger.info('dry run complete', { event: 'migrate.dry_run', applications: applications.length });
    return { migrated: applications.length, dryRun: true };
  }

  if (applications.length) await db.collection('applications').insertMany(applications);

  // Scans and findings only change field names; ids stay stable.
  const scanRename = await db.collection('scans').updateMany({ project: { $exists: true } }, {
    $rename: { project: 'application', projectKey: 'applicationKey', projectName: 'applicationName' },
  });
  const findingRename = await db.collection('findings').updateMany({ project: { $exists: true } }, {
    $rename: { project: 'application', projectKey: 'applicationKey' },
  });

  // Findings predate per-branch tracking: backfill each one from its scan.
  const scans = await db.collection('scans').find({}, { projection: { scanId: 1, branch: 1 } }).toArray();
  let backfilled = 0;
  for (const scan of scans) {
    // eslint-disable-next-line no-await-in-loop
    const result = await db
      .collection('findings')
      .updateMany({ scanId: scan.scanId, branch: { $exists: false } }, { $set: { branch: scan.branch } });
    backfilled += result.modifiedCount;
  }

  logger.info('migration complete', {
    event: 'migrate.complete',
    applications: applications.length,
    scansRenamed: scanRename.modifiedCount,
    findingsRenamed: findingRename.modifiedCount,
    findingsBackfilled: backfilled,
  });
  return { migrated: applications.length, backfilled };
};

run()
  .then(async (result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (!dryRun && result.migrated) {
      process.stdout.write('Verify the console, then drop the old collection: db.projects.drop()\n');
    }
    await disconnectMongo();
    process.exit(0);
  })
  .catch(async (error) => {
    logger.error('migration failed', { event: 'migrate.failed', error: error.message, stack: error.stack });
    await disconnectMongo().catch(() => {});
    process.exit(1);
  });
