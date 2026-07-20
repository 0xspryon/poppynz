import { Schema } from "effect";
import { validateInput } from "@/api/lib/schema-validator";

const serviceCatalogueValidationError = {
  code: "INVALID_SERVICE_CATALOGUE_INPUT",
  message: "Service catalogue input contains invalid or unsupported fields.",
} as const;

const trimmedNonEmptyString = Schema.Trim.pipe(Schema.nonEmptyString());

export const serviceCatalogueItemCreateSchema = Schema.Struct({
  name: trimmedNonEmptyString.pipe(Schema.maxLength(120)),
  category: trimmedNonEmptyString.pipe(Schema.maxLength(80)),
  baseHourlyRateCents: Schema.Number.pipe(Schema.int(), Schema.positive()),
  currency: Schema.optional(trimmedNonEmptyString.pipe(Schema.maxLength(3))),
  isLive: Schema.optional(Schema.Boolean),
});

export const serviceCatalogueItemUpdateSchema = Schema.partial(serviceCatalogueItemCreateSchema);

export type ServiceCatalogueItemCreateInput = Schema.Schema.Type<typeof serviceCatalogueItemCreateSchema>;
export type ServiceCatalogueItemUpdateInput = Schema.Schema.Type<typeof serviceCatalogueItemUpdateSchema>;

export const validateServiceCatalogueItemCreateInput = validateInput(
  serviceCatalogueItemCreateSchema,
  serviceCatalogueValidationError,
);
export const validateServiceCatalogueItemUpdateInput = validateInput(
  serviceCatalogueItemUpdateSchema,
  serviceCatalogueValidationError,
);
export const serviceCatalogueJsonError = serviceCatalogueValidationError;
