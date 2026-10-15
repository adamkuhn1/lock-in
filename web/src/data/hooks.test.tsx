import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { demoAuth } from './auth';
import { DataProvider } from './context';
import { createDemoApi } from './demo';
import { keys, useMarkApplied, useSetApplicationStatus, useWorkOnIdea } from './hooks';
import type { Application } from './types';

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

  it('reverts the idea and rethrows when queuing the launch fails', async () => {
    const api = createDemoApi();
    const update = vi.spyOn(api, 'updateIdea');
    vi.spyOn(api, 'requestLaunch').mockRejectedValue(new Error('network down'));
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DataProvider api={api} auth={demoAuth}><QueryClientProvider client={qc}>{children}</QueryClientProvider></DataProvider>
    );
    const { result } = renderHook(() => useWorkOnIdea(), { wrapper });
    act(() => { result.current.mutate({ id: 'i1', status: 'today' }); });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('network down');
    expect(update).toHaveBeenNthCalledWith(1, 'i1', expect.objectContaining({ status: 'in_progress' }));
    expect(update).toHaveBeenLastCalledWith('i1', { status: 'today', started_at: null });
    const idea = (await api.listIdeas()).find((i) => i.id === 'i1');
    expect(idea).toMatchObject({ status: 'today', started_at: null });
  });
});

describe('useSetApplicationStatus', () => {
  const setup = () => {
    const api = createDemoApi();
    const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <DataProvider api={api} auth={demoAuth}><QueryClientProvider client={qc}>{children}</QueryClientProvider></DataProvider>
    );
    return { api, qc, wrapper };
  };
  it('updates the cached status optimistically', async () => {
    const { api, qc, wrapper } = setup();
    const before = await api.listApplications();
    qc.setQueryData(keys.applications, before);
    let release!: () => void;
    vi.spyOn(api, 'setApplicationStatus').mockImplementation(() => new Promise<void>((r) => { release = r; }));
    const { result } = renderHook(() => useSetApplicationStatus(), { wrapper });
    act(() => { result.current.mutate({ app: before[0], status: 'Rejected after OA' }); });
    await waitFor(() => expect(qc.getQueryData<Application[]>(keys.applications)?.[0].status).toBe('Rejected after OA'));
    act(() => release());
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
  it('reverts the cache on error', async () => {
    const { api, qc, wrapper } = setup();
    const before = await api.listApplications();
    qc.setQueryData(keys.applications, before);
    vi.spyOn(api, 'setApplicationStatus').mockRejectedValue(new Error("Couldn't reach Google. Try again."));
    const { result } = renderHook(() => useSetApplicationStatus(), { wrapper });
    act(() => { result.current.mutate({ app: before[0], status: 'Rejected' }); });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(qc.getQueryData<Application[]>(keys.applications)?.[0].status).toBe(before[0].status);
  });
  it('refetches applications after an error (e.g. a client timeout where the Sheet write may still have landed)', async () => {
    const { api, qc, wrapper } = setup();
    qc.setQueryData(keys.applications, await api.listApplications());
    const inval = vi.spyOn(qc, 'invalidateQueries');
    vi.spyOn(api, 'setApplicationStatus').mockRejectedValue(new Error("Couldn't reach Google. Try again."));
    const { result } = renderHook(() => useSetApplicationStatus(), { wrapper });
    act(() => { result.current.mutate({ app: (qc.getQueryData<Application[]>(keys.applications) ?? [])[0], status: 'Rejected' }); });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(inval).toHaveBeenCalledWith({ queryKey: keys.applications });
  });
  it('useMarkApplied refetches applications, postings and outreach even when it fails', async () => {
    const { api, qc, wrapper } = setup();
    const inval = vi.spyOn(qc, 'invalidateQueries');
    vi.spyOn(api, 'markApplied').mockRejectedValue(new Error("Couldn't reach Google. Try again."));
    const { result } = renderHook(() => useMarkApplied(), { wrapper });
    act(() => { result.current.mutate({ posting_id: 'p1' }); });
    await waitFor(() => expect(result.current.isError).toBe(true));
    for (const k of [keys.applications, keys.postings, keys.outreach]) expect(inval).toHaveBeenCalledWith({ queryKey: k });
  });
});
