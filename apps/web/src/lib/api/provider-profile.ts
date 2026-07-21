/** Provider profile read/update + location picking, backed by /me/profile
 * and /geocoding. Location is saved as a Google place id; the API resolves
 * coordinates server-side. */
import { apiClient, call, type ApiResult, type ErrorsOf } from './client';

const getEndpoint = apiClient.me.profile.$get;
const updateEndpoint = apiClient.me.profile.$patch;
const locationEndpoint = apiClient.me.profile.location.$patch;
const suggestionsEndpoint = apiClient.geocoding['place-suggestions'].$get;

export type ProviderProfile = Extract<Awaited<ReturnType<typeof getProfile>>, { ok: true }>['data'];
export type ProfileError = ErrorsOf<typeof getEndpoint>;
export type ProfileUpdateError = ErrorsOf<typeof updateEndpoint>;
export type ProfileLocationError = ErrorsOf<typeof locationEndpoint>;
export type PlaceSuggestionsError = ErrorsOf<typeof suggestionsEndpoint>;
export type PlaceSuggestion = Extract<
	Awaited<ReturnType<typeof getPlaceSuggestions>>,
	{ ok: true }
>['data']['suggestions'][number];

export interface ProfileDraft {
	firstName?: string | null;
	lastName?: string | null;
	gender?: 'male' | 'female' | null;
	phoneNumber?: string | null;
	dateOfBirth?: string | null;
	shortBio?: string | null;
}

export async function getProfile() {
	return call(getEndpoint());
}

export async function updateProfile(patch: ProfileDraft) {
	// The API reads PATCH bodies via parseJsonBody (no hono validator), so the
	// RPC input type omits `json` — the client still serializes it at runtime.
	const args = { json: patch } as unknown as Parameters<typeof updateEndpoint>[0];
	return call(updateEndpoint(args));
}

export async function updateProfileLocation(googlePlaceId: string) {
	const args = { json: { googlePlaceId } } as unknown as Parameters<typeof locationEndpoint>[0];
	return call(locationEndpoint(args));
}

export async function getPlaceSuggestions(query: string) {
	return call(suggestionsEndpoint({ query: { query } }));
}

export type { ApiResult };
