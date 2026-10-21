import { describe, expect, it } from 'vitest';
import { INDIEPING_LISTING, indiepingListing, listingLabel, listingOf } from './directory-listing.ts';

describe('IndiePing as a directory source', () => {
  it('counts only its own listing page', () => {
    const evidence = { indiepingListing: { page: INDIEPING_LISTING } };
    expect(indiepingListing(evidence)).toBe(INDIEPING_LISTING);
    expect(indiepingListing({ indiepingListing: { page: 'https://evil.test/' } })).toBeNull();
    expect(listingOf('indieping', evidence)).toBe(INDIEPING_LISTING);
    expect(listingOf('article-link', evidence)).toBeNull();
    expect(listingLabel('indieping')).toBe('IndiePing 名單自動收錄');
  });
});
