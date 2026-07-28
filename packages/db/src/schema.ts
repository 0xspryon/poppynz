import { relations, sql } from "drizzle-orm";
import {
  text,
  timestamp,
  boolean,
  doublePrecision,
  integer,
  index,
  pgSchema,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const appDb = pgSchema("app_db");

export const gender = appDb.enum("gender", ["male", "female"]);
export const accessControlRole = appDb.enum("access_control_role", ["family", "service-provider", "admin"]);
export const approvalRequestStatus = appDb.enum("approval_request_status", ["submitted", "approved", "rejected"]);
export const approvalStatus = appDb.enum("approval_status", ["approved", "rejected"]);
export const providerSearchOutboxStatus = appDb.enum("provider_search_outbox_status", ["pending", "processing", "processed", "failed", "superseded"]);
// "all" means every non-admin profile — admins are never shown T&C.
export const tcAppliesToRole = appDb.enum("tc_applies_to_role", ["all", "family", "service-provider"]);
export const kycDocumentStatus = appDb.enum("kyc_document_status", [
  "submitted",
  "approved",
  "rejected",
]);

export const user = appDb.table("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at")
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  isAnonymous: boolean("is_anonymous").default(false),
  role: text("role"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
  phoneNumber: text("phone_number").unique(),
  phoneNumberVerified: boolean("phone_number_verified"),
});

export const signupIntent = appDb.table(
  "signup_intent",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    email: text("email").notNull(),
    role: text("role").notNull(),
    language: text("language").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    consumedAt: timestamp("consumed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [index("signup_intent_email_idx").on(table.email)],
);

export const userProfile = appDb.table("user_profile", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  language: text("language").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  gender: gender("gender"),
  phoneNumber: text("phone_number"),
  dateOfBirth: text("date_of_birth"),
  address: text("address"),
  city: text("city"),
  postalCode: text("postal_code"),
  country: text("country"),
  stateProvince: text("state_province"),
  shortBio: text("short_bio"),
  googlePlaceId: text("google_place_id"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
});

export const referral = appDb.table(
  "referral",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    referrerUserId: text("referrer_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull(),
    referredUserId: text("referred_user_id").references(() => user.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at").notNull(),
    joinedAt: timestamp("joined_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("referral_referrer_user_id_idx").on(table.referrerUserId),
    index("referral_email_idx").on(table.email),
  ],
);

export const kycDocumentType = appDb.table(
  "kyc_document_types",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    name: text("name").notNull(),
    appliesToRole: accessControlRole("applies_to_role").default("service-provider").notNull(),
    isOptional: boolean("is_optional").default(false).notNull(),
    requiresExpiryDate: boolean("requires_expiry_date").default(false).notNull(),
    isFetchable: boolean("is_fetchable").default(false).notNull(),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("kyc_document_types_deleted_at_idx").on(table.deletedAt)],
);

export const approvalRequest = appDb.table(
  "approval_requests",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: approvalRequestStatus("status").notNull(),
    reviewedBy: text("reviewed_by").references(() => user.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at"),
    reason: text("reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("approval_requests_user_id_idx").on(table.userId),
    index("approval_requests_status_idx").on(table.status),
  ],
);

export const approval = appDb.table(
  "approvals",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    approvalRequestId: uuid("approval_request_id")
      .notNull()
      .references(() => approvalRequest.id, { onDelete: "restrict" }),
    approvedBy: text("approved_by")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    status: approvalStatus("status").notNull().default('rejected'),
    reason: text('reason'),
    expiresAt: timestamp("expires_at").notNull(),
    // Expiry-warning mail stamps, one per tier. Null = not sent. Firing a
    // shorter tier also stamps every longer tier so late-entering approvals
    // get exactly one mail (see the worker's approval-expiry processor).
    notifiedExpiresInOneMonthAt: timestamp("notified_expires_in_one_month_at"),
    notifiedExpiresInTwoWeeksAt: timestamp("notified_expires_in_two_weeks_at"),
    notifiedExpiresInOneWeekAt: timestamp("notified_expires_in_one_week_at"),
    notifiedExpiresInTwoDaysAt: timestamp("notified_expires_in_two_days_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("approvals_user_id_idx").on(table.userId),
    index("approvals_request_id_idx").on(table.approvalRequestId),
    index("approvals_status_expires_at_idx").on(table.status, table.expiresAt),
  ],
);

export const kycDocument = appDb.table(
  "kyc_documents",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    documentTypeId: uuid("document_type_id")
      .notNull()
      .references(() => kycDocumentType.id, { onDelete: "restrict" }),
    filename: text("filename"),
    fileKey: text("file_key"),
    expiryDate: timestamp("expiry_date"),
    status: kycDocumentStatus("status").notNull(),
    reason: text("reason"),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("kyc_documents_user_id_idx").on(table.userId),
    index("kyc_documents_document_type_id_idx").on(table.documentTypeId),
    uniqueIndex("kyc_documents_user_id_document_type_uidx").on(table.userId, table.documentTypeId),
  ],
);

// Admin-managed base services providers pick from. `isLive` is catalogue
// visibility (hidden items stay on existing provider listings but can't be
// newly added) — deliberately distinct from `deletedAt` soft deletion.
export const serviceCatalogueItem = appDb.table(
  "service_catalogue",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    name: text("name").notNull(),
    category: text("category").notNull(),
    baseHourlyRateCents: integer("base_hourly_rate_cents").notNull(),
    currency: text("currency").default("CAD").notNull(),
    isLive: boolean("is_live").default(true).notNull(),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("service_catalogue_deleted_at_idx").on(table.deletedAt),
    index("service_catalogue_is_live_idx").on(table.isLive),
  ],
);

export const serviceOffered = appDb.table(
  "services_offered",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    catalogueServiceId: uuid("catalogue_service_id").references(() => serviceCatalogueItem.id, {
      onDelete: "restrict",
    }),
    name: text("name").notNull(),
    description: text("description"),
    hourlyRateCents: integer("hourly_rate_cents").notNull(),
    currency: text("currency").default("CAD").notNull(),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("services_offered_user_id_idx").on(table.userId),
    index("services_offered_deleted_at_idx").on(table.deletedAt),
    index("services_offered_catalogue_service_id_idx").on(table.catalogueServiceId),
  ],
);

export const providerSearchOutbox = appDb.table(
  "provider_search_outbox",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: providerSearchOutboxStatus("status").default("pending").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    lastError: text("last_error"),
    processedAt: timestamp("processed_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("provider_search_outbox_user_id_idx").on(table.userId),
    index("provider_search_outbox_status_idx").on(table.status),
    uniqueIndex("provider_search_outbox_user_unresolved_uidx")
      .on(table.userId)
      .where(sql`${table.status} in ('pending', 'processing', 'failed')`),
  ],
);

// Admin-managed terms-and-conditions documents. A document is a stable slug
// (e.g. "terms_of_service"); its text lives in tc_document_versions so every
// published revision is kept verbatim for the acceptance audit trail.
export const tcDocument = appDb.table(
  "tc_documents",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    appliesToRole: tcAppliesToRole("applies_to_role").default("all").notNull(),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("tc_documents_slug_uidx").on(table.slug),
    index("tc_documents_deleted_at_idx").on(table.deletedAt),
  ],
);

// Immutable once published (publishedAt set): users accepted that exact text,
// so published rows are never updated or deleted. publishedAt null = the
// document's single open draft, enforced by the partial unique index.
export const tcDocumentVersion = appDb.table(
  "tc_document_versions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    documentId: uuid("document_id")
      .notNull()
      .references(() => tcDocument.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    description: text("description").notNull(),
    content: text("content").notNull(),
    checkboxLabel: text("checkbox_label").notNull(),
    publishedAt: timestamp("published_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("tc_document_versions_document_id_idx").on(table.documentId),
    uniqueIndex("tc_document_versions_document_id_version_uidx").on(
      table.documentId,
      table.version,
    ),
    uniqueIndex("tc_document_versions_document_id_draft_uidx")
      .on(table.documentId)
      .where(sql`${table.publishedAt} is null`),
  ],
);

// Append-only audit log; rows are never updated or deleted. slug and version
// are denormalized so acceptance history stays queryable by slug even if a
// document is renamed or removed later.
export const tcDocumentAcceptance = appDb.table(
  "tc_document_acceptances",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => tcDocument.id, { onDelete: "restrict" }),
    slug: text("slug").notNull(),
    versionId: uuid("version_id")
      .notNull()
      .references(() => tcDocumentVersion.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    acceptedAt: timestamp("accepted_at").defaultNow().notNull(),
  },
  (table) => [
    index("tc_document_acceptances_user_id_idx").on(table.userId),
    index("tc_document_acceptances_version_id_idx").on(table.versionId),
    uniqueIndex("tc_document_acceptances_user_id_version_id_uidx").on(
      table.userId,
      table.versionId,
    ),
  ],
);

export const session = appDb.table(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: text("impersonated_by"),
    activeOrganizationId: text("active_organization_id"),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const account = appDb.table(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);

export const verification = appDb.table(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at")
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

export const apikey = appDb.table(
  "apikey",
  {
    id: text("id").primaryKey(),
    configId: text("config_id").default("default").notNull(),
    name: text("name"),
    start: text("start"),
    referenceId: text("reference_id").notNull(),
    prefix: text("prefix"),
    key: text("key").notNull(),
    refillInterval: integer("refill_interval"),
    refillAmount: integer("refill_amount"),
    lastRefillAt: timestamp("last_refill_at"),
    enabled: boolean("enabled").default(true),
    rateLimitEnabled: boolean("rate_limit_enabled").default(true),
    rateLimitTimeWindow: integer("rate_limit_time_window").default(86400000),
    rateLimitMax: integer("rate_limit_max").default(10),
    requestCount: integer("request_count").default(0),
    remaining: integer("remaining"),
    lastRequest: timestamp("last_request"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    permissions: text("permissions"),
    metadata: text("metadata"),
  },
  (table) => [
    index("apikey_configId_idx").on(table.configId),
    index("apikey_referenceId_idx").on(table.referenceId),
    index("apikey_key_idx").on(table.key),
  ],
);

export const organization = appDb.table(
  "organization",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    logo: text("logo"),
    createdAt: timestamp("created_at").notNull(),
    metadata: text("metadata"),
  },
  (table) => [uniqueIndex("organization_slug_uidx").on(table.slug)],
);

export const member = appDb.table(
  "member",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").default("member").notNull(),
    createdAt: timestamp("created_at").notNull(),
  },
  (table) => [
    index("member_organizationId_idx").on(table.organizationId),
    index("member_userId_idx").on(table.userId),
  ],
);

export const invitation = appDb.table(
  "invitation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").default("pending").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    inviterId: text("inviter_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("invitation_organizationId_idx").on(table.organizationId),
    index("invitation_email_idx").on(table.email),
  ],
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  members: many(member),
  invitations: many(invitation),
  approvals: many(approval),
  approvalRequests: many(approvalRequest),
  kycDocuments: many(kycDocument),
  servicesOffered: many(serviceOffered),
  tcDocumentAcceptances: many(tcDocumentAcceptance),
}));

export const tcDocumentRelations = relations(tcDocument, ({ many }) => ({
  versions: many(tcDocumentVersion),
  acceptances: many(tcDocumentAcceptance),
}));

export const tcDocumentVersionRelations = relations(tcDocumentVersion, ({ one, many }) => ({
  document: one(tcDocument, {
    fields: [tcDocumentVersion.documentId],
    references: [tcDocument.id],
  }),
  acceptances: many(tcDocumentAcceptance),
}));

export const tcDocumentAcceptanceRelations = relations(tcDocumentAcceptance, ({ one }) => ({
  user: one(user, {
    fields: [tcDocumentAcceptance.userId],
    references: [user.id],
  }),
  document: one(tcDocument, {
    fields: [tcDocumentAcceptance.documentId],
    references: [tcDocument.id],
  }),
  version: one(tcDocumentVersion, {
    fields: [tcDocumentAcceptance.versionId],
    references: [tcDocumentVersion.id],
  }),
}));

export const approvalRequestRelations = relations(approvalRequest, ({ one, many }) => ({
  user: one(user, {
    fields: [approvalRequest.userId],
    references: [user.id],
  }),
  reviewer: one(user, {
    fields: [approvalRequest.reviewedBy],
    references: [user.id],
  }),
  approvals: many(approval),
}));

export const approvalRelations = relations(approval, ({ one }) => ({
  user: one(user, {
    fields: [approval.userId],
    references: [user.id],
  }),
  approver: one(user, {
    fields: [approval.approvedBy],
    references: [user.id],
  }),
  approvalRequest: one(approvalRequest, {
    fields: [approval.approvalRequestId],
    references: [approvalRequest.id],
  }),
}));

export const kycDocumentRelations = relations(kycDocument, ({ one }) => ({
  user: one(user, {
    fields: [kycDocument.userId],
    references: [user.id],
  }),
  documentType: one(kycDocumentType, {
    fields: [kycDocument.documentTypeId],
    references: [kycDocumentType.id],
  }),
}));

export const kycDocumentTypeRelations = relations(kycDocumentType, ({ many }) => ({
  documents: many(kycDocument),
}));

export const serviceOfferedRelations = relations(serviceOffered, ({ one }) => ({
  user: one(user, {
    fields: [serviceOffered.userId],
    references: [user.id],
  }),
  catalogueItem: one(serviceCatalogueItem, {
    fields: [serviceOffered.catalogueServiceId],
    references: [serviceCatalogueItem.id],
  }),
}));

export const serviceCatalogueItemRelations = relations(serviceCatalogueItem, ({ many }) => ({
  servicesOffered: many(serviceOffered),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const organizationRelations = relations(organization, ({ many }) => ({
  members: many(member),
  invitations: many(invitation),
}));

export const memberRelations = relations(member, ({ one }) => ({
  organization: one(organization, {
    fields: [member.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [member.userId],
    references: [user.id],
  }),
}));

export const invitationRelations = relations(invitation, ({ one }) => ({
  organization: one(organization, {
    fields: [invitation.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [invitation.inviterId],
    references: [user.id],
  }),
}));
