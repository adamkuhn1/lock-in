import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';
import type { DataApi } from '../data/api';
import { demoAuth } from '../data/auth';
import { DataProvider } from '../data/context';
import { createDemoApi } from '../data/demo';

export function renderWithData(ui: ReactElement, opts: { api?: DataApi; route?: string } = {}) {
  const api = opts.api ?? createDemoApi();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } });
  const result = render(
    <DataProvider api={api} auth={demoAuth}>
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[opts.route ?? '/']}>{ui}</MemoryRouter>
      </QueryClientProvider>
    </DataProvider>,
  );
  return { ...result, api, qc };
}
