import { Router } from 'express';
import * as users from '../controllers/user.controller.js';
import { authenticate, requireRole, ROLE_GROUPS } from '../middleware/auth.js';
import { validateBody, validateQuery, validateParams } from '../middleware/validate.js';
import { auditAction } from '../middleware/audit.js';
import { createUserSchema, updateUserSchema, listUsersSchema, idParamSchema, updateProfileSchema } from '../validators/index.js';

const router = Router();
router.use(authenticate);

router.patch('/me', validateBody(updateProfileSchema), users.updateProfile);

router.get('/', requireRole(ROLE_GROUPS.triagers), validateQuery(listUsersSchema), users.listUsers);
router.get('/:id', requireRole(ROLE_GROUPS.triagers), validateParams(idParamSchema), users.getUser);

router.post('/', requireRole(ROLE_GROUPS.admins), validateBody(createUserSchema), users.createUser);
router.patch('/:id', requireRole(ROLE_GROUPS.admins), validateParams(idParamSchema), validateBody(updateUserSchema), users.updateUser);
router.delete('/:id', requireRole(ROLE_GROUPS.admins), validateParams(idParamSchema), users.deleteUser);

router.post(
  '/:id/reset-password',
  requireRole(ROLE_GROUPS.admins),
  validateParams(idParamSchema),
  auditAction('user.password.reset_requested_by_admin', 'user_management', {
    target: (req) => ({ type: 'user', id: req.params.id }),
  }),
  users.resetUserPassword,
);
router.post('/:id/unlock', requireRole(ROLE_GROUPS.admins), validateParams(idParamSchema), users.unlockUser);

export default router;
