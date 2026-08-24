import { Router } from 'express';
import * as scans from '../controllers/scan.controller.js';
import { authenticate, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import { scanLimiter } from '../middleware/rateLimit.js';
import { createScanSchema, bulkScanSchema, listScansSchema } from '../validators/index.js';

const router = Router();
router.use(authenticate);

router.get('/', validateQuery(listScansSchema), scans.listScans);
router.get('/:scanId', scans.getScan);

router.post('/', requireRole(ROLE_GROUPS.scanOperators), scanLimiter, validateBody(createScanSchema), scans.createScan);
router.post('/bulk', requireRole(ROLE_GROUPS.scanOperators), scanLimiter, validateBody(bulkScanSchema), scans.createBulkScans);
router.post('/:scanId/cancel', requireRole(ROLE_GROUPS.scanOperators), scans.cancelScan);
router.post('/:scanId/retry', requireRole(ROLE_GROUPS.scanOperators), scanLimiter, scans.retryScan);

export default router;
