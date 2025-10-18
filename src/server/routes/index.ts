import { Router } from 'express';
import authRoutes from './auth.routes';
import sessionRoutes from './session.routes';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authRoutes);
router.use(authenticate);
router.use(sessionRoutes);

export default router;
