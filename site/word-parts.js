import { h } from './dom.js';
import { contributorRoute, tagRoute } from './logic.js';
import { t, tagLabel } from './strings.js';

// Small pieces that show a word's readings and its tag / contributor links, shared by the cards,
// the search results and the homepage.

// A word's Tâi-lô: hidden with the 台羅 switch (class tl), unless the word has no Hanji, when it is
// the word itself.
export const tlSpan = (row) => h('span', { class: row.hanji ? 'result-tl tl' : 'result-tl' }, row.tl);

// Pe̍h-ōe-jī (only where it differs) and 方音符號, which the sidebar's 選單顯示 switches hide
// through <html data-poj / data-tps>.
export const readings = (row) => [row.poj ? h('span', { class: 'poj' }, row.poj) : null, row.tps ? h('span', { class: 'tps' }, row.tps) : null];

// One tag as a link to its cards page, drawn as #label (the # from styles.css).
export const tagLink = (name, reading = null) => h('a', { class: 'tag', href: tagRoute(name), title: reading }, tagLabel(name));

// A card's contributor byline: names as plain links to their cards pages, joined as a list.
export const contributorLinks = (names) => names.flatMap((name, i) => [i > 0 ? t('list.separator') : null, h('a', { class: 'person', href: contributorRoute(name) }, name)]).filter(Boolean);
