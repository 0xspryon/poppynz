// better-auth decodeURIComponent()s these verify-endpoint query params; a
// broken %-escape (e.g. a link truncated when copied from wrapped terminal
// output) makes that throw and 500s the handler. Detect it up front so the
// route can redirect to the UI error page instead.
const CALLBACK_PARAMS = ['callbackURL', 'errorCallbackURL', 'newUserCallbackURL'] as const;

export const hasMalformedCallbackParam = (getParam: (key: string) => string | undefined): boolean =>
  CALLBACK_PARAMS.some((key) => {
    const value = getParam(key);
    if (!value) return false;
    try {
      decodeURIComponent(value);
      return false;
    } catch {
      return true;
    }
  });
