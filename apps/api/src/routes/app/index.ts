import { Hono } from 'hono';
import { signupRoute } from './auth/signup/signup'
import { signinRoute } from './auth/signin/signin'
import type { HonoEnv } from '../../app-env';
import { profileRoute } from './me/profile';
import { onboardingRoute } from './me/onboarding';
import { approvalRoute } from './approval/approval';
import { uploadRoute } from './uploads/upload';
import { servicesOfferedRoute } from './me/services-offered';
import { kycDocsRoute } from './kyc-docs/kyc-docs';
import { approvalRequestsRoute } from './approval-requests/approval-requests';
import { adminApprovalRequestsRoute } from './admin/approval-requests';
import { adminKycDocsRoute } from './admin/kyc-docs';
import { geocodingRoute } from './geocoding/geocoding';
import { providersRoute } from './providers/providers';
import { adminProviderSearchRoute } from './admin/provider-search';
import { serviceCatalogueRoute } from './service-catalogue/service-catalogue';
import { adminServiceCatalogueRoute } from './admin/service-catalogue';
import { adminUsersRoute } from './admin/users';
import { referralsRoute } from './referrals/referrals';

export const appRoutes = new Hono<HonoEnv>()
.route('/auth', signupRoute)
.route('/auth', signinRoute)
.route('/me/profile', profileRoute)
.route('/me/onboarding', onboardingRoute)
.route('/me/services-offered', servicesOfferedRoute)
.route('/kyc-docs', kycDocsRoute)
.route('/approval-requests', approvalRequestsRoute)
.route('/approvals', approvalRoute)
.route('/admin/approval-requests', adminApprovalRequestsRoute)
.route('/admin/kyc-docs', adminKycDocsRoute)
.route('/admin/provider-search', adminProviderSearchRoute)
.route('/service-catalogue', serviceCatalogueRoute)
.route('/admin/service-catalogue', adminServiceCatalogueRoute)
.route('/admin/users', adminUsersRoute)
.route('/referrals', referralsRoute)
.route('/providers', providersRoute)
.route('/geocoding', geocodingRoute)
.route('/uploads', uploadRoute)
