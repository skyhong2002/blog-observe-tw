import DiscoveryReview from '@/components/discovery-review';

export const dynamic = 'force-dynamic';

export default function DiscoveryReviewPage() {
  return (
    <section className="section-block">
      <div className="page-heading">
        <p className="eyebrow">OPERATOR</p>
        <h1>部落格來源候選審核</h1>
        <p>候選來源保留發現頁面、RSS 偵測與 blogroll 證據；批次決定會留下稽核紀錄。</p>
      </div>
      <DiscoveryReview />
    </section>
  );
}
