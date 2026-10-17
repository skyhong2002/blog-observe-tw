import AdminConsole from '@/components/admin/AdminConsole';
import { privatePageMetadata } from '@/lib/seo';
export const dynamic = 'force-dynamic';
export const metadata = privatePageMetadata('帳號 · 管理後台');
export default function AdminAccountsPage() {
  return <AdminConsole section="accounts" />;
}
