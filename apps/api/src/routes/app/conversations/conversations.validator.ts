import { Schema } from "effect";
import { validateInput } from "@/api/lib/schema-validator";

export const reachoutValidationError = {
  code: "INVALID_REACHOUT_INPUT",
  message: "A recipient and at least one service are required.",
} as const;

export const reachoutCreateSchema = Schema.Struct({
  recipientUserId: Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(255)),
  serviceIds: Schema.Array(Schema.UUID).pipe(Schema.minItems(1), Schema.maxItems(50)),
});

export type ReachoutCreateInput = Schema.Schema.Type<typeof reachoutCreateSchema>;

export const validateReachoutCreateInput = validateInput(reachoutCreateSchema, reachoutValidationError);

export const reachoutJsonError = reachoutValidationError;

export const messageValidationError = {
  code: "INVALID_MESSAGE_INPUT",
  message: "A message body is required.",
} as const;

export const messageCreateSchema = Schema.Struct({
  body: Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(4000)),
});

export type MessageCreateInput = Schema.Schema.Type<typeof messageCreateSchema>;

export const validateMessageCreateInput = validateInput(messageCreateSchema, messageValidationError);

export const messageJsonError = messageValidationError;

export const conversationIdValidationError = {
  code: "INVALID_CONVERSATION_ID",
  message: "A valid conversation id is required.",
} as const;

export const validateConversationId = validateInput(Schema.UUID, conversationIdValidationError);

export const lookupValidationError = {
  code: "INVALID_LOOKUP_INPUT",
  message: "A counterpart user id is required.",
} as const;

export const validateLookupUserId = validateInput(
  Schema.Trim.pipe(Schema.minLength(1), Schema.maxLength(255)),
  lookupValidationError,
);
