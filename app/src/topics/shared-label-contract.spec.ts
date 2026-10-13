import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { optionalSharedLabel, parseSharedLabelRelations, parseSharedLabelVisual } from './shared-label-contract.ts';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const relation = {
  id: 'relation:1',
  type: 'related',
  target: { id: hash('水果'), label: '水果', href: '/tag/%E6%B0%B4%E6%9E%9C/' },
  source: 'submission',
  sourceDetail: 'submission',
  createdAt: null,
  status: 'approved',
  inherited: false,
  depth: 1,
};
const packet = () => ({ tag: '榴槤', tagId: hash('榴槤'), truncated: true, relations: [relation] });
describe('offline F1 shared label contract', () => {
  it('preserves raw IDs, direction, truncation and unknown date; strips private extras', () => {
    const data = parseSharedLabelRelations(
      {
        ...packet(),
        reviewerEmail: 'private',
        relations: [
          { ...relation, actor: 'private' },
          {
            ...relation,
            id: 'group-membership:1',
            type: 'is-a',
            target: { id: 'group:7', label: '食物', href: '/group/7/' },
            source: 'rule',
            inherited: true,
            depth: 2,
          },
        ],
      },
      '榴槤',
    );
    expect(data.truncated).toBe(true);
    expect(data.relations[1]?.inherited).toBe(true);
    expect(data.relations[0]?.createdAt).toBeNull();
    expect(JSON.stringify(data)).not.toContain('private');
  });
  it.each(['pending', 'rejected'])('rejects non-public %s relations instead of pretending empty', (status) => {
    expect(optionalSharedLabel(() => parseSharedLabelRelations({ ...packet(), relations: [{ ...relation, status }] }, '榴槤'))).toEqual({
      status: 'missing',
    });
  });
  it('rejects label identity drift and external href', () => {
    expect(() => parseSharedLabelRelations(packet(), '芒果')).toThrow();
    expect(() =>
      parseSharedLabelRelations(
        { ...packet(), relations: [{ ...relation, target: { ...relation.target, href: '//evil.example/' } }] },
        '榴槤',
      ),
    ).toThrow();
  });
  it('accepts public null visual without inventing an image', () =>
    expect(parseSharedLabelVisual({ tag: '榴槤', visual: null }, '榴槤')).toEqual({ tag: '榴槤', visual: null }));
  it('retains image version and attribution, rejects credential query', () => {
    const visual = {
      kind: 'logo',
      emoji: null,
      label: null,
      wikidataId: null,
      image: '/api/v1/tags/%E6%A6%B4%E6%A7%A4/visual-image?v=abc',
      large: null,
      source: {
        pageUrl: 'https://commons.wikimedia.org/wiki/File:X',
        license: 'CC BY 4.0',
        licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
        artist: 'Example',
      },
    };
    expect(parseSharedLabelVisual({ tag: '榴槤', visual }, '榴槤').visual?.source?.artist).toBe('Example');
    expect(() => parseSharedLabelVisual({ tag: '榴槤', visual: { ...visual, image: visual.image + '&token=secret' } }, '榴槤')).toThrow(
      'Invalid shared label contract',
    );
  });
});

describe('F1 input/path bounds regressions', () => {
  it('rejects dot-segment href after URL normalization', () => {
    const dot = { ...relation, target: { id: hash('.'), label: '.', href: '/tag/./' } };
    expect(() => parseSharedLabelRelations({ ...packet(), relations: [dot] }, '榴槤')).toThrow();
    const dots = { ...relation, target: { id: hash('..'), label: '..', href: '/tag/../' } };
    expect(() => parseSharedLabelRelations({ ...packet(), relations: [dots] }, '榴槤')).toThrow();
  });
  it.each(['x\u0085y', 'x\ud800y'])('rejects upstream Cc/Cs without changing identity', (label) => {
    expect(() => parseSharedLabelRelations({ ...packet(), tag: label, tagId: hash(label) }, label)).toThrow();
  });
  it('retains allowed Cf inside CJK tags byte exactly', () => {
    const tag = '中\u200d文';
    expect(parseSharedLabelRelations({ tag, tagId: hash(tag), relations: [], truncated: false }, tag).tag).toBe(tag);
  });
  it('rejects oversized fields rather than clipping upstream labels/provenance', () => {
    expect(() => parseSharedLabelRelations({ ...packet(), relations: [{ ...relation, sourceDetail: 'x'.repeat(17) }] }, '榴槤')).toThrow();
    const label = '字'.repeat(61);
    expect(() =>
      parseSharedLabelRelations(
        { ...packet(), relations: [{ ...relation, target: { id: hash(label), label, href: `/tag/${encodeURIComponent(label)}/` } }] },
        '榴槤',
      ),
    ).toThrow();
    const visual = {
      kind: 'logo',
      emoji: null,
      label: null,
      wikidataId: null,
      image: null,
      large: null,
      source: { pageUrl: 'https://commons.wikimedia.org/', license: null, licenseUrl: null, artist: '字'.repeat(256) },
    };
    expect(() => parseSharedLabelVisual({ tag: '榴槤', visual }, '榴槤')).toThrow();
  });
  it('bounds full object JSON including extras without invoking getters/toJSON', () => {
    expect(() => parseSharedLabelRelations({ ...packet(), extra: 'x'.repeat(2 * 1024 * 1024) }, '榴槤')).toThrow();
    const getter = vi.fn(() => 'secret');
    const raw = { ...packet() };
    Object.defineProperty(raw, 'private', { enumerable: true, get: getter });
    expect(() => parseSharedLabelRelations(raw, '榴槤')).toThrow();
    expect(getter).not.toHaveBeenCalled();
    const toJSON = vi.fn(() => packet());
    expect(() => parseSharedLabelRelations({ ...packet(), toJSON }, '榴槤')).toThrow();
    expect(toJSON).not.toHaveBeenCalled();
    const cyclic: Record<string, unknown> = { ...packet() };
    cyclic.self = cyclic;
    expect(() => parseSharedLabelRelations(cyclic, '榴槤')).toThrow();
    expect(() => parseSharedLabelRelations({ ...packet(), extra: 1n }, '榴槤')).toThrow();
  });
});
