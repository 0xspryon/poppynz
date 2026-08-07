import { Hono } from 'hono';
import type { HonoEnv } from '@/api/app-env';
import {
  createServiceNeededHandler,
  deleteServiceNeededHandler,
  listServicesNeededHandler,
  updateServiceNeededHandler
} from './services-needed.handler';

export const servicesNeededRoute = new Hono<HonoEnv>()
  .get('/', (c) => listServicesNeededHandler(c))
  .post('/', (c) => createServiceNeededHandler(c))
  .patch('/:id', (c) => updateServiceNeededHandler(c))
  .delete('/:id', (c) => deleteServiceNeededHandler(c));
