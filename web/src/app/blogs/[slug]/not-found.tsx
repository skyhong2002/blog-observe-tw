import StateNotice from '@/components/StateNotice';

/** A blog the directory does not (or no longer) publicly lists; still an HTTP 404. */
export default function BlogNotFound() {
  return (
    <div className="mx-auto max-w-2xl py-10">
      <StateNotice
        headingLevel={1}
        title="找不到這個部落格"
        actions={[
          { href: '/blogs/', label: '回部落格目錄', primary: true },
          { href: '/queue/#add', label: '推薦這個部落格' },
        ]}
      >
        它可能還沒被收錄、已經搬家，或站主要求移除。可以在目錄用名稱或網址搜尋，或把它推薦給我們。
      </StateNotice>
    </div>
  );
}
