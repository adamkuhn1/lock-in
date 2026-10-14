import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import type { DataApi } from './data/api';
import type { AuthApi } from './data/auth';
import { DataProvider } from './data/context';
import Applications from './screens/Applications';
import Jobs from './screens/Jobs';
import LeetCode from './screens/LeetCode';
import Outreach from './screens/Outreach';
import Projects from './screens/Projects';
import SettingsScreen from './screens/Settings';
import Today from './screens/Today';
import { AppShell } from './ui/AppShell';
import { SignIn } from './ui/SignIn';

function AuthGate({ auth, children }: { auth: AuthApi; children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'in' | 'out'>('loading');
  useEffect(() => {
    let alive = true;
    void auth.hasSession().then((ok) => alive && setState(ok ? 'in' : 'out'));
    const off = auth.onChange((ok) => setState(ok ? 'in' : 'out'));
    return () => { alive = false; off(); };
  }, [auth]);
  if (state === 'loading') return <div className="boot" role="status" aria-label="Loading" />;
  if (state === 'out') return <SignIn auth={auth} />;
  return <>{children}</>;
}

export default function App({ api, auth }: { api: DataApi; auth: AuthApi }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }));
  return (
    <DataProvider api={api} auth={auth}>
      <AuthGate auth={auth}>
        <QueryClientProvider client={qc}>
          <BrowserRouter>
            <Routes>
              <Route element={<AppShell />}>
                <Route index element={<Today />} />
                <Route path="leetcode" element={<LeetCode />} />
                <Route path="projects" element={<Projects />} />
                <Route path="apps" element={<Applications />} />
                <Route path="jobs" element={<Jobs />} />
                <Route path="outreach" element={<Outreach />} />
                <Route path="settings" element={<SettingsScreen />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </QueryClientProvider>
      </AuthGate>
    </DataProvider>
  );
}
