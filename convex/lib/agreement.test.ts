import { describe, expect, it } from 'vitest';

import type { Id } from '../_generated/dataModel';
import { evaluate, type AgreementContribution, type AgreementDevice } from './agreement';
import { testVector } from './testFactories';
import type { EvidenceKind } from './validators';

const DAY = 24 * 60 * 60 * 1000;
const VENUE = 'venue' as Id<'museums'>;
const NOON = Date.UTC(2026, 8, 10, 12);

function field(value: string, evidence: EvidenceKind = 'wikidata') {
  return { value, edited: evidence === 'user_edited', evidence };
}

function contribution(id: string, deviceId: string, overrides: Partial<AgreementContribution> = {}): AgreementContribution {
  return {
    _id: id as Id<'contributions'>, deviceId: deviceId as Id<'devices'>, venueId: VENUE, modelVersion: 'm1',
    vector: testVector(), fields: { title: field('Water Lilies'), artist: field('Claude Monet') },
    evidence: ['wikidata'], createdAt: NOON, ...overrides,
  };
}

function devices(entries: Record<string, Partial<AgreementDevice>>): Map<Id<'devices'>, AgreementDevice> {
  return new Map(Object.entries(entries).map(([id, device]) => [
    id as Id<'devices'>, { trustWeight: 0.5, banned: false, ...device },
  ]));
}

const twoNewDevices = devices({ d1: {}, d2: {} });

describe('strong evidence', () => {
  it.each(['accession', 'qr', 'tavily+image'] as const)('promotes %s alone', (kind) => {
    const candidate = contribution('c1', 'd1', {
      evidence: [kind, 'ocr'], fields: { title: field('Water Lilies', kind), artist: field('Claude Monet', kind) },
    });
    expect(evaluate(candidate, [], devices({ d1: {} }))).toEqual({
      promote: true, reason: 'strong', partners: [], differentDays: false,
    });
  });

  it.each(['tavily', 'wikidata', 'ocr', 'weak'] as const)('does not promote %s alone', (kind) => {
    const candidate = contribution('c1', 'd1', { evidence: [kind] });
    expect(evaluate(candidate, [], devices({ d1: { trustWeight: 1 } }))).toMatchObject({ promote: false, reason: 'insufficient' });
  });

  it('needs agreement when the title or artist was edited even beside accession evidence', () => {
    const edited = contribution('c1', 'd1', {
      evidence: ['accession', 'user_edited'],
      fields: { title: field('Water Lilies', 'user_edited'), artist: field('Claude Monet', 'accession') },
    });
    expect(evaluate(edited, [], devices({ d1: {} }))).toMatchObject({ promote: false, reason: 'insufficient' });
    const partner = contribution('c2', 'd2', { vector: testVector(0.95) });
    expect(evaluate(edited, [partner], twoNewDevices)).toMatchObject({ promote: true, reason: 'agreement', partners: ['c2'] });
  });

  it('still promotes strong evidence when only a secondary field was edited', () => {
    const candidate = contribution('c1', 'd1', {
      evidence: ['accession', 'user_edited'],
      fields: { title: field('Water Lilies', 'accession'), artist: field('Claude Monet', 'accession') },
    });
    expect(evaluate(candidate, [], devices({ d1: {} }))).toMatchObject({ promote: true, reason: 'strong' });
  });

  it('never promotes a banned device, even with strong evidence', () => {
    const candidate = contribution('c1', 'd1', { evidence: ['qr'] });
    expect(evaluate(candidate, [], devices({ d1: { banned: true } }))).toMatchObject({ promote: false });
    expect(evaluate(candidate, [], new Map())).toMatchObject({ promote: false });
  });
});

describe('agreement', () => {
  const candidate = contribution('c1', 'd1');
  const partner = contribution('c2', 'd2', { vector: testVector(0.95) });

  it('keeps conflicting verified accessions apart, including through a names-only candidate', () => {
    const accession = (value: string) => ({ title: field('Water Lilies'), artist: field('Claude Monet'), accession: field(value, 'qr') });
    const first = contribution('c2', 'd2', { vector: testVector(0.95), fields: accession('Ａ  123') });
    const same = contribution('c3', 'd3', { vector: testVector(0.97), fields: accession('a 123') });
    const different = contribution('c4', 'd4', { vector: testVector(0.93), fields: accession('456') });
    const trust = devices({ d1: {}, d2: {}, d3: {}, d4: {} });
    expect(evaluate(candidate, [first, different, same], trust).partners).toEqual(['c2', 'c3']);
    expect(evaluate(first, [different], trust).promote).toBe(false);
  });

  it('does not count replayed partner vectors as independent trust', () => {
    const replay = contribution('c3', 'd3', { vector: testVector(0.95) });
    const trust = devices({ d1: { trustWeight: 0.25 }, d2: { trustWeight: 0.25 }, d3: { trustWeight: 0.5 } });
    expect(evaluate(candidate, [partner, replay], trust).promote).toBe(false);
    expect(evaluate(candidate, [partner, replay], devices({ d1: {}, d2: {}, d3: {} })).partners).toEqual(['c2']);
  });

  it('promotes two new devices naming the same work at the same venue with matching embeddings', () => {
    expect(evaluate(candidate, [partner], twoNewDevices)).toEqual({
      promote: true, reason: 'agreement', partners: ['c2'], differentDays: false,
    });
  });

  it('matches names after casefolding, punctuation, diacritics and spacing differ', () => {
    const variant = contribution('c2', 'd2', {
      vector: testVector(0.95), fields: { title: field('  WATER-LILIES! '), artist: field('Claudé  Monet') },
    });
    expect(evaluate(candidate, [variant], twoNewDevices)).toMatchObject({ promote: true, partners: ['c2'] });
    const other = contribution('c3', 'd2', { vector: testVector(0.95), fields: { title: field('Haystacks'), artist: field('Claude Monet') } });
    expect(evaluate(candidate, [other], twoNewDevices)).toMatchObject({ promote: false });
  });

  it('rejects an identical embedding as a replay while accepting a close one', () => {
    const replay = contribution('c2', 'd2', { vector: testVector(1) });
    expect(evaluate(candidate, [replay], twoNewDevices)).toMatchObject({ promote: false, reason: 'insufficient' });
    const close = contribution('c3', 'd2', { vector: testVector(0.998) });
    expect(evaluate(candidate, [close], twoNewDevices)).toMatchObject({ promote: true, partners: ['c3'] });
  });

  it('requires the embeddings to be similar', () => {
    const far = contribution('c2', 'd2', { vector: testVector(0.85) });
    expect(evaluate(candidate, [far], twoNewDevices)).toMatchObject({ promote: false });
  });

  it('ignores the same device, other venues, other model versions and banned partners', () => {
    const sameDevice = contribution('c2', 'd1', { vector: testVector(0.95) });
    const elsewhere = contribution('c3', 'd2', { vector: testVector(0.95), venueId: 'other' as Id<'museums'> });
    const otherModel = contribution('c4', 'd2', { vector: testVector(0.95), modelVersion: 'm0' });
    const banned = contribution('c5', 'd3', { vector: testVector(0.95) });
    const pool = devices({ d1: {}, d2: {}, d3: { banned: true } });
    expect(evaluate(candidate, [sameDevice, elsewhere, otherModel, banned, candidate], pool)).toMatchObject({ promote: false });
  });

  it('sums trust over distinct devices and does not let a confirmed device promote alone', () => {
    const confirmed = devices({ d1: { trustWeight: 1 } });
    expect(evaluate(candidate, [], confirmed)).toMatchObject({ promote: false, reason: 'insufficient' });
    const light = devices({ d1: { trustWeight: 0.25 }, d2: { trustWeight: 0.25 }, d3: { trustWeight: 0.25 } });
    const third = contribution('c3', 'd3', { vector: testVector(0.9) });
    expect(evaluate(candidate, [partner, third], light)).toMatchObject({ promote: false });
    const sameDeviceTwice = contribution('c4', 'd2', { vector: testVector(0.97) });
    expect(evaluate(candidate, [partner, sameDeviceTwice], devices({ d1: { trustWeight: 0.25 }, d2: { trustWeight: 0.5 } })))
      .toMatchObject({ promote: false });
    expect(evaluate(candidate, [partner, third], devices({ d1: { trustWeight: 0.25 }, d2: { trustWeight: 0.25 }, d3: { trustWeight: 0.5 } })))
      .toMatchObject({ promote: true, partners: ['c2', 'c3'] });
  });

  it('records whether a partner scanned on a different day without requiring it', () => {
    const nextDay = contribution('c2', 'd2', { vector: testVector(0.95), createdAt: NOON + DAY });
    expect(evaluate(candidate, [nextDay], twoNewDevices)).toMatchObject({ promote: true, differentDays: true });
    const lateSameDay = contribution('c3', 'd2', { vector: testVector(0.95), createdAt: NOON + 8 * 60 * 60 * 1000 });
    expect(evaluate(candidate, [lateSameDay], twoNewDevices)).toMatchObject({ promote: true, differentDays: false });
  });
});

describe('strong candidates with pending partners', () => {
  it('includes a matching weak partner while keeping strong promotion independent of trust', () => {
    const candidate = contribution('c1', 'd1', { evidence: ['qr'] });
    const partner = contribution('c2', 'd2', { vector: testVector(0.95) });
    expect(evaluate(candidate, [partner], twoNewDevices)).toMatchObject({ promote: true, reason: 'strong', partners: ['c2'] });
    expect(evaluate(candidate, [partner], devices({ d1: { trustWeight: 0.25 }, d2: { trustWeight: 0.25 } })))
      .toMatchObject({ promote: true, reason: 'strong', partners: [] });
  });
});
