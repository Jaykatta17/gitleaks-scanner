import { Router } from 'express';
import * as applications from '../controllers/application.controller.js';
import { authenticate, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import {
  createApplicationSchema,
  updateApplicationSchema,
  listApplicationsSchema,
  branchInputSchema,
  updateBranchSchema,
  branchParamSchema,
  idParamSchema,
} from '../validators/index.js';

const router = Router();
router.use(authenticate);

router.get('/', validateQuery(listApplicationsSchema), applications.listApplications);
router.get('/:id', validateParams(idParamSchema), applications.getApplication);
router.get('/:id/stats', validateParams(idParamSchema), applications.applicationStats);
router.get('/:id/branches', validateParams(idParamSchema), applications.listBranches);

router.post('/', requireRole(ROLE_GROUPS.triagers), validateBody(createApplicationSchema), applications.createApplication);
router.patch(
  '/:id',
  requireRole(ROLE_GROUPS.triagers),
  validateParams(idParamSchema),
  validateBody(updateApplicationSchema),
  applications.updateApplication,
);
router.delete('/:id', requireRole(ROLE_GROUPS.triagers), validateParams(idParamSchema), applications.archiveApplication);

router.post(
  '/:id/branches',
  requireRole(ROLE_GROUPS.triagers),
  validateParams(idParamSchema),
  validateBody(branchInputSchema),
  applications.addBranch,
);
router.patch(
  '/:id/branches/:branch',
  requireRole(ROLE_GROUPS.triagers),
  validateParams(branchParamSchema),
  validateBody(updateBranchSchema),
  applications.updateBranch,
);
router.delete(
  '/:id/branches/:branch',
  requireRole(ROLE_GROUPS.triagers),
  validateParams(branchParamSchema),
  applications.removeBranch,
);

export default router;
