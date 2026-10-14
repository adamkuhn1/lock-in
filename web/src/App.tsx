import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter } from 'react-router';
import type { DataApi } from './data/api';
import type { AuthApi } from './data/auth';
import { DataProvider } from './data/context';
import { AppRoutes } from './routes';
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
            <AppRoutes />
          </BrowserRouter>
        </QueryClientProvider>
      </AuthGate>
    </DataProvider>
  );
}
