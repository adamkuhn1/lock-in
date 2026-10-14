import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
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
    expect(oa).toHaveTextContent('4');
    expect(oa).toHaveTextContent('20%');
    expect(oa).toHaveTextContent('9.3%');
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
});
