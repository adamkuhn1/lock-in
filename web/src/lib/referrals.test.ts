import { describe, expect, it } from 'vitest';
import type { Application, LaunchRequest, Outreach, Referral } from '../data/types';
import {
  backing, followUpDue, followUpMessage, groupByJob, latestFind, nextStep, notesSentThisWeek, ratePct, reachWithoutContact, replyRates,
  replyTotal, sortGroups,
} from './referrals';

const R = (id: string, over: Partial<Referral> = {}): Referral => ({
  id, request_id: 'req1', posting_id: 'p1', job_url: 'https://x/1', company: 'Stripe', role: 'Software Engineer, New Grad', tier: 'reach',
  name: 'Maya Chen', title: 'SWE', profile_url: 'https://www.linkedin.com/in/maya', pick: 'ex_apple', why: null, note: 'Hi',
  status: 'drafted', sent_on: null, accepted_on: null, followed_up_on: null, replied_on: null, referred_on: null,
  created_at: '2026-10-20T12:00:00Z', ...over,
});
const O = (id: string, over: Partial<Outreach> = {}): Outreach => ({
  id, job_url: 'https://x', company: 'Acme', role: null, resume_path: null, status: 'sent', sent_on: '2026-10-20', follow_up_on: null,
  followups: 0, created_at: '2026-10-20T00:00:00Z', tier: 'volume', replied_on: null, ...over,
});
const A = (id: number, over: Partial<Application> = {}): Application => ({
  id, company: 'Stripe', role: 'SWE', track: null, term: null, location: null, status: 'Applied', stage: 'applied', priority: null,
  applied_on: '2026-10-20', tier: 'reach', ...over,
});

describe('follow-up clock', () => {
  const acc = (on: string, over: Partial<Referral> = {}) => R('a', { status: 'accepted', sent_on: '2026-10-10', accepted_on: on, ...over });
  it('is due 3 days after they accept, with day 4 as the last good day', () => {
    expect(nextStep(acc('2026-10-20'), '2026-10-21')).toBe('Follow up in 2 days');
    expect(nextStep(acc('2026-10-20'), '2026-10-22')).toBe('Follow up tomorrow');
    expect(nextStep(acc('2026-10-20'), '2026-10-23')).toBe('Follow up today');
    expect(nextStep(acc('2026-10-20'), '2026-10-24')).toBe('Follow up today (day 4)');
    expect(nextStep(acc('2026-10-20'), '2026-10-26')).toBe('Follow-up overdue 2 days');
    expect(followUpDue(acc('2026-10-20'), '2026-10-22')).toBe(false);
    expect(followUpDue(acc('2026-10-20'), '2026-10-23')).toBe(true);
    expect(followUpDue(acc('2026-10-20', { followed_up_on: '2026-10-23' }), '2026-10-25')).toBe(false);
    expect(nextStep(acc('2026-10-20', { followed_up_on: '2026-10-23' }), '2026-10-25')).toBe('Followed up · waiting for a reply');
  });
  it('says how long a sent note has waited', () => {
    expect(nextStep(R('s', { status: 'sent', sent_on: '2026-10-20' }), '2026-10-22')).toBe('Waiting to accept · sent 2 days ago');
    expect(nextStep(R('d'), '2026-10-22')).toBeNull();
  });
  it('follow-up message names the role and repeats the ask', () => {
    const m = followUpMessage(R('a'));
    expect(m).toMatch(/^Thanks for connecting, Maya!/);
    expect(m).toContain("Stripe's Software Engineer, New Grad role");
    expect(m).toContain('referring me');
  });
});

describe('weekly count and grouping', () => {
  it('counts notes sent Monday through today', () => {
    // 2026-10-28 is a Wednesday; the week starts Monday 2026-10-26
    const refs = [R('1', { sent_on: '2026-10-26' }), R('2', { sent_on: '2026-10-28' }), R('3', { sent_on: '2026-10-25' }), R('4')];
    expect(notesSentThisWeek(refs, '2026-10-28')).toBe(2);
  });
  it('groups by request and sorts due follow-ups first', () => {
    const refs = [
      R('a', { request_id: 'old', status: 'sent', sent_on: '2026-10-01', created_at: '2026-10-01T00:00:00Z', company: 'Figma' }),
      R('b', { request_id: 'due', status: 'accepted', sent_on: '2026-10-01', accepted_on: '2026-10-20', company: 'Ramp' }),
      R('c', { request_id: 'new', created_at: '2026-10-27T00:00:00Z', company: 'OpenAI' }),
      R('d', { request_id: 'new', name: 'Sam Lee', created_at: '2026-10-27T00:00:01Z', company: 'OpenAI' }),
    ];
    const groups = sortGroups(groupByJob(refs), '2026-10-28');
    expect(groups.map((g) => g.company)).toEqual(['Ramp', 'OpenAI', 'Figma']);
    expect(groups[1].refs.map((r) => r.name)).toEqual(['Maya Chen', 'Sam Lee']);
  });
  it('finds the latest Find engineers request for a posting or a company', () => {
    const req = (id: string, payload: Record<string, unknown>, at: string): LaunchRequest =>
      ({ id, kind: 'find_engineers', payload, status: 'launched', error: null, created_at: at });
    const reqs = [req('1', { posting_id: 'p1', company: 'Stripe' }, '2026-10-01T00:00:00Z'), req('2', { posting_id: 'p1', company: 'Stripe' }, '2026-10-02T00:00:00Z'),
      req('3', { company: 'Figma, Inc.' }, '2026-10-03T00:00:00Z')];
    expect(latestFind(reqs, { posting_id: 'p1', company: 'Stripe' })?.id).toBe('2');
    expect(latestFind(reqs, { company: 'figma' })?.id).toBe('3');
    expect(latestFind(reqs, { company: 'Stripe' })).toBeNull(); // a posting's run isn't an application's
  });
});

describe('reply rates by tier', () => {
  it('counts sent and replied notes and emails per tier', () => {
    const refs = [R('1', { sent_on: '2026-10-20', status: 'replied', replied_on: '2026-10-22' }), R('2', { sent_on: '2026-10-20', status: 'accepted' }),
      R('3', { sent_on: '2026-10-21', status: 'referred', tier: 'midwest' }), R('4')];
    const outreach = [O('a', { status: 'replied' }), O('b'), O('c', { sent_on: null, status: 'drafted' }), O('d', { tier: null })];
    const rows = replyRates(refs, outreach);
    expect(rows.map((r) => [r.tier, r.notes, r.emails])).toEqual([
      ['reach', { sent: 2, replied: 1 }, { sent: 0, replied: 0 }],
      ['midwest', { sent: 1, replied: 1 }, { sent: 0, replied: 0 }],
      ['volume', { sent: 0, replied: 0 }, { sent: 2, replied: 1 }],
      [null, { sent: 0, replied: 0 }, { sent: 1, replied: 0 }],
    ]);
    expect(replyTotal(rows, 'notes')).toEqual({ sent: 3, replied: 2 });
    expect(ratePct({ sent: 3, replied: 2 })).toBe('67%');
    expect(ratePct({ sent: 0, replied: 0 })).toBe('—');
  });
});

describe('Reach applications without a contact', () => {
  it('flags reach apps in play with nobody contacted at the company', () => {
    const apps = [A(1), A(2, { company: 'Figma' }), A(3, { company: 'Ramp', stage: 'closed' }), A(4, { company: 'Acme', tier: 'volume' }),
      A(5, { company: 'OpenAI' })];
    const refs = [R('s', { company: 'Stripe, Inc.', status: 'sent', sent_on: '2026-10-21' }), R('d', { company: 'OpenAI' })];
    expect(reachWithoutContact(apps, refs).map((a) => a.company)).toEqual(['Figma', 'OpenAI']);
    expect(backing('OpenAI', refs)).toBe('drafted');
    expect(backing('Stripe', refs)).toBe('contacted');
    expect(backing('Figma', refs)).toBe('none');
  });
});
