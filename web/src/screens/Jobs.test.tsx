import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { createDemoApi } from '../data/demo';
import { renderWithData } from '../test/render';
import Jobs from './Jobs';

const tree = (
  <Routes>
    <Route path="/" element={<Jobs />} />
    <Route path="/hunt/outreach" element={<p>outreach page</p>} />
  </Routes>
);

describe('Jobs', () => {
  it('lists new postings by tier, starred first within a tier', async () => {
    const { container } = renderWithData(tree);
    await screen.findAllByRole('button', { name: 'Cold email' });
    const titles = [...container.querySelectorAll('[data-primary] .job-title')].map((n) => n.textContent ?? '');
    expect(titles).toHaveLength(8);
    const company = (t: string) => t.replace(/^.*?Starred: /, '').split(' · ')[0];
    // Tier A (Stripe starred, then Ramp, Cloudflare, Datadog, Robinhood newest first), then tier B (Ford and Rocket starred, then Duolingo)
    expect(titles.map(company)).toEqual(['Stripe', 'Ramp', 'Cloudflare', 'Datadog', 'Robinhood', 'Ford', 'Rocket Companies', 'Duolingo']);
    expect(screen.getAllByText(/^Tier A · /)).toHaveLength(5);
  });
  it('Tier A chip shows only top-tier companies', async () => {
    renderWithData(tree);
    await userEvent.click(await screen.findByRole('button', { name: 'Tier A' }));
    expect(screen.getAllByRole('button', { name: 'Cold email' })).toHaveLength(5);
  });
  it('filters by star and clears', async () => {
    renderWithData(tree);
    await userEvent.click(await screen.findByRole('button', { name: '⭐ Starred' }));
    expect(screen.getAllByRole('button', { name: 'Cold email' })).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: 'New grad' }));
    expect(screen.getByText('Nothing matches these filters.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getAllByRole('button', { name: 'Cold email' })).toHaveLength(8);
  });
  it('dismiss removes a posting', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'setPostingStatus');
    renderWithData(tree, { api });
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss Ramp Software Engineer, New Grad' }));
    expect(spy).toHaveBeenCalledWith('p3', 'dismissed');
    expect(await screen.findAllByRole('button', { name: 'Cold email' })).toHaveLength(7);
  });
  it('cold email queues outreach and goes to Outreach', async () => {
    const api = createDemoApi();
    const queue = vi.spyOn(api, 'queueOutreach');
    const status = vi.spyOn(api, 'setPostingStatus');
    const { container } = renderWithData(tree, { api });
    await screen.findAllByRole('button', { name: 'Cold email' });
    const stripe = [...container.querySelectorAll('li.job')].find((li) => li.textContent?.includes('Stripe')) as HTMLElement;
    await userEvent.click(within(stripe).getByRole('button', { name: 'Cold email' }));
    expect(queue).toHaveBeenCalledWith({ job_url: expect.stringMatching(/^https:\/\/boards\.greenhouse\.io\/stripe\//), company: 'Stripe', role: 'Software Engineer Intern, Winter 2027' });
    expect(await screen.findByText('outreach page')).toBeInTheDocument();
    expect(status).toHaveBeenCalledWith('p1', 'outreach');
  });
  it('Tailor resume queues a tailor request and goes to Outreach', async () => {
    const api = createDemoApi();
    const tailor = vi.spyOn(api, 'queueTailor');
    const cold = vi.spyOn(api, 'queueOutreach');
    const status = vi.spyOn(api, 'setPostingStatus');
    const { container } = renderWithData(tree, { api });
    await screen.findAllByRole('button', { name: 'Tailor resume' });
    const stripe = [...container.querySelectorAll('li.job')].find((li) => li.textContent?.includes('Stripe')) as HTMLElement;
    await userEvent.click(within(stripe).getByRole('button', { name: 'Tailor resume' }));
    expect(tailor).toHaveBeenCalledWith({ job_url: expect.stringMatching(/^https:\/\/boards\.greenhouse\.io\/stripe\//), company: 'Stripe', role: 'Software Engineer Intern, Winter 2027' });
    expect(cold).not.toHaveBeenCalled();
    expect(await screen.findByText('outreach page')).toBeInTheDocument();
    expect(status).toHaveBeenCalledWith('p1', 'outreach');
  });
  it('Cold email and Tailor resume are disabled when an outreach for that job is already queued', async () => {
    const api = createDemoApi();
    const postings = await api.listPostings('2000-01-01T00:00:00Z');
    const stripe = postings.find((p) => p.company === 'Stripe')!;
    await api.queueOutreach({ job_url: stripe.url! });
    const { container } = renderWithData(tree, { api });
    await screen.findAllByRole('button', { name: 'Tailor resume' });
    const rowOf = (company: string) => [...container.querySelectorAll('li.job')].find((li) => li.textContent?.includes(company)) as HTMLElement;
    await vi.waitFor(() => expect(within(rowOf('Stripe')).getByRole('button', { name: 'Tailor resume' })).toBeDisabled());
    expect(within(rowOf('Stripe')).getByRole('button', { name: 'Cold email' })).toBeDisabled();
    expect(within(rowOf('Stripe')).getByText('Already queued')).toHaveClass('muted');
    expect(within(rowOf('Ramp')).getByRole('button', { name: 'Tailor resume' })).toBeEnabled();
    expect(within(rowOf('Ramp')).getByRole('button', { name: 'Cold email' })).toBeEnabled();
    expect(within(rowOf('Ramp')).queryByText('Already queued')).toBeNull();
  });
  it('Jobs renders a javascript: URL as text', async () => {
    const api = createDemoApi();
    api.listPostings = async () => [{
      id: 'evil', company: 'Evil', title: 'Intern', location: null, url: 'javascript:alert(1)', term: null,
      posted_at: null, tier: null, starred: false, status: 'new', found_at: new Date().toISOString(),
    }];
    const { container } = renderWithData(tree, { api });
    expect(await screen.findByText('Link: javascript:alert(1)')).toBeInTheDocument();
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Open' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cold email' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Tailor resume' })).toBeDisabled();
  });
  it('cold email waits for the posting to leave the inbox before navigating', async () => {
    const api = createDemoApi();
    let release!: () => void;
    const orig = api.setPostingStatus.bind(api);
    api.setPostingStatus = (id, status) => new Promise((res) => { release = () => res(orig(id, status)); });
    renderWithData(tree, { api });
    await userEvent.click((await screen.findAllByRole('button', { name: 'Cold email' }))[0]);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText('outreach page')).toBeNull();
    release();
    expect(await screen.findByText('outreach page')).toBeInTheDocument();
  });
  it('dismiss can be undone', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'setPostingStatus');
    renderWithData(tree, { api });
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss Ramp Software Engineer, New Grad' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Dismissed Ramp');
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(spy).toHaveBeenLastCalledWith('p3', 'new');
    expect(await screen.findAllByRole('button', { name: 'Cold email' })).toHaveLength(8);
  });
  it('I applied adds the posting to the Sheet and removes it from the inbox', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'markApplied');
    renderWithData(tree, { api });
    await userEvent.click(await screen.findByRole('button', { name: 'I applied: Ramp Software Engineer, New Grad' }));
    expect(spy).toHaveBeenCalledWith({ posting_id: 'p3' });
    expect(await screen.findAllByRole('button', { name: 'Cold email' })).toHaveLength(7);
    expect((await api.listApplications()).some((a) => a.company === 'Ramp' && a.role === 'Software Engineer, New Grad')).toBe(true);
  });
  it('Undo after I applied removes it from the Sheet and puts the posting back', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'undoApplied');
    renderWithData(tree, { api });
    await userEvent.click(await screen.findByRole('button', { name: 'I applied: Ramp Software Engineer, New Grad' }));
    expect(await screen.findByText('Added Ramp to your Sheet')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(spy).toHaveBeenCalledWith({ company: 'Ramp', role: 'Software Engineer, New Grad' });
    expect(await screen.findAllByRole('button', { name: 'Cold email' })).toHaveLength(8);
    expect((await api.listApplications()).some((a) => a.company === 'Ramp' && a.role === 'Software Engineer, New Grad')).toBe(false);
  });
  it('I applied asks before adding a duplicate; Add anyway forces, Cancel backs out', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'markApplied');
    renderWithData(tree, { api });
    const name = 'I applied: Stripe Software Engineer Intern, Winter 2027';
    await userEvent.click(await screen.findByRole('button', { name }));
    expect(await screen.findByText('Already in your Sheet. Add anyway?')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel adding Stripe' }));
    expect(screen.queryByText('Already in your Sheet. Add anyway?')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name }));
    await userEvent.click(await screen.findByRole('button', { name: 'Add Stripe anyway' }));
    expect(spy).toHaveBeenLastCalledWith({ posting_id: 'p1', force: true });
    expect(await screen.findAllByRole('button', { name: 'Cold email' })).toHaveLength(7);
  });
  it('I applied shows the short error and keeps the posting', async () => {
    const api = createDemoApi();
    vi.spyOn(api, 'markApplied').mockRejectedValue(new Error("Couldn't reach Google. Try again."));
    renderWithData(tree, { api });
    await userEvent.click(await screen.findByRole('button', { name: 'I applied: Ramp Software Engineer, New Grad' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't reach Google. Try again.");
    expect(screen.getAllByRole('button', { name: 'Cold email' })).toHaveLength(8);
  });
  it('I applied moves focus to Add anyway when the Sheet already has the job', async () => {
    renderWithData(tree);
    await userEvent.click(await screen.findByRole('button', { name: 'I applied: Stripe Software Engineer Intern, Winter 2027' }));
    expect(await screen.findByRole('button', { name: 'Add Stripe anyway' })).toHaveFocus();
  });
});
