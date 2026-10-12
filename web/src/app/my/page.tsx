import ApiKeyManager from '@/components/ApiKeyManager';
import ReaderList from '@/components/ReaderList';
import SectionTabs from '@/components/SectionTabs';
import { exampleUrl, loadSpec, operations } from '@/lib/openapi-spec';
import { privatePageMetadata } from '@/lib/seo';

export const metadata = privatePageMetadata('我的閱讀');

// A public GET from the generated spec for the API key curl example; the page
// itself stays a static shell and loads every private value in the browser.
function keyExample(): string {
  const example = operations(loadSpec())
    .filter((e) => e.method === 'GET' && !e.path.endsWith('openapi.json'))
    .map(exampleUrl)
    .find((url) => url !== null);
  if (!example) throw new Error('data/openapi.json has no public GET example for the API key section');
  return example;
}

export default function MyPage() {
  return (
    <div className="space-y-5 pb-8">
      <header>
        <h1 className="text-2xl font-semibold">我的閱讀</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">管理追蹤的部落格，把閱讀清單帶回自己的閱讀器。</p>
      </header>
      <SectionTabs
        label="我的閱讀"
        tabs={[
          { href: '/my/', label: '追蹤清單', current: true },
          { href: '/me/feed.xml', label: '個人 RSS' },
          { href: '/me/opml', label: '匯出 OPML' },
        ]}
      />
      <ReaderList />
      <ApiKeyManager example={keyExample()} />
    </div>
  );
}
