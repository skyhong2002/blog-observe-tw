/**
 * Source contracts for the homepage's compact reads and the topic pages' dark
 * secondary text. Behaviour of the reads themselves (paths, contracts, no-store)
 * is in public-cache.test.ts and public-contracts.test.ts; the topic list's
 * server markup is in home-topics-render.spec.tsx.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const SRC = join(import.meta.dirname, '../src');
const source = (path: string) => readFileSync(join(SRC, path), 'utf8');

test('home: only the compact overview is awaited; the topic list streams in its own Suspense', () => {
  const page = source('app/page.tsx');
  assert.match(page, /^export const dynamic = 'force-dynamic';$/m);
  assert.match(page, /^import \{ homeOverview \} from '@\/lib\/public-api';$/m);
  assert.equal(page.match(/\bawait\b/g)?.length, 1, 'one await: the overview');
  assert.match(page, /const data = await homeOverview\(\);/);
  // No topic read, no waiting on it, no other overview.
  assert.doesNotMatch(page, /Promise\.all|topicsApiPath|homeTopicsApiPath|publicJson|\boverview\(\)|\/api\/topics/);
  assert.match(page, /<Suspense fallback=\{<HomeTopicsPending \/>\}>\s*<HomeTopicRanking \/>\s*<\/Suspense>/);
  assert.equal(page.match(/<HomeTopicRanking\b/g)?.length, 1);
  // The left column keeps its heading, full-ranking link and method line around the streamed list.
  assert.match(
    page,
    /<h2>最近共同話題<\/h2>\s*<Link href="\/topics\/">完整排行 →<\/Link>\s*<\/div>\s*<Suspense[\s\S]*?<\/Suspense>\s*<p className=\{styles\.muted\}>近 30 天；同站貢獻逐次遞減，至少兩站參與。/,
  );
  assert.match(page, /^import Link from '@\/components\/NoPrefetchLink';$/m);
  assert.doesNotMatch(page, /^'use client';/m);
});

test('home: the topic list reads view=home itself, lets failures throw, and keeps nothing across requests', () => {
  const list = source('app/_home/HomeTopics.tsx');
  assert.doesNotMatch(list, /^'use client';/m);
  assert.match(list, /const topics = await publicJson<HomeTopics>\(homeTopicsApiPath\('30'\)\);/);
  // A failed or malformed read is the error boundary's, never an empty list.
  assert.doesNotMatch(list, /\btry\b|\.catch\(|publicJsonOrNull|暫時無法讀取/);
  assert.doesNotMatch(list, /new Map|unstable_cache|\bcache\(|revalidate|data-analytics|sendEvent|gtag/);
  assert.match(list, /^import Link from '@\/components\/NoPrefetchLink';$/m);
  assert.match(list, /<Link \{\.\.\.topicLink\(tag\.id, tag\.canonicalPath, '30'\)\}>/);
  assert.match(list, /最近 30 天尚無足夠的共同話題。/);
  // public-api.ts: the reads are React's per-request cache over no-store reads, the full overview unchanged.
  const api = source('lib/public-api.ts');
  assert.match(api, /const read = cache\(\(path: string\) => readPublic\(gatewayOrigin\(\), path\)\);/);
  assert.match(api, /export const overview = \(\) => publicJson<Overview>\('\/api\/overview'\);/);
  assert.match(api, /export const homeOverview = \(\) => publicJson<HomeOverview>\(HOME_OVERVIEW_PATH\);/);
  assert.doesNotMatch(api, /unstable_cache|revalidate|new Map/);
  // The full pages keep the full reads.
  for (const page of ['app/ranking/page.tsx', 'app/articles/page.tsx', 'app/tags/page.tsx'])
    assert.match(source(page), /await overview\(\)/, page);
  assert.doesNotMatch(source('components/public/TopicRanking.tsx'), /view=home|homeTopicsApiPath/);
});

test('clouds: drawn from the local topic ranking only, one shared path each, streamed without holding the masthead', () => {
  const page = source('app/page.tsx');
  // The mark/tagline render with the overview; the cloud is a Suspense slot, not awaited by the page.
  assert.match(
    page,
    /<MastheadCloud\s+edition=\{updated\}\s+cloud=\{\s*<Suspense fallback=\{null\}>\s*<HomeTopicCloud \/>\s*<\/Suspense>\s*\}\s*\/>/,
  );
  assert.doesNotMatch(page, /data\.tags|data\.posts|NewsImage/);
  const masthead = source('app/_home/MastheadCloud.tsx');
  assert.doesNotMatch(masthead, /\/tags\/\?tag=|Overview\['tags'\]|postCount|blogCount|publicJson|await/);
  // Homepage cloud and ranking read the identical path, so public-api.ts's per-request cache makes one read.
  const cloud = source('app/_home/HomeTopicCloud.tsx');
  assert.match(cloud, /const topics = await publicJson<HomeTopics>\(homeTopicsApiPath\('30'\)\);/);
  assert.match(source('app/_home/HomeTopics.tsx'), /publicJson<HomeTopics>\(homeTopicsApiPath\('30'\)\)/);
  assert.doesNotMatch(cloud, /\btry\b|\.catch\(|data\.tags|\/tags\//);
  // Profile: list and cloud share blogTopicsApiPath; the client profile only receives a server slot.
  assert.match(source('components/BlogTopicCloud.tsx'), /publicJsonOrNull<Topics>\(blogTopicsApiPath\(slug\)\)/);
  assert.match(source('components/BlogTopics.tsx'), /publicJsonOrNull<Topics>\(blogTopicsApiPath\(slug\)\)/);
  const profile = source('components/SourceProfile.tsx');
  assert.doesNotMatch(profile, /MediaWordCloud|publicJson|blogTopicsApiPath/);
  assert.match(
    source('app/blogs/[slug]/page.tsx'),
    /cloud=\{\s*<Suspense fallback=\{<MediaWordCloudPending \/>\}>\s*<BlogTopicCloud slug=\{blog\.slug\} \/>\s*<\/Suspense>\s*\}/,
  );
  for (const path of ['components/MediaWordCloud.tsx', 'lib/topic-cloud.ts'])
    assert.doesNotMatch(source(path), /\/tags\/\?tag=|postCount|Tag\b/, path);
});

/** Every class string that sets text-zinc-500 also sets a dark text colour (dark:text-zinc-400 where it was missing). */
test('theme: topic and history secondary text has a dark variant', () => {
  for (const path of [
    'components/public/TopicDetail.tsx',
    'components/public/TopicRanking.tsx',
    'components/BlogTopics.tsx',
    'app/_home/HomeTopics.tsx',
  ]) {
    const text = source(path);
    for (const match of text.matchAll(/text-zinc-500/g)) {
      const start = Math.max(text.lastIndexOf('"', match.index), text.lastIndexOf("'", match.index), text.lastIndexOf('`', match.index));
      const end = text.slice(match.index).search(/["'`]/) + match.index;
      const classes = text.slice(start + 1, end);
      assert.match(classes, /(^|\s)dark:text-zinc-\d+(\s|$)/, `${path}: "${classes}"`);
    }
  }
  // The ones added here are 400 (7.55:1 on the dark background); none was set to another shade.
  assert.ok(source('components/public/TopicDetail.tsx').includes("'text-zinc-500 dark:text-zinc-400'"));
  assert.ok(source('components/public/TopicRanking.tsx').includes("' text-xs text-zinc-500 dark:text-zinc-400'"));
  assert.doesNotMatch(source('components/public/TopicDetail.tsx'), /text-zinc-500 dark:text-zinc-400 dark:text-/);
});
