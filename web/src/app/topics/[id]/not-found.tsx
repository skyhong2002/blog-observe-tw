import StateNotice from '@/components/StateNotice';

/** A topic that is not (or no longer) in the public ranking; still an HTTP 404. */
export default function TopicNotFound() {
  return (
    <div className="mx-auto max-w-2xl py-10">
      <StateNotice
        headingLevel={1}
        title="找不到這個話題"
        actions={[
          { href: '/topics/', label: '回話題排行', primary: true },
          { href: '/topics/trending/', label: '看升溫話題' },
        ]}
      >
        話題會隨部落格最近寫的內容變動；這個詞可能已經沒有足夠的部落格在寫，或網址打錯了。
      </StateNotice>
    </div>
  );
}
