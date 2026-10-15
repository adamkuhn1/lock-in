import { describe, expect, it } from 'vitest';
import type { LaunchRequest, Outreach } from '../data/types';
import type { Contact } from '../data/types';
import { PHASE_LABEL, followUpDraft, followUpLabel, followUpOn, followUpsDue, isPlainEmail, latestRequest, mailtoHref, outreachPhase, sortOutreach } from './outreach';

const O = (id: string, over: Partial<Outreach> = {}): Outreach => ({
  id, job_url: 'https://x.com/' + id, company: null, role: null, resume_path: null, status: 'queued',
  sent_on: null, follow_up_on: null, followups: 0, created_at: '2026-10-14T12:00:00Z', ...over,
});
const R = (id: string, outreachId: string, status: LaunchRequest['status'], created_at = '2026-10-14T12:00:00Z', error: string | null = null): LaunchRequest => ({
  id, kind: 'outreach', payload: { outreach_id: outreachId, job_url: 'x' }, status, error, created_at,
});

describe('outreach', () => {
  it('follow-up is 5 days after sent', () => {
    expect(followUpOn('2026-10-28')).toBe('2026-11-02');
  });
  it('due follow-ups: sent, due today or earlier', () => {
    const list = [O('a', { status: 'sent', follow_up_on: '2026-10-14' }), O('b', { status: 'sent', follow_up_on: '2026-10-15' }), O('c', { status: 'replied', follow_up_on: '2026-10-01' })];
    expect(followUpsDue(list, '2026-10-14').map((o) => o.id)).toEqual(['a']);
  });
  it('phases from the latest launch request', () => {
    expect(outreachPhase(O('a'), [R('r1', 'a', 'queued')], '2026-10-14')).toEqual({ kind: 'queued' });
    expect(outreachPhase(O('a'), [R('r1', 'a', 'launched')], '2026-10-14')).toEqual({ kind: 'on_mac' });
    expect(outreachPhase(O('a'), [R('r1', 'a', 'failed', '2026-10-14T12:00:00Z', 'boom'), R('r2', 'a', 'queued', '2026-10-14T13:00:00Z')], '2026-10-14')).toEqual({ kind: 'queued' });
    expect(outreachPhase(O('a'), [R('r1', 'a', 'failed', '2026-10-14T12:00:00Z', 'osascript: not authorized')], '2026-10-14')).toEqual({ kind: 'failed', error: 'osascript: not authorized' });
    expect(outreachPhase(O('a'), [], '2026-10-14')).toEqual({ kind: 'not_queued' });
    expect(outreachPhase(O('a', { status: 'drafted' }), [], '2026-10-14')).toEqual({ kind: 'drafted' });
    expect(outreachPhase(O('a', { status: 'sent', follow_up_on: '2026-10-14' }), [], '2026-10-14')).toEqual({ kind: 'due' });
    expect(outreachPhase(O('a', { status: 'sent', follow_up_on: '2026-10-20' }), [], '2026-10-14')).toEqual({ kind: 'sent' });
  });
  it('sorts due first, then in-progress, then sent, then done', () => {
    const list = [
      O('replied', { status: 'replied' }), O('sent', { status: 'sent', follow_up_on: '2026-10-20' }),
      O('drafted', { status: 'drafted' }), O('due', { status: 'sent', follow_up_on: '2026-10-13' }), O('queued'),
    ];
    expect(sortOutreach(list, [R('r', 'queued', 'queued')], '2026-10-14').map((o) => o.id)).toEqual(['due', 'drafted', 'queued', 'sent', 'replied']);
  });
});

import { sentThisWeek } from './outreach';
it('sentThisWeek counts Mon..today', () => {
  expect(sentThisWeek([{ sent_on: '2026-10-11' }, { sent_on: '2026-10-12' }, { sent_on: '2026-10-14' }, { sent_on: null }], '2026-10-14')).toBe(2);
});

describe('tailor_resume requests', () => {
  const T = (id: string, outreachId: string, status: LaunchRequest['status'], created_at: string, error: string | null = null): LaunchRequest => ({
    id, kind: 'tailor_resume', payload: { outreach_id: outreachId, job_url: 'x' }, status, error, created_at,
  });
  it('drive the phase like outreach requests', () => {
    expect(outreachPhase(O('a'), [T('t1', 'a', 'queued', '2026-10-14T12:00:00Z')], '2026-10-14')).toEqual({ kind: 'queued' });
    expect(outreachPhase(O('a'), [T('t1', 'a', 'launched', '2026-10-14T12:00:00Z')], '2026-10-14')).toEqual({ kind: 'on_mac' });
    expect(outreachPhase(O('a'), [T('t1', 'a', 'failed', '2026-10-14T12:00:00Z', 'Base resume not found at /R/Base_Resume')], '2026-10-14'))
      .toEqual({ kind: 'failed', error: 'Base resume not found at /R/Base_Resume' });
  });
  it('the newest of either kind wins', () => {
    const reqs = [R('r1', 'a', 'failed', '2026-10-14T12:00:00Z', 'boom'), T('t1', 'a', 'launched', '2026-10-14T13:00:00Z')];
    expect(outreachPhase(O('a'), reqs, '2026-10-14')).toEqual({ kind: 'on_mac' });
    expect(latestRequest(O('a'), reqs)?.kind).toBe('tailor_resume');
  });
  it('a launched tailor that saved a resume (no recruiter yet) is resume_ready, not on_mac forever', () => {
    const o = O('a', { resume_path: '/Users/adamk/Desktop/Adam_Kuhn_Resumes/Acme_SWE/Adam_Kuhn_Resume.pdf' });
    expect(outreachPhase(o, [T('t1', 'a', 'launched', '2026-10-14T12:00:00Z')], '2026-10-14')).toEqual({ kind: 'resume_ready' });
    expect(PHASE_LABEL.resume_ready).toBe('Resume ready');
    expect(outreachPhase(o, [T('t1', 'a', 'queued', '2026-10-14T12:00:00Z')], '2026-10-14')).toEqual({ kind: 'queued' });
    // Cold email sets resume_path at launch, so it stays "Opened on Mac" until drafts land.
    expect(outreachPhase(o, [R('r1', 'a', 'launched')], '2026-10-14')).toEqual({ kind: 'on_mac' });
  });
  it('ignores other kinds and other outreach ids', () => {
    const other: LaunchRequest = { id: 'm', kind: 'mock_interview', payload: { outreach_id: 'a' }, status: 'queued', error: null, created_at: '2026-10-14T14:00:00Z' };
    expect(latestRequest(O('a'), [other, T('t1', 'b', 'queued', '2026-10-14T12:00:00Z')])).toBeNull();
  });
});

describe('isPlainEmail', () => {
  it('accepts plain addresses only', () => {
    for (const ok of ['dana@stripe.com', 'dana.reyes+jobs@eng.stripe.co.uk', 'a_b-c@x.io']) expect(isPlainEmail(ok)).toBe(true);
    for (const bad of ['dana@stripe', 'dana stripe@x.com', 'a@b@c.com', 'a@b.com?bcc=e@v.il', 'a@b.com,c@d.com', 'a@b.com;c@d.com',
      'a&b@c.com', 'a#b@c.com', '<a@b.com>', '"a"@b.com', "a'b@c.com", '@b.com', 'a@.com', 'a@b.c', '']) expect(isPlainEmail(bad)).toBe(false);
  });
});

describe('mailtoHref', () => {
  it('encodes subject and body, with CRLF line breaks', () => {
    expect(mailtoHref('dana@stripe.com', 'Applied: SWE — NYC', 'Hi Dana,\n\nThanks,\nAdam'))
      .toBe('mailto:dana@stripe.com?subject=Applied%3A%20SWE%20%E2%80%94%20NYC&body=Hi%20Dana%2C%0D%0A%0D%0AThanks%2C%0D%0AAdam');
  });
  it('keeps existing CRLFs single and escapes &, ?, # and =', () => {
    const href = mailtoHref('a@b.co', 'Q&A? #1 = yes', 'line1\r\nline2 & more? #tag');
    expect(href).toBe('mailto:a@b.co?subject=Q%26A%3F%20%231%20%3D%20yes&body=line1%0D%0Aline2%20%26%20more%3F%20%23tag');
    const u = new URL(href);
    expect(u.searchParams.get('subject')).toBe('Q&A? #1 = yes');
    expect(u.searchParams.get('body')).toBe('line1\r\nline2 & more? #tag');
  });
  it('escapes the address too, so it cannot inject headers', () => {
    expect(mailtoHref('x@y.co?bcc=evil@z.co', 's', 'b')).toBe('mailto:x@y.co%3Fbcc%3Devil@z.co?subject=s&body=b');
  });

  describe('followUpLabel', () => {
    const today = '2026-10-14';
    it('counts down while sent', () => {
      expect(followUpLabel(O('a', { status: 'sent', follow_up_on: '2026-10-17' }), today)).toBe('Follow up in 3 days');
      expect(followUpLabel(O('a', { status: 'sent', follow_up_on: '2026-10-15' }), today)).toBe('Follow up tomorrow');
    });
    it('is due today, then overdue', () => {
      expect(followUpLabel(O('a', { status: 'sent', follow_up_on: today }), today)).toBe('Follow up today');
      expect(followUpLabel(O('a', { status: 'sent', follow_up_on: '2026-10-13' }), today)).toBe('Overdue 1 day');
      expect(followUpLabel(O('a', { status: 'sent', follow_up_on: '2026-10-11' }), today)).toBe('Overdue 3 days');
    });
    it('suggests closing after a follow-up with no reply', () => {
      expect(followUpLabel(O('a', { status: 'sent', followups: 1, follow_up_on: today }), today)).toBe('No reply yet \u2014 close?');
      expect(followUpLabel(O('a', { status: 'sent', followups: 1, follow_up_on: '2026-10-20' }), today)).toBe('Check back in 6 days');
      expect(followUpLabel(O('a', { status: 'sent', followups: 1, follow_up_on: '2026-10-15' }), today)).toBe('Check back tomorrow');
    });
    it('is null when not sent or no date', () => {
      expect(followUpLabel(O('a', { status: 'drafted' }), today)).toBeNull();
      expect(followUpLabel(O('a', { status: 'replied', follow_up_on: today }), today)).toBeNull();
      expect(followUpLabel(O('a', { status: 'sent', follow_up_on: null }), today)).toBeNull();
    });
  });

  describe('followUpDraft', () => {
    const C = (over: Partial<Contact> = {}): Contact => ({
      id: 'c', outreach_id: 'a', name: 'Dana Reyes', title: null, linkedin_url: null, email_guess: 'd@x.com', email_confidence: null,
      why: null, draft_subject: 'CMU student, SWE intern', draft_body: 'x', ...over,
    });
    it('builds subject and body', () => {
      const d = followUpDraft(O('a', { role: 'SWE Intern', company: 'Stripe' }), C());
      expect(d.subject).toBe('Re: CMU student, SWE intern');
      expect(d.body).toBe("Hi Dana,\n\nFollowing up on my application to SWE Intern at Stripe. I'm still very interested and happy to share anything that would help.\n\nPortfolio: https://adamkuhn.vercel.app\n\nThanks,\nAdam");
    });
    it('does not double Re:', () => {
      expect(followUpDraft(O('a'), C({ draft_subject: 'Re: hello' })).subject).toBe('Re: hello');
      expect(followUpDraft(O('a'), C({ draft_subject: 're: hello' })).subject).toBe('re: hello');
    });
    it('treats a whitespace-only company or role as missing', () => {
      const d = followUpDraft(O('a', { role: '  ', company: '   ' }), C());
      expect(d.body).toContain('application to the role. I');
      expect(followUpDraft(O('a', { company: ' Stripe ' }), C()).body).toContain('to the role at Stripe.');
    });
    it('handles missing role, company, name and subject', () => {
      const d = followUpDraft(O('a'), C({ name: '', draft_subject: null }));
      expect(d.body).toContain('Hi there,');
      expect(d.body).toContain('application to the role. I');
      expect(d.subject).toBe('Re: my application');
      expect(followUpDraft(O('a', { company: 'Stripe' }), C()).body).toContain('to the role at Stripe.');
      expect(followUpDraft(O('a', { role: 'SWE' }), C()).body).toContain('to SWE.');
    });
  });
});
