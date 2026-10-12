import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import SourceProfile from '@/components/SourceProfile';
import { getBlog } from '@/lib/api';
export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const blog = await getBlog((await params).slug);
  return { title: blog?.name ?? '找不到部落格', description: blog?.description ?? undefined };
}
export default async function BlogDetailPage({ params }: Props) {
  const blog = await getBlog((await params).slug);
  if (!blog) notFound();
  return <SourceProfile blog={blog} />;
}
