import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createDemoApi } from '../data/demo';
import { renderWithData } from '../test/render';
import { demoAuth } from '../data/auth';
import { STAGE_RULES } from '../lib/stages';
import Settings from './Settings';

describe('Settings', () => {
  it('shows sync status with a stale badge and the failing error', async () => {
    const { container } = renderWithData(<Settings />);
    const sync = container.querySelector('[data-primary]') as HTMLElement;
    const sheet = (await within(sync).findByText('Sheet')).closest('li')!;
    expect(sheet).toHaveTextContent('Stale');
    expect(sheet).toHaveTextContent('TransportError: timed out');
    expect(within(sync).getByText('LeetCode').closest('li')).not.toHaveTextContent('Stale');
  });
  it('a long sync error is shortened, with the full text behind a disclosure (M8)', async () => {
    const api = createDemoApi();
    const full = `TransportError: timed out\n${'Traceback line\n'.repeat(20)}`;
    api.listSyncStatus = async () => [{ source: 'sheet', last_ok_at: null, last_error: full, consecutive_failures: 3 }];
    const { container } = renderWithData(<Settings />, { api });
    const sync = container.querySelector('[data-primary]') as HTMLElement;
    const li = (await within(sync).findByText('Sheet')).closest('li')!;
    expect(within(li).getByText('TransportError: timed out', { selector: 'p' })).toBeInTheDocument();
    const details = li.querySelector('details');
    expect(details).not.toBeNull();
    expect(details).toHaveTextContent('Traceback line');
  });
  it('saves targets; the daily LeetCode count lives on the LeetCode screen only (M10)', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'updateSettings');
    renderWithData(<Settings />, { api });
    const weekly = await screen.findByRole('spinbutton', { name: 'Applications per week' });
    expect(screen.queryByRole('group', { name: 'LeetCode per day' })).toBeNull();
    await userEvent.clear(weekly);
    await userEvent.type(weekly, '30');
    await userEvent.tab();
    expect(spy).toHaveBeenCalledWith({ weekly_app_target: 30 });
  });
  it('rejects nudge times out of order', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'updateSettings');
    renderWithData(<Settings />, { api });
    const check = await screen.findByLabelText('Check-in');
    await userEvent.clear(check);
    await userEvent.type(check, '09:00');
    expect(screen.queryByText('Times must be in order.')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save times' }));
    expect(await screen.findByText('Times must be in order.')).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalledWith(expect.objectContaining({ nudge_times: expect.anything() }));
  });
  it('rejects a non-http app URL', async () => {
    renderWithData(<Settings />);
    const field = await screen.findByRole('textbox', { name: 'App URL' });
    await userEvent.type(field, 'javascript:alert(1)');
    await userEvent.tab();
    expect(await screen.findByText('Must start with http:// or https://')).toBeInTheDocument(); // M11
  });
  it('adds and toggles projects with validation', async () => {
    const api = createDemoApi();
    const add = vi.spyOn(api, 'addProject');
    const toggle = vi.spyOn(api, 'setProjectActive');
    renderWithData(<Settings />, { api });
    await userEvent.click(await screen.findByRole('checkbox', { name: /Showboat/ }));
    expect(toggle).toHaveBeenCalledWith('showboat', false);
    await userEvent.click(screen.getByText('New project'));
    await userEvent.type(screen.getByRole('textbox', { name: 'ID' }), 'lego');
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'LEGO');
    await userEvent.type(screen.getByRole('textbox', { name: 'GitHub repo' }), 'not a repo');
    await userEvent.click(screen.getByRole('button', { name: 'Add project' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Repo looks like owner/name.');
    await userEvent.clear(screen.getByRole('textbox', { name: 'GitHub repo' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'GitHub repo' }), 'adamkuhn1/lego');
    await userEvent.click(screen.getByRole('button', { name: 'Add project' }));
    expect(add).toHaveBeenCalledWith({ id: 'lego', name: 'LEGO', repo: 'adamkuhn1/lego', local_path: null });
  });
  it('shows the Sheet status → stage table', async () => {
    renderWithData(<Settings />);
    const table = await screen.findByRole('table', { name: 'Sheet stages' });
    expect(within(table).getAllByRole('row')).toHaveLength(STAGE_RULES.length + 1); // header + rules
  });
  it('signs out', async () => {
    const spy = vi.spyOn(demoAuth, 'signOut');
    renderWithData(<Settings />);
    await userEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(spy).toHaveBeenCalled();
  });
  it('shows a short fixed error when saving fails', async () => {
    const api = createDemoApi();
    api.updateSettings = async () => { throw new Error('PGRST301 raw db message'); };
    renderWithData(<Settings />, { api });
    const weekly = await screen.findByRole('spinbutton', { name: 'Applications per week' });
    await userEvent.clear(weekly);
    await userEvent.type(weekly, '30');
    await userEvent.tab();
    expect(await screen.findByText("Couldn't save. Try again.")).toBeInTheDocument();
    expect(screen.queryByText(/PGRST301/)).not.toBeInTheDocument();
  });
  it('shows fixed copy next to a text field that failed to save', async () => {
    const api = createDemoApi();
    api.updateSettings = async () => { throw new Error('raw'); };
    renderWithData(<Settings />, { api });
    const field = await screen.findByRole('textbox', { name: 'Resume folder' });
    await userEvent.clear(field);
    await userEvent.type(field, '/tmp/x');
    await userEvent.tab();
    expect((await screen.findAllByText("Couldn't save. Try again.")).length).toBeGreaterThan(0);
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });
});
