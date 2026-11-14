import StateNotice from '@/components/StateNotice';
import TopicMethodFallback from '@/components/TopicMethodFallback';

export default function NotFound() {
  return (
    <>
      <div className="mx-auto max-w-2xl py-10">
        <StateNotice
          headingLevel={1}
          title="找不到這個頁面"
          actions={[
            { href: '/', label: '回首頁', primary: true },
            { href: '/blogs/', label: '部落格目錄' },
            { href: '/topics/', label: '話題排行' },
          ]}
        >
          網址可能打錯了，或這個頁面已經移除。部落格與話題的網址偶爾會改名，可以從目錄或排行重新找到它。
        </StateNotice>
      </div>
      <TopicMethodFallback />
    </>
  );
}
