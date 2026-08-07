import { Hono } from 'hono';
import type { HonoEnv } from '../../../../app-env';
import { signupHandler } from './signup.handler';

export const signupRoute = new Hono<HonoEnv>().post('/sign-up', (c) => signupHandler(c));
