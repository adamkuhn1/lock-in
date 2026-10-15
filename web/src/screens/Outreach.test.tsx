import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { createDemoApi } from '../data/demo';
import { followUpOn } from '../lib/outreach';
import { addDays, localDay } from '../lib/time';
import { renderWithData } from '../test/render';
import Outreach, { PromptButton } from './Outreach';

const cardFor = async (name: string) => (await screen.findByRole('heading', { level: 2, name })).closest('section') as HTMLElement;

describe('Outreach', () => {
  it('rejects a pasted string that is not a job link', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'queueOutreach');
    renderWithData(<Outreach />, { api });
    await userEvent.type(await screen.findByRole('textbox', { name: 'Job link' }), 'javascript:alert(1){Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Paste a full job link');
    expect(spy).not.toHaveBeenCalled();
  });
  it('a pasted link becomes a card queued for the Mac', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'queueOutreach');
    renderWithData(<Outreach />, { api });
    await userEvent.type(await screen.findByRole('textbox', { name: 'Job link' }), ' https://jobs.lever.co/acme/42 {Enter}');
    expect(spy).toHaveBeenCalledWith({ job_url: 'https://jobs.lever.co/acme/42' });
    const card = await cardFor('jobs.lever.co');
    expect(within(card).getByText('Queued for Mac')).toBeInTheDocument();
  });
  it('Copy prompt copies the rendered template', async () => {
    const user = userEvent.setup();
    renderWithData(<Outreach />);
    const card = await cardFor('Ramp');
    expect(within(card).getByText('Queued for Mac')).toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Copy prompt' }));
    expect(await navigator.clipboard.readText()).toContain('save-outreach --id o2');
    expect(within(card).getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });
  it('drafted card: contacts, drafts behind a tap, Sent sets the follow-up', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'updateOutreach');
    renderWithData(<Outreach />, { api });
    const card = await cardFor('Stripe');
    expect(within(card).getByText('Dana Reyes')).toBeInTheDocument();
    expect(within(card).getByText('dreyes@stripe.com')).toBeInTheDocument();
    expect(within(card).getAllByText('Draft')).toHaveLength(2);
    await userEvent.click(within(card).getByRole('button', { name: 'Sent' }));
    const today = localDay(new Date());
    expect(spy).toHaveBeenCalledWith('o1', { status: 'sent', sent_on: today, follow_up_on: followUpOn(today), followups: 0 });
  });
  it('Open in Outlook opens a prefilled mailto for each contact with an email', async () => {
    renderWithData(<Outreach />);
    const card = await cardFor('Stripe');
    const links = [within(card).getByRole('link', { name: 'Open in Outlook: Dana Reyes (Stripe)' }), within(card).getByRole('link', { name: 'Open in Outlook: Marcus Lee (Stripe)' })];
    expect(links[0]).toHaveTextContent('Open in Outlook');
    const href = links[0].getAttribute('href')!;
    expect(href.startsWith('mailto:dreyes@stripe.com?subject=CMU%20student%2C%20Winter%202027%20SWE%20intern&body=Hi%20Dana%2C%0D%0A%0D%0AI%20saw')).toBe(true);
    expect(links[0]).toHaveClass('btn');
    expect(links[0]).not.toHaveAttribute('target');
    expect(links[1].getAttribute('href')).toMatch(/^mailto:mlee@stripe\.com\?subject=Fellow%20Michigander/);
  });
  it('no Open in Outlook without an email', async () => {
    const api = createDemoApi();
    const base = await api.listContacts();
    api.listContacts = async () => base.map((c) => ({ ...c, email_guess: null, email_confidence: null }));
    renderWithData(<Outreach />, { api });
    expect(within(await cardFor('Stripe')).queryByRole('link', { name: /^Open in Outlook/ })).toBeNull();
  });
  it('no Open in Outlook for an address that is not plain', async () => {
    const api = createDemoApi();
    const base = await api.listContacts();
    api.listContacts = async () => base.map((c) => ({ ...c, email_guess: c.name === 'Dana Reyes' ? 'dreyes@stripe.com?bcc=x@y.co' : c.email_guess }));
    renderWithData(<Outreach />, { api });
    const card = await cardFor('Stripe');
    expect(within(card).queryByRole('link', { name: 'Open in Outlook: Dana Reyes (Stripe)' })).toBeNull();
    expect(within(card).getByRole('link', { name: 'Open in Outlook: Marcus Lee (Stripe)' })).toBeInTheDocument();
  });
  it('a tailored resume with no recruiter yet shows the resume and a note, not Opened on Mac', async () => {
    const api = createDemoApi();
    const o = await api.queueTailor({ job_url: 'https://jobs.lever.co/acme/5', company: 'Acme', role: 'SWE' });
    const path = '/Users/adamk/Desktop/Adam_Kuhn_Resumes/Acme_SWE/Adam_Kuhn_Resume.pdf';
    const list = await api.listOutreach();
    api.listOutreach = async () => list.map((x) => (x.id === o.id ? { ...x, resume_path: path } : x));
    const reqs = await api.listLaunchRequests();
    api.listLaunchRequests = async () => reqs.map((r) => (r.payload.outreach_id === o.id ? { ...r, status: 'launched' as const } : r));
    renderWithData(<Outreach />, { api });
    const card = await cardFor('Acme');
    expect(within(card).getByText('Resume ready')).toBeInTheDocument();
    expect(within(card).queryByText('Opened on Mac')).toBeNull();
    expect(within(card).getByText(`Resume: ${path}`)).toBeInTheDocument();
    expect(within(card).getByText('No recruiter found yet.')).toBeInTheDocument();
  });
  it('shows which resume to attach', async () => {
    renderWithData(<Outreach />);
    const card = await cardFor('Stripe');
    expect(within(card).getByText('Resume: /Users/adamk/Desktop/Adam_Kuhn_Resumes/Stripe_SWE_Intern_2027/Adam_Kuhn_Resume.pdf')).toHaveClass('muted');
    expect(within(card).queryByText('No recruiter found yet.')).toBeNull();
    expect(within(await cardFor('Ramp')).queryByText(/^Resume:/)).toBeNull();
  });
  it('Try again on a failed tailor relaunches tailor_resume', async () => {
    const api = createDemoApi();
    const o = await api.queueTailor({ job_url: 'https://jobs.lever.co/acme/3', company: 'Acme', role: 'SWE' });
    const reqs = await api.listLaunchRequests();
    api.listLaunchRequests = async () => reqs.map((r) => r.payload.outreach_id === o.id
      ? { ...r, status: 'failed' as const, error: 'LaunchError: Base resume not found at /R/Base_Resume' } : r);
    const spy = vi.spyOn(api, 'requestLaunch');
    renderWithData(<Outreach />, { api });
    const card = await cardFor('Acme');
    expect(within(card).getByText('LaunchError: Base resume not found at /R/Base_Resume')).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Try again' }));
    expect(spy).toHaveBeenCalledWith('tailor_resume', { outreach_id: o.id, job_url: 'https://jobs.lever.co/acme/3' });
  });
  it('never links a non-http LinkedIn value', async () => {
    const api = createDemoApi();
    const base = await api.listContacts();
    api.listContacts = async () => base.map((c) => ({ ...c, linkedin_url: 'javascript:alert(1)' }));
    const { container } = renderWithData(<Outreach />, { api });
    await cardFor('Stripe');
    expect(container.querySelector('a[href^="javascript"]')).toBeNull();
  });
  it('a launched request shows Opened on Mac', async () => {
    const api = createDemoApi();
    const reqs = await api.listLaunchRequests();
    api.listLaunchRequests = async () => reqs.map((r) => ({ ...r, status: 'launched' as const }));
    renderWithData(<Outreach />, { api });
    expect(within(await cardFor('Ramp')).getByText('Opened on Mac')).toBeInTheDocument();
  });
  it('failed launch shows the error and Try again', async () => {
    const api = createDemoApi();
    const reqs = await api.listLaunchRequests();
    api.listLaunchRequests = async () => reqs.map((r) => ({ ...r, status: 'failed' as const, error: 'osascript failed (1): Not authorized' }));
    const spy = vi.spyOn(api, 'requestLaunch');
    renderWithData(<Outreach />, { api });
    const card = await cardFor('Ramp');
    expect(within(card).getByText('osascript failed (1): Not authorized')).toBeInTheDocument();
    await userEvent.click(within(card).getByRole('button', { name: 'Try again' }));
    expect(spy).toHaveBeenCalledWith('outreach', { outreach_id: 'o2', job_url: 'https://jobs.ashbyhq.com/ramp/7d1c' });
  });
  it('a long launcher error is shortened with the full text behind a disclosure (M8)', async () => {
    const api = createDemoApi();
    const reqs = await api.listLaunchRequests();
    const full = `osascript failed (1): Not authorized\n${'detail line\n'.repeat(30)}`;
    api.listLaunchRequests = async () => reqs.map((r) => ({ ...r, status: 'failed' as const, error: full }));
    renderWithData(<Outreach />, { api });
    const card = await cardFor('Ramp');
    expect(within(card).getByText('osascript failed (1): Not authorized', { selector: 'p' })).toBeInTheDocument();
    const details = card.querySelector('details');
    expect(details).not.toBeNull();
    expect(details).toHaveTextContent('detail line');
  });
  it("a prompt that can't be built says so (M4)", async () => {
    render(<PromptButton build={() => { throw new Error('missing values for: job_url'); }} />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy prompt' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't build the prompt.");
  });
  it('PromptButton clears its reset timer on unmount (M4)', async () => {
    const set = vi.spyOn(window, 'setTimeout');
    const clear = vi.spyOn(window, 'clearTimeout');
    const { unmount } = render(<PromptButton build={() => 'hello'} />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy prompt' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    const call = set.mock.calls.findIndex((c) => c[1] === 1500);
    expect(call).toBeGreaterThanOrEqual(0);
    const id = set.mock.results[call].value;
    unmount();
    expect(clear).toHaveBeenCalledWith(id);
    set.mockRestore(); clear.mockRestore();
  });
  it('I applied on a card adds it to the Sheet and then shows Applied ✓', async () => {
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'markApplied');
    renderWithData(<Outreach />, { api });
    const card = await cardFor('Palantir');
    await userEvent.click(within(card).getByRole('button', { name: 'I applied: Palantir FDSE Intern' }));
    expect(spy).toHaveBeenCalledWith({ outreach_id: 'o4' });
    const done = await within(card).findByRole('status');
    expect(done).toHaveTextContent('Applied ✓');
    expect(done).toHaveFocus();
  });
  it('a card already in the Sheet shows Applied ✓ instead of the button', async () => {
    renderWithData(<Outreach />);
    const card = await cardFor('Stripe');
    expect(await within(card).findByText('Applied ✓')).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /^I applied/ })).not.toBeInTheDocument();
  });
  it('Applied ✓ matching collapses whitespace like the server', async () => {
    const api = createDemoApi();
    const real = api.listApplications.bind(api);
    api.listApplications = async () => [...(await real()), {
      id: 999, company: '  palantir ', role: 'FDSE   Intern', track: null, term: null, location: null, status: 'Applied', stage: 'applied', priority: null, applied_on: null,
    }];
    renderWithData(<Outreach />, { api });
    const card = await cardFor('Palantir');
    expect(await within(card).findByText('Applied ✓')).toBeInTheDocument();
  });
  it('Discard closes a drafted card and moves it into Done; Reopen brings it back', async () => {
    const user = userEvent.setup();
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'updateOutreach');
    renderWithData(<Outreach />, { api });
    const card = await cardFor('Stripe');
    const discard = within(card).getByRole('button', { name: 'Discard: Stripe' });
    expect(discard).toHaveTextContent('Discard');
    await user.click(discard);
    expect(spy).toHaveBeenCalledWith('o1', { status: 'closed' });
    const done = (await screen.findByText(/^Done \(/)).closest('details') as HTMLElement;
    const closed = within(done).getByRole('heading', { level: 2, name: 'Stripe' }).closest('section') as HTMLElement;
    expect(within(closed).queryByRole('button', { name: /^Discard/ })).toBeNull();
    await user.click(within(closed).getByRole('button', { name: 'Reopen: Stripe' }));
    expect(spy).toHaveBeenLastCalledWith('o1', { status: 'drafted' });
    expect(within(await cardFor('Stripe')).getByRole('button', { name: 'Sent' })).toBeInTheDocument();
  });
  it('Reopen goes back to queued when there are no contacts', async () => {
    const user = userEvent.setup();
    const api = createDemoApi();
    api.listLaunchRequests = async () => [];
    const spy = vi.spyOn(api, 'updateOutreach');
    renderWithData(<Outreach />, { api });
    await user.click(within(await cardFor('Ramp')).getByRole('button', { name: 'Discard: Ramp' }));
    const done = (await screen.findByText(/^Done \(/)).closest('details') as HTMLElement;
    await user.click(within(done).getByRole('button', { name: 'Reopen: Ramp' }));
    expect(spy).toHaveBeenLastCalledWith('o2', { status: 'queued' });
  });
  it('a sent card counts down; a due card offers the follow-up', async () => {
    renderWithData(<Outreach />);
    expect(within(await cardFor('Palantir')).getByText(/Follow up in 6 days/)).toBeInTheDocument();
    expect(within(await cardFor('Datadog')).getByText(/Follow up tomorrow/)).toBeInTheDocument();
    const card = await cardFor('Figma');
    expect(within(card).getByText(/Follow up today/)).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'Open follow-up in Outlook: Priya Nair (Figma)' })).toBeInTheDocument();
  });
  it('a due card links the follow-up for each contact with a plain email, and previews it', async () => {
    const api = createDemoApi();
    const base = await api.listContacts();
    api.listContacts = async () => [...base, {
      id: 'c9', outreach_id: 'o5', name: 'Sam Ito', title: null, linkedin_url: null, email_guess: 'sito@figma.com', email_confidence: 'pattern',
      why: null, draft_subject: 'CMU student, Figma intern', draft_body: 'Hi Sam',
    }, {
      id: 'c10', outreach_id: 'o5', name: 'No Mail', title: null, linkedin_url: null, email_guess: null, email_confidence: null,
      why: null, draft_subject: 'x', draft_body: 'y',
    }];
    renderWithData(<Outreach />, { api });
    const card = await cardFor('Figma');
    const link = within(card).getByRole('link', { name: 'Open follow-up in Outlook: Sam Ito (Figma)' });
    expect(link).toHaveTextContent('Open follow-up');
    const href = link.getAttribute('href')!;
    expect(href.startsWith('mailto:sito@figma.com?subject=Re%3A%20CMU%20student%2C%20Figma%20intern&body=Hi%20Sam%2C%0D%0A%0D%0AFollowing%20up%20on%20my%20application%20to%20Software%20Engineer%20Intern%20at%20Figma.')).toBe(true);
    expect(within(card).queryByRole('link', { name: /No Mail/ })).toBeNull();
    expect(within(card).getAllByText('Follow-up draft')).toHaveLength(3);
    expect(within(card).getByText('Re: CMU student, Figma intern')).toBeInTheDocument();
  });
  it('Follow-up sent bumps the count and pushes the clock a week; the next due shows the close suggestion', async () => {
    const user = userEvent.setup();
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'updateOutreach');
    renderWithData(<Outreach />, { api });
    const card = await cardFor('Figma');
    await user.click(within(card).getByRole('button', { name: 'Follow-up sent: Figma' }));
    const today = localDay(new Date());
    expect(spy).toHaveBeenCalledWith('o5', { followups: 1, follow_up_on: addDays(today, 7) });
    const after = await cardFor('Figma');
    expect(await within(after).findByText(/Check back in 7 days/)).toBeInTheDocument();
    expect(within(after).queryByRole('button', { name: /^Follow-up sent/ })).toBeNull();
  });
  it('a second due follow-up suggests closing instead of another follow-up', async () => {
    const api = createDemoApi();
    const list = await api.listOutreach();
    api.listOutreach = async () => list.map((o) => (o.id === 'o5' ? { ...o, followups: 1 } : o));
    renderWithData(<Outreach />, { api });
    const card = await cardFor('Figma');
    expect(within(card).getByText(/No reply yet \u2014 close\?/)).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Close: Figma' })).toHaveClass('btn-primary');
    expect(within(card).getByRole('button', { name: 'Replied: Figma' })).toBeInTheDocument();
    expect(within(card).queryByRole('button', { name: /^Follow-up sent/ })).toBeNull();
    expect(within(card).queryByRole('link', { name: /^Open follow-up/ })).toBeNull();
  });
  it('Reopen keeps the clock for a card that was sent', async () => {
    const user = userEvent.setup();
    const api = createDemoApi();
    const spy = vi.spyOn(api, 'updateOutreach');
    renderWithData(<Outreach />, { api });
    await user.click(within(await cardFor('Palantir')).getByRole('button', { name: 'Close: Palantir' }));
    const done = (await screen.findByText(/^Done \(/)).closest('details') as HTMLElement;
    await user.click(await within(done).findByRole('button', { name: 'Reopen: Palantir' }));
    expect(spy).toHaveBeenLastCalledWith('o4', { status: 'sent' });
  });
  it('Reopen is disabled until contacts have loaded', async () => {
    const api = createDemoApi();
    const list = await api.listOutreach();
    api.listOutreach = async () => list.map((o) => (o.id === 'o1' ? { ...o, status: 'closed' as const } : o));
    api.listContacts = () => new Promise(() => {});
    renderWithData(<Outreach />, { api });
    const done = (await screen.findByText(/^Done \(/)).closest('details') as HTMLElement;
    expect(within(done).getByRole('button', { name: 'Reopen: Stripe' })).toBeDisabled();
  });
  it('sent and due cards do not offer the original Open in Outlook', async () => {
    renderWithData(<Outreach />);
    const card = await cardFor('Figma');
    expect(within(card).queryByRole('link', { name: /^Open in Outlook/ })).toBeNull();
    expect(within(card).getByRole('link', { name: /^Open follow-up/ })).toBeInTheDocument();
  });
});
