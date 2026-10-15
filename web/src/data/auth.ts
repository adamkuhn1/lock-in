import type { SupabaseClient } from '@supabase/supabase-js';

export interface AuthApi {
  hasSession(): Promise<boolean>;
  onChange(cb: (signedIn: boolean) => void): () => void;
  /** Rejects with an AuthError (fixed, user-safe copy) on failure. */
  signInWithPassword(email: string, password: string): Promise<void>;
  /** Rejects with an AuthError (fixed, user-safe copy) on failure. */
  setPassword(password: string): Promise<void>;
  sendLink(email: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<void>;
  signOut(): Promise<void>;
}

/** An error whose message is safe to show as-is. */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export const AUTH_COPY = {
  wrong: 'Wrong email or password.',
  network: "Couldn't reach the server. Try again.",
  weak: 'Use at least 10 characters.',
  reauth: 'For security, sign in with the email link once on this device, then set your password.',
  other: "Couldn't sign in. Try again.",
} as const;

/** Map any Supabase/fetch failure to fixed copy. Raw backend text never leaves this function. */
export function mapAuthError(err: unknown): AuthError {
  if (err instanceof AuthError) return err;
  const e = (err ?? {}) as { code?: string; name?: string; message?: string };
  const code = e.code ?? '';
  const text = `${e.name ?? ''} ${e.message ?? ''}`.toLowerCase();
  if (code === 'invalid_credentials' || /invalid login credentials/.test(text)) return new AuthError(AUTH_COPY.wrong);
  if (code.startsWith('reauthentication') || /reauthenticat/.test(text)) return new AuthError(AUTH_COPY.reauth);
  if (code === 'weak_password' || /password should be at least|weak password|password is too short/.test(text)) return new AuthError(AUTH_COPY.weak);
  if (/failed to fetch|load failed|networkerror|network request failed|retryablefetch/.test(text)) return new AuthError(AUTH_COPY.network);
  return new AuthError(AUTH_COPY.other);
}

export function supabaseAuth(sb: SupabaseClient, redirectTo = window.location.origin): AuthApi {
  return {
    async hasSession() {
      // A throw, or a refresh that failed on a bad connection, is not a sign-out: reject so callers keep the cached session.
      let result;
      try {
        result = await sb.auth.getSession();
      } catch (e) {
        throw mapAuthError(e);
      }
      const { data, error } = result;
      if (!data.session && error && (error as { name?: string }).name === 'AuthRetryableFetchError') throw mapAuthError(error);
      return data.session !== null;
    },
    async signInWithPassword(email, password) {
      try {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } catch (e) {
        throw mapAuthError(e);
      }
    },
    async setPassword(password) {
      try {
        const { error } = await sb.auth.updateUser({ password });
        if (error) throw error;
      } catch (e) {
        throw mapAuthError(e);
      }
    },
    onChange(cb) {
      const { data } = sb.auth.onAuthStateChange((event, session) => {
        // On subscribe supabase-js emits INITIAL_SESSION, null if the refresh failed offline. hasSession owns the initial answer.
        if (event === 'INITIAL_SESSION' && !session) return;
        cb(session !== null);
      });
      return () => data.subscription.unsubscribe();
    },
    async sendLink(email) {
      // Sign-ups are disabled server-side; shouldCreateUser:false makes an unknown email fail fast.
      const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: redirectTo } });
      if (error) throw new Error(error.message);
    },
    async verifyCode(email, code) {
      const { error } = await sb.auth.verifyOtp({ email, token: code, type: 'email' });
      if (error) throw new Error(error.message);
    },
    async signOut() {
      await sb.auth.signOut();
    },
  };
}

export const demoAuth: AuthApi = {
  hasSession: async () => true,
  onChange: () => () => undefined,
  signInWithPassword: async () => undefined,
  setPassword: async () => undefined,
  sendLink: async () => undefined,
  verifyCode: async () => undefined,
  signOut: async () => undefined,
};
