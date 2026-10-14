import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithData } from '../test/render';
import Share from './Share';

beforeEach(() => {
  const ctx = new Proxy({}, { get: () => () => {}, set: () => true });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
});

describe('Share', () => {
  it('renders the card, the caption and the funnel toggle', async () => {
    const { container } = renderWithData(<Share />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Share' })).toBeInTheDocument();
    expect(await screen.findByRole('img', { name: /^Day 21 card/ })).toBeInTheDocument();
    expect(container.querySelector('[data-primary] canvas')).not.toBeNull();
    expect(screen.getByText(/^Day 21 of locking in for SWE internships/)).toBeInTheDocument();
    const toggle = screen.getByRole('checkbox', { name: 'Show funnel' });
    expect(toggle).toBeChecked();
    await userEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Share image' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy caption' })).toBeInTheDocument();
  });

  it('says so when the canvas is unavailable', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    renderWithData(<Share />);
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't make the image.");
  });
});
