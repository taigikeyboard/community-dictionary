import { currentUser } from './account.js';
import { cardList, closeWordTip, openWordTip } from './cards.js';
import { loadItaigiIndex, loadRows, loadStats, loadTagMap } from './data.js';
import { h } from './dom.js';
import { parseRoute, wordsByContributor, wordsSpelled, wordsWithTag, wordTitle } from './logic.js';
import { backButton, hero, noteNavigation, pageTitle, view } from './page.js';
import { renderEdit, renderMine } from './mine-page.js';
import { searchBox } from './search-box.js';
import { initSettings } from './settings.js';
import { initSidebar } from './sidebar.js';
import { storySections } from './story.js';
import { HTML_LANG, language, setLanguage, t, tagLabel } from './strings.js';
import { renderSubmit } from './submit-page.js';
import { tagMap } from './tag-map.js';
import { TAGS } from './tags.js';
import { tagLink } from './word-parts.js';

// The router and startup: the homepage (tag bubble map and statistics), the 揣詞 search page and
// the card pages for a tag, a contributor or a word; the submission form is submit-page.js.

function renderHome() {
  document.title = pageTitle();
  view.replaceChildren(
    // the title, then the tag bubbles (what the site is says the announcement bar above)
    hero(t('site.title')),
    tagMap(loadTagMap, () => h('div', { class: 'tags' }, TAGS.map((tag) => tagLink(tag.name, tag.tl))), {
      onWord: openWordTip,
      // a zoomed-in tag shows words whose cards need iTaigi: start loading it (1.5 MB) now
      onZoomIn: () => loadItaigiIndex().catch(() => {}),
    }),
    // scrolling down: the statistics, section by section
    storySections(loadStats),
  );
}

// The 揣詞 page: a search box of its own under the title; its menu lists and links the words.
function renderSearch() {
  document.title = pageTitle(t('search.title'));
  view.replaceChildren(backButton(), hero(t('search.title')), searchBox());
}

// A cards page: `title` over a lead line (a tag's Tâi-lô), then the words `pick(rows, itaigi)`
// chooses from both sources as cards; a failed load says so in place of the cards. Without
// `headword` (the word page, whose title already names the word) the list is the word page's own.
function renderCards(title, lead, pick, { headword = true } = {}) {
  document.title = pageTitle(title);
  const list = h('div', { class: headword ? 'cards' : 'cards cards-word' });
  view.replaceChildren(backButton(), hero(title, lead, { isReading: true }), list);
  // the session decides which cards offer 修改 (the contributor's own words)
  Promise.all([loadRows(), loadItaigiIndex(), currentUser()])
    .then(([rows, itaigi, user]) => cardList(list, pick(rows, itaigi), { headword, user }))
    .catch(() => list.replaceWith(h('p', { class: 'empty' }, t('data.loadError'))));
}

// A tag's page: every word carrying it.
const renderTag = (tag) =>
  renderCards(tagLabel(tag), TAGS.find((listed) => listed.name === tag)?.tl, (rows, itaigi) => wordsWithTag(rows, itaigi, tag));

// A contributor's page: every word they gave.
const renderContributor = (name) => renderCards(name, null, (rows, itaigi) => wordsByContributor(rows, itaigi, name));

// A word's page: its cards from each source, under the word itself.
const renderWord = (hanji, tl) =>
  renderCards(wordTitle({ hanji, tl }), null, (rows, itaigi) => wordsSpelled(rows, itaigi, hanji, tl), { headword: false });

// Hash routes (logic.js parseRoute): the homepage at #/ and any unknown hash, the 揣詞 page at
// #/search, the form at #/submit, 我貢獻 ê 詞 at #/mine, 修改 at #/edit/<login>/<key>, cards at #/tag/<name>, #/contributor/<name> and
// #/word/<hanji>/<tl>.
function route() {
  const target = parseRoute(location.hash);
  // the homepage widens the column for the bubble map (styles.css main[data-page="home"])
  view.dataset.page = target.page;
  if (target.page === 'submit') renderSubmit();
  else if (target.page === 'search') renderSearch();
  else if (target.page === 'mine') renderMine();
  else if (target.page === 'edit') renderEdit(target.login, target.key);
  else if (target.page === 'tag') renderTag(target.tag);
  else if (target.page === 'contributor') renderContributor(target.name);
  else if (target.page === 'word') renderWord(target.hanji, target.tl);
  else renderHome();
}

// "/" anywhere outside a text field jumps to the 揣詞 page's search box (after kautian-mirror)
document.addEventListener('keydown', (event) => {
  if (event.key !== '/' || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) return;
  if (event.target.closest('input, textarea, select, [contenteditable]')) return;
  const target = view.querySelector(':scope > .search input');
  if (!target) return;
  event.preventDefault();
  target.focus();
});

// The page's fixed text (index.html marks it with data-i18n="key", or data-i18n-<attribute>="key"
// for an attribute) and <html lang> in the chosen language.
function translateStatic() {
  document.documentElement.lang = HTML_LANG[language()];
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-aria-label]')) el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel));
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.setAttribute('title', t(el.dataset.i18nTitle));
}

// The bar's 你好！ @login, once the session says who is signed in; blank while signed out.
let signedIn = null;
const greeting = document.querySelector('.account-greeting');
const showGreeting = () => {
  greeting.textContent = signedIn ? t('account.greeting', { login: signedIn.login }) : '';
};

setLanguage(document.documentElement.dataset.lang);
translateStatic();
currentUser().then((user) => {
  signedIn = user;
  showGreeting();
});
// a new language redraws the current page in it (the reader stays where they are)
initSettings(document.getElementById('settings'), (settings) => {
  if (settings.lang === undefined || settings.lang === language()) return;
  setLanguage(settings.lang);
  translateStatic();
  showGreeting();
  closeWordTip();
  route();
});
initSidebar(document.querySelectorAll('button[aria-controls="sidebar"]'), document.getElementById('sidebar'));

window.addEventListener('hashchange', () => {
  noteNavigation();
  closeWordTip();
  route();
  window.scrollTo(0, 0);
  // the 揣詞 page puts the reader straight in its box
  const pageSearch = view.querySelector(':scope > .search input');
  if (pageSearch) return pageSearch.focus({ preventScroll: true });
  // the focused link is replaced along with the page, so focus moves to the new heading instead of
  // falling back to <body>, keeping keyboard and screen-reader users in place
  const heading = view.querySelector('h1');
  heading.setAttribute('tabindex', '-1');
  heading.focus({ preventScroll: true });
});
route();
