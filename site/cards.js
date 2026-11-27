import { ACCENT_OTHER } from '../lib/entry.js';
import { loadItaigiIndex, loadRows } from './data.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { wordLabel, wordRoute, wordsSpelled, wordTitle } from './logic.js';
import { pageTitle } from './page.js';
import { listJoin, t } from './strings.js';
import { TAG_NAMES } from './tags.js';
import { contributorLinks, readings, tagLink, tlSpan } from './word-parts.js';

// Word cards: one card with its copy / share buttons, a paged list of them, and the card a word
// bubble opens on the homepage.

const unique = (values) => [...new Set(values.filter((v) => v !== ''))];

// How long a card button shows its check mark after copying.
const COPIED_MS = 1500;
// Screen readers do not reliably read a focused button's changed label; the page's status line
// (index.html) says it aloud.
const statusLine = document.getElementById('status');

const setLabel = (button, label) => {
  button.title = label;
  button.setAttribute('aria-label', label);
};

// One icon button of a card's head. `run()` does its action and resolves to a done label, or to
// nothing; with a label, the button shows a check mark and that label for COPIED_MS (a second
// click restarts it), then its own icon and label again. Same size either way, so nothing moves.
function cardAction(name, label, run) {
  const button = h('button', { class: 'icon-button', type: 'button', title: label, 'aria-label': label }, icon(name));
  let revert = null;
  button.addEventListener('click', async () => {
    const done = await run();
    if (!done) return;
    button.replaceChildren(icon('check'));
    setLabel(button, done);
    statusLine.textContent = done;
    clearTimeout(revert);
    revert = setTimeout(() => {
      button.replaceChildren(icon(name));
      setLabel(button, label);
      statusLine.textContent = '';
    }, COPIED_MS);
  });
  return button;
}

// Copies `text`; resolves to `doneLabel` once it is on the clipboard.
const copyText = (text, doneLabel) =>
  navigator.clipboard.writeText(text).then(
    () => doneLabel,
    (error) => console.warn('clipboard.write.failed', error.name),
  );

// A card's 複製詞目 / 分享連結 buttons (after kautian-mirror): copy "Hanji Tâi-lô"; share the
// word page's link (`route`) through the system share sheet, or copy the link where there is none.
function cardActions(row, route) {
  return h(
    'div',
    { class: 'card-actions' },
    cardAction('copy', t('card.copy'), () => copyText(wordLabel(row), t('card.copied'))),
    cardAction('share', t('card.share'), () => {
      const url = `${location.origin}${location.pathname}${route}`;
      if (!navigator.share) return copyText(url, t('card.linkCopied'));
      navigator.share({ title: pageTitle(wordTitle(row)), url }).catch((error) => {
        if (error.name !== 'AbortError') console.warn('share.failed', error.name);
      });
    }),
  );
}

// One word card. Community rows merge their attestations (accents, meaning, examples, note,
// contributors); iTaigi rows have readings, tags and their iTaigi contributors. With `headword`
// the card leads with the word, linked to its own page (tag pages); a word page already names it
// in the heading.
function wordCard(row, { headword }) {
  const attestations = row.attestations ?? [];
  const pick = (field) => unique(attestations.map((a) => a[field]));
  const tags = attestations.length > 0 ? unique(attestations.flatMap((a) => a.tags)) : (row.tags ?? []).map((index) => TAG_NAMES[index]);
  const accents = unique(attestations.flatMap((a) => a.accents.map((accent) => (accent === ACCENT_OTHER && a.place ? a.place : accent))));
  const details = [
    [t('field.accents'), listJoin(accents)],
    [t('field.meaning'), pick('meaning').join('\n')],
    // each example as its Hanji line over its Tâi-lô line
    [t('field.examples'), unique(attestations.flatMap((a) => a.examples.map((e) => [e.hanji, e.tl].filter(Boolean).join('\n')))).join('\n')],
    [t('field.note'), pick('note').join('\n')],
  ].filter(([, value]) => value !== '');
  const contributors = attestations.length > 0 ? pick('contributor') : (row.contributors ?? []);
  // the card's foot: tags on the left, the contributors on the right as a byline (linking to their
  // pages); its 貢獻者 label is read aloud and shown on hover, the corner placement says it to the eye
  const credit =
    contributors.length > 0
      ? h(
          'p',
          { class: 'card-credit', title: t('card.contributors') },
          h('span', { class: 'unseen' }, t('card.byline')),
          contributorLinks(contributors),
          // an iTaigi word names its source after its contributors, as a link to iTaigi
          attestations.length === 0 ? [' · ', h('a', { class: 'card-source', href: 'https://itaigi.tw/', rel: 'noopener' }, 'iTaigi')] : null,
        )
      : null;
  const tagList = tags.length > 0 ? h('nav', { class: 'card-tags', 'aria-label': t('field.tags') }, tags.map((name) => tagLink(name))) : null;
  const readingLine = h('p', { class: 'card-readings' }, tlSpan(row), readings(row));
  // the card's first line (the headword, or the readings on a word page) shares a row with the
  // buttons, so a long word wraps before them instead of running under them
  const route = wordRoute(row.hanji, row.tl);
  const [first, second] = headword ? [h('a', { class: 'card-hanji', href: route }, wordTitle(row)), readingLine] : [readingLine, null];
  return h(
    'article',
    { class: 'word-card' },
    h('div', { class: 'card-head' }, first, cardActions(row, route)),
    second,
    details.length > 0 ? h('dl', { class: 'card-details' }, details.flatMap(([label, value]) => [h('dt', {}, label), h('dd', {}, value)])) : null,
    tagList || credit ? h('footer', { class: 'card-foot' }, tagList, credit) : null,
  );
}

const CARD_PAGE_SIZE = 60;

// Fills `list` with cards for `words` (community rows first, then iTaigi), CARD_PAGE_SIZE at a
// time, since one tag can hold a few thousand words: the next batch loads as the reader scrolls
// near the end of the list.
export function cardList(list, words, options) {
  const all = [...words.community, ...words.itaigi];
  if (all.length === 0) {
    list.replaceWith(h('p', { class: 'empty' }, t('data.empty')));
    return;
  }
  let shown = 0;
  const showMore = () => {
    list.append(...all.slice(shown, shown + CARD_PAGE_SIZE).map((row) => wordCard(row, options)));
    shown = Math.min(shown + CARD_PAGE_SIZE, all.length);
  };
  showMore();
  if (shown === all.length) return;
  // a marker after the list; once it nears the viewport the next batch is added, and the observer
  // stops when every card is in (or the page was replaced, taking the marker with it)
  const end = h('div', { class: 'cards-end', 'aria-hidden': 'true' });
  list.after(end);
  const observer = new IntersectionObserver(
    (seen) => {
      if (!end.isConnected) return observer.disconnect();
      if (!seen.some((e) => e.isIntersecting)) return;
      showMore();
      if (shown === all.length) {
        observer.disconnect();
        end.remove();
      }
    },
    { rootMargin: '0px 0px 800px 0px' },
  );
  observer.observe(end);
}

// The open word card's close, or nothing when none is open.
let closeOpenTip = () => {};
// Closes the word bubble's card, if one is open (app.js runs it on leaving the page).
export const closeWordTip = () => closeOpenTip();

// The card a word bubble opens (tag-map.js onWord): the word's cards as its word page shows them
// (readings, meaning, tags, contributors, 複製詞目 / 分享連結), in a panel beside the bubble. Escape,
// a click outside it, another word or leaving the page closes it; focus moves into it once it is
// filled and back to the bubble on Escape.
export function openWordTip({ hanji, tl }, link) {
  closeOpenTip();
  const section = link.closest('.tag-map-section');
  const tip = h('div', { class: 'word-tip', role: 'dialog', 'aria-label': wordTitle({ hanji, tl }), tabindex: '-1' }, h('p', { class: 'word-tip-note' }, t('data.loading')));
  // beside the bubble (right if it fits, else left), centred on it, kept inside the map section
  const place = () => {
    const area = section.getBoundingClientRect();
    const at = link.getBoundingClientRect();
    const gap = 12;
    let left = at.right - area.left + gap;
    if (left + tip.offsetWidth > area.width) left = at.left - area.left - gap - tip.offsetWidth;
    const top = at.top - area.top + at.height / 2 - tip.offsetHeight / 2;
    tip.style.left = `${Math.max(0, Math.min(area.width - tip.offsetWidth, left))}px`;
    tip.style.top = `${Math.max(0, Math.min(area.height - tip.offsetHeight, top))}px`;
  };
  const outside = (event) => {
    if (!tip.contains(event.target)) close();
  };
  // Escape closes the card before the map would zoom out on the same key
  const onKey = (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    close();
    link.focus({ preventScroll: true });
  };
  const close = () => {
    tip.remove();
    document.removeEventListener('pointerdown', outside, true);
    document.removeEventListener('keydown', onKey, true);
    closeOpenTip = () => {};
  };
  closeOpenTip = close;
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('keydown', onKey, true);
  section.append(tip);
  place();
  Promise.all([loadRows(), loadItaigiIndex()])
    .then(([rows, itaigi]) => {
      if (!tip.isConnected) return;
      const words = wordsSpelled(rows, itaigi, hanji, tl);
      tip.replaceChildren(...[...words.community, ...words.itaigi].map((row) => wordCard(row, { headword: true })));
      place();
      tip.focus({ preventScroll: true });
    })
    .catch(() => tip.isConnected && tip.replaceChildren(h('p', { class: 'word-tip-note' }, t('data.loadError'))));
}
