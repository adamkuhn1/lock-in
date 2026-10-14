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
    <Route path="/outreach" element={<p>outreach page</p>} />
  </Routes>
);

describe('Jobs', () => {
  it('lists new postings with starred first', async () => {
    const { container } = renderWithData(tree);
    await screen.findAllByRole('button', { name: 'Cold email' });
    const titles = [...container.querySelectorAll('[data-primary] .job-title')].map((n) => n.textContent);
    expect(titles).toHaveLength(8);
    expect(titles.slice(0, 3).every((t) => t?.includes('Starred'))).toBe(true);
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
});
