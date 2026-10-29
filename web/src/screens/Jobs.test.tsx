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
    expect(titles).toHaveLength(9);
    const company = (t: string) => t.replace(/^.*?Starred: /, '').split(' · ')[0];
    // Reach (Stripe starred, then Ramp, Duolingo newest first), then Midwest (all starred: Lakeshore Labs, Ford, Rocket newest first),
    // then volume (Cloudflare, Datadog, Robinhood)
    expect(titles.map(company)).toEqual(['Stripe', 'Ramp', 'Duolingo', 'Lakeshore Labs', 'Ford', 'Rocket Companies', 'Cloudflare', 'Datadog', 'Robinhood']);
    expect(screen.getAllByText(/^Reach · /)).toHaveLength(3);
  });
  it('tier chips show one tier, and Newest first ignores tiers', async () => {
    const { container } = renderWithData(tree);
    await userEvent.click(await screen.findByRole('button', { name: 'Reach (3)' }));
    expect(screen.getAllByRole('button', { name: 'Cold email' })).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: 'Midwest (3)' }));
    expect(screen.getAllByRole('button', { name: 'Cold email' })).toHaveLength(3);
    await userEvent.click(screen.getByRole('button', { name: 'Midwest (3)' }));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'newest');
    const first = container.querySelector('[data-primary] .job-title')?.textContent ?? '';
    expect(first).toContain('Lakeshore Labs'); // found an hour ago
  });
  it('Reach rows offer Find engineers and queue it with the posting', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'findEngineers');
    renderWithData(tree, { api });
    await userEvent.click(await screen.findByRole('button', { name: 'Find engineers: Duolingo Software Engineer Intern' }));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ posting_id: 'p5', company: 'Duolingo', tier: 'reach' }));
    expect(await screen.findByRole('button', { name: /^Find engineers: Duolingo/ })).toHaveTextContent('Queued for Mac');
    // Ramp has two drafted, Stripe two sent; Cloudflare is volume, so no button
    expect(screen.getByRole('link', { name: /2 engineers to message/ })).toHaveAttribute('href', '/hunt/engineers');
    expect(screen.getByRole('link', { name: /2 of 2 notes sent/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Find engineers: Cloudflare/ })).not.toBeInTheDocument();
  });
  it('filtered postings sit under Filtered with the reason, and can be restored', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'restorePosting');
    renderWithData(tree, { api });
    await userEvent.click(await screen.findByText('Filtered (2)'));
    expect(screen.getByText(/Needs 2\+ years of experience/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Restore Anduril Software Engineer, New Grad' }));
    expect(spy).toHaveBeenCalledWith('p10');
    expect(await screen.findAllByRole('button', { name: 'Cold email' })).toHaveLength(10);
  });
  it('filters by star and clears', async () => {
    renderWithData(tree);
    await userEvent.click(await screen.findByRole('button', { name: '⭐ Starred' }));
    expect(screen.getAllByRole('button', { name: 'Cold email' })).toHaveLength(4);
    await userEvent.click(screen.getByRole('button', { name: 'Reach (3)' }));
    await userEvent.click(screen.getByRole('button', { name: 'New grad' }));
    expect(screen.getByText('Nothing matches these filters.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getAllByRole('button', { name: 'Cold email' })).toHaveLength(9);
  });
  it('dismiss removes a posting', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'setPostingStatus');
    renderWithData(tree, { api });
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss Ramp Software Engineer, New Grad' }));
    expect(spy).toHaveBeenCalledWith('p3', 'dismissed');
    expect(await screen.findAllByRole('button', { name: 'Cold email' })).toHaveLength(8);
  });
  it('opening a posting keeps it in the inbox, tagged Opened', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'setPostingStatus');
    const { container } = renderWithData(tree, { api });
    await screen.findAllByRole('button', { name: 'Cold email' });
    const ramp = () => [...container.querySelectorAll('[data-primary] li.job')].find((li) => li.textContent?.includes('Ramp')) as HTMLElement;
    await userEvent.click(within(ramp()).getByRole('link', { name: /Open/ }));
    expect(spy).toHaveBeenCalledWith('p3', 'seen');
    expect(await within(ramp()).findByText('Opened')).toBeInTheDocument();
    expect(within(ramp()).getByRole('button', { name: /^I applied: Ramp/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Cold email' })).toHaveLength(9);
  });
  it('Best fit shows Claude\'s shortlist in rank order with each reason', async () => {
    const { container } = renderWithData(tree);
    await userEvent.click(await screen.findByRole('button', { name: 'Best fit (3)' }));
    const titles = [...container.querySelectorAll('[data-primary] .job-title')].map((n) => n.textContent ?? '');
    expect(titles.map((t) => t.match(/Best fit #(\d)/)?.[1])).toEqual(['1', '2', '3']);
    expect(titles[1]).toContain('Lakeshore Labs');
    expect(titles[1]).toContain('Found by Claude');
    expect(screen.getByText(/New-grad fintech role in NYC/)).toBeInTheDocument();
  });
  it('Find best fits queues a Mac launch and switches to the Best fit list', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'requestLaunch');
    renderWithData(tree, { api });
    await userEvent.click(await screen.findByRole('button', { name: 'Find best fits' }));
    expect(spy).toHaveBeenCalledWith('best_fit', {});
    expect(await screen.findByRole('button', { name: 'Queued for Mac' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Best fit (3)' })).toHaveAttribute('aria-pressed', 'true');
  });
  it('shows three postings per company, then a button for the rest', async () => {
    const api = createDemoApi();
    const real = await api.listPostings('2000-01-01');
    vi.spyOn(api, 'listPostings').mockResolvedValue([
      ...real, ...[1, 2, 3, 4, 5].map((i) => ({ ...real[0], id: `ibm${i}`, company: 'IBM', title: `Developer ${i}`, fit_rank: null, fit_reason: null })),
    ]);
    const { container } = renderWithData(tree, { api });
    await userEvent.click(await screen.findByRole('button', { name: 'Show 2 more from IBM' }));
    expect([...container.querySelectorAll('[data-primary] .job-title')].filter((n) => n.textContent?.includes('IBM'))).toHaveLength(5);
  });
  it('cold email queues outreach and goes to Outreach', async () => {
    const api = createDemoApi();
    const queue = vi.spyOn(api, 'queueOutreach');
    const status = vi.spyOn(api, 'setPostingStatus');
    const { container } = renderWithData(tree, { api });
    await screen.findAllByRole('button', { name: 'Cold email' });
    const stripe = [...container.querySelectorAll('li.job')].find((li) => li.textContent?.includes('Stripe')) as HTMLElement;
    await userEvent.click(within(stripe).getByRole('button', { name: 'Cold email' }));
    expect(queue).toHaveBeenCalledWith({ job_url: expect.stringMatching(/^https:\/\/boards\.greenhouse\.io\/stripe\//), company: 'Stripe', role: 'Software Engineer Intern, Winter 2027', tier: 'reach' });
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
    expect(tailor).toHaveBeenCalledWith({ job_url: expect.stringMatching(/^https:\/\/boards\.greenhouse\.io\/stripe\//), company: 'Stripe', role: 'Software Engineer Intern, Winter 2027', tier: 'reach' });
    expect(cold).not.toHaveBeenCalled();
    expect(await screen.findByText('outreach page')).toBeInTheDocument();
    expect(status).toHaveBeenCalledWith('p1', 'outreach');
  });
  it('Tailor & fill out app queues a tailor request with fill and goes to Outreach', async () => {
    const api = createDemoApi();
    const tailor = vi.spyOn(api, 'queueTailor');
    const status = vi.spyOn(api, 'setPostingStatus');
    const { container } = renderWithData(tree, { api });
    await screen.findAllByRole('button', { name: 'Tailor & fill out app' });
    const stripe = [...container.querySelectorAll('li.job')].find((li) => li.textContent?.includes('Stripe')) as HTMLElement;
    await userEvent.click(within(stripe).getByRole('button', { name: 'Tailor & fill out app' }));
    expect(tailor).toHaveBeenCalledWith({ job_url: expect.stringMatching(/^https:\/\/boards\.greenhouse\.io\/stripe\//), company: 'Stripe', role: 'Software Engineer Intern, Winter 2027', tier: 'reach', fill: true });
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
    expect(within(rowOf('Stripe')).getByRole('button', { name: 'Tailor & fill out app' })).toBeDisabled();
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
    expect(await screen.findAllByRole('button', { name: 'Cold email' })).toHaveLength(9);
  });
  it('I applied adds the posting to the Sheet and removes it from the inbox', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'markApplied');
    renderWithData(tree, { api });
    await userEvent.click(await screen.findByRole('button', { name: 'I applied: Ramp Software Engineer, New Grad' }));
    expect(spy).toHaveBeenCalledWith({ posting_id: 'p3' });
    expect(await screen.findAllByRole('button', { name: 'Cold email' })).toHaveLength(8);
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
    expect(await screen.findAllByRole('button', { name: 'Cold email' })).toHaveLength(9);
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
    expect(await screen.findAllByRole('button', { name: 'Cold email' })).toHaveLength(8);
  });
  it('I applied shows the short error and keeps the posting', async () => {
    const api = createDemoApi();
    vi.spyOn(api, 'markApplied').mockRejectedValue(new Error("Couldn't reach Google. Try again."));
    renderWithData(tree, { api });
    await userEvent.click(await screen.findByRole('button', { name: 'I applied: Ramp Software Engineer, New Grad' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't reach Google. Try again.");
    expect(screen.getAllByRole('button', { name: 'Cold email' })).toHaveLength(9);
  });
  it('I applied moves focus to Add anyway when the Sheet already has the job', async () => {
    renderWithData(tree);
    await userEvent.click(await screen.findByRole('button', { name: 'I applied: Stripe Software Engineer Intern, Winter 2027' }));
    expect(await screen.findByRole('button', { name: 'Add Stripe anyway' })).toHaveFocus();
  });
});
