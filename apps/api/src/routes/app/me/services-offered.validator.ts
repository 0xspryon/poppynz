import { Schema } from "effect";
import { validateInput } from "@/api/lib/schema-validator";

const servicesOfferedValidationError = {
  code: "INVALID_SERVICE_OFFERED_INPUT",
  message: "Service offered input contains invalid or unsupported fields.",
} as const;

const trimmedNonEmptyString = Schema.Trim.pipe(Schema.nonEmptyString());
const optionalDescription = Schema.optional(Schema.NullOr(Schema.Trim.pipe(Schema.maxLength(1000))));

export const serviceOfferedCreateSchema = Schema.Struct({
  name: trimmedNonEmptyString.pipe(Schema.maxLength(120)),
  description: optionalDescription,
  hourlyRateCents: Schema.Number.pipe(Schema.int(), Schema.positive()),
  currency: Schema.optional(trimmedNonEmptyString.pipe(Schema.maxLength(3))),
});

export const serviceOfferedUpdateSchema = Schema.partial(serviceOfferedCreateSchema);

export type ServiceOfferedCreateInput = Schema.Schema.Type<typeof serviceOfferedCreateSchema>;
export type ServiceOfferedUpdateInput = Schema.Schema.Type<typeof serviceOfferedUpdateSchema>;

export const validateServiceOfferedCreateInput = validateInput(serviceOfferedCreateSchema, servicesOfferedValidationError);
export const validateServiceOfferedUpdateInput = validateInput(serviceOfferedUpdateSchema, servicesOfferedValidationError);
export const serviceOfferedJsonError = servicesOfferedValidationError;
