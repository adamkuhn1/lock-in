import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthError, type AuthApi } from '../data/auth';
import { SignIn } from './SignIn';

function fakeAuth(over: Partial<AuthApi> = {}): AuthApi {
  return {
    hasSession: async () => false, onChange: () => () => undefined, signOut: async () => undefined,
    signInWithPassword: vi.fn(async () => undefined), setPassword: async () => undefined,
    sendLink: vi.fn(async () => undefined), verifyCode: vi.fn(async () => undefined), ...over,
  };
}

const toLink = () => userEvent.click(screen.getByRole('button', { name: 'Email me a link instead' }));

describe('SignIn', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('defaults to a password form with autofill hints', () => {
    render(<SignIn auth={fakeAuth()} />);
    const email = screen.getByLabelText('Email');
    expect(email).toHaveAttribute('type', 'email');
    expect(email).toHaveAttribute('autocomplete', 'username');
    const pw = screen.getByLabelText('Password');
    expect(pw).toHaveAttribute('type', 'password');
    expect(pw).toHaveAttribute('autocomplete', 'current-password');
    expect(email.closest('form')).toBe(pw.closest('form'));
    expect(screen.getByRole('button', { name: 'Sign in' })).toHaveAttribute('type', 'submit');
  });
  it('signs in with email and password and remembers the email', async () => {
    const auth = fakeAuth();
    render(<SignIn auth={auth} />);
    await userEvent.type(screen.getByLabelText('Email'), ' adam@example.com ');
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(auth.signInWithPassword).toHaveBeenCalledWith('adam@example.com', 'correct horse');
    expect(localStorage.getItem('lockin-last-email')).toBe('adam@example.com');
  });
  it('prefills the remembered email', () => {
    localStorage.setItem('lockin-last-email', 'adam@example.com');
    render(<SignIn auth={fakeAuth()} />);
    expect(screen.getByLabelText('Email')).toHaveValue('adam@example.com');
  });
  it('still works when localStorage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const auth = fakeAuth();
    render(<SignIn auth={auth} />);
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(auth.signInWithPassword).toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('a wrong password shows the fixed copy', async () => {
    const auth = fakeAuth({ signInWithPassword: vi.fn(async () => { throw new AuthError('Wrong email or password.'); }) });
    render(<SignIn auth={auth} />);
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong email or password.');
    expect(localStorage.getItem('lockin-last-email')).toBeNull();
  });
  it('an unexpected error never shows its raw text', async () => {
    const auth = fakeAuth({ signInWithPassword: vi.fn(async () => { throw new Error('GoTrue 500 internal'); }) });
    render(<SignIn auth={auth} />);
    await userEvent.type(screen.getByLabelText('Email'), 'a@b.co');
    await userEvent.type(screen.getByLabelText('Password'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't sign in. Try again.");
    expect(screen.queryByText(/GoTrue/)).toBeNull();
  });
  it('switches to the email link flow and back', async () => {
    render(<SignIn auth={fakeAuth()} />);
    await toLink();
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(screen.getByRole('button', { name: 'Send sign-in email' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Use a password' }));
    expect(screen.getByLabelText('Password')).toBeInTheDocument();
  });
  it('sends the email, then accepts the code', async () => {
    const auth = fakeAuth();
    render(<SignIn auth={auth} />);
    await toLink();
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
    await toLink();
    await userEvent.type(screen.getByLabelText('Email'), 'x@y.co');
    await userEvent.click(screen.getByRole('button', { name: 'Send sign-in email' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't send the email.");
    expect(screen.queryByText(/Signups not allowed/)).toBeNull();
  });
  it('a bad code says so; Use another email clears the error (M3)', async () => {
    const auth = fakeAuth({ verifyCode: vi.fn(async () => { throw new Error('Token has expired or is invalid'); }) });
    render(<SignIn auth={auth} />);
    await toLink();
    await userEvent.type(screen.getByLabelText('Email'), 'x@y.co');
    await userEvent.click(screen.getByRole('button', { name: 'Send sign-in email' }));
    await userEvent.type(await screen.findByLabelText('Code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("That code didn't work.");
    await userEvent.click(screen.getByRole('button', { name: 'Use another email' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
