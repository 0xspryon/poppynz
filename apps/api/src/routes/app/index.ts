import { Hono } from 'hono';
import { signupRoute } from './auth/signup/signup';
import { signinRoute } from './auth/signin/signin';
import type { HonoEnv } from '../../app-env';
import { profileRoute } from './me/profile';
import { onboardingRoute } from './me/onboarding';
import { approvalRoute } from './approval/approval';
import { uploadRoute } from './uploads/upload';
import { servicesOfferedRoute } from './me/services-offered';
import { servicesNeededRoute } from './me/services-needed';
import { kycDocsRoute } from './kyc-docs/kyc-docs';
import { approvalRequestsRoute } from './approval-requests/approval-requests';
import { adminApprovalRequestsRoute } from './admin/approval-requests';
import { adminKycDocsRoute } from './admin/kyc-docs';
import { geocodingRoute } from './geocoding/geocoding';
import { providersRoute } from './providers/providers';
import { familiesRoute } from './families/families';
import { adminProviderSearchRoute } from './admin/provider-search';
import { adminFamilySearchRoute } from './admin/family-search';
import { serviceCatalogueRoute } from './service-catalogue/service-catalogue';
import { adminServiceCatalogueRoute } from './admin/service-catalogue';
import { adminUsersRoute } from './admin/users';
import { adminUserSearchesRoute } from './admin/user-searches';
import { userSearchesRoute } from './user-searches/user-searches';
import { referralsRoute } from './referrals/referrals';
import { contractsRoute } from './contracts/contracts';
import { conversationsRoute } from './conversations/conversations';
import { notificationsRoute } from './notifications/notifications';
import { tcsRoute } from './tcs/tcs';
import { meTcsRoute } from './me/tcs';
import { adminTcsRoute } from './admin/tcs';

export const appRoutes = new Hono<HonoEnv>()
  .route('/auth', signupRoute)
  .route('/auth', signinRoute)
  .route('/me/profile', profileRoute)
  .route('/me/onboarding', onboardingRoute)
  .route('/me/services-offered', servicesOfferedRoute)
  .route('/me/services-needed', servicesNeededRoute)
  .route('/me/tcs', meTcsRoute)
  .route('/tcs', tcsRoute)
  .route('/admin/tcs', adminTcsRoute)
  .route('/kyc-docs', kycDocsRoute)
  .route('/approval-requests', approvalRequestsRoute)
  .route('/approvals', approvalRoute)
  .route('/admin/approval-requests', adminApprovalRequestsRoute)
  .route('/admin/kyc-docs', adminKycDocsRoute)
  .route('/admin/provider-search', adminProviderSearchRoute)
  .route('/admin/family-search', adminFamilySearchRoute)
  .route('/service-catalogue', serviceCatalogueRoute)
  .route('/admin/service-catalogue', adminServiceCatalogueRoute)
  .route('/admin/users', adminUsersRoute)
  .route('/admin/user-searches', adminUserSearchesRoute)
  .route('/user-searches', userSearchesRoute)
  .route('/referrals', referralsRoute)
  .route('/contracts', contractsRoute)
  .route('/conversations', conversationsRoute)
  .route('/notifications', notificationsRoute)
  .route('/providers', providersRoute)
  .route('/families', familiesRoute)
  .route('/geocoding', geocodingRoute)
  .route('/uploads', uploadRoute);
