import { Hono } from 'hono';
import { signupRoute } from './auth/signup/signup'
import { HonoEnv } from '../../app-env';

export const appRoutes = new Hono<HonoEnv>()
.route('/auth', signupRoute)
