import { load } from 'cheerio';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BlogGenresView } from '@/components/BlogGenres';
import type { GenreState } from '../../app/src/blog-genres/resolve.ts';

const state: GenreState = {
  status: 'ready',
  items: [{ genre: 'food', source: 'ai', visible: true, agrees: 4, disagrees: 2, adminOverride: null }],
};
describe('blog genre SSR block', () => {
  it('shows provenance and public totals with a login prompt to logged-out readers', () => {
    const $ = load(renderToString(<BlogGenresView state={state} signedIn={false} loginUrl="/auth/google?next=blog" />));
    expect($('section').text()).toContain('AI 初判');
    expect($('section').text()).toContain('同意 4 · 不同意 2');
    expect($('a').text()).toContain('登入後');
    expect($('button,select').length).toBe(0);
  });
  it('allows logged-in readers to vote, withdraw and propose from the fixed vocabulary', () => {
    const $ = load(renderToString(<BlogGenresView state={state} signedIn votes={{ food: -1 }} loginUrl="/auth/google" />));
    expect($('a').length).toBe(0);
    expect($('button[aria-pressed=true]').text()).toContain('已不同意（收回）');
    expect($('select[name=genre] option').length).toBe(12);
    expect($('form').text()).toContain('提議並同意');
    expect($('section').text()).not.toContain('解除管理員覆寫');
  });
  it('shows admin set/hide/release while keeping hidden candidates and their counts visible', () => {
    const hidden: GenreState = { status: 'ready', items: [{ ...state.items[0], source: 'admin', visible: false, adminOverride: 'hide' }] };
    const $ = load(renderToString(<BlogGenresView state={hidden} signedIn admin loginUrl="/auth/google" />));
    expect($('section').text()).toContain('管理員覆寫');
    expect($('section').text()).toContain('未顯示');
    expect($('select[name=action] option').length).toBe(3);
    expect($('button').text()).toContain('解除管理員覆寫');
  });
  it('distinguishes an unavailable read from a successfully empty classification', () => {
    const html = renderToString(<BlogGenresView state={{ status: 'unavailable', items: [] }} signedIn loginUrl="/auth/google" />);
    expect(html).toContain('類型資料暫時無法使用');
    expect(html).not.toContain('尚未分類');
    expect(html).not.toContain('<form');
  });
});
