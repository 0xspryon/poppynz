/** Provider profile read/update + location picking, backed by /me/profile
 * and /geocoding. Location is saved as a Google place id; the API resolves
 * coordinates server-side. */
import { apiClient, call, type ApiResult, type ErrorsOf, type UnexpectedError } from './client';

const getEndpoint = apiClient.me.profile.$get;
const updateEndpoint = apiClient.me.profile.$patch;
const locationEndpoint = apiClient.me.profile.location.$patch;
const photoEndpoint = apiClient.me.profile.photo.$put;
const presignEndpoint = apiClient.uploads['presigned-url'].$post;
const suggestionsEndpoint = apiClient.geocoding['place-suggestions'].$get;

export type ProviderProfile = Extract<Awaited<ReturnType<typeof getProfile>>, { ok: true }>['data'];
export type ProfileError = ErrorsOf<typeof getEndpoint>;
export type ProfileUpdateError = ErrorsOf<typeof updateEndpoint>;
export type ProfileLocationError = ErrorsOf<typeof locationEndpoint>;
export type ProfilePhotoError =
	| ErrorsOf<typeof presignEndpoint>
	| ErrorsOf<typeof photoEndpoint>
	| UnexpectedError;
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

/**
 * Profile photo: presign a public-bucket upload, PUT the file to storage,
 * then point the profile at the stored key. Returns the refreshed profile
 * (its `image` is a short-lived view URL).
 */
export async function uploadProfilePhoto(
	file: File
): Promise<ApiResult<ProviderProfile, ProfilePhotoError>> {
	const presigned = await call(
		presignEndpoint({
			json: {
				target: 'public-profile-picture',
				fileName: file.name,
				contentType: file.type || 'application/octet-stream',
				sizeBytes: file.size
			}
		})
	);
	if (!presigned.ok) return presigned;

	try {
		const uploadRes = await fetch(presigned.data.uploadUrl, {
			method: 'PUT',
			headers: { 'content-type': file.type || 'application/octet-stream' },
			body: file
		});
		if (!uploadRes.ok) {
			return {
				ok: false,
				error: {
					code: 'UNEXPECTED',
					message: 'The photo could not be uploaded to storage.',
					status: uploadRes.status
				}
			};
		}
	} catch {
		return {
			ok: false,
			error: { code: 'UNEXPECTED', message: 'The photo upload could not be sent.', status: null }
		};
	}

	const args = { json: { fileKey: presigned.data.fileKey } } as unknown as Parameters<
		typeof photoEndpoint
	>[0];
	return call(photoEndpoint(args));
}

export async function getPlaceSuggestions(query: string) {
	return call(suggestionsEndpoint({ query: { query } }));
}

export type { ApiResult };
