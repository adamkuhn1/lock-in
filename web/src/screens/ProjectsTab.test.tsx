import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithData } from '../test/render';
import Projects from './Projects';

describe('Projects tab', () => {
  it("shows today's idea and the projects", async () => {
    renderWithData(<Projects />);
    expect(screen.getByRole('heading', { level: 1, name: 'Projects' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Today · 27B' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Showboat' })).toBeInTheDocument();
  });
});
