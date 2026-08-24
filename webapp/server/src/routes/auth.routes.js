import { Router } from 'express';
import * as auth from '../controllers/auth.controller.js';
import { authenticate } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { auditAction } from '../middleware/audit.js';
import { loginLimiter, passwordResetLimiter } from '../middleware/rateLimit.js';
import {
  loginSchema,
  refreshSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  mfaVerifySchema,
} from '../validators/index.js';

const router = Router();

// The login/refresh/reset handlers write their own fine-grained audit events.
router.post('/login', loginLimiter, validateBody(loginSchema), auth.login);
router.post('/refresh', validateBody(refreshSchema), auth.refresh);
router.post('/logout', auth.logout);
router.post('/logout-all', authenticate, auth.logoutAll);
router.get('/me', authenticate, auth.me);

router.post('/forgot-password', passwordResetLimiter, validateBody(forgotPasswordSchema), auth.forgotPassword);
router.post('/reset-password', passwordResetLimiter, validateBody(resetPasswordSchema), auth.resetPassword);
router.post('/change-password', authenticate, validateBody(changePasswordSchema), auth.changePassword);

router.post(
  '/mfa/enroll',
  authenticate,
  auditAction('auth.mfa.enrollment_started', 'authentication', { includeBody: false }),
  auth.startMfaEnrollment,
);
router.post('/mfa/confirm', authenticate, validateBody(mfaVerifySchema), auth.confirmMfaEnrollment);
router.post('/mfa/disable', authenticate, auth.disableMfa);

export default router;
