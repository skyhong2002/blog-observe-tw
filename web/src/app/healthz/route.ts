export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ ok: true, service: 'blog-observe-web', version: 'next' });
}
