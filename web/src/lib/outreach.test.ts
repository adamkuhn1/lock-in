import { describe, expect, it } from 'vitest';
import type { LaunchRequest, Outreach } from '../data/types';
import { followUpOn, followUpsDue, outreachPhase, sortOutreach } from './outreach';

const O = (id: string, over: Partial<Outreach> = {}): Outreach => ({
  id, job_url: 'https://x.com/' + id, company: null, role: null, resume_path: null, status: 'queued',
  sent_on: null, follow_up_on: null, created_at: '2026-10-14T12:00:00Z', ...over,
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
