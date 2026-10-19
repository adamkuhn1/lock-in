import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createDemoApi } from '../data/demo';
import type { Outreach } from '../data/types';
import { renderWithData } from '../test/render';
import Me, { tailoredResumes } from './Me';

describe('Me', () => {
  it('shows the profile, season record, resumes and links', async () => {
    renderWithData(<Me />);
    expect(screen.getByRole('heading', { level: 1, name: 'Me' })).toBeInTheDocument();
    const profile = (await screen.findByRole('heading', { name: 'Adam Kuhn' })).closest('section') as HTMLElement;
    expect(within(profile).getByText(/^May 2027/)).toHaveTextContent('May 2027 (can move to December 2027)');
    expect(await screen.findByRole('heading', { name: 'Season record' })).toBeInTheDocument();
    expect(screen.getByText('Longest streak')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Resumes' })).toBeInTheDocument();
    expect(screen.getByText('~/Desktop/Adam_Kuhn_Resumes/Base_Resume/Adam_Kuhn_Resume.pdf')).toBeInTheDocument();
    expect(await screen.findByText('/Users/adamk/Desktop/Adam_Kuhn_Resumes/Stripe_SWE_Intern_2027/Adam_Kuhn_Resume.pdf')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Story bank/ })).toHaveAttribute('href', '/grind/prep');
    expect(screen.getByRole('link', { name: /Share today's card/ })).toHaveAttribute('href', '/me/share');
    expect(screen.getByRole('link', { name: /^Settings/ })).toHaveAttribute('href', '/me/settings');
    expect(screen.queryByRole('heading', { name: 'Showboat' })).toBeNull(); // projects moved to their own tab
  });

  it('edits the profile, saving only filled-in fields', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'updateSettings');
    renderWithData(<Me />, { api });
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const grad = screen.getByRole('textbox', { name: 'Graduating' });
    expect(grad).toHaveAttribute('placeholder', 'May 2027');
    await userEvent.type(grad, ' December 2027 ');
    await userEvent.type(screen.getByRole('textbox', { name: 'Preferred locations' }), 'NYC or Chicago');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(spy).toHaveBeenCalledWith({ profile: { grad: 'December 2027', locations: 'NYC or Chicago' } });
    const profile = (await screen.findByRole('heading', { name: 'Adam Kuhn' })).closest('section') as HTMLElement;
    expect(await within(profile).findByText('NYC or Chicago')).toBeInTheDocument();
  });

  it('tailored resumes skip base-resume paths and come newest first', () => {
    const o = (id: string, resume_path: string | null, created_at: string) => ({ id, resume_path, created_at }) as Outreach;
    expect(tailoredResumes([o('a', '/R/Base_Resume/Adam_Kuhn_Resume.pdf', '2026-10-01'), o('b', '/R/Stripe/x.pdf', '2026-10-02'),
      o('c', null, '2026-10-03'), o('d', '/R/Ramp/x.pdf', '2026-10-04')]).map((x) => x.id)).toEqual(['d', 'b']);
  });
});
