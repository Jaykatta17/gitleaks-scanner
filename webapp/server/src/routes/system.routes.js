import { Router } from 'express';
import * as system from '../controllers/system.controller.js';
import { authenticate, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { settingsSchema, testEmailSchema } from '../validators/index.js';

const router = Router();

// Probes stay unauthenticated so load balancers and Kubernetes can reach them.
router.get('/health/live', system.liveness);
router.get('/health/ready', system.readiness);
router.get('/auth-methods', system.authMethods);

router.get('/health', authenticate, requireRole(ROLE_GROUPS.triagers), system.health);
router.get('/config', authenticate, requireRole(ROLE_GROUPS.triagers), system.configuration);
router.put('/settings', authenticate, requireRole(ROLE_GROUPS.admins), validateBody(settingsSchema), system.upsertSetting);
router.post('/test/smtp', authenticate, requireRole(ROLE_GROUPS.admins), validateBody(testEmailSchema), system.testSmtp);
router.post('/test/ldap', authenticate, requireRole(ROLE_GROUPS.admins), system.testLdap);

export default router;
