'use client';

// The home topic sections when the server's ranking read failed: the browser reads it itself (home-topics-browser.ts).
// The list keeps its placeholder while it waits and says so with a retry if that read fails too; the cloud is
// decoration and stays out.

import { SectionUnavailable } from '@/components/SectionBoundary';
import type { CloudVisual } from '@/lib/tag-visuals';
import { topicCloudWords } from '@/lib/topic-cloud';
import HomeTopicList, { HomeTopicsPending } from './HomeTopicList';
import styles from './home.module.css';
import { useHomeTopics } from './home-topics-browser';
import { MastheadWords } from './MastheadCloud';

export function HomeTopicRankingFromBrowser() {
  const [load, retry] = useHomeTopics();
  if (load.status === 'ready') return <HomeTopicList topics={load.data} />;
  if (load.status === 'pending') return <HomeTopicsPending />;
  return <SectionUnavailable label="最近共同話題" className={styles.notice} onRetry={retry} />;
}

export function HomeTopicCloudFromBrowser({ visuals }: { visuals: Array<[string, CloudVisual]> }) {
  const [load] = useHomeTopics();
  if (load.status !== 'ready') return null;
  const words = topicCloudWords(load.data.cloudItems ?? load.data.items, '30', 30, new Map(visuals));
  return words.length ? <MastheadWords words={words} /> : null;
}
