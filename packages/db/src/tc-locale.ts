/**
 * Per-locale terms and conditions (U7), free of I/O.
 *
 * English is authoritative and numbers the revisions; a translation is a row
 * in another locale with the same version number as the English revision it
 * translates. See the tc_document_versions comment in the schema.
 */
export const tcLocales = ['en', 'fr'] as const;
export type TcLocale = (typeof tcLocales)[number];
export const TC_SOURCE_LOCALE: TcLocale = 'en';

export const isTcLocale = (value: unknown): value is TcLocale =>
  typeof value === 'string' && (tcLocales as ReadonlyArray<string>).includes(value);

/** Any locale the platform doesn't carry reads the English text. */
export const toTcLocale = (value: string | null | undefined): TcLocale =>
  isTcLocale(value) ? value : TC_SOURCE_LOCALE;

type VersionRow = {
  id: string;
  locale: string;
  version: number;
  publishedAt: Date | null;
};

/** The current revision: the latest published English version. */
export const currentRevision = <V extends VersionRow>(versions: ReadonlyArray<V>): V | null =>
  versions
    .filter((row) => row.locale === TC_SOURCE_LOCALE && row.publishedAt !== null)
    .reduce<V | null>((latest, row) => (latest && latest.version >= row.version ? latest : row), null);

/**
 * What a reader in `locale` is shown: the published translation of the
 * current revision, else the English text (`fallback` = true when a
 * translation was wanted but is missing or out of date).
 */
export const displayedVersion = <V extends VersionRow>(
  versions: ReadonlyArray<V>,
  locale: TcLocale
): { version: V; fallback: boolean } | null => {
  const english = currentRevision(versions);
  if (!english) return null;
  if (locale === TC_SOURCE_LOCALE) return { version: english, fallback: false };
  const translation = versions.find(
    (row) => row.locale === locale && row.version === english.version && row.publishedAt !== null
  );
  return translation ? { version: translation, fallback: false } : { version: english, fallback: true };
};

/** Whether `versionId` names a published row (any locale) of the current
 * revision — what accepting is allowed to record. */
export const currentRevisionRow = <V extends VersionRow>(
  versions: ReadonlyArray<V>,
  versionId: string
): V | null => {
  const english = currentRevision(versions);
  const row = versions.find((candidate) => candidate.id === versionId);
  return english && row && row.publishedAt !== null && row.version === english.version
    ? row
    : null;
};

/**
 * The version number a new draft in `locale` takes. English drafts open the
 * next revision; a translation translates the latest English revision (a
 * draft one included, so both can go live together). Null when there is no
 * English text to translate yet.
 */
export const nextDraftVersion = (
  versions: ReadonlyArray<VersionRow>,
  locale: TcLocale
): number | null => {
  const englishVersions = versions
    .filter((row) => row.locale === TC_SOURCE_LOCALE)
    .map((row) => row.version);
  const latestEnglish = englishVersions.length > 0 ? Math.max(...englishVersions) : null;
  if (locale === TC_SOURCE_LOCALE) return (latestEnglish ?? 0) + 1;
  return latestEnglish;
};
