import { expect, it } from 'vitest';
import { CURATED_PAGES, curatedProof, parseBlogblogMembers, parseIndiepingMembers } from './curated-directories.ts';

it('accepts only curated directory table rows, excluding resource links and member recommendations', () => {
  const html =
    '<main><table><tr><td><a href="https://alice.test/blogroll">Alice</a></td><td><a href="https://other.test">comment</a></td></tr></table><a href="https://kagi.com/smallweb">Kagi</a></main>';
  expect(parseBlogblogMembers(html, CURATED_PAGES[0]).map((x) => x.url)).toEqual(['https://alice.test/blogroll']);
  expect(() => parseBlogblogMembers(html, 'https://member.test/blogroll')).toThrow();
});
it('party qualification comes from named hosts and participants, not every external link', () => {
  const html =
    '<main><a href="https://store.test">reference</a><ul><li>主持人：<a href="https://host.test">Host</a></li><li>參與者（2）：<ul><li><a href="https://writer.test/post/1">Writer</a></li></ul></li></ul></main>';
  expect(parseBlogblogMembers(html, CURATED_PAGES[1]).map((x) => x.url)).toEqual(['https://host.test/', 'https://writer.test/post/1']);
});
it('reads the official IndiePing list without per-domain requests or guessed submissions', () => {
  expect(
    parseIndiepingMembers([
      { domain: 'alice.test', name: 'Alice' },
      { domain: '127.0.0.1', name: 'private' },
      { domain: 'bad.test/path', name: 'bad' },
    ]).map((x) => x.url),
  ).toEqual(['https://alice.test/']);
  expect(() => parseIndiepingMembers({ blogs: [] })).toThrow();
});
it('requires structured proof for the exact publication, with a known source and membership kind', () => {
  const p = {
    url: 'https://writer.test/post/1',
    home: 'https://writer.test/',
    name: 'Writer',
    provider: 'blogblog-club',
    page: CURATED_PAGES[1],
    kind: 'participant',
    sha256: 'a'.repeat(64),
    observedAt: new Date().toISOString(),
  };
  expect(curatedProof({ curatedListings: [p] }, p.home)).toEqual(p);
  for (const change of [
    { page: 'https://member.test/blogroll' },
    { kind: 'reference' },
    { home: 'https://victim.test/' },
    { sha256: 'no' },
  ])
    expect(curatedProof({ curatedListings: [{ ...p, ...change }] }, p.home)).toBeNull();
  expect(curatedProof({ directoryListing: { page: CURATED_PAGES[0] } }, p.home)).toBeNull();
  expect(curatedProof({ curatedListings: [p] }, 'https://other.test/')).toBeNull();
});
