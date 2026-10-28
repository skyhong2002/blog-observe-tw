import { renderToString } from 'react-dom/server';
import { expect, test } from 'vitest';
import { ClaimInstructions } from '../src/components/SiteParticipation';

test('verification instructions display the token as text, never an active head tag', () => {
  const challenge = {
    id: 1,
    home: 'https://example.test/',
    method: 'meta',
    token: 'wt_test',
    marker: '<meta name="weblog-verification" content="wt_test">',
    fileUrl: null,
    expiresAt: '2026-10-29T00:00:00Z',
  };
  const html = renderToString(<ClaimInstructions challenge={challenge} busy={false} onVerify={() => {}} />);
  expect(html).toContain('&lt;meta');
  expect(html).not.toContain('<meta name="weblog-verification"');
  expect(html).toContain('我已發布，驗證網站');
  expect(html).toContain('不包含帳號或 Email');
});
test('file and about proofs have distinct instructions and busy verification cannot be submitted again', () => {
  const base = {
    id: 1,
    home: 'https://example.test/blog/',
    token: 'wt_test',
    marker: 'weblog-verification: wt_test',
    expiresAt: '2026-10-29T00:00:00Z',
  };
  const file = renderToString(
    <ClaimInstructions
      challenge={{ ...base, method: 'file', fileUrl: `${base.home}weblog-verification-wt_test.txt` }}
      busy
      onVerify={() => {}}
    />,
  );
  expect(file).toContain('檔案網址：');
  expect(file).toContain('https://example.test/blog/weblog-verification-wt_test.txt');
  expect(file).toContain('disabled');
  const about = renderToString(
    <ClaimInstructions challenge={{ ...base, method: 'about', fileUrl: null }} busy={false} onVerify={() => {}} />,
  );
  expect(about).toContain('第一個獨立段落');
  expect(about).toContain('請勿放在留言區');
});
