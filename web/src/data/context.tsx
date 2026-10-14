import { createContext, useContext, type ReactNode } from 'react';
import type { DataApi } from './api';
import type { AuthApi } from './auth';

const ApiContext = createContext<DataApi | null>(null);
const AuthContext = createContext<AuthApi | null>(null);

export function DataProvider({ api, auth, children }: { api: DataApi; auth: AuthApi; children: ReactNode }) {
  return (
    <AuthContext.Provider value={auth}>
      <ApiContext.Provider value={api}>{children}</ApiContext.Provider>
    </AuthContext.Provider>
  );
}

export function useApi(): DataApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error('useApi must be used inside <DataProvider>');
  return api;
}

export function useAuth(): AuthApi {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth must be used inside <DataProvider>');
  return auth;
}
