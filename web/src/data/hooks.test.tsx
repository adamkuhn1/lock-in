import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { demoAuth } from './auth';
import { DataProvider } from './context';
import { createDemoApi } from './demo';
import { useWorkOnIdea } from './hooks';

describe('useWorkOnIdea', () => {
  it('ignores a repeat call while in flight, and allows one after it settles', async () => {
    const api = createDemoApi();
    const launch = vi.spyOn(api, 'requestLaunch');
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DataProvider api={api} auth={demoAuth}><QueryClientProvider client={qc}>{children}</QueryClientProvider></DataProvider>
    );
    const { result } = renderHook(() => useWorkOnIdea(), { wrapper });
    act(() => { result.current.mutate({ id: 'i2', status: 'todo' }); result.current.mutate({ id: 'i2', status: 'todo' }); });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(launch).toHaveBeenCalledTimes(1);
    act(() => { result.current.mutate({ id: 'i2', status: 'todo' }); });
    await waitFor(() => expect(launch).toHaveBeenCalledTimes(2));
  });
});
