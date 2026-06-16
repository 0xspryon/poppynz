import { Hono } from 'hono';
import { signupRoute } from './auth/signup/signup'
import { HonoEnv } from '../../app-env';
import { profileRoute } from './me/profile';
import { approvalRoute } from './approval/approval';
import { uploadRoute } from './uploads/upload';

export const appRoutes = new Hono<HonoEnv>()
.route('/auth', signupRoute)
.route('/me/profile', profileRoute)
.route('/approval', approvalRoute)
.route('/uploads', uploadRoute)
