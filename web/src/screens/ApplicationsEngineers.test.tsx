import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createDemoApi } from '../data/demo';
import { renderWithData } from '../test/render';
import Applications from './Applications';

describe('Applications: Reach without an engineer', () => {
  it('flags Reach applications with nobody contacted and queues Find engineers', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'findEngineers');
    renderWithData(<Applications />, { api });
    const flags = within(await screen.findByRole('region', { name: /^Reach, no engineer yet/ }));
    expect(flags.getAllByRole('listitem').map((li) => li.querySelector('.job-title')?.textContent)).toEqual(['Ramp', 'Amazon', 'Duolingo', 'Plaid']);
    expect(flags.getByRole('link', { name: 'Note drafted, send it' })).toHaveAttribute('href', '/hunt/engineers'); // Ramp
    await userEvent.click(flags.getByRole('button', { name: 'Find engineers: Amazon SDE Intern 2027' }));
    expect(spy).toHaveBeenCalledWith({ company: 'Amazon', role: 'SDE Intern 2027', tier: 'reach' });
  });
  it('filters the board by tier', async () => {
    renderWithData(<Applications />);
    await userEvent.click(await screen.findByRole('button', { name: 'Midwest' }));
    const board = within(screen.getByRole('region', { name: 'Board' }));
    expect(board.queryByText('Stripe')).not.toBeInTheDocument();
    expect(board.getByText('Ford')).toBeInTheDocument();
  });
});
