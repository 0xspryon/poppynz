import { Hono } from 'hono';
import type { HonoEnv } from '../../../../app-env';
import { signinHandler } from './signin.handler';

export const signinRoute = new Hono<HonoEnv>().post('/sign-in', (c) => signinHandler(c));
