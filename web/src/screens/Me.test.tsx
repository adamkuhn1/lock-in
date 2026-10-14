import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithData } from '../test/render';
import Me from './Me';

describe('Me', () => {
  it('links to the share card and settings, shows today idea and projects', async () => {
    renderWithData(<Me />);
    expect(screen.getByRole('heading', { level: 1, name: 'Me' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Share today's card/ })).toHaveAttribute('href', '/me/share');
    expect(screen.getByRole('link', { name: /^Settings/ })).toHaveAttribute('href', '/me/settings');
    expect(await screen.findByRole('heading', { name: 'Today · 27B' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Showboat' })).toBeInTheDocument();
  });
});
