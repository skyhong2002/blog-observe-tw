import AdminConsole from '@/components/admin/AdminConsole';
import { privatePageMetadata } from '@/lib/seo';
export const dynamic = 'force-dynamic';
export const metadata = privatePageMetadata('部落格 · 管理後台');
export default function AdminBlogsPage() {
  return <AdminConsole section="blogs" />;
}
