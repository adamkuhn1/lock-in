import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createDemoApi } from '../data/demo';
import { followUpOn } from '../lib/outreach';
import { localDay } from '../lib/time';
import { renderWithData } from '../test/render';
import Outreach, { PromptButton } from './Outreach';

const cardFor = async (name: string) => (await screen.findByRole('heading', { level: 2, name })).closest('section') as HTMLElement;

describe('Outreach', () => {
  it('rejects a pasted string that is not a job link', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'queueOutreach');
    renderWithData(<Outreach />, { api });
    await userEvent.type(await screen.findByRole('textbox', { name: 'Job link' }), 'javascript:alert(1){Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Paste a full job link');
    expect(spy).not.toHaveBeenCalled();
  });
  it('a pasted link becomes a card queued for the Mac', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'queueOutreach');
    renderWithData(<Outreach />, { api });
    await userEvent.type(await screen.findByRole('textbox', { name: 'Job link' }), ' https://jobs.lever.co/acme/42 {Enter}');
    expect(spy).toHaveBeenCalledWith({ job_url: 'https://jobs.lever.co/acme/42' });
    const card = await cardFor('jobs.lever.co');
    expect(within(card).getByText('Queued for Mac')).toBeInTheDocument();
  });
  it('Copy prompt copies the rendered template', async () => {
    const user = userEvent.setup();
    renderWithData(<Outreach />);
    const card = await cardFor('Ramp');
    expect(within(card).getByText('Queued for Mac')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Copy prompt' }));
    expect(await navigator.clipboard.readText()).toContain('save-outreach --id o2');
    expect(within(card).getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });
  it('drafted card: contacts, drafts behind a tap, Sent sets the follow-up', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'updateOutreach');
    renderWithData(<Outreach />, { api });
    const card = await cardFor('Stripe');
    expect(within(card).getByText('Dana Reyes')).toBeInTheDocument();
    expect(within(card).getByText('dreyes@stripe.com')).toBeInTheDocument();
    expect(within(card).getAllByText('Draft')).toHaveLength(2);
    await userEvent.click(within(card).getByRole('button', { name: 'Sent' }));
    const today = localDay(new Date());
    expect(spy).toHaveBeenCalledWith('o1', { status: 'sent', sent_on: today, follow_up_on: followUpOn(today) });
  });
  it('never links a non-http LinkedIn value', async () => {
    const api = createDemoApi();
    const base = await api.listContacts();
    api.listContacts = async () => base.map((c) => ({ ...c, linkedin_url: 'javascript:alert(1)' }));
    const { container } = renderWithData(<Outreach />, { api });
    await cardFor('Stripe');
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
  });
  it('a launched request shows Opened on Mac', async () => {
    const api = createDemoApi();
    const reqs = await api.listLaunchRequests();
    api.listLaunchRequests = async () => reqs.map((r) => ({ ...r, status: 'launched' as const }));
    renderWithData(<Outreach />, { api });
    expect(within(await cardFor('Ramp')).getByText('Opened on Mac')).toBeInTheDocument();
  });
  it('failed launch shows the error and Try again', async () => {
    const api = createDemoApi();
    const reqs = await api.listLaunchRequests();
    api.listLaunchRequests = async () => reqs.map((r) => ({ ...r, status: 'failed' as const, error: 'osascript failed (1): Not authorized' }));
    const spy = vi.spyOn(api, 'requestLaunch');
    renderWithData(<Outreach />, { api });
    const card = await cardFor('Ramp');
    expect(within(card).getByText('osascript failed (1): Not authorized')).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Try again' }));
    expect(spy).toHaveBeenCalledWith('outreach', { outreach_id: 'o2', job_url: 'https://jobs.ashbyhq.com/ramp/7d1c' });
  });
  it('a long launcher error is shortened with the full text behind a disclosure (M8)', async () => {
    const api = createDemoApi();
    const reqs = await api.listLaunchRequests();
    const full = `osascript failed (1): Not authorized\n${'detail line\n'.repeat(30)}`;
    api.listLaunchRequests = async () => reqs.map((r) => ({ ...r, status: 'failed' as const, error: full }));
    renderWithData(<Outreach />, { api });
    const card = await cardFor('Ramp');
    expect(within(card).getByText('osascript failed (1): Not authorized', { selector: 'p' })).toBeInTheDocument();
    const details = card.querySelector('details');
    expect(details).not.toBeNull();
    expect(details).toHaveTextContent('detail line');
  });
  it("a prompt that can't be built says so (M4)", async () => {
    render(<PromptButton build={() => { throw new Error('missing values for: job_url'); }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy prompt' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't build the prompt.");
  });
  it('PromptButton clears its reset timer on unmount (M4)', async () => {
    const set = vi.spyOn(window, 'setTimeout');
    const clear = vi.spyOn(window, 'clearTimeout');
    const { unmount } = render(<PromptButton build={() => 'hello'} />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy prompt' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    const call = set.mock.calls.findIndex((c) => c[1] === 1500);
    expect(call).toBeGreaterThanOrEqual(0);
    const id = set.mock.results[call].value;
    unmount();
    expect(clear).toHaveBeenCalledWith(id);
    set.mockRestore(); clear.mockRestore();
  });
});
