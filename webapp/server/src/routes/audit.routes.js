import { Router } from 'express';
import * as audit from '../controllers/audit.controller.js';
import { authenticate, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { validateQuery, validateParams } from '../middleware/validate.js';
import { listAuditSchema, idParamSchema } from '../validators/index.js';

const router = Router();
router.use(authenticate, requireRole(ROLE_GROUPS.triagers));

router.get('/', validateQuery(listAuditSchema), audit.listAuditLogs);
router.get('/facets', audit.auditFacets);
router.get('/export', validateQuery(listAuditSchema), audit.exportAuditLogs);
router.get('/syslog/status', audit.syslogStatus);
router.post('/syslog/test', requireRole(ROLE_GROUPS.admins), audit.testSyslog);
router.get('/:id', validateParams(idParamSchema), audit.getAuditLog);

export default router;
