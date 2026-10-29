import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createDemoApi } from '../data/demo';
import { renderWithData } from '../test/render';
import { localDay } from '../lib/time';
import Engineers from './Engineers';

const card = (company: string) => screen.getByRole('region', { name: new RegExp(`^${company}`) });

describe('Engineers', () => {
  it('puts the due follow-up first, then drafted notes, and hides finished jobs under Done', async () => {
    const { container } = renderWithData(<Engineers />);
    await screen.findByText('Maya Chen');
    const heads = [...container.querySelectorAll('.screen > .card h2')].map((h) => h.textContent);
    expect(heads.slice(1)).toEqual(['Stripe', 'Ramp']); // after "Notes this week"
    expect(screen.getByText('Done (2)')).toBeInTheDocument();
    expect(within(card('Stripe')).getByText('Follow up today')).toBeInTheDocument();
    expect(within(card('Stripe')).getByText(/Thanks for connecting, Maya!/)).toBeInTheDocument();
  });
  it('shows each drafted note with its character count, pick and profile link', async () => {
    renderWithData(<Engineers />);
    const ramp = within(await screen.findByRole('region', { name: /^Ramp/ }));
    expect(ramp.getByText('Ex-Apple')).toBeInTheDocument();
    expect(ramp.getByText('Same team')).toBeInTheDocument();
    expect(ramp.getAllByText(/\/280 characters$/)).toHaveLength(2);
    expect(ramp.getAllByRole('link', { name: 'Open profile' })[0]).toHaveAttribute('href', expect.stringContaining('linkedin.com/in/'));
  });
  it('moves an engineer along: sent, accepted, followed up', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'updateReferral');
    renderWithData(<Engineers />, { api });
    const today = localDay(new Date());
    await userEvent.click(await screen.findByRole('button', { name: 'Sent: Ava Park (Ramp)' }));
    expect(spy).toHaveBeenCalledWith('f3', { status: 'sent', sent_on: today });
    await userEvent.click(await screen.findByRole('button', { name: 'Accepted: Ava Park (Ramp)' }));
    expect(spy).toHaveBeenCalledWith('f3', { status: 'accepted', accepted_on: today });
    expect(await within(card('Ramp')).findByText('Follow up in 3 days')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Followed up: Maya Chen (Stripe)' }));
    expect(spy).toHaveBeenCalledWith('f1', { followed_up_on: today });
  });
  it('counts notes sent this week against the target', async () => {
    renderWithData(<Engineers />);
    expect(await screen.findByRole('progressbar', { name: 'LinkedIn notes sent this week' })).toHaveAttribute('aria-valuemax', '10');
  });
});
