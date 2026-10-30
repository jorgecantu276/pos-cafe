// Only the TV screen currently needs a post-login destination. Keep the
// allowlist exact so query parameters cannot introduce external redirects.
export function loginReturnTarget(value: string | null): '/tv' | '/' {
  return value === '/tv' ? '/tv' : '/';
}

export const TV_LOGIN_URL = '/login?returnTo=%2Ftv';
