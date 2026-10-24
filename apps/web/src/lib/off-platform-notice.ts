/** Chat copy for UAT #38 (draft wording from the UAT report). Sharing contact
 * details stays allowed; these make clear what Poppynz covers. Functions, not
 * constants: the locale is only known per request. */
import { m } from '$lib/paraglide/messages';

/** Always visible in every chat. */
export const standingChatNotice = (): string => m.shell_chat_standing_notice();

/** Shown to both people under a message where a phone number, email or link
 * was detected — the API records each one. */
export const contactDetailsWarning = (): string => m.shell_chat_contact_details_warning();
