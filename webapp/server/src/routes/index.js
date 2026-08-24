import { Router } from 'express';
import authRoutes from './auth.routes.js';
import userRoutes from './user.routes.js';
import applicationRoutes from './application.routes.js';
import scanRoutes from './scan.routes.js';
import findingRoutes from './finding.routes.js';
import auditRoutes from './audit.routes.js';
import systemRoutes from './system.routes.js';
import * as dashboard from '../controllers/dashboard.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/applications', applicationRoutes);
router.use('/scans', scanRoutes);
router.use('/findings', findingRoutes);
router.use('/audit-logs', auditRoutes);
router.use('/system', systemRoutes);

router.get('/dashboard/overview', authenticate, dashboard.overview);
router.get('/dashboard/activity', authenticate, dashboard.activityFeed);

export default router;
