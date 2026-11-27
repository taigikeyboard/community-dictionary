import { h } from './dom.js';
import { icon } from './icons.js';

// The frame every page is drawn into: the view, the site title, a page's heading and its back button.

export const view = document.getElementById('view');
export const SITE_TITLE = '台語齒盤群眾辭典';

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
  const button = h('button', { class: 'back-link', type: 'button' }, icon('back'), '頂一頁');
  button.addEventListener('click', () => {
    if (navigatedInside) history.back();
    else location.hash = '#/';
  });
  return button;
}
