import AdminConsole from '@/components/admin/AdminConsole';
import { privatePageMetadata } from '@/lib/seo';
export const dynamic = 'force-dynamic';
export const metadata = privatePageMetadata('候選來源 · 管理後台');
export default function AdminPage() {
  return <AdminConsole section="discovery" />;
}
