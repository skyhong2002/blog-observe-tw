import { load } from 'cheerio';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BlogGenresView, typedGenres, typedTags } from '@/components/BlogGenres';
import { BLOG_GENRES } from '../../app/src/blog-genre-vocabulary.ts';
import type { GenreState } from '../../app/src/blog-genres/resolve.ts';

const state: GenreState = {
  status: 'ready',
  items: [{ genre: 'food', label: '美食', source: 'ai', visible: true, agrees: 4, disagrees: 2, adminOverride: null }],
};
describe('blog genre SSR block', () => {
  it('shows provenance and public totals with a login prompt to logged-out readers', () => {
    const $ = load(renderToString(<BlogGenresView state={state} signedIn={false} loginUrl="/auth/google?next=blog" />));
    expect($('section').text()).toContain('AI 初判');
    expect($('section').text()).toContain('同意 4 · 不同意 2');
    expect($('a').text()).toContain('登入後');
    expect($('button,input').length).toBe(0);
    // Each genre links to the directory filtered by it.
    expect($('a[href="/blogs/?genre=food"]').text()).toBe('美食');
  });
  it("shows traffic's editor tags, with their own key, and never the words 類型 or 分類", () => {
    const editor: GenreState = {
      status: 'ready',
      items: [
        { genre: '個人', label: '個人', source: 'editor', visible: true, agrees: 0, disagrees: 0, adminOverride: null },
        ...state.items,
      ],
    };
    const $ = load(renderToString(<BlogGenresView state={editor} signedIn loginUrl="/auth/google" />));
    expect($('a[href="/blogs/?genre=%E5%80%8B%E4%BA%BA"]').text()).toBe('個人');
    expect($('li').first().text()).toContain('編輯');
    expect($('section').text()).not.toMatch(/類型|分類/);
  });
  it('allows logged-in readers to vote, withdraw and add any genre', () => {
    const $ = load(renderToString(<BlogGenresView state={state} signedIn votes={{ food: -1 }} loginUrl="/auth/google" />));
    expect($('a[href^="/auth"]').length).toBe(0);
    expect($('button[aria-pressed=true]').text()).toContain('已不同意（收回）');
    // A free-text box; its suggestions are the starting genres not already listed. No admin controls for readers.
    expect($('input[name=genre]').attr('placeholder')).toBe('新增標籤，例如：咖啡');
    expect($('#genre-add-suggestions option').length).toBe(Object.keys(BLOG_GENRES).length - 1);
    expect($('#genre-add-suggestions option[value=美食]').length).toBe(0);
    expect($('button[type=submit]').text()).toBe('新增');
    expect($('section').text()).not.toContain('管理員覆寫');
  });
  it('keeps admin set/hide/release apart, in its own collapsed block, while hidden candidates and their counts stay visible', () => {
    const hidden: GenreState = { status: 'ready', items: [{ ...state.items[0], source: 'admin', visible: false, adminOverride: 'hide' }] };
    const $ = load(renderToString(<BlogGenresView state={hidden} signedIn admin loginUrl="/auth/google" />));
    expect($('li').text()).toContain('未顯示（管理員覆寫）');
    const block = $('details');
    expect(block.find('summary').text()).toBe('管理員覆寫');
    expect(block.find('input[name=genre]').length).toBe(1);
    expect(
      block
        .find('button')
        .map((_, el) => $(el).text())
        .get(),
    ).toEqual(['指定顯示', '隱藏', '解除覆寫']);
  });
  it('an empty classification says nothing: signed out it offers sign-in, signed in the picker', () => {
    const empty: GenreState = { status: 'ready', items: [] };
    const out = load(renderToString(<BlogGenresView state={empty} signedIn={false} loginUrl="/auth/google" />));
    expect(out('section').text()).toBe('標籤登入後投票或新增標籤 →');
    const signed = load(renderToString(<BlogGenresView state={empty} signedIn loginUrl="/auth/google" />));
    expect(signed('section').text()).not.toContain('尚未分類');
    expect(signed('input[name=genre]').length).toBe(1);
  });
  it('distinguishes an unavailable read from a successfully empty classification', () => {
    const html = renderToString(<BlogGenresView state={{ status: 'unavailable', items: [] }} signedIn loginUrl="/auth/google" />);
    expect(html).toContain('標籤資料暫時無法使用');
    expect(html).not.toContain('尚未分類');
    expect(html).not.toContain('<input');
  });
  it('reads what a reader typed as genre keys: separators split, starting names fold, junk drops', () => {
    expect(typedGenres('美食、咖啡, ＃Single  Origin;;  ###')).toEqual(['food', '咖啡', 'single origin']);
    expect(typedGenres('咖啡,咖啡')).toEqual(['咖啡']);
    expect(typedGenres('  ')).toEqual([]);
    // A proposal keeps the reader's spelling; the gateway folds it the same way.
    expect(typedTags('美食, ＃Single  Origin')).toEqual([
      { key: 'food', text: '美食' },
      { key: 'single origin', text: '＃Single  Origin' },
    ]);
  });
});
