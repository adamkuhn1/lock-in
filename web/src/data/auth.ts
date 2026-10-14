import type { SupabaseClient } from '@supabase/supabase-js';

export interface AuthApi {
  hasSession(): Promise<boolean>;
  onChange(cb: (signedIn: boolean) => void): () => void;
  sendLink(email: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<void>;
  signOut(): Promise<void>;
}

export function supabaseAuth(sb: SupabaseClient, redirectTo = window.location.origin): AuthApi {
  return {
    async hasSession() {
      const { data } = await sb.auth.getSession();
      return data.session !== null;
    },
    onChange(cb) {
      const { data } = sb.auth.onAuthStateChange((_event, session) => cb(session !== null));
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
  sendLink: async () => undefined,
  verifyCode: async () => undefined,
  signOut: async () => undefined,
};
