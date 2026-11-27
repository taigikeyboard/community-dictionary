import { ACCENT_OTHER, ACCENTS, LIMITS, MAX_EXAMPLES, MAX_WORDS, TAG_LIMIT } from '../lib/entry.js';
import { currentUser, signIn, submitErrorText, submitWords, WorkerError } from './account.js';
import { icon } from './icons.js';
import {
  checkBatch,
  contributorRoute,
  duplicateStatus,
  findExisting,
  indexItaigi,
  isBlankWord,
  parseRoute,
  searchItaigi,
  tagRoute,
  wordRoute,
  wordsByContributor,
  wordsSpelled,
  wordsWithTag,
} from './logic.js';
import { h } from './dom.js';
import { initSettings } from './settings.js';
import { initSidebar } from './sidebar.js';
import { storySections } from './story.js';
import { tagMap } from './tag-map.js';
import { TAG_NAMES, TAGS } from './tags.js';

// Pages: the homepage (tag bubble map and statistics), the 揣詞 search page (community entries and
// iTaigi), the submission form, whose word rows show the community entries already collected, and
// card pages for a tag, a contributor or a word.

const view = document.getElementById('view');
const LOAD_ERROR = '資料載入失敗，請重新整理。';
const SITE_TITLE = '台語齒盤群眾辭典';

// a page's title, and a lead line under it (a tag's Tâi-lô, `isReading`, follows the 台羅 switch)
const hero = (title, lead, { isReading = false } = {}) =>
  h('header', { class: 'hero' }, h('h1', {}, title), lead ? h('p', { class: isReading ? 'tl' : null }, lead) : null);

// whether the reader has moved between this site's pages since it loaded (the back button can then
// step back through them)
let navigatedInside = false;

// The 「‹ 頂一頁」 button above a subpage's title (the top bar has no links): back to the page the reader
// came from on this site, or the homepage when the page was opened directly.
function backButton() {
  const button = h('button', { class: 'back-link', type: 'button' }, icon('back'), '頂一頁');
  button.addEventListener('click', () => {
    if (navigatedInside) history.back();
    else location.hash = '#/';
  });
  return button;
}

// A word's Tâi-lô: hidden with the 台羅 switch (class tl), unless the word has no Hanji, when it is
// the word itself.
const tlSpan = (row) => h('span', { class: row.hanji ? 'result-tl tl' : 'result-tl' }, row.tl);

// Fetches and caches one JSON file; rejects on a network or HTTP failure, and a failed load is not
// cached, so the next call retries.
function cachedJson(path) {
  let promise;
  return () => {
    promise ??= fetch(path)
      .then((res) => {
        if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
        return res.json();
      })
      .catch((err) => {
        promise = undefined;
        throw err;
      });
    return promise;
  };
}

const loadRows = cachedJson('search.json');
const loadItaigi = cachedJson('itaigi.json');
const loadTagMap = cachedJson('tag-map.json');
const loadStats = cachedJson('stats.json');

// A card's contributor byline: names as plain links to their cards pages, joined by 、.
const contributorLinks = (names) => names.flatMap((name, i) => [i > 0 ? '、' : null, h('a', { class: 'person', href: contributorRoute(name) }, name)]).filter(Boolean);

// The search box lists up to 200 matches per source; a word row only the closest few.
const SEARCH_LIMIT = 200;
const WORD_ROW_LIMIT = 5;

// Pe̍h-ōe-jī (only where it differs) and 方音符號, which the sidebar's 選單顯示 switches hide
// through <html data-poj / data-tps>.
const readings = (row) => [row.poj ? h('span', { class: 'poj' }, row.poj) : null, row.tps ? h('span', { class: 'tps' }, row.tps) : null];

// One result row: Hanji, Tâi-lô and the readings. In the search box it links to the word's cards;
// under a word row of the form it does not, since leaving would drop what was typed.
function resultItem(row, { exact = false, linked = false } = {}) {
  const head = h('span', { class: 'result-head' }, h('span', { class: 'result-hanji' }, row.hanji), tlSpan(row), readings(row));
  return h('li', { class: exact ? 'exact' : null }, linked ? h('a', { class: 'result-link', href: wordRoute(row.hanji, row.tl) }, head) : head);
}

// Popover of words already collected, under whatever field `locate` picks inside `root`:
// locate(element) → { anchor, values() → { hanji, tl } } or null. It floats over the page, so
// opening it never moves anything below, and it stays closed while nothing matches. Loads the
// community entries on first use; the search box (`isSearch`) also lists iTaigi rows below them
// (CC0, no attribution required) and links every row to its cards. A failed load is retried on
// the next keystroke. `onRender` runs after every update (rows replaced, opened or closed); the
// panel and its list are returned for the search box's keyboard control.
function matchesPopover(root, locate, limit, { isSearch = false, onRender = () => {} } = {}) {
  const results = h('ul', { class: 'results' });
  const panel = h('section', { class: 'matches', hidden: true, 'aria-label': isSearch ? '揣詞結果' : '已經有 ê 詞' }, results);

  let rows = null;
  let itaigi = null;
  let active = null;
  const update = () => {
    if (active && !root.contains(active.anchor)) active = null;
    const { hanji, tl } = active ? active.values() : { hanji: '', tl: '' };
    const found = rows ? findExisting(rows, hanji, tl, limit) : [];
    const foundItaigi = itaigi ? searchItaigi(itaigi, hanji, limit) : [];
    panel.hidden = found.length === 0 && foundItaigi.length === 0;
    if (!panel.hidden) {
      if (panel.parentElement !== active.anchor) active.anchor.append(panel);
      results.replaceChildren(
        ...found.map(({ row, exact }) => resultItem(row, { exact, linked: isSearch })),
        ...foundItaigi.map((row) => resultItem(row, { linked: true })),
      );
    }
    onRender();
  };
  const load = () => {
    if (!rows) {
      loadRows()
        .then((loaded) => {
          rows = loaded;
          update();
        })
        .catch(() => {});
    }
    if (isSearch && !itaigi) {
      loadItaigiIndex()
        .then((loaded) => {
          itaigi = loaded;
          update();
        })
        .catch(() => {});
    }
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
  results.setAttribute('aria-label', '揣詞結果');
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

// One tag as a link to its cards page, drawn as #name (the # from styles.css).
const tagLink = (name, reading = null) => h('a', { class: 'tag', href: tagRoute(name), title: reading }, name);

// The 揣詞 page's search box; results open in the same popover as the form's word rows.
function searchBox() {
  // the blank placeholder only drives :placeholder-shown, which hides the 揤 / 揣詞 hint once
  // something is typed (a placeholder cannot draw the key's box)
  const input = h('input', { type: 'search', 'aria-label': '揣詞', placeholder: ' ', 'aria-keyshortcuts': '/', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off' });
  const hint = h('span', { class: 'search-hint', 'aria-hidden': 'true' }, '揤 ', h('kbd', {}, '/'), ' 揣詞');
  const box = h('div', { class: 'search', role: 'search' }, h('div', { class: 'search-field' }, icon('search'), input, hint));
  let render = () => {};
  const { panel, results } = matchesPopover(box, () => ({ anchor: box, values: () => ({ hanji: input.value, tl: '' }) }), SEARCH_LIMIT, {
    isSearch: true,
    onRender: () => render(),
  });
  render = menuKeys(input, panel, results);
  return box;
}

const errorSlot = (name) => h('div', { class: 'error', id: `e-${name}`, hidden: true });

function field(name, label, control) {
  return h('div', { class: 'field' }, h('label', { for: `f-${name}` }, label), control, errorSlot(name));
}

function textInput(name, { multiline = false, romanized = false } = {}) {
  return h(multiline ? 'textarea' : 'input', {
    id: `f-${name}`,
    name,
    type: multiline ? null : 'text',
    class: romanized ? 'romanized' : null,
    spellcheck: romanized ? 'false' : null,
    autocapitalize: romanized ? 'off' : null,
    'aria-describedby': `e-${name}`,
  });
}

// One checkbox pill.
const pill = (name, value, text, { checked = false } = {}) =>
  h('label', {}, h('input', { type: 'checkbox', name, value, checked }), h('span', {}, text));

function choiceGroup(name, label, content) {
  return h('fieldset', { class: 'field', id: `f-${name}`, 'aria-describedby': `e-${name}` }, h('legend', {}, label), content, errorSlot(name));
}

// A key pressed while an IME is composing (or the Enter that commits a candidate in Safari, which
// reports keyCode 229 with isComposing already false) belongs to the IME, not the form.
const imeKey = (event) => event.isComposing || event.keyCode === 229;

// 腔口: one pill per accent, full names as lib/entry.js lists them, then a ＋ like the tags'. ＋
// opens an input floating under it; what is typed (any words, not only a place name) becomes one
// more pill before ＋, already ticked. That pill is the accent 其他 with the text in `place`
// (lib/entry.js allows one), so typing again replaces its text; unticking it leaves `place` out.
function accentGroup({ accents = [], place = '' } = {}) {
  const add = h('button', { class: 'pill-add', type: 'button', 'aria-label': '其他腔口', 'aria-expanded': 'false', title: '其他腔口' }, icon('plus'));
  const custom = h('input', { type: 'text', id: 'f-place', class: 'pill-input', 'aria-label': '其他腔口', 'aria-describedby': 'e-place', autocomplete: 'off', maxlength: LIMITS.place, hidden: true });
  const slot = h('span', { class: 'tag-add' }, add, custom);
  const pills = h('div', { class: 'pills' }, ACCENTS.filter((a) => a !== ACCENT_OTHER).map((a) => pill('accents', a, a, { checked: accents.includes(a) })), slot);
  // the 其他 pill, made on the first text typed; its hidden `place` is disabled (left out of the
  // form data) while the pill is unticked
  let other = null;
  const setOther = (text, checked) => {
    if (!other) {
      other = pill('accents', ACCENT_OTHER, '');
      const value = h('input', { type: 'hidden', name: 'place' });
      other.append(value);
      const box = other.querySelector('input[type="checkbox"]');
      box.addEventListener('change', () => {
        value.disabled = !box.checked;
      });
      slot.before(other);
    }
    other.querySelector('span').textContent = text;
    other.querySelector('input[type="hidden"]').value = text;
    other.querySelector('input[type="checkbox"]').checked = checked;
    other.querySelector('input[type="hidden"]').disabled = !checked;
  };
  if (place !== '') setOther(place, accents.includes(ACCENT_OTHER));
  // a ＋ near the right edge opens its input leftward, so it stays inside the column
  const editing = (on) => {
    add.setAttribute('aria-expanded', String(on));
    custom.hidden = !on;
    if (!on) return;
    custom.classList.toggle('align-end', slot.offsetLeft + custom.offsetWidth > pills.clientWidth);
    custom.value = other?.querySelector('input[type="hidden"]').value ?? '';
    custom.focus();
  };
  const commit = () => {
    const text = custom.value.normalize('NFC').trim();
    if (text !== '') setOther(text, true);
    editing(false);
  };
  add.addEventListener('click', () => editing(true));
  custom.addEventListener('keydown', (event) => {
    if (imeKey(event)) return;
    if (event.key === 'Escape') {
      editing(false);
      add.focus();
    } else if (event.key === 'Enter') {
      // Enter keeps what is typed instead of submitting the form
      event.preventDefault();
      commit();
      add.focus();
    }
  });
  custom.addEventListener('blur', () => !custom.hidden && commit());
  return choiceGroup('accents', '腔口', h('div', {}, pills, errorSlot('place')));
}

// 標籤: the site's tags as pills, several may be picked, and a ＋ pill after the last one. ＋ opens
// an input floating under it, so opening it never reflows the pills; an added tag becomes one more
// pill before ＋, already ticked, read and unticked like the others.
function tagGroup(checked = []) {
  const add = h('button', { class: 'pill-add', type: 'button', 'aria-label': '家己加標籤', 'aria-expanded': 'false', title: '家己加標籤' }, icon('plus'));
  const custom = h('input', { type: 'text', class: 'pill-input', 'aria-label': '家己加標籤', autocomplete: 'off', maxlength: TAG_LIMIT, hidden: true });
  const slot = h('span', { class: 'tag-add' }, add, custom);
  // a restored draft's own tags come back as ticked pills after the site's
  const own = checked.filter((name) => !TAG_NAMES.includes(name)).map((name) => pill('tags', name, name, { checked: true }));
  const pills = h('div', { class: 'pills' }, TAGS.map((tag) => pill('tags', tag.name, tag.name, { checked: checked.includes(tag.name) })), own, slot);
  // a ＋ near the right edge opens its input leftward, so it stays inside the column; ＋ moves each
  // time a tag is added before it, so this runs then too
  const place = () => {
    custom.classList.toggle('align-end', slot.offsetLeft + custom.offsetWidth > pills.clientWidth);
  };
  const editing = (on) => {
    add.setAttribute('aria-expanded', String(on));
    custom.hidden = !on;
    if (!on) return;
    place();
    custom.focus();
  };
  const addTag = () => {
    const name = custom.value.normalize('NFC').trim();
    custom.value = '';
    if (name === '') return;
    const existing = [...pills.querySelectorAll('input[type="checkbox"]')].find((box) => box.value === name);
    if (existing) existing.checked = true;
    else slot.before(pill('tags', name, name, { checked: true }));
    if (!custom.hidden) place();
  };
  add.addEventListener('click', () => editing(true));
  custom.addEventListener('keydown', (event) => {
    if (imeKey(event)) return;
    if (event.key === 'Escape') {
      custom.value = '';
      editing(false);
      add.focus();
    } else if (event.key === 'Enter') {
      // Enter adds the tag instead of submitting the form, and stays ready for the next one
      event.preventDefault();
      addTag();
    }
  });
  custom.addEventListener('blur', () => {
    addTag();
    editing(false);
  });
  return choiceGroup('tags', '標籤', pills);
}

let nextWordId = 0;

const wordValues = (row) => ({
  hanji: row.querySelector('[name="hanji"]').value,
  tl: row.querySelector('[name="tl"]').value,
});

// One row of a pair list (a word, or an example sentence): Hanji/Japanese and Tâi-lô inputs, the
// row's button and its error line. The button removes the row, or on the slot row (see pairList)
// shows ＋ and moves the caret into it. The column names are the inputs' placeholders.
function wordRow(list) {
  const n = nextWordId++;
  const button = h('button', { class: 'icon-button', type: 'button' }, icon('close', 'icon icon-remove'), icon('plus', 'icon icon-add'));
  const hanji = h('input', { type: 'text', name: 'hanji', 'aria-label': '漢字、日語', placeholder: '漢字、日語', 'aria-describedby': `e-word-${n}` });
  const row = h(
    'div',
    { class: 'word' },
    h(
      'div',
      { class: 'word-fields' },
      hanji,
      h('input', { type: 'text', name: 'tl', class: 'romanized', spellcheck: 'false', autocapitalize: 'off', 'aria-label': '台羅', placeholder: '台羅', 'aria-describedby': `e-word-${n}` }),
      button,
    ),
    h('div', { class: 'error', id: `e-word-${n}`, hidden: true }),
  );
  button.addEventListener('click', () => {
    if (row.classList.contains('word-slot')) {
      hanji.focus();
      return;
    }
    row.remove();
    list.dispatchEvent(new Event('words-changed'));
  });
  return row;
}

const isBlankRow = (row) => isBlankWord(wordValues(row));

// The row the next pasted line goes into: the empty row below `row`, else a new row inserted there.
// At the limit (`max`) the empty slot row at the end gives up its place; past it, null.
function nextPasteRow(list, row, max, newRow) {
  const next = row.nextElementSibling;
  if (next && isBlankRow(next)) return next;
  const spare = list.lastElementChild;
  if (list.children.length >= max && spare !== row && isBlankRow(spare)) spare.remove();
  if (list.children.length >= max) return null;
  const inserted = newRow();
  row.after(inserted);
  return inserted;
}

// Pasted lines fill one row each: the first the row pasted into, the rest the empty row below or a
// new row inserted there, so words already typed further down stay. Tab-separated cells (a
// spreadsheet's copy) fill the Hanji and Tâi-lô columns from the column pasted into. Returns how
// many lines did not fit under `max`.
function pasteWords(list, input, text, max, newRow) {
  const names = ['hanji', 'tl'];
  const firstColumn = names.indexOf(input.name);
  const lines = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.split('\t').slice(0, names.length - firstColumn).map((cell) => cell.trim()))
    .filter((cells) => cells.some((cell) => cell !== ''));
  let row = input.closest('.word');
  let placed = 0;
  for (const cells of lines) {
    if (placed > 0) row = nextPasteRow(list, row, max, newRow);
    if (!row) break;
    cells.forEach((cell, i) => {
      row.querySelector(`[name="${names[firstColumn + i]}"]`).value = cell;
    });
    placed += 1;
  }
  list.dispatchEvent(new Event('words-changed'));
  return lines.length - placed;
}

// The form's two pair lists: the words, in their own box, and the example sentences.
const WORD_LIST = { max: MAX_WORDS, add: '加一个詞', remove: '提掉這个詞' };
const EXAMPLE_LIST = { max: MAX_EXAMPLES, add: '加一句例句', remove: '提掉這句例句' };

// Rows grow on their own: below the filled rows there is always one empty slot row, drawn
// faint with a ＋, and typing into it adds the next one (up to `kind.max`). The first row is a
// plain row even while empty, so a fresh list shows the first row and the slot below it.
// Enter moves on (Hanji → Tâi-lô → next row) instead of submitting the form. `onDropped(count)`
// hears about pasted lines past the limit; `initial` fills the first rows (a restored draft).
// Returns the list element; the caller places it.
function pairList(kind, { onDropped, initial = [] }) {
  const list = h('div', { class: 'words' });
  const newRow = () => wordRow(list);
  const refresh = () => {
    // clearing the second-to-last row leaves two empty rows at the end; keep one
    while (list.children.length > 2) {
      const last = list.lastElementChild;
      if (!isBlankRow(last) || !isBlankRow(last.previousElementSibling) || last.contains(document.activeElement)) break;
      last.remove();
    }
    while (list.children.length < 2) list.append(newRow());
    if (!isBlankRow(list.lastElementChild) && list.children.length < kind.max) list.append(newRow());
    for (const row of list.children) {
      const blank = isBlankRow(row);
      const slot = blank && row === list.lastElementChild && row !== list.firstElementChild;
      row.classList.toggle('word-slot', slot);
      const button = row.querySelector('.icon-button');
      button.setAttribute('aria-label', slot ? kind.add : kind.remove);
      button.title = slot ? kind.add : '提掉';
      // an empty first row has nothing to remove
      button.hidden = blank && row === list.firstElementChild;
    }
  };
  for (const word of initial) {
    const row = newRow();
    row.querySelector('[name="hanji"]').value = word.hanji;
    row.querySelector('[name="tl"]').value = word.tl;
    list.append(row);
  }
  list.addEventListener('input', refresh);
  list.addEventListener('words-changed', refresh);
  list.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || imeKey(event) || event.target.tagName !== 'INPUT') return;
    event.preventDefault();
    const row = event.target.closest('.word');
    const next = event.target.name === 'hanji' ? row.querySelector('[name="tl"]') : row.nextElementSibling?.querySelector('[name="hanji"]');
    next?.focus();
  });
  list.addEventListener('paste', (event) => {
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (event.target.tagName !== 'INPUT' || !/[\n\t]/.test(text.trim())) return;
    event.preventDefault();
    const dropped = pasteWords(list, event.target, text, kind.max, newRow);
    if (dropped > 0) onDropped(dropped);
  });
  refresh();
  return list;
}

// The filled rows of a pair list, as { hanji, tl }.
const filledPairs = (list) => [...list.children].map(wordValues).filter((pair) => !isBlankWord(pair));

function readShared(form, exampleList) {
  const data = new FormData(form);
  return {
    accents: data.getAll('accents'),
    tags: data.getAll('tags'),
    place: data.get('place') ?? '',
    meaning: data.get('meaning') ?? '',
    examples: filledPairs(exampleList),
    note: data.get('note') ?? '',
  };
}

// Errors with a `row` go to that word's line, with an `example` to that filled example row's line
// (several joined); the rest to their field's slot.
function showErrors(form, rowElements, exampleRows, errors) {
  for (const el of form.querySelectorAll('.error')) {
    el.hidden = true;
    el.textContent = '';
  }
  for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
  for (const { field: name, row, example, text } of errors) {
    if (row === undefined && example === undefined) {
      const el = form.querySelector(`#e-${name}`);
      el.textContent = text;
      el.hidden = false;
      form.querySelector(`#f-${name}`)?.setAttribute('aria-invalid', 'true');
    } else {
      const rowEl = example === undefined ? rowElements[row] : exampleRows[example];
      const el = rowEl.querySelector('.error');
      el.textContent = el.textContent ? `${el.textContent}；${text}` : text;
      el.hidden = false;
      rowEl.querySelector(`[name="${name}"]`).setAttribute('aria-invalid', 'true');
    }
  }
}

// The form's words and fields, kept in sessionStorage across the GitHub sign-in round trip.
const DRAFT_KEY = 'submit-draft';

function saveDraft(form, wordList, exampleList) {
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ words: filledPairs(wordList), ...readShared(form, exampleList) }));
}

// The saved draft, once (it is removed as it is read); null when there is none or it is unreadable.
function takeDraft() {
  const text = sessionStorage.getItem(DRAFT_KEY);
  sessionStorage.removeItem(DRAFT_KEY);
  try {
    const draft = JSON.parse(text);
    const strings = (list) => Array.isArray(list) && list.every((v) => typeof v === 'string');
    const pairs = (list) => Array.isArray(list) && list.every((p) => typeof p?.hanji === 'string' && typeof p?.tl === 'string');
    if (!draft || !pairs(draft.words) || !pairs(draft.examples) || !strings(draft.accents) || !strings(draft.tags)) return null;
    return draft;
  } catch {
    return null;
  }
}

// The tips above the form, numbered: one list item per tip, each a string or h() nodes.
const SUBMIT_TIPS = [
  ['提交資料需要登入 GitHub 口座，若無口座請先去', h('a', { href: 'https://github.com/signup', target: '_blank', rel: 'noopener' }, '申請'), '。'],
  ['為著整理資料方便，台羅請使用教育部台語羅馬字。'],
  ['若無漢字、日語，彼欄會當留空。'],
];

const submitTips = () => h('section', { class: 'submit-tips', 'aria-label': '填寫提示' }, h('ol', {}, SUBMIT_TIPS.map((tip) => h('li', {}, tip))));

const wordLabel = (entry) => [entry.hanji, entry.tl].filter(Boolean).join(' ');

function renderSubmit() {
  const draft = takeDraft();
  const notice = h('p', { class: 'form-notice', role: 'status', hidden: true });
  const say = (text) => {
    notice.textContent = text;
    notice.hidden = false;
  };
  // 「登入 GitHub 提交」 while signed out, 「提交」 once signed in; a hidden copy of the longer label,
  // stacked in the same grid cell, holds the button at that width so it never changes size when
  // the session loads or the contributor signs out.
  const signedOutLabel = '登入 GitHub 提交';
  let user = null;
  const submitLabel = h('span');
  const showLabel = () => {
    submitLabel.textContent = user ? '提交' : signedOutLabel;
  };
  const submit = h(
    'button',
    { class: 'button button-steady', type: 'submit' },
    h('span', { class: 'button-sizer', 'aria-hidden': 'true' }, signedOutLabel),
    submitLabel,
  );
  const session = currentUser();
  session.then((found) => {
    user = found;
    showLabel();
  });

  showLabel();
  const words = pairList(WORD_LIST, {
    onDropped: (dropped) => say(`一擺上濟 ${MAX_WORDS} 个詞，有 ${dropped} 个無貼入去。`),
    initial: draft?.words ?? [],
  });
  const examples = pairList(EXAMPLE_LIST, {
    onDropped: (dropped) => say(`例句上濟 ${MAX_EXAMPLES} 句，有 ${dropped} 句無貼入去。`),
    initial: draft?.examples ?? [],
  });
  matchesPopover(words, (el) => {
    const row = el.closest('.word');
    return row && { anchor: row.querySelector('.word-fields'), values: () => wordValues(row) };
  }, WORD_ROW_LIMIT);
  // the words share every field below them (one 解說, one set of 例句 and 標籤), so the box says
  // that several words must be one meaning
  const form = h(
    'form',
    { class: 'form', novalidate: true },
    h(
      'div',
      { class: 'field form-box' },
      h('span', { class: 'field-label' }, '詞條'),
      h('p', { class: 'field-hint' }, '仝一个意思 ê 詞（無仝寫法、講法）會當做伙提交；意思無仝 ê 詞，請分開提交。'),
      words,
    ),
    field('meaning', '解說', textInput('meaning')),
    // 例句 in the same white box as 詞條 (styles.css .form-box)
    h('div', { class: 'field form-box' }, h('span', { class: 'field-label' }, '例句'), examples, errorSlot('examples')),
    accentGroup(draft ?? {}),
    tagGroup(draft?.tags ?? []),
    field('note', '說明', textInput('note', { multiline: true })),
    h('div', { class: 'actions' }, submit, notice),
  );
  for (const name of ['meaning', 'note']) {
    if (typeof draft?.[name] === 'string') form.elements[name].value = draft[name];
  }

  // Editing a row or a field clears its error line at once; the next 提交 checks everything again.
  const clearError = (event) => {
    const scope = event.target.closest('.word') ?? event.target.closest('.field');
    if (!scope) return;
    for (const el of scope.querySelectorAll('.error:not([hidden])')) {
      el.hidden = true;
      el.textContent = '';
    }
    for (const el of scope.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
    if (scope.getAttribute('aria-invalid')) scope.removeAttribute('aria-invalid');
  };
  form.addEventListener('input', clearError);
  form.addEventListener('change', clearError);

  let confirmedKeys = null;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    notice.hidden = true;
    const rowElements = [...words.children];
    const exampleRows = [...examples.children].filter((row) => !isBlankRow(row));
    const shared = readShared(form, examples);
    const { entries, errors } = await checkBatch(shared, rowElements.map(wordValues));
    showErrors(form, rowElements, exampleRows, errors);
    if (errors.length > 0) return;
    const signedIn = await session.then(() => user);

    // One's own earlier pair is refused; another contributor's does not block (D10), the
    // contributor confirms once for this set of words.
    const already = [];
    const mine = [];
    try {
      const rows = await loadRows();
      for (const { entry, row } of entries) {
        const dup = await duplicateStatus(rows, entry.hanji, entry.tl, signedIn?.id);
        if (dup.status === 'mine') mine.push({ field: 'tl', row, text: '你已經提交過這个詞' });
        if (dup.status === 'attested') already.push(`${wordLabel(entry)}：${dup.contributors.join('、')} 已經提交過`);
      }
    } catch {
      say(LOAD_ERROR);
      return;
    }
    if (mine.length > 0) return showErrors(form, rowElements, exampleRows, mine);
    const keys = entries.map((e) => e.key).join(',');
    if (already.length > 0 && confirmedKeys !== keys) {
      confirmedKeys = keys;
      say(`${already.join('。')}。腔口無仝抑是有補充，請寫佇「說明」才閣送一擺。`);
      return;
    }
    // signing in leaves the page; the draft brings the form back as it was
    const goSignIn = () => {
      saveDraft(form, words, examples);
      signIn('#/submit');
    };
    if (!signedIn) return goSignIn();

    submit.disabled = true;
    say('送出中…');
    try {
      const pullRequest = await submitWords({ ...shared, words: entries.map(({ entry }) => ({ hanji: entry.hanji, tl: entry.tl })) });
      renderSubmitted(pullRequest);
    } catch (err) {
      // the session ran out (24 hours) between loading the form and pressing 提交
      if (err instanceof WorkerError && err.status === 401) return goSignIn();
      const labelOf = (key) => wordLabel(entries.find((e) => e.key === key)?.entry ?? { hanji: key, tl: '' });
      say(submitErrorText(err, labelOf));
    } finally {
      submit.disabled = false;
    }
  });

  document.title = `提交新詞 · ${SITE_TITLE}`;
  view.replaceChildren(backButton(), hero('提交新詞'), submitTips(), form);
}

// After a submission: the pull request the Worker opened, where the maintainer reviews the words.
function renderSubmitted(pullRequest) {
  // only a GitHub page is linked, whatever the reply held
  const url = /^https:\/\/github\.com\//.test(pullRequest?.url) ? pullRequest.url : null;
  view.replaceChildren(
    backButton(),
    hero('提交成功'),
    h(
      'div',
      { class: 'submitted' },
      h('p', {}, '提交 ê 詞當咧處理，感謝你的貢獻，勞力！'),
      url ? h('p', {}, h('a', { href: url, target: '_blank', rel: 'noopener' }, `看審查進度（#${pullRequest.number}）`)) : null,
    ),
  );
  window.scrollTo(0, 0);
  view.querySelector('h1').focus({ preventScroll: true });
}

// The card a word bubble opens (tag-map.js onWord): the word's cards as its word page shows them
// (readings, meaning, tags, contributors, 複製詞目 / 分享連結), in a panel beside the bubble. Escape,
// a click outside it, another word or leaving the page closes it; focus moves into it once it is
// filled and back to the bubble on Escape.
let closeWordTip = () => {};
function openWordTip({ hanji, tl }, link) {
  closeWordTip();
  const section = link.closest('.tag-map-section');
  const tip = h('div', { class: 'word-tip', role: 'dialog', 'aria-label': hanji || tl, tabindex: '-1' }, h('p', { class: 'word-tip-note' }, '載入中…'));
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
    closeWordTip = () => {};
  };
  closeWordTip = close;
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
    .catch(() => tip.isConnected && tip.replaceChildren(h('p', { class: 'word-tip-note' }, LOAD_ERROR)));
}

function renderSearch() {
  document.title = SITE_TITLE;
  view.replaceChildren(
    // the title, then the tag bubbles (what the site is says the announcement bar above)
    hero(SITE_TITLE),
    tagMap(loadTagMap, () => h('div', { class: 'tags' }, TAGS.map((tag) => tagLink(tag.name, tag.tl))), {
      onWord: openWordTip,
      // a zoomed-in tag shows words whose cards need iTaigi: start loading it (1.5 MB) now
      onZoomIn: () => loadItaigiIndex().catch(() => {}),
    }),
    // scrolling down: the statistics, section by section
    storySections(loadStats),
  );
}

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
    cardAction('copy', '複製詞目', () => copyText([row.hanji, row.tl].filter(Boolean).join(' '), '已複製')),
    cardAction('share', '分享連結', () => {
      const url = `${location.origin}${location.pathname}${route}`;
      if (!navigator.share) return copyText(url, '連結已複製');
      navigator.share({ title: `${row.hanji || row.tl} · ${SITE_TITLE}`, url }).catch((error) => {
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
    ['腔口', accents.join('、')],
    ['解說', pick('meaning').join('\n')],
    // each example as its Hanji line over its Tâi-lô line
    ['例句', unique(attestations.flatMap((a) => a.examples.map((e) => [e.hanji, e.tl].filter(Boolean).join('\n')))).join('\n')],
    ['說明', pick('note').join('\n')],
  ].filter(([, value]) => value !== '');
  const contributors = attestations.length > 0 ? pick('contributor') : (row.contributors ?? []);
  // the card's foot: tags on the left, the contributors on the right as a byline (linking to their
  // pages); its 貢獻者 label is read aloud and shown on hover, the corner placement says it to the eye
  const credit =
    contributors.length > 0
      ? h(
          'p',
          { class: 'card-credit', title: '貢獻者' },
          h('span', { class: 'unseen' }, '貢獻者：'),
          contributorLinks(contributors),
          // an iTaigi word names its source after its contributors, as a link to iTaigi
          attestations.length === 0 ? [' · ', h('a', { class: 'card-source', href: 'https://itaigi.tw/', rel: 'noopener' }, 'iTaigi')] : null,
        )
      : null;
  const tagList = tags.length > 0 ? h('nav', { class: 'card-tags', 'aria-label': '標籤' }, tags.map((name) => tagLink(name))) : null;
  const readingLine = h('p', { class: 'card-readings' }, tlSpan(row), readings(row));
  // the card's first line (the headword, or the readings on a word page) shares a row with the
  // buttons, so a long word wraps before them instead of running under them
  const route = wordRoute(row.hanji, row.tl);
  const [first, second] = headword ? [h('a', { class: 'card-hanji', href: route }, row.hanji || row.tl), readingLine] : [readingLine, null];
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
function cardList(list, words, options) {
  const all = [...words.community, ...words.itaigi];
  if (all.length === 0) {
    list.replaceWith(h('p', { class: 'empty' }, '無資料'));
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

const loadItaigiIndex = (() => {
  let index = null;
  return () => loadItaigi().then((rows) => (index ??= indexItaigi(rows)));
})();

// Loads both sources, then hands them to `fill`; a failed load says so in place of the cards.
function withWords(list, fill) {
  Promise.all([loadRows(), loadItaigiIndex()])
    .then(([rows, itaigi]) => fill(rows, itaigi))
    .catch(() => list.replaceWith(h('p', { class: 'empty' }, LOAD_ERROR)));
}

// The 揣詞 page: a search box of its own under the title; its menu lists and links the words.
function renderFind() {
  document.title = `揣詞 · ${SITE_TITLE}`;
  view.replaceChildren(backButton(), hero('揣詞'), searchBox());
}

// A tag's page: every word carrying it, as cards.
function renderTag(tag) {
  document.title = `${tag} · ${SITE_TITLE}`;
  const reading = TAGS.find((listed) => listed.name === tag)?.tl;
  const list = h('div', { class: 'cards' });
  view.replaceChildren(backButton(), hero(tag, reading, { isReading: true }), list);
  withWords(list, (rows, itaigi) => cardList(list, wordsWithTag(rows, itaigi, tag), { headword: true }));
}

// A contributor's page: every word they gave, as cards.
function renderContributor(name) {
  document.title = `${name} · ${SITE_TITLE}`;
  const list = h('div', { class: 'cards' });
  view.replaceChildren(backButton(), hero(name), list);
  withWords(list, (rows, itaigi) => cardList(list, wordsByContributor(rows, itaigi, name), { headword: true }));
}

// A word's page: its cards from each source, under the word itself.
function renderWord(hanji, tl) {
  document.title = `${hanji || tl} · ${SITE_TITLE}`;
  const list = h('div', { class: 'cards cards-word' });
  view.replaceChildren(backButton(), hero(hanji || tl), list);
  withWords(list, (rows, itaigi) => cardList(list, wordsSpelled(rows, itaigi, hanji, tl), { headword: false }));
}

// Hash routes (logic.js parseRoute): the homepage at #/ and any unknown hash, the 揣詞 page at
// #/search, the form at #/submit, cards
// at #/tag/<name>, #/contributor/<name> and #/word/<hanji>/<tl>.
function route() {
  const target = parseRoute(location.hash);
  // the homepage widens the column for the bubble map (styles.css main[data-page="search"])
  view.dataset.page = target.page;
  if (target.page === 'submit') renderSubmit();
  else if (target.page === 'find') renderFind();
  else if (target.page === 'tag') renderTag(target.tag);
  else if (target.page === 'contributor') renderContributor(target.name);
  else if (target.page === 'word') renderWord(target.hanji, target.tl);
  else renderSearch();
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

initSettings(document.getElementById('settings'));
initSidebar(document.querySelectorAll('button[aria-controls="sidebar"]'), document.getElementById('sidebar'));

window.addEventListener('hashchange', () => {
  navigatedInside = true;
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
