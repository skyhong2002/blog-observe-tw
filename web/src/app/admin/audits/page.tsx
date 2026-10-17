import AdminConsole from '@/components/admin/AdminConsole';
import { privatePageMetadata } from '@/lib/seo';
export const dynamic = 'force-dynamic';
export const metadata = privatePageMetadata('稽核紀錄 · 管理後台');
export default function AdminAuditsPage() {
  return <AdminConsole section="audits" />;
}
