'use client';

import { useSearchParams } from 'next/navigation';
import StateNotice from '@/components/StateNotice';

/** The reason the gateway's /auth/google/callback sent the reader back here, if any. */
export default function LoginError() {
  const error = useSearchParams().get('error');
  if (!error) return null;
  const cancelled = error === 'cancelled';
  return (
    <StateNotice tone={cancelled ? 'notice' : 'error'} role="status" title={cancelled ? '你取消了 Google 登入' : '登入沒有完成'}>
      {cancelled ? '沒關係，準備好了再按一次下面的按鈕就行。' : 'Google 沒有把登入結果交回來，可能是逾時或瀏覽器擋了 Cookie。請再試一次。'}
    </StateNotice>
  );
}
