import { describe, expect, it, vi } from 'vitest';
import { deterministicPersonalProof, personalHomepage } from './ai/personal.ts';
import { claimFileUrl, claimMarker, homeKey, verifySiteClaim } from './site-identity.ts';

const token = 'wt_a-random-challenge';
describe('site control evidence', () => {
  it('keeps author paths separate while normalizing scheme and www', () => {
    expect(homeKey('https://www.example.com/')).toBe(homeKey('http://example.com'));
    expect(homeKey('https://medium.com/@alice')).not.toBe(homeKey('https://medium.com/@bob'));
    expect(claimFileUrl('https://example.com/blog/', token)).toBe(`https://example.com/blog/weblog-verification-${token}.txt`);
  });
  it('only accepts a head meta marker or an about introduction paragraph, never comments', () => {
    expect(claimMarker(`<meta name="weblog-verification" content="${token}">`, token, 'meta')).toBe(true);
    expect(claimMarker(`<main><meta name="weblog-verification" content="${token}"></main>`, token, 'meta')).toBe(false);
    expect(claimMarker(`<main><h1>About</h1><p>weblog-verification: ${token}</p></main>`, token, 'about')).toBe(true);
    for (const attrs of ['id="comments"', 'class="wp-block-comments"', 'class="giscus"', 'itemprop="comment"', 'data-comment']) {
      expect(claimMarker(`<main><div ${attrs}><p>weblog-verification: ${token}</p></div></main>`, token, 'about')).toBe(false);
    }
    expect(claimMarker(`<main><h2>Replies</h2><p>weblog-verification: ${token}</p></main>`, token, 'about')).toBe(false);
    expect(claimMarker(`<script>weblog-verification: ${token}</script>`, token, 'about')).toBe(false);
    expect(claimMarker(`<main><div class="custom-widget"><p>weblog-verification: ${token}</p></div></main>`, token, 'about')).toBe(false);
    expect(claimMarker(`<main><p>Author introduction.</p><p>weblog-verification: ${token}</p></main>`, token, 'about')).toBe(false);
  });
  it('uses the pinned crawler, refuses cross-site redirect evidence and private addresses', async () => {
    const home = 'https://claim-proof.test/';
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      if (String(input).endsWith('/robots.txt')) return new Response('User-agent: *\nAllow: /');
      return new Response(`<meta name="weblog-verification" content="${token}">`);
    });
    expect(await verifySiteClaim(home, token, 'meta', { fetcher, delayMs: 250, resolveHost: async () => ['93.184.216.34'] })).toMatchObject(
      { proofUrl: home },
    );
    fetcher.mockImplementation(async (input) =>
      String(input).endsWith('/robots.txt')
        ? new Response('')
        : new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/' } }),
    );
    await expect(
      verifySiteClaim(home, token, 'meta', { fetcher, delayMs: 250, resolveHost: async () => ['93.184.216.34'] }),
    ).rejects.toThrow();
  });
  it('requires a home-advertised about page and an exact file body', async () => {
    const home = 'https://claim-about.test/';
    const routes: Record<string, string> = {
      [home]: '<a href="/about/">關於我</a>',
      [`${home}about/`]: `<main><p>weblog-verification: ${token}</p></main>`,
      [claimFileUrl(home, token)]: `weblog-verification: ${token}`,
    };
    const options = {
      delayMs: 250,
      resolveHost: async () => ['93.184.216.34'],
      fetcher: vi.fn(
        async (input: Parameters<typeof fetch>[0]) =>
          new Response(String(input).endsWith('/robots.txt') ? 'User-agent: *\nAllow: /' : routes[String(input)] || '', {
            status: String(input).endsWith('/robots.txt') || routes[String(input)] ? 200 : 404,
          }),
      ),
    };
    expect(await verifySiteClaim(home, token, 'about', options)).toMatchObject({ proofUrl: `${home}about/` });
    expect(await verifySiteClaim(home, token, 'file', options)).toMatchObject({ proofUrl: claimFileUrl(home, token) });
    routes[claimFileUrl(home, token)] = `404: ${claimFileUrl(home, token)}`;
    expect(await verifySiteClaim(home, token, 'file', options)).toBeNull();
  });
});
it('recognizes a Hawks-style hero without prescribed class names or three 我 characters', () => {
  const intro = '嗨早安，我是 Hawks！我喜歡寫程式、打擊樂跟動畫。這裡放一些學到的東西、參加活動的心得，還有平常的碎念和喜歡的作品。';
  const shell = `<head><title>hawks.tw</title></head><main><div class="home-hero-copy"><h1>Hawks.tw</h1><p>${intro}</p></div></main>`;
  expect(deterministicPersonalProof(personalHomepage(shell).evidence)).toBe(true);
  for (const wrapper of ['article', 'div class="post-list"', 'div class="user-profile"', 'div id="comments"']) {
    const tag = wrapper.split(' ')[0];
    expect(personalHomepage(`<${wrapper}>${shell}</${tag}>`).evidence.personal).toBe(false);
  }
});
