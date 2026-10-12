import { createDb } from '../app/src/db/client.ts';
import { backfillPublicRoutes, backfillTopicRouteAliases } from '../app/src/seo/page-routes.ts';

const args = process.argv.slice(2);
const option = (key: string) => {
  const index = args.indexOf(key);
  return index < 0 ? undefined : args[index + 1];
};
const kind = option('--kind'),
  afterId = option('--after-id'),
  limit = Number(option('--limit') ?? 100);
if (!['blog', 'topic', 'topic-alias'].includes(kind ?? '') || !Number.isSafeInteger(limit) || limit < 1 || limit > 500)
  throw Error(
    'usage: node --env-file=<private-env> tools/backfill-public-routes.ts --kind blog|topic|topic-alias [--after-id <cursor>] [--limit 100] --apply',
  );
if (!args.includes('--apply')) {
  console.log(
    JSON.stringify({
      status: 'dry-run',
      kind,
      limit,
      operation: 'bounded public HTML route registry only; API IDs, favicon keys and source data remain unchanged',
      applyRequired: true,
    }),
  );
} else {
  const store = createDb();
  try {
    const result =
      kind === 'topic-alias'
        ? await backfillTopicRouteAliases(store.pool, { afterId, limit })
        : await backfillPublicRoutes(store.pool, { kind: kind as 'blog' | 'topic', afterId, limit });
    console.log(JSON.stringify(result));
  } finally {
    await store.close();
  }
}
