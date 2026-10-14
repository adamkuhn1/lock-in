import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AuthApi } from '../data/auth';
import { SignIn } from './SignIn';

function fakeAuth(over: Partial<AuthApi> = {}): AuthApi {
  return {
    hasSession: async () => false, onChange: () => () => undefined, signOut: async () => undefined,
    sendLink: vi.fn(async () => undefined), verifyCode: vi.fn(async () => undefined), ...over,
  };
}

describe('SignIn', () => {
  it('sends the email, then accepts the code', async () => {
    const auth = fakeAuth();
    render(<SignIn auth={auth} />);
    await userEvent.type(screen.getByLabelText('Email'), ' adam@example.com ');
    await userEvent.click(screen.getByRole('button', { name: 'Send sign-in email' }));
    expect(auth.sendLink).toHaveBeenCalledWith('adam@example.com');
    await userEvent.type(await screen.findByLabelText('Code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(auth.verifyCode).toHaveBeenCalledWith('adam@example.com', '123456');
  });
  it('a failed send shows fixed copy, not the server error (M3)', async () => {
    const auth = fakeAuth({ sendLink: vi.fn(async () => { throw new Error('Signups not allowed for otp'); }) });
    render(<SignIn auth={auth} />);
    await userEvent.type(screen.getByLabelText('Email'), 'x@y.co');
    await userEvent.click(screen.getByRole('button', { name: 'Send sign-in email' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't send the email.");
    expect(screen.queryByText(/Signups not allowed/)).toBeNull();
  });
  it('a bad code says so; Use another email clears the error (M3)', async () => {
    const auth = fakeAuth({ verifyCode: vi.fn(async () => { throw new Error('Token has expired or is invalid'); }) });
    render(<SignIn auth={auth} />);
    await userEvent.type(screen.getByLabelText('Email'), 'x@y.co');
    await userEvent.click(screen.getByRole('button', { name: 'Send sign-in email' }));
    await userEvent.type(await screen.findByLabelText('Code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("That code didn't work.");
    await userEvent.click(screen.getByRole('button', { name: 'Use another email' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
