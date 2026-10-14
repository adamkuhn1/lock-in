import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createDemoApi } from '../data/demo';
import { planDay } from '../lib/time';
import { renderWithData } from '../test/render';
import Prep from './Prep';

describe('Prep', () => {
  it('company prep lists OA/interview companies, interviews soonest first, and saves notes', async () => {
    const api = createDemoApi();
    const save = vi.spyOn(api, 'saveCompanyPrep');
    const { container } = renderWithData(<Prep />, { api });
    const primary = await screen.findByRole('region', { name: 'Company prep' });
    expect(container.querySelector('[data-primary]')).toBe(primary);
    const names = within(primary).getAllByRole('group').map((d) => d.querySelector('summary')!.textContent);
    expect(names[0]).toMatch(/^Datadog/);
    expect(names.join('|')).toMatch(/Stripe/);
    await userEvent.click(within(primary).getByText('Stripe'));
    await userEvent.type(within(primary).getByLabelText('Stripe notes'), 'OA is CodeSignal');
    await userEvent.click(within(primary).getByRole('button', { name: 'Save Stripe' }));
    expect(save).toHaveBeenCalledWith({ company: 'Stripe', notes: 'OA is CodeSignal', links: '', interview_on: null });
  });

  it('logs a prep session for today and lists it', async () => {
    const api = createDemoApi();
    const add = vi.spyOn(api, 'addPrepSession');
    renderWithData(<Prep />, { api });
    await userEvent.type(await screen.findByLabelText('Note (optional)'), 'Two Sum variants');
    await userEvent.click(screen.getByRole('button', { name: 'Log Study' }));
    expect(add).toHaveBeenCalledWith({ kind: 'study', minutes: 30, note: 'Two Sum variants', happened_on: planDay(new Date()) });
    expect(await screen.findByText(/^Study · 30 min · Two Sum variants/)).toBeInTheDocument();
  });

  it('Mock with Claude queues a launch with the chosen company', async () => {
    const api = createDemoApi();
    const launch = vi.spyOn(api, 'requestLaunch');
    renderWithData(<Prep />, { api });
    await userEvent.selectOptions(await screen.findByLabelText('Company (optional)'), 'Datadog');
    await userEvent.click(screen.getByRole('button', { name: 'Behavioral' }));
    expect(launch).toHaveBeenCalledWith('mock_interview', { mode: 'behavioral', company: 'Datadog' });
    expect(await screen.findByText('Queued for Mac')).toBeInTheDocument();
  });

  it('story bank: hint, add, practice and delete with confirm', async () => {
    const api = createDemoApi();
    renderWithData(<Prep />, { api });
    expect(await screen.findByText('No story for: failure')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'New story' }));
    const form = screen.getByRole('region', { name: 'New story' });
    await userEvent.click(within(form).getByRole('button', { name: 'Save story' }));
    expect(within(form).getByText('Title is required.')).toBeInTheDocument();
    await userEvent.type(within(form).getByLabelText('Title'), 'Failed demo day');
    await userEvent.click(within(form).getByRole('button', { name: 'failure' }));
    await userEvent.click(within(form).getByRole('button', { name: 'Save story' }));
    expect(await screen.findByText('Failed demo day')).toBeInTheDocument();
    expect(screen.queryByText(/^No story for/)).toBeNull();
    const row = screen.getByText('Group project conflict').closest('li')!;
    await userEvent.click(within(row).getByText('Group project conflict'));
    await userEvent.click(within(row).getByRole('button', { name: 'Practiced' }));
    expect(await within(row).findByRole('button', { name: 'Practiced today' })).toBeDisabled();
    await userEvent.click(within(row).getByRole('button', { name: 'Delete' }));
    await userEvent.click(within(row).getByRole('button', { name: 'Delete story' }));
    expect((await api.listStories()).some((s) => s.title === 'Group project conflict')).toBe(false);
  });

  it('fundamentals cycle not started → learning → solid → not started', async () => {
    const api = createDemoApi();
    const set = vi.spyOn(api, 'setPrepProgress');
    renderWithData(<Prep />, { api });
    await userEvent.click(await screen.findByText(/^System design \(1\/15 solid\)$/));
    const item = screen.getByRole('button', { name: 'Design a rate limiter: Not started' });
    await userEvent.click(item);
    expect(set).toHaveBeenLastCalledWith('sd-rate-limiter', 'learning');
    await userEvent.click(await screen.findByRole('button', { name: 'Design a rate limiter: Learning' }));
    expect(set).toHaveBeenLastCalledWith('sd-rate-limiter', 'solid');
    await userEvent.click(await screen.findByRole('button', { name: 'Design a rate limiter: Solid' }));
    expect(set).toHaveBeenLastCalledWith('sd-rate-limiter', null);
  });
});
