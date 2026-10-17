import AdminConsole from '@/components/admin/AdminConsole';
import { privatePageMetadata } from '@/lib/seo';
export const dynamic = 'force-dynamic';
export const metadata = privatePageMetadata('簡介與標籤 · 管理後台');
export default function AdminOverridesPage() {
  return <AdminConsole section="overrides" />;
}
