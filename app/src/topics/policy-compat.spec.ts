import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { normalizationProfile } from './policy.ts';

const inspect = (enabled: string | undefined) =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
  const p = await import('./app/src/topics/policy.ts');
  const r = await import('./app/src/topics/routes.ts');
  console.log(JSON.stringify({normalization:p.NORMALIZATION_VERSION, policy:p.POLICY_VERSION,
    matcher:p.MATCHER_VERSION, normalized:p.normalizeTerm('Ｔ\\u200bＰBL'),
    display:p.displayTerm('  TPBL  '), evidence:r.evidence(), metadata:r.matchingPolicy}));
`,
      ],
      {
        cwd: new URL('../../../', import.meta.url),
        env: { ...process.env, NODE_ENV: 'test', BLOG_TOPIC_FORMAT_NORMALIZATION_ENABLED: enabled ?? '' },
        encoding: 'utf8',
      },
    ),
  );

describe('persisted topic namespace compatibility', () => {
  it('defaults to the real published legacy pair in a fresh process, including SQL and public metadata', () => {
    expect(process.versions.unicode).toBe('17.0');
    for (const enabled of [undefined, 'false', 'TRUE']) {
      const result = inspect(enabled);
      expect(result.policy).toBe('topic-policy-v3:25670024a3b758518aa0895b6ca6ebc0d1a4e6540a48380d0aeade56fe703475');
      expect(result.matcher).toBe('topic-matcher-v3:4fbe490ef931407618f96c9ae90aec7cef585a8b4c55de118e9c5df98bba16e5');
      expect(result.normalization).toBe('nfkc-lower-en-US-unicode-17.0');
      expect(result.normalized).toBe('t\u200bpbl');
      expect(result.display).toBe('  TPBL  ');
      expect(result.evidence).toContain(`i.matcher_version='${result.matcher}'`);
      expect(result.evidence).toContain(`t.policy_version='${result.policy}'`);
      expect(result.metadata).toMatchObject({ version: result.matcher, policyVersion: result.policy });
    }
  });
  it('keeps the format-cleanup algorithm and its distinct exact namespace together', () => {
    const result = inspect('true');
    expect(result.policy).toBe('topic-policy-v3:b70ade11f5c3cc7c5d88f36cc2e63c754beb04e87f5beee5bc25b8a5624b5c3f');
    expect(result.matcher).toBe('topic-matcher-v3:ea4f7c2b5660f0b7585faa318c43fcca01dfeb6dbfdfd168beff81fa73e09244');
    expect(result.normalized).toBe('tpbl');
    expect(result.display).toBe('TPBL');
    expect(result.evidence).toContain(`i.matcher_version='${result.matcher}'`);
    expect(result.evidence).not.toContain('4fbe490ef931');
  });
  it('selects one immutable profile and rejects premature production opt-in', () => {
    const env = { BLOG_TOPIC_FORMAT_NORMALIZATION_ENABLED: 'false', NODE_ENV: 'production' };
    const profile = normalizationProfile(env);
    env.BLOG_TOPIC_FORMAT_NORMALIZATION_ENABLED = 'true';
    expect(Object.isFrozen(profile)).toBe(true);
    expect(profile.normalize('T\u200bPBL')).toBe('t\u200bpbl');
    expect(() => normalizationProfile(env)).toThrow('topic_format_normalization_not_ready_for_production');
    expect(normalizationProfile({ ...env, NODE_ENV: 'test' }).normalize('T\u200bPBL')).toBe('tpbl');
  });
});
