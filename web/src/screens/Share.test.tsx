import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithData } from '../test/render';
import Share from './Share';

const PNG = new Blob(['png'], { type: 'image/png' });

beforeEach(() => {
  const ctx = new Proxy({}, { get: () => () => {}, set: () => true });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => cb(PNG));
});

afterEach(() => {
  for (const k of ['share', 'canShare'] as const) Reflect.deleteProperty(navigator, k);
  vi.restoreAllMocks();
});

const stubShare = (share: (d: ShareData) => Promise<void>) => {
  Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
  const spy = vi.fn(share);
  Object.defineProperty(navigator, 'share', { value: spy, configurable: true });
  return spy;
};

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

  it('keeps Share image disabled until the PNG is ready', async () => {
    let finish: (b: Blob | null) => void = () => {};
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((cb) => { finish = cb; });
    renderWithData(<Share />);
    const btn = await screen.findByRole('button', { name: 'Share image' });
    await waitFor(() => expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalled());
    expect(btn).toBeDisabled();
    act(() => finish(PNG));
    expect(btn).toBeEnabled();
  });

  it('shares the pre-rendered file right away, with no await before navigator.share', async () => {
    const share = stubShare(() => Promise.resolve());
    renderWithData(<Share />);
    const btn = await screen.findByRole('button', { name: 'Share image' });
    await waitFor(() => expect(btn).toBeEnabled());
    btn.click(); // synchronous: share must already have been called when click() returns
    expect(share).toHaveBeenCalledTimes(1);
    const file = share.mock.calls[0][0].files![0];
    expect(file.name).toBe('lock-in-day-21.png');
    expect(file.type).toBe('image/png');
  });

  it('ignores a cancelled share but reports other failures', async () => {
    const abort = new DOMException('cancelled', 'AbortError');
    stubShare(() => Promise.reject(abort));
    renderWithData(<Share />);
    const btn = await screen.findByRole('button', { name: 'Share image' });
    await waitFor(() => expect(btn).toBeEnabled());
    await userEvent.click(btn);
    expect(screen.queryByRole('alert')).toBeNull();
    stubShare(() => Promise.reject(new DOMException('nope', 'NotAllowedError')));
    await userEvent.click(btn);
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't make the image.");
  });

  it('downloads when the browser cannot share files', async () => {
    const create = vi.fn(() => 'blob:card');
    const revoke = vi.fn();
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    const clicked: { link: HTMLAnchorElement; attached: boolean }[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ link: this, attached: document.body.contains(this) });
    });
    renderWithData(<Share />);
    const btn = await screen.findByRole('button', { name: 'Share image' });
    await waitFor(() => expect(btn).toBeEnabled());
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      fireEvent.click(btn);
      expect(revoke).not.toHaveBeenCalled();
      vi.advanceTimersByTime(39_999);
      expect(revoke).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(revoke).toHaveBeenCalledWith('blob:card');
    } finally {
      vi.useRealTimers();
    }
    expect(create).toHaveBeenCalledWith(PNG);
    expect(clicked).toHaveLength(1);
    expect(clicked[0].attached).toBe(true);
    expect(clicked[0].link.download).toBe('lock-in-day-21.png');
    expect(document.body.contains(clicked[0].link)).toBe(false);
  });
});
