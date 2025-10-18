import path from 'path';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { Router } from 'express';
import {
  createEmptySlide,
  createImageSlide,
  createPdfSlide,
  createSession,
  deleteSlide,
  endSession,
  getSessionState,
  listSessions,
  startSession
} from '../controllers/session.controller';
import { env } from '../config/env';

const router = Router();

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, env.UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${randomUUID()}${path.extname(file.originalname).toLowerCase()}`;
    cb(null, unique);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024
  }
});

router.post('/session', createSession);
router.get('/sessions', listSessions);
router.post('/session/:sessionId/start', startSession);
router.post('/session/:sessionId/end', endSession);
router.post('/session/:sessionId/slides/pdf', upload.single('file'), createPdfSlide);
router.post('/session/:sessionId/slides/image', upload.single('file'), createImageSlide);
router.post('/session/:sessionId/slides', createEmptySlide);
router.delete('/session/:sessionId/slide/:slideId', deleteSlide);
router.get('/session/:sessionId/state', getSessionState);

export default router;
