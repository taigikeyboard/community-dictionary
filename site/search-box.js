import { loadRows } from './data.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { findExisting, searchTags, tagRoute, wordRoute } from './logic.js';
import { TAGS } from './tags.js';
import { t, tagLabel, tParts } from './strings.js';
import { readings, tlSpan } from './word-parts.js';

// The popover of words already collected (the 揣詞 search box and the form's word rows) and the
// 揣詞 page's search box with its keyboard-driven menu.

// The search box lists up to 200 matches (a word row of the form, submit-page.js, only the closest
// few).
const SEARCH_LIMIT = 200;

// One result row: Hanji, Tâi-lô and the readings. In the search box it links to the word's cards;
// under a word row of the form it does not, since leaving would drop what was typed.
function resultItem(row, { exact = false, linked = false } = {}) {
  const head = h('span', { class: 'result-head' }, h('span', { class: 'result-hanji' }, row.hanji), tlSpan(row), readings(row));
  return h('li', { class: exact ? 'exact' : null }, linked ? h('a', { class: 'result-link', href: wordRoute(row.hanji, row.tl) }, head) : head);
}

// One tag row of the search box: #label and the tag's Tâi-lô (site tags only), linked to its cards.
function tagItem(name) {
  const reading = TAGS.find((tag) => tag.name === name)?.tl;
  const head = h('span', { class: 'result-head' }, h('span', { class: 'result-hanji tag' }, tagLabel(name)), reading ? h('span', { class: 'result-tl tl' }, reading) : null);
  return h('li', {}, h('a', { class: 'result-link', href: tagRoute(name) }, head));
}

// Popover of words already collected, under whatever field `locate` picks inside `root`:
// locate(element) → { anchor, values() → { hanji, tl } } or null. It floats over the page, so
// opening it never moves anything below, and it stays closed while nothing matches. Loads every
// word on first use; the search box (`isSearch`) also lists matching tags above them and links
// every row to its cards. A failed load is retried on the next keystroke. `onRender` runs after every update (rows replaced, opened or closed); the
// panel and its list are returned for the search box's keyboard control.
export function matchesPopover(root, locate, limit, { isSearch = false, onRender = () => {} } = {}) {
  const results = h('ul', { class: 'results' });
  const panel = h('section', { class: 'matches', hidden: true, 'aria-label': t(isSearch ? 'search.results' : 'search.existing') }, results);

  let rows = null;
  let active = null;
  const update = () => {
    if (active && !root.contains(active.anchor)) active = null;
    const { hanji, tl } = active ? active.values() : { hanji: '', tl: '' };
    const found = rows ? findExisting(rows, hanji, tl, limit) : [];
    const foundTags = isSearch ? searchTags(rows ?? [], hanji, limit) : [];
    panel.hidden = found.length === 0 && foundTags.length === 0;
    if (!panel.hidden) {
      if (panel.parentElement !== active.anchor) active.anchor.append(panel);
      results.replaceChildren(
        ...foundTags.map(tagItem),
        ...found.map(({ row, exact }) => resultItem(row, { exact, linked: isSearch })),
      );
    }
    onRender();
  };
  // once loaded, the popover updates; a failure is retried on the next keystroke
  const load = () => {
    if (rows) return;
    loadRows()
      .then((loaded) => {
        rows = loaded;
        update();
      })
      .catch(() => {});
  };
  root.addEventListener('input', (event) => {
    active = locate(event.target);
    update();
    load();
  });
  const close = () => {
    active = null;
    update();
  };
  root.addEventListener('focusin', (event) => {
    const next = locate(event.target);
    if (next?.anchor === active?.anchor) return;
    active = next;
    update();
  });
  root.addEventListener('focusout', (event) => {
    if (active && !active.anchor.contains(event.relatedTarget)) close();
  });
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !event.isComposing) close();
  });
  // keep focus in the input while clicking inside the popover (a row's link still follows)
  panel.addEventListener('pointerdown', (event) => event.preventDefault());
  root.addEventListener('words-changed', update);
  return { panel, results };
}

// Keyboard control for the search box's menu, after kautian-mirror's combobox: ↓ / ↑ pick the
// next / previous row and wrap around, Enter opens the picked row's word (the first row's when none
// is picked), Escape closes it (matchesPopover); the mouse picks the row it moves over. Keys pressed
// while an input method is composing stay with the input method. The input keeps focus; the picked
// row is announced through aria-activedescendant. Returns `render`, to run after every update.
function menuKeys(input, panel, results) {
  results.id = 'search-results';
  results.setAttribute('role', 'listbox');
  results.setAttribute('aria-label', t('search.results'));
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', results.id);
  input.setAttribute('aria-expanded', 'false');
  let picked = -1;
  const options = () => [...results.children];
  const pick = (index, { scroll = false } = {}) => {
    const list = options();
    list[picked]?.classList.remove('active');
    list[picked]?.setAttribute('aria-selected', 'false');
    picked = index;
    const option = list[picked];
    if (!option) return input.removeAttribute('aria-activedescendant');
    option.classList.add('active');
    option.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', option.id);
    if (scroll) option.scrollIntoView({ block: 'nearest' });
  };
  input.addEventListener('keydown', (event) => {
    // keyCode 229: a key some browsers send to an input method without setting isComposing
    if (event.isComposing || event.keyCode === 229 || panel.hidden) return;
    const count = options().length;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      pick(picked < 0 ? (step > 0 ? 0 : count - 1) : (picked + step + count) % count, { scroll: true });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      (options()[picked] ?? options()[0])?.querySelector('a')?.click();
    }
  });
  results.addEventListener('mousemove', (event) => {
    const index = options().indexOf(event.target.closest('li'));
    if (index >= 0 && index !== picked) pick(index);
  });
  return () => {
    picked = -1;
    input.removeAttribute('aria-activedescendant');
    input.setAttribute('aria-expanded', String(!panel.hidden));
    options().forEach((option, index) => {
      option.id = `search-option-${index}`;
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
    });
  };
}

// The 揣詞 page's search box; results open in the same popover as the form's word rows.
export function searchBox() {
  // the blank placeholder only drives :placeholder-shown, which hides the 揤 / 揣詞 hint once
  // something is typed (a placeholder cannot draw the key's box)
  const input = h('input', { type: 'search', 'aria-label': t('search.title'), placeholder: ' ', 'aria-keyshortcuts': '/', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off' });
  const hint = h('span', { class: 'search-hint', 'aria-hidden': 'true' }, tParts('search.hint', { key: h('kbd', {}, '/') }));
  const box = h('div', { class: 'search', role: 'search' }, h('div', { class: 'search-field' }, icon('search'), input, hint));
  let render = () => {};
  const { panel, results } = matchesPopover(box, () => ({ anchor: box, values: () => ({ hanji: input.value, tl: '' }) }), SEARCH_LIMIT, {
    isSearch: true,
    onRender: () => render(),
  });
  render = menuKeys(input, panel, results);
  return box;
}
