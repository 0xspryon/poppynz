import { Schema } from 'effect';
import { validateInput } from '@/api/lib/schema-validator';

export const contractCreateValidationError = {
  code: 'INVALID_CONTRACT_INPUT',
  message: 'A conversation id is required.'
} as const;

export const contractCreateSchema = Schema.Struct({
  conversationId: Schema.UUID
});

export type ContractCreateInput = Schema.Schema.Type<typeof contractCreateSchema>;

export const validateContractCreateInput = validateInput(
  contractCreateSchema,
  contractCreateValidationError
);

export const contractCreateJsonError = contractCreateValidationError;

export const contractTermsValidationError = {
  code: 'INVALID_CONTRACT_TERMS',
  message: 'Each service needs a valid rate and at least one weekly session.'
} as const;

// A real calendar date — the pattern alone would wave "2026-13-45" through to
// a Postgres cast error (a 500 instead of a 422).
const isoCalendarDate = Schema.String.pipe(
  Schema.pattern(/^\d{4}-\d{2}-\d{2}$/),
  Schema.filter(
    (value) =>
      !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime()) &&
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value,
    {
      message: () => 'must be a valid calendar date'
    }
  )
);

const MINUTES_PER_DAY = 24 * 60;

// One weekly session: NZ wall-clock minutes from midnight (never UTC), Monday
// = 0. Overlapping sessions are legal — the UI warns, the provider judges.
const contractSessionSchema = Schema.Struct({
  weekday: Schema.Int.pipe(Schema.between(0, 6)),
  startMinutes: Schema.Int.pipe(Schema.between(0, MINUTES_PER_DAY - 1)),
  endMinutes: Schema.Int.pipe(Schema.between(1, MINUTES_PER_DAY))
}).pipe(
  Schema.filter((session) => session.endMinutes > session.startMinutes, {
    message: () => 'a session must end after it starts'
  })
);

// Drafts may be saved partial (zero services); sending enforces at least one
// line item at the domain level (EMPTY_CONTRACT_TERMS). A service that IS
// present always carries at least one session — hours are derived from them.
export const contractTermsSchema = Schema.Struct({
  services: Schema.Array(
    Schema.Struct({
      serviceId: Schema.UUID,
      rateCents: Schema.Int.pipe(Schema.positive(), Schema.lessThanOrEqualTo(1_000_000)),
      sessions: Schema.Array(contractSessionSchema).pipe(Schema.minItems(1), Schema.maxItems(21)),
      expectations: Schema.Trim.pipe(Schema.maxLength(2000))
    })
  ).pipe(
    Schema.maxItems(20),
    Schema.filter(
      (services) => new Set(services.map((service) => service.serviceId)).size === services.length,
      {
        message: () => 'each service may appear only once'
      }
    )
  ),
  startsOn: Schema.optional(Schema.NullOr(isoCalendarDate)),
  endsOn: Schema.optional(Schema.NullOr(isoCalendarDate))
}).pipe(
  Schema.filter(
    (terms) =>
      !terms.startsOn ||
      !terms.endsOn ||
      terms.endsOn >= terms.startsOn ||
      'the end date must not be before the start date'
  )
);

export type ContractTermsInput = Schema.Schema.Type<typeof contractTermsSchema>;

export const validateContractTermsInput = validateInput(
  contractTermsSchema,
  contractTermsValidationError
);

export const contractTermsJsonError = contractTermsValidationError;

export const contractDeclineValidationError = {
  code: 'INVALID_CONTRACT_DECLINE_INPUT',
  message: 'The decline reason is too long.'
} as const;

export const contractDeclineSchema = Schema.Struct({
  reason: Schema.optional(Schema.NullOr(Schema.Trim.pipe(Schema.maxLength(1000))))
});

export type ContractDeclineInput = Schema.Schema.Type<typeof contractDeclineSchema>;

export const validateContractDeclineInput = validateInput(
  contractDeclineSchema,
  contractDeclineValidationError
);

export const contractDeclineJsonError = contractDeclineValidationError;

export const contractEndValidationError = {
  code: 'INVALID_CONTRACT_END_INPUT',
  message: 'The note is too long.'
} as const;

export const contractEndSchema = Schema.Struct({
  note: Schema.optional(Schema.NullOr(Schema.Trim.pipe(Schema.maxLength(1000))))
});

export type ContractEndInput = Schema.Schema.Type<typeof contractEndSchema>;

export const validateContractEndInput = validateInput(
  contractEndSchema,
  contractEndValidationError
);

export const contractEndJsonError = contractEndValidationError;

export const contractIdValidationError = {
  code: 'INVALID_CONTRACT_ID',
  message: 'A valid contract id is required.'
} as const;

export const validateContractId = validateInput(Schema.UUID, contractIdValidationError);
