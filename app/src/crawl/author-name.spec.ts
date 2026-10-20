import { describe, expect, it } from 'vitest';
import { cleanAuthorName } from './author-name.ts';
import { parseFeed } from './feed.ts';

describe('cleanAuthorName', () => {
  it('keeps only the name of address-shaped fields', () => {
    expect(cleanAuthorName('noreply@blogger.com (carol)')).toBe('carol');
    expect(cleanAuthorName('eddie@proton.me (Eddie Lv 呂英全)')).toBe('Eddie Lv 呂英全');
    expect(cleanAuthorName('Lea Verou <lea@example.com>')).toBe('Lea Verou');
    expect(cleanAuthorName('someone@gmail.com')).toBeNull();
    expect(cleanAuthorName('mailto:someone@gmail.com')).toBeNull();
  });
  it('drops placeholders and decodes entities', () => {
    expect(cleanAuthorName('noreply@blogger.com (Unknown)')).toBeNull();
    expect(cleanAuthorName(' Admin ')).toBeNull();
    expect(cleanAuthorName('https://example.com/')).toBeNull();
    expect(cleanAuthorName('noreply@blogger.com (Jedi&#39;s Demo Blog)')).toBe("Jedi's Demo Blog");
    expect(cleanAuthorName('慢活夫妻 George &amp; Dewi')).toBe('慢活夫妻 George & Dewi');
    expect(cleanAuthorName('蘿蔔')).toBe('蘿蔔');
    expect(cleanAuthorName('')).toBeNull();
  });
});

describe('feed author fallback', () => {
  it('uses the RSS channel owner when items name nobody', () => {
    const xml = `<rss version="2.0"><channel><title>T</title><managingEditor>me@example.com (蘿蔔)</managingEditor>
      <item><title>A</title><link>https://example.com/a/</link></item>
      <item><title>B</title><link>https://example.com/b/</link><author>x@example.com (Other)</author></item></channel></rss>`;
    expect(parseFeed(xml, 'https://example.com/index.xml').map((entry) => entry.author)).toEqual(['蘿蔔', 'Other']);
  });
  it('reads the first named Atom author and the feed-level author', () => {
    const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><title>T</title><author><name>Owner</name></author>
      <entry><id>1</id><title>A</title><link href="https://example.com/a/"/><author><name></name></author><author><name>Ann</name></author><author><name>Bob</name></author></entry>
      <entry><id>2</id><title>B</title><link href="https://example.com/b/"/></entry></feed>`;
    expect(parseFeed(xml, 'https://example.com/atom.xml').map((entry) => entry.author)).toEqual(['Ann', 'Owner']);
  });
});
