import type { FastifyInstance } from 'fastify';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { validatedOverride } from './contracts.ts';

const decode = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v);
export function registerAiRoutes(app: FastifyInstance, pool: Pool) {
  app.get<{ Params: { slug: string } }>('/api/blogs/:slug/inference', async (req, reply) => {
    const [[blog]] = await pool.query<RowDataPacket[]>("SELECT id FROM blogs WHERE slug=? AND status='verified'", [req.params.slug]);
    if (!blog) return reply.code(404).send({ error: 'not_found' });
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT task,result_json,coverage,model_alias,actual_model,policy,normalization_version,input_hash,updated_at FROM ai_results WHERE entity_type='blog' AND entity_id=? AND task='profile' AND status='ok' ORDER BY updated_at DESC,id DESC LIMIT 1",
      [blog.id],
    );
    const [[override]] = await pool.query<RowDataPacket[]>(
      "SELECT result_json,updated_at FROM ai_overrides WHERE entity_type='blog' AND entity_id=? AND task='profile'",
      [blog.id],
    );
    const row = rows[0];
    const overrideValue = override ? validatedOverride(override.result_json) : null;
    const value = overrideValue || (row ? decode(row.result_json) : null);
    const [topics] = await pool.query<RowDataPacket[]>(
      "SELECT p.id,p.title,COALESCE(o.result_json,a.result_json) result_json,CASE WHEN o.id IS NOT NULL THEN 'manual' ELSE a.coverage END coverage,COALESCE(o.updated_at,a.updated_at) updated_at,o.id override_id FROM posts p LEFT JOIN ai_results a ON a.id=(SELECT r.id FROM ai_results r WHERE r.entity_type='post' AND r.entity_id=p.id AND r.task='topics' AND r.status='ok' ORDER BY r.updated_at DESC,r.id DESC LIMIT 1) LEFT JOIN ai_overrides o ON o.entity_type='post' AND o.entity_id=p.id AND o.task='topics' WHERE p.blog_id=? AND (a.id IS NOT NULL OR o.id IS NOT NULL) ORDER BY p.published_at DESC,p.id DESC LIMIT 10",
      [blog.id],
    );
    return {
      label: overrideValue ? '人工覆寫' : 'AI 推定',
      profile: value,
      overridden: Boolean(overrideValue),
      provenance: row
        ? {
            coverage: row.coverage,
            modelAlias: row.model_alias,
            actualModel: row.actual_model,
            policy: row.policy,
            normalizationVersion: row.normalization_version,
            inputHash: row.input_hash,
            updatedAt: override?.updated_at || row.updated_at,
          }
        : null,
      topics: topics
        .filter((t) => !t.override_id || validatedOverride(t.result_json))
        .map((t) => ({
          postId: t.id,
          title: t.title,
          topics: decode(t.result_json).topics,
          coverage: t.coverage,
          updatedAt: t.updated_at,
          label: t.override_id ? '人工覆寫' : 'AI 推定',
        })),
    };
  });
}
