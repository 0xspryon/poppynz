import { Schema } from 'effect';
import { validateInput } from '@/api/lib/schema-validator';

const servicesNeededValidationError = {
  code: 'INVALID_SERVICE_NEEDED_INPUT',
  message: 'Service needed input contains invalid or unsupported fields.'
} as const;

const trimmedNonEmptyString = Schema.Trim.pipe(Schema.nonEmptyString());
const optionalDescription = Schema.optional(
  Schema.NullOr(Schema.Trim.pipe(Schema.maxLength(1000)))
);

export const serviceNeededCreateSchema = Schema.Struct({
  name: trimmedNonEmptyString.pipe(Schema.maxLength(120)),
  description: optionalDescription,
  catalogueServiceId: Schema.optional(Schema.NullOr(Schema.UUID))
});

export const serviceNeededUpdateSchema = Schema.partial(serviceNeededCreateSchema);

export type ServiceNeededCreateInput = Schema.Schema.Type<typeof serviceNeededCreateSchema>;
export type ServiceNeededUpdateInput = Schema.Schema.Type<typeof serviceNeededUpdateSchema>;

export const validateServiceNeededCreateInput = validateInput(
  serviceNeededCreateSchema,
  servicesNeededValidationError
);
export const validateServiceNeededUpdateInput = validateInput(
  serviceNeededUpdateSchema,
  servicesNeededValidationError
);
export const serviceNeededJsonError = servicesNeededValidationError;
