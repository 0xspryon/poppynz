import { Hono } from 'hono';
import type { HonoEnv } from '@/api/app-env';
import { createUploadPresignHandler } from './upload.handler';

export const uploadRoute = new Hono<HonoEnv>().post('/presigned-url', (c) =>
  createUploadPresignHandler(c)
);
