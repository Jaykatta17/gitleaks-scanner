import { Router } from 'express';
import * as findings from '../controllers/finding.controller.js';
import { authenticate, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import { listFindingsSchema, updateFindingSchema, bulkFindingSchema, idParamSchema } from '../validators/index.js';

const router = Router();
router.use(authenticate);

router.get('/', validateQuery(listFindingsSchema), findings.listFindings);
router.get('/export', validateQuery(listFindingsSchema), findings.exportFindings);
router.get('/:id', validateParams(idParamSchema), findings.getFinding);

router.patch('/:id', requireRole(ROLE_GROUPS.triagers), validateParams(idParamSchema), validateBody(updateFindingSchema), findings.updateFinding);
router.post('/bulk', requireRole(ROLE_GROUPS.triagers), validateBody(bulkFindingSchema), findings.bulkUpdateFindings);

export default router;
