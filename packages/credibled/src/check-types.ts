// The Credibled check types Poppynz can order, as read from the live account
// on 2026-08-22 via GET /check-types/.
//
// Two things drive the shape of this file:
//
// 1. Check-type UUIDs are issued PER CREDIBLED ACCOUNT, so they can't be
//    hard-coded or seeded — the helper and family accounts hand out different
//    ids for the same product, and rotating a key can reissue them. The stable
//    identifier is `value`, which is what we persist. The API client resolves
//    value -> uuid at call time from GET /check-types/.
// 2. There is NO vulnerable-sector check in the catalogue, on any tier. That
//    screen is issued by the applicant's local police service and Credibled
//    does not resell it, so vulnerable-sector evidence can only ever arrive as
//    an uploaded document reviewed by an admin.
//
// US equivalents exist for most of these (us_crim_check, us_identity, …) but
// aren't listed: Poppynz operates in Canada, and applicants with history
// outside it are covered by the international check.

export const credibledCheckTypeValues = [
  'request_enhanced_criminal_record_check',
  'request_criminal_record_check',
  'request_enhanced_identity_verification',
  'request_international_criminal_record_check',
  'request_credential_verification',
  'request_education_verification',
  'request_employment_verification',
  'request_motor_vehicle_records',
  'request_soquij',
  'request_softcheck',
  'request_social_media_check',
  'request_equifax'
] as const;

export type CredibledCheckTypeValue = (typeof credibledCheckTypeValues)[number];

export const isCredibledCheckTypeValue = (input: string): input is CredibledCheckTypeValue =>
  (credibledCheckTypeValues as ReadonlyArray<string>).includes(input);

export type CredibledCheckType = {
  readonly value: CredibledCheckTypeValue;
  /** Credibled's own name for the product — used as the admin picker label. */
  readonly label: string;
  /** Credibled groups mutually exclusive tiers into a "club"; requesting two
   * members of one club yields only the highest tier. */
  readonly club: string;
};

export const credibledCheckTypes: ReadonlyArray<CredibledCheckType> = [
  {
    value: 'request_enhanced_criminal_record_check',
    label: 'Enhanced Canadian Criminal Record Check',
    club: 'ca_crim_check'
  },
  {
    value: 'request_criminal_record_check',
    label: 'Canadian Criminal Record Check',
    club: 'ca_crim_check'
  },
  {
    value: 'request_enhanced_identity_verification',
    label: 'Identity Verification',
    club: 'ca_identity'
  },
  {
    value: 'request_international_criminal_record_check',
    label: 'International Criminal Record Check',
    club: 'international_check'
  },
  {
    value: 'request_credential_verification',
    label: 'Canadian Credential Verification',
    club: 'ca_credential'
  },
  {
    value: 'request_education_verification',
    label: 'Canadian Education Verification',
    club: 'ca_education'
  },
  {
    value: 'request_employment_verification',
    label: 'Canadian Employment Verification',
    club: 'ca_employment'
  },
  {
    value: 'request_motor_vehicle_records',
    label: 'Canadian Driver Abstracts',
    club: 'ca_driver_abstract'
  },
  { value: 'request_soquij', label: 'SOQUIJ (Quebec court records)', club: 'ca_soquij' },
  { value: 'request_softcheck', label: 'Public Records Check', club: 'ca_softcheck' },
  {
    value: 'request_social_media_check',
    label: 'Canadian Social Media Check',
    club: 'ca_social_media'
  },
  { value: 'request_equifax', label: 'Canadian Credit Check', club: 'ca_credit_check' }
];

export const credibledCheckTypeLabel = (value: string) =>
  credibledCheckTypes.find((type) => type.value === value)?.label ?? value;

/**
 * The "club" a check belongs to.
 *
 * Credibled fulfils only the highest tier when two members of one club are
 * requested together — so ordering both bills twice and delivers once. Callers
 * use this to refuse the second selection rather than discover it on the
 * invoice.
 */
export const credibledCheckTypeClub = (value: string): string | null =>
  credibledCheckTypes.find((type) => type.value === value)?.club ?? null;
