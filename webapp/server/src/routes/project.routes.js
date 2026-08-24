import { Router } from 'express';
import * as projects from '../controllers/project.controller.js';
import { authenticate, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import { createProjectSchema, updateProjectSchema, listProjectsSchema, idParamSchema } from '../validators/index.js';

const router = Router();
router.use(authenticate);

router.get('/', validateQuery(listProjectsSchema), projects.listProjects);
router.get('/:id', validateParams(idParamSchema), projects.getProject);
router.get('/:id/stats', validateParams(idParamSchema), projects.projectStats);

router.post('/', requireRole(ROLE_GROUPS.triagers), validateBody(createProjectSchema), projects.createProject);
router.patch('/:id', requireRole(ROLE_GROUPS.triagers), validateParams(idParamSchema), validateBody(updateProjectSchema), projects.updateProject);
router.delete('/:id', requireRole(ROLE_GROUPS.triagers), validateParams(idParamSchema), projects.deleteProject);

export default router;
