import { h } from './dom.js';
import { icon } from './icons.js';
import { t } from './strings.js';

// The frame every page is drawn into: the view, the site title, a page's heading and its back button.

export const view = document.getElementById('view');
// the window title: a page's name before the site's, or the site's alone
export const pageTitle = (name) => (name ? `${name} · ${t('site.title')}` : t('site.title'));

// a page's title, and a lead line under it (a tag's Tâi-lô, `isReading`, follows the 台羅 switch)
export const hero = (title, lead, { isReading = false } = {}) =>
  h('header', { class: 'hero' }, h('h1', {}, title), lead ? h('p', { class: isReading ? 'tl' : null }, lead) : null);

// whether the reader has moved between this site's pages since it loaded (the back button can then
// step back through them); app.js marks it on the first hashchange
let navigatedInside = false;
export const noteNavigation = () => {
  navigatedInside = true;
};

// The 「‹ 頂一頁」 button above a subpage's title (the top bar has no links): back to the page the reader
// came from on this site, or the homepage when the page was opened directly.
export function backButton() {
  const button = h('button', { class: 'back-link', type: 'button' }, icon('back'), t('nav.back'));
  button.addEventListener('click', () => {
    if (navigatedInside) history.back();
    else location.hash = '#/';
  });
  return button;
}
