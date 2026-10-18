import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createDemoApi } from '../data/demo';
import type { Application } from '../data/types';
import { localDay } from '../lib/time';
import { renderWithData } from '../test/render';
import Applications from './Applications';

const app = (id: number, applied_on: string | null): Application => ({
  id, company: `Co${id}`, role: 'SWE Intern', track: null, term: null, location: null, status: 'Submitted', stage: 'applied', priority: null, applied_on,
});

describe('Applications', () => {
  it('leads with this week vs target', async () => {
    const api = createDemoApi();
    const today = localDay(new Date());
    api.listApplications = async () => [app(1, today), app(2, today), app(3, '2020-01-01')];
    const { container } = renderWithData(<Applications />, { api });
    const primary = container.querySelector('[data-primary]') as HTMLElement;
    expect(await within(primary).findByText('2')).toBeInTheDocument();
    expect(primary).toHaveTextContent('of 25');
    expect(within(primary).getByRole('progressbar', { name: 'Applications this week' })).toHaveAttribute('aria-valuenow', '2');
  });
  it('funnel shows counts, rates and the typical rates', async () => {
    renderWithData(<Applications />);
    const table = await screen.findByRole('table', { name: 'Funnel' });
    const oa = within(table).getByRole('row', { name: /^OA/ });
    expect(oa).toHaveTextContent('5');
    expect(oa).toHaveTextContent('24%');
    expect(oa).toHaveTextContent('2 active · 1 rejected · 67% passed');
    expect(oa).toHaveTextContent('9%');
    expect(oa).not.toHaveTextContent('9.3%');
    expect(within(table).getByRole('row', { name: /^Offer/ })).toHaveTextContent('38%');
  });
  it('search narrows the board and opens matching groups', async () => {
    renderWithData(<Applications />);
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Search' }), 'stripe');
    expect(screen.getByText('OA (1)')).toBeInTheDocument();
    expect(screen.queryByText(/Applied \(/)).toBeNull();
  });
  it('links to the sheet', async () => {
    renderWithData(<Applications />);
    expect(await screen.findByRole('link', { name: 'Open sheet' })).toHaveAttribute('href', 'https://docs.google.com/spreadsheets/d/demo-sheet-id');
  });
  it('Status select lists the Sheet options and saves a change', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'setApplicationStatus');
    renderWithData(<Applications />, { api });
    const select = await screen.findByRole('combobox', { name: 'Status for Ramp Software Engineer Intern' });
    expect(select).toHaveValue('Submitted');
    expect(within(select).getByRole('option', { name: 'Rejected after OA' })).toBeInTheDocument();
    await userEvent.selectOptions(select, 'Applied');
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ id: 2, company: 'Ramp', role: 'Software Engineer Intern' }), 'Applied');
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Status for Ramp Software Engineer Intern' })).toHaveValue('Applied');
  });
  it('Undo shows on a row applied today, not on other statuses, and removes the row', async () => {
    const api = createDemoApi();
    const [p] = (await api.listPostings('2000-01-01T00:00:00Z')).filter((x) => x.company === 'Ramp' && x.status === 'new');
    await api.markApplied({ posting_id: p.id });
    const spy = vi.spyOn(api, 'undoApplied');
    renderWithData(<Applications />, { api });
    const undo = await screen.findByRole('button', { name: `Undo I applied: Ramp ${p.title}` });
    expect(screen.queryByRole('button', { name: 'Undo I applied: Ramp Software Engineer Intern' })).toBeNull(); // Submitted, not Applied
    await userEvent.click(undo);
    expect(spy).toHaveBeenCalledWith({ company: 'Ramp', role: p.title, sheet_row: null });
    await waitFor(() => expect(screen.queryByRole('button', { name: `Undo I applied: Ramp ${p.title}` })).toBeNull());
  });
  it('Status select reverts and shows the short error on failure', async () => {
    const api = createDemoApi();
    vi.spyOn(api, 'setApplicationStatus').mockRejectedValue(new Error("That status isn't in your Sheet's Status dropdown. Add it there first."));
    renderWithData(<Applications />, { api });
    const select = await screen.findByRole('combobox', { name: 'Status for Ramp Software Engineer Intern' });
    await userEvent.selectOptions(select, 'Applied');
    expect(await screen.findByRole('alert')).toHaveTextContent("That status isn't in your Sheet's Status dropdown.");
    expect(screen.getByRole('combobox', { name: 'Status for Ramp Software Engineer Intern' })).toHaveValue('Submitted');
  });
  it('no Status select when the Sheet has no dropdown', async () => {
    const api = createDemoApi();
    api.sheetStatuses = async () => [];
    renderWithData(<Applications />, { api });
    await screen.findAllByText('Ramp');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
