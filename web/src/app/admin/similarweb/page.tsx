import AdminConsole from '@/components/admin/AdminConsole';
import { privatePageMetadata } from '@/lib/seo';
export const dynamic = 'force-dynamic';
export const metadata = privatePageMetadata('Similarweb · 管理後台');
export default function AdminSimilarwebPage() {
  return <AdminConsole section="similarweb" />;
}
