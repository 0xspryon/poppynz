import { Hono } from 'hono';
import type { HonoEnv } from '../../../app-env';
import {
  getProfileHandler,
  updateProfileHandler,
  updateProfileLocationHandler,
  updateProfilePhotoHandler
} from './profile.handler';

export const profileRoute = new Hono<HonoEnv>()
  .patch('/location', (c) => updateProfileLocationHandler(c))
  .put('/photo', (c) => updateProfilePhotoHandler(c))
  .get('/', (c) => getProfileHandler(c))
  .patch('/', (c) => updateProfileHandler(c));
