/**
 * Seeds a working demo environment: an admin, one user per role, a handful of
 * projects, and completed scans with findings so every screen has data.
 *
 *   npm run seed              # create if missing
 *   npm run seed -- --reset   # wipe the operational collections first
 */
import env from '../config/env.js';
import logger from '../config/logger.js';
import { connectMongo, disconnectMongo } from '../db/mongoose.js';
import { User } from '../models/user.model.js';
import { Project } from '../models/project.model.js';
import { Scan } from '../models/scan.model.js';
import { Finding } from '../models/finding.model.js';
import { AuditLog } from '../models/auditLog.model.js';
import { executeScan } from '../services/scanner.service.js';
import { generateScanId } from '../services/scan.service.js';
import { recordAudit } from '../services/audit.service.js';

const DEMO_PASSWORD = process.env.SEED_PASSWORD || 'ChangeMe!2024#Sentinel';

const USERS = [
  { username: 'admin', email: 'admin@sentinel.local', displayName: 'Platform Administrator', role: 'admin', department: 'Security Engineering' },
  { username: 'analyst', email: 'analyst@sentinel.local', displayName: 'Riya Sharma', role: 'security_analyst', department: 'AppSec' },
  { username: 'developer', email: 'developer@sentinel.local', displayName: 'Sam Okafor', role: 'developer', department: 'Payments' },
  { username: 'auditor', email: 'auditor@sentinel.local', displayName: 'Lena Fischer', role: 'viewer', department: 'Internal Audit' },
];

const PROJECTS = [
  { key: 'PAY', name: 'Payments API', repoUrl: 'https://github.com/acme/payments-api.git', criticality: 'critical', businessUnit: 'Payments', assessmentType: 'regulatory', maintainerEmail: 'payments-lead@sentinel.local', tags: ['pci', 'tier-1'] },
  { key: 'WEB', name: 'Customer Web Portal', repoUrl: 'https://github.com/acme/web-portal.git', criticality: 'high', businessUnit: 'Digital', assessmentType: 'internal', maintainerEmail: 'web-lead@sentinel.local', tags: ['tier-1', 'public'] },
  { key: 'MOB', name: 'Mobile Banking App', repoUrl: 'https://github.com/acme/mobile-app.git', criticality: 'high', businessUnit: 'Digital', assessmentType: 'external', maintainerEmail: 'mobile-lead@sentinel.local', tags: ['mobile'] },
  { key: 'DATA', name: 'Data Platform ETL', repoUrl: 'https://github.com/acme/data-etl.git', criticality: 'medium', businessUnit: 'Data', assessmentType: 'internal', maintainerEmail: 'data-lead@sentinel.local', tags: ['batch'] },
  { key: 'INFRA', name: 'Infrastructure as Code', repoUrl: 'https://github.com/acme/infra-terraform.git', criticality: 'critical', businessUnit: 'Platform', assessmentType: 'internal', maintainerEmail: 'platform-lead@sentinel.local', tags: ['terraform', 'tier-1'] },
  { key: 'LEGACY', name: 'Legacy Billing', repoUrl: 'https://github.com/acme/legacy-billing.git', criticality: 'low', businessUnit: 'Finance', assessmentType: 'third_party', maintainerEmail: 'billing-lead@sentinel.local', tags: ['legacy'] },
];

const seedUsers = async () => {
  const created = [];
  for (const spec of USERS) {
    // eslint-disable-next-line no-await-in-loop
    let user = await User.findOne({ username: spec.username });
    if (!user) {
      user = new User({ ...spec, authProvider: 'local', status: 'active' });
      // eslint-disable-next-line no-await-in-loop
      await user.setPassword(DEMO_PASSWORD);
      user.mustChangePassword = true;
      // eslint-disable-next-line no-await-in-loop
      await user.save();
      created.push(user.username);
    }
  }
  return created;
};

const seedProjects = async (admin) => {
  const created = [];
  for (const spec of PROJECTS) {
    // eslint-disable-next-line no-await-in-loop
    const existing = await Project.findOne({ key: spec.key });
    if (existing) continue;
    // eslint-disable-next-line no-await-in-loop
    const project = await Project.create({
      ...spec,
      defaultBranch: 'main',
      description: `${spec.name} — onboarded by the seed script for demonstration purposes.`,
      createdBy: admin._id,
      updatedBy: admin._id,
      schedule: { enabled: spec.criticality === 'critical', cron: '0 3 * * *' },
    });
    created.push(project.key);
  }
  return created;
};

const seedScans = async (admin, { scansPerProject = 3 } = {}) => {
  const projects = await Project.find({ archived: false });
  let scanCount = 0;
  let findingCount = 0;

  for (const project of projects) {
    // eslint-disable-next-line no-await-in-loop
    if (await Scan.exists({ project: project._id })) continue;

    for (let index = scansPerProject; index > 0; index -= 1) {
      const finishedAt = new Date(Date.now() - index * 3 * 24 * 60 * 60 * 1000);
      // eslint-disable-next-line no-await-in-loop
      const result = await executeScan({
        repoUrl: `${project.repoUrl}#${index}`,
        branch: project.defaultBranch,
        commitId: '',
      });
      // eslint-disable-next-line no-await-in-loop
      const scan = await Scan.create({
        scanId: generateScanId(),
        project: project._id,
        projectKey: project.key,
        projectName: project.name,
        repoUrl: project.repoUrl,
        branch: project.defaultBranch,
        commitId: result.commit,
        status: 'completed',
        driver: result.driver,
        trigger: index === 1 ? 'manual' : 'scheduled',
        requestedBy: admin._id,
        requestedByName: admin.username,
        queuedAt: finishedAt,
        startedAt: finishedAt,
        finishedAt: new Date(finishedAt.getTime() + 42_000),
        durationMs: 42_000,
        summary: result.summary,
        logs: [{ at: finishedAt, level: 'info', message: 'Seeded scan' }],
      });
      scanCount += 1;

      if (result.findings.length) {
        // eslint-disable-next-line no-await-in-loop
        await Finding.insertMany(
          result.findings.map((finding, position) => ({
            ...finding,
            scan: scan._id,
            scanId: scan.scanId,
            project: project._id,
            projectKey: project.key,
            // Only the newest scan stays fully open, so the triage funnel has depth.
            status: index === 1 ? 'open' : position % 3 === 0 ? 'remediated' : position % 3 === 1 ? 'triaged' : 'false_positive',
            firstSeenAt: finishedAt,
            lastSeenAt: finishedAt,
            triage: index === 1 ? {} : { updatedBy: admin._id, updatedAt: new Date(finishedAt.getTime() + 86_400_000), note: 'Reviewed during the seeded triage cycle' },
          })),
          { ordered: false },
        );
        findingCount += result.findings.length;
      }
    }

    // eslint-disable-next-line no-await-in-loop
    const [counts] = await Finding.aggregate([
      { $match: { project: project._id, status: { $in: ['open', 'triaged'] } } },
      { $group: { _id: null, open: { $sum: 1 }, critical: { $sum: { $cond: [{ $eq: ['$severity', 'critical'] }, 1, 0] } } } },
    ]);
    project.stats = {
      lastScanAt: new Date(),
      lastScanStatus: 'completed',
      totalScans: scansPerProject,
      openFindings: counts?.open || 0,
      criticalFindings: counts?.critical || 0,
    };
    // eslint-disable-next-line no-await-in-loop
    await project.save();
  }
  return { scanCount, findingCount };
};

const main = async () => {
  const reset = process.argv.includes('--reset');
  await connectMongo();

  if (reset) {
    await Promise.all([
      User.deleteMany({}),
      Project.deleteMany({}),
      Scan.deleteMany({}),
      Finding.deleteMany({}),
      AuditLog.deleteMany({}),
    ]);
    logger.warn('seed reset: operational collections cleared', { event: 'seed.reset' });
  }

  const createdUsers = await seedUsers();
  const admin = await User.findOne({ username: 'admin' });
  const createdProjects = await seedProjects(admin);
  const { scanCount, findingCount } = await seedScans(admin);

  await recordAudit({
    action: 'system.seeded',
    category: 'system',
    outcome: 'success',
    actor: { username: 'system', displayName: 'Seed script' },
    message: `Seed completed: ${createdUsers.length} user(s), ${createdProjects.length} project(s), ${scanCount} scan(s)`,
    metadata: { createdUsers, createdProjects, scanCount, findingCount, reset },
  });

  logger.info('seed complete', {
    event: 'seed.complete',
    users: createdUsers,
    projects: createdProjects,
    scans: scanCount,
    findings: findingCount,
  });
  if (createdUsers.length) {
    process.stdout.write(`\nDemo sign-in: ${createdUsers.join(', ')} / ${DEMO_PASSWORD}\n(change on first sign-in)\n\n`);
  }
  await disconnectMongo();
  process.exit(0);
};

main().catch((error) => {
  logger.error('seed failed', { event: 'seed.failed', error: error.message, stack: error.stack });
  process.exit(1);
});
