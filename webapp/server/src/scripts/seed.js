/**
 * Seeds a working demo environment: an admin, one user per role, registered
 * applications (with HOD/SPOC and several branches each), and completed scans
 * per branch with findings, so every screen has data.
 *
 *   npm run seed              # create if missing
 *   npm run seed -- --reset   # wipe the operational collections first
 */
import env from '../config/env.js';
import logger from '../config/logger.js';
import { connectMongo, disconnectMongo } from '../db/mongoose.js';
import { User } from '../models/user.model.js';
import { Application } from '../models/application.model.js';
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

const contact = (name, email, designation, department, phone) => ({
  name,
  email,
  designation,
  department,
  phone,
  employeeId: `EMP${Math.abs([...email].reduce((acc, char) => acc * 31 + char.charCodeAt(0), 7)) % 900000 + 100000}`,
});

const APPLICATIONS = [
  {
    key: 'PAY',
    name: 'Payments API',
    applicationId: 'APP-1042',
    repository: { url: 'https://github.com/acme/payments-api.git', provider: 'github', defaultBranch: 'main' },
    criticality: 'critical',
    businessUnit: 'Payments',
    assessmentType: 'regulatory',
    hod: contact('Meera Iyer', 'meera.iyer@corp.local', 'Head of Payments Engineering', 'Payments', '+91 80 4000 1201'),
    spoc: contact('Arjun Kumar', 'arjun.kumar@corp.local', 'Lead Engineer', 'Payments', '+91 98450 11223'),
    backupSpoc: contact('Neha Verma', 'neha.verma@corp.local', 'Senior Engineer', 'Payments', ''),
    tags: ['pci', 'tier-1'],
    branches: [
      { name: 'main', environment: 'production', isDefault: true, schedule: { enabled: true, cron: '0 3 * * *' } },
      { name: 'release/2.4', environment: 'release' },
      { name: 'develop', environment: 'development' },
    ],
  },
  {
    key: 'WEB',
    name: 'Customer Web Portal',
    applicationId: 'APP-2210',
    repository: { url: 'https://github.com/acme/web-portal.git', provider: 'github', defaultBranch: 'main' },
    criticality: 'high',
    businessUnit: 'Digital',
    assessmentType: 'internal',
    hod: contact('Daniel Okoro', 'daniel.okoro@corp.local', 'Head of Digital Channels', 'Digital', '+44 20 7946 0102'),
    spoc: contact('Sofia Rossi', 'sofia.rossi@corp.local', 'Engineering Manager', 'Digital', ''),
    tags: ['tier-1', 'public'],
    branches: [
      { name: 'main', environment: 'production', isDefault: true },
      { name: 'staging', environment: 'staging' },
    ],
  },
  {
    key: 'MOB',
    name: 'Mobile Banking App',
    applicationId: 'APP-3391',
    repository: { url: 'https://github.com/acme/mobile-app.git', provider: 'gitlab', defaultBranch: 'main' },
    criticality: 'high',
    businessUnit: 'Digital',
    assessmentType: 'external',
    hod: contact('Daniel Okoro', 'daniel.okoro@corp.local', 'Head of Digital Channels', 'Digital', '+44 20 7946 0102'),
    spoc: contact('Kenji Watanabe', 'kenji.watanabe@corp.local', 'Mobile Lead', 'Digital', ''),
    tags: ['mobile'],
    branches: [
      { name: 'main', environment: 'production', isDefault: true },
      { name: 'release/ios-8.2', environment: 'release' },
    ],
  },
  {
    key: 'DATA',
    name: 'Data Platform ETL',
    applicationId: 'APP-4477',
    repository: { url: 'https://github.com/acme/data-etl.git', provider: 'github', defaultBranch: 'master' },
    criticality: 'medium',
    businessUnit: 'Data',
    assessmentType: 'internal',
    hod: contact('Priya Raman', 'priya.raman@corp.local', 'Head of Data Platform', 'Data', ''),
    spoc: contact('Tom Becker', 'tom.becker@corp.local', 'Data Engineer', 'Data', ''),
    tags: ['batch'],
    branches: [{ name: 'master', environment: 'production', isDefault: true }],
  },
  {
    key: 'INFRA',
    name: 'Infrastructure as Code',
    applicationId: 'APP-5008',
    repository: { url: 'https://github.com/acme/infra-terraform.git', provider: 'github', defaultBranch: 'main' },
    criticality: 'critical',
    businessUnit: 'Platform',
    assessmentType: 'internal',
    hod: contact('Elena Petrova', 'elena.petrova@corp.local', 'Head of Platform Engineering', 'Platform', ''),
    spoc: contact('Marcus Hale', 'marcus.hale@corp.local', 'SRE Lead', 'Platform', '+1 415 555 0142'),
    tags: ['terraform', 'tier-1'],
    branches: [
      { name: 'main', environment: 'production', isDefault: true, schedule: { enabled: true, cron: '0 2 * * *' } },
      { name: 'sandbox', environment: 'development' },
    ],
  },
  {
    key: 'LEGACY',
    name: 'Legacy Billing',
    applicationId: 'APP-6120',
    repository: { url: 'https://github.com/acme/legacy-billing.git', provider: 'bitbucket', defaultBranch: 'trunk' },
    criticality: 'low',
    businessUnit: 'Finance',
    assessmentType: 'third_party',
    hod: contact('Robert King', 'robert.king@corp.local', 'Head of Finance Systems', 'Finance', ''),
    spoc: contact('Grace Mwangi', 'grace.mwangi@corp.local', 'Application Owner', 'Finance', ''),
    tags: ['legacy'],
    branches: [{ name: 'trunk', environment: 'production', isDefault: true }],
  },
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

const seedApplications = async (admin) => {
  const created = [];
  for (const spec of APPLICATIONS) {
    // eslint-disable-next-line no-await-in-loop
    if (await Application.exists({ key: spec.key })) continue;
    // eslint-disable-next-line no-await-in-loop
    const application = await Application.create({
      ...spec,
      description: `${spec.name} — registered by the seed script for demonstration purposes.`,
      branches: spec.branches.map((branch) => ({ ...branch, addedBy: admin._id })),
      createdBy: admin._id,
      updatedBy: admin._id,
    });
    created.push(application.key);
  }
  return created;
};

/** One scan per registered branch, repeated `history` times, so every branch has a trail. */
const seedScans = async (admin, { history = 3 } = {}) => {
  const applications = await Application.find({ archived: false });
  let scanCount = 0;
  let findingCount = 0;

  for (const application of applications) {
    // eslint-disable-next-line no-await-in-loop
    if (await Scan.exists({ application: application._id })) continue;

    for (const branch of application.branches) {
      for (let index = history; index > 0; index -= 1) {
        const finishedAt = new Date(Date.now() - index * 3 * 24 * 60 * 60 * 1000);
        // eslint-disable-next-line no-await-in-loop
        const result = await executeScan({
          repoUrl: `${application.repository.url}#${branch.name}#${index}`,
          branch: branch.name,
          commitId: '',
        });
        // eslint-disable-next-line no-await-in-loop
        const scan = await Scan.create({
          scanId: generateScanId(),
          application: application._id,
          applicationKey: application.key,
          applicationName: application.name,
          repoUrl: application.repository.url,
          branch: branch.name,
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
          logs: [{ at: finishedAt, level: 'info', message: `Seeded scan of ${branch.name}` }],
        });
        scanCount += 1;

        if (result.findings.length) {
          // eslint-disable-next-line no-await-in-loop
          await Finding.insertMany(
            result.findings.map((finding, position) => ({
              ...finding,
              scan: scan._id,
              scanId: scan.scanId,
              application: application._id,
              applicationKey: application.key,
              branch: branch.name,
              // Only the newest scan stays fully open, so the triage funnel has depth.
              status:
                index === 1
                  ? 'open'
                  : position % 3 === 0
                    ? 'remediated'
                    : position % 3 === 1
                      ? 'triaged'
                      : 'false_positive',
              firstSeenAt: finishedAt,
              lastSeenAt: finishedAt,
              triage:
                index === 1
                  ? {}
                  : {
                      updatedBy: admin._id,
                      updatedAt: new Date(finishedAt.getTime() + 86_400_000),
                      note: 'Reviewed during the seeded triage cycle',
                    },
            })),
            { ordered: false },
          );
          findingCount += result.findings.length;
        }
      }

      // eslint-disable-next-line no-await-in-loop
      const [branchCounts] = await Finding.aggregate([
        { $match: { application: application._id, branch: branch.name, status: { $in: ['open', 'triaged'] } } },
        {
          $group: {
            _id: null,
            open: { $sum: 1 },
            critical: { $sum: { $cond: [{ $eq: ['$severity', 'critical'] }, 1, 0] } },
          },
        },
      ]);
      branch.stats = {
        lastScanAt: new Date(),
        lastScanStatus: 'completed',
        totalScans: history,
        openFindings: branchCounts?.open || 0,
        criticalFindings: branchCounts?.critical || 0,
        lastScanId: branch.stats?.lastScanId || '',
      };
    }

    // eslint-disable-next-line no-await-in-loop
    const [counts] = await Finding.aggregate([
      { $match: { application: application._id, status: { $in: ['open', 'triaged'] } } },
      {
        $group: {
          _id: null,
          open: { $sum: 1 },
          critical: { $sum: { $cond: [{ $eq: ['$severity', 'critical'] }, 1, 0] } },
        },
      },
    ]);
    application.stats = {
      ...application.stats.toObject(),
      lastScanAt: new Date(),
      lastScanStatus: 'completed',
      totalScans: history * application.branches.length,
      openFindings: counts?.open || 0,
      criticalFindings: counts?.critical || 0,
    };
    // eslint-disable-next-line no-await-in-loop
    await application.save();
  }
  return { scanCount, findingCount };
};

const main = async () => {
  const reset = process.argv.includes('--reset');
  await connectMongo();

  if (reset) {
    await Promise.all([
      User.deleteMany({}),
      Application.deleteMany({}),
      Scan.deleteMany({}),
      Finding.deleteMany({}),
      AuditLog.deleteMany({}),
    ]);
    logger.warn('seed reset: operational collections cleared', { event: 'seed.reset' });
  }

  const createdUsers = await seedUsers();
  const admin = await User.findOne({ username: 'admin' });
  const createdApplications = await seedApplications(admin);
  const { scanCount, findingCount } = await seedScans(admin);

  await recordAudit({
    action: 'system.seeded',
    category: 'system',
    outcome: 'success',
    actor: { username: 'system', displayName: 'Seed script' },
    message: `Seed completed: ${createdUsers.length} user(s), ${createdApplications.length} application(s), ${scanCount} scan(s)`,
    metadata: { createdUsers, createdApplications, scanCount, findingCount, reset },
  });

  logger.info('seed complete', {
    event: 'seed.complete',
    users: createdUsers,
    applications: createdApplications,
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
