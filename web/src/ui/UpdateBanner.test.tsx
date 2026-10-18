import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { pwaState } from '../test/pwa-register-react';
import { UpdateBanner } from './UpdateBanner';

describe('UpdateBanner', () => {
  afterEach(() => { pwaState.needRefresh = false; pwaState.updated = 0; });
  it('stays hidden until a new version is ready', () => {
    render(<UpdateBanner />);
    expect(screen.queryByText(/new version/)).toBeNull();
  });
  it('offers Reload, which activates the new version', async () => {
    pwaState.needRefresh = true;
    render(<UpdateBanner />);
    expect(screen.getByRole('status')).toHaveTextContent('A new version of Lock In is ready.');
    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(pwaState.updated).toBe(1);
  });
});
