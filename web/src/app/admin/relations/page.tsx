import AdminConsole from '@/components/admin/AdminConsole';
import { privatePageMetadata } from '@/lib/seo';
export const dynamic = 'force-dynamic';
export const metadata = privatePageMetadata('連結關係 · 管理後台');
export default function AdminRelationsPage() {
  return <AdminConsole section="relations" />;
}
