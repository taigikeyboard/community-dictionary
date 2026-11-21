import { ACCENT_OTHER, ACCENTS, TAG_LIMIT } from '../lib/entry.js';
import { WORKER_URL } from './config.js';
import { icon } from './icons.js';
import {
  checkBatch,
  contributedTags,
  contributorRoute,
  duplicateStatus,
  findExisting,
  indexItaigi,
  isBlankWord,
  MAX_WORDS,
  parseRoute,
  searchItaigi,
  tagRoute,
  wordRoute,
  wordsByContributor,
  wordsSpelled,
  wordsWithTag,
} from './logic.js';
import { initSettings } from './settings.js';
import { initSidebar } from './sidebar.js';
import { TAG_NAMES, TAGS } from './tags.js';

// Pages: search (community entries and iTaigi) with tag chips, the submission form, whose word rows
// show the community entries already collected, and card pages for a tag or a word.

const view = document.getElementById('view');
const LOAD_ERROR = '資料載入失敗，請重新整理。';
const SITE_TITLE = '台語齒盤社群辭典';
const SUBMIT_ROUTE = '#/submit';

// Builds an element; children are nodes or strings (always text, never parsed as HTML).
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    el.setAttribute(name, value === true ? '' : value);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

const hero = (title, lead) => h('header', { class: 'hero' }, h('h1', {}, title), lead ? h('p', {}, lead) : null);

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
const loadContributors = cachedJson('contributors.json');

// One labelled row of chips on the homepage.
const chipGroup = (label, chips) => h('section', { class: 'chip-group' }, h('h2', {}, label), chips);

// Contributors under the tags, drawn like them as #name, most words first (dist/contributors.json
// from build-site); each opens the contributor's cards page.
function contributorChips() {
  const row = h('nav', { class: 'tags', 'aria-label': '貢獻者' });
  loadContributors()
    .then((names) => row.append(...names.map((name) => h('a', { class: 'tag', href: contributorRoute(name) }, name))))
    .catch(() => {});
  return row;
}

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
  const head = h('span', { class: 'result-head' }, h('span', { class: 'result-hanji' }, row.hanji), h('span', { class: 'result-tl' }, row.tl), readings(row));
  return h('li', { class: exact ? 'exact' : null }, linked ? h('a', { class: 'result-link', href: wordRoute(row.hanji, row.tl) }, head) : head);
}

// Popover of words already collected, under whatever field `locate` picks inside `root`:
// locate(element) → { anchor, values() → { hanji, tl } } or null. It floats over the page, so
// opening it never moves anything below, and it stays closed while nothing matches. Loads the
// community entries on first use; the search box (`isSearch`) also lists iTaigi rows below them
// (CC0, no attribution required) and links every row to its cards. A failed load is retried on
// the next keystroke.
function matchesPopover(root, locate, limit, { isSearch = false } = {}) {
  const results = h('ul', { class: 'results' });
  const panel = h('section', { class: 'matches', hidden: true, 'aria-label': isSearch ? '揣詞結果' : '已經有的詞' }, results);

  let rows = null;
  let itaigi = null;
  let active = null;
  const update = () => {
    if (active && !root.contains(active.anchor)) active = null;
    const { hanji, tl } = active ? active.values() : { hanji: '', tl: '' };
    const found = rows ? findExisting(rows, hanji, tl, limit) : [];
    const foundItaigi = itaigi ? searchItaigi(itaigi, hanji, limit) : [];
    panel.hidden = found.length === 0 && foundItaigi.length === 0;
    if (panel.hidden) return;
    if (panel.parentElement !== active.anchor) active.anchor.append(panel);
    results.replaceChildren(
      ...found.map(({ row, exact }) => resultItem(row, { exact, linked: isSearch })),
      ...foundItaigi.map((row) => resultItem(row, { linked: true })),
    );
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
    if (event.key === 'Escape') close();
  });
  // keep focus in the input while clicking inside the popover (a row's link still follows)
  panel.addEventListener('pointerdown', (event) => event.preventDefault());
  root.addEventListener('words-changed', update);
}

// One tag as a link to its cards page, drawn as #name (the # from styles.css).
const tagLink = (name, reading = null) => h('a', { class: 'tag', href: tagRoute(name), title: reading }, name);

// The tag chips under the search box: the site's tags, then tags contributors made once they are
// in accepted entries. Each opens the tag's cards page.
function tagChips() {
  const row = h('nav', { class: 'tags', 'aria-label': '標籤' }, TAGS.map((tag) => tagLink(tag.name, tag.tl)));
  loadRows()
    .then((rows) => row.append(...contributedTags(rows, TAG_NAMES).map((name) => tagLink(name))))
    .catch(() => {});
  return row;
}

// The page's search box; results open in the same popover as the word rows.
function searchBox() {
  const input = h('input', { type: 'search', 'aria-label': '揣詞', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off' });
  const box = h('div', { class: 'search', role: 'search' }, icon('search'), input);
  matchesPopover(box, () => ({ anchor: box, values: () => ({ hanji: input.value, tl: '' }) }), SEARCH_LIMIT, { isSearch: true });
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

// 腔口: one pill per accent, full names, 其他 last as lib/entry.js lists them.
const accentGroup = () => choiceGroup('accents', '腔口', h('div', { class: 'pills' }, ACCENTS.map((a) => pill('accents', a, a))));

// A key pressed while an IME is composing (or the Enter that commits a candidate in Safari, which
// reports keyCode 229 with isComposing already false) belongs to the IME, not the form.
const imeKey = (event) => event.isComposing || event.keyCode === 229;

// 標籤: the site's tags as pills, several may be picked, and a ＋ pill after the last one. ＋ opens
// an input floating under it, so opening it never reflows the pills; an added tag becomes one more
// pill before ＋, already ticked, read and unticked like the others.
function tagGroup() {
  const add = h('button', { class: 'pill-add', type: 'button', 'aria-label': '家己加標籤', 'aria-expanded': 'false', title: '家己加標籤' }, icon('plus'));
  const custom = h('input', { type: 'text', class: 'pill-input', 'aria-label': '家己加標籤', autocomplete: 'off', maxlength: TAG_LIMIT, hidden: true });
  const slot = h('span', { class: 'tag-add' }, add, custom);
  const pills = h('div', { class: 'pills' }, TAGS.map((tag) => pill('tags', tag.name, tag.name)), slot);
  // a ＋ near the right edge opens its input leftward, so it stays inside the column; ＋ moves each
  // time a tag is added before it, so this runs then too
  const place = () => {
    custom.classList.remove('align-end');
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

// One word: Hanji/Japanese and Tâi-lô inputs, the row's button and its error line. The button
// removes the word, or on the slot row (see wordList) shows ＋ and moves the caret into it.
function wordRow(list) {
  const n = nextWordId++;
  const button = h('button', { class: 'icon-button', type: 'button' }, icon('close', 'icon icon-remove'), icon('plus', 'icon icon-add'));
  const hanji = h('input', { type: 'text', name: 'hanji', 'aria-label': '漢字、日語', 'aria-describedby': `e-word-${n}` });
  const row = h(
    'div',
    { class: 'word' },
    h(
      'div',
      { class: 'word-fields' },
      hanji,
      h('input', { type: 'text', name: 'tl', class: 'romanized', spellcheck: 'false', autocapitalize: 'off', 'aria-label': '台羅', 'aria-describedby': `e-word-${n}` }),
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
// At the limit the empty slot row at the end gives up its place; past it, null.
function nextPasteRow(list, row) {
  const next = row.nextElementSibling;
  if (next && isBlankRow(next)) return next;
  const spare = list.lastElementChild;
  if (list.children.length >= MAX_WORDS && spare !== row && isBlankRow(spare)) spare.remove();
  if (list.children.length >= MAX_WORDS) return null;
  const inserted = wordRow(list);
  row.after(inserted);
  return inserted;
}

// Pasted lines fill one row each: the first the row pasted into, the rest the empty row below or a
// new row inserted there, so words already typed further down stay. Tab-separated cells (a
// spreadsheet's copy) fill the Hanji and Tâi-lô columns from the column pasted into. Returns how
// many lines did not fit under MAX_WORDS.
function pasteWords(list, input, text) {
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
    if (placed > 0) row = nextPasteRow(list, row);
    if (!row) break;
    cells.forEach((cell, i) => {
      row.querySelector(`[name="${names[firstColumn + i]}"]`).value = cell;
    });
    placed += 1;
  }
  list.dispatchEvent(new Event('words-changed'));
  return lines.length - placed;
}

// Words grow on their own: below the filled rows there is always one empty slot row, drawn
// faint with a ＋, and typing into it adds the next one (up to MAX_WORDS). The first row is a
// plain row even while empty, so a fresh form shows the first word and the slot below it.
// Enter moves on (Hanji → Tâi-lô → next row) instead of submitting the form. `onFilled(count)`
// hears the number of filled rows after every change; `onDropped(count)` about pasted lines past
// MAX_WORDS.
function wordList({ onFilled, onDropped }) {
  const list = h('div', { class: 'words' });
  const section = h(
    'div',
    { class: 'field words-block' },
    h('div', { class: 'word-fields words-head', 'aria-hidden': 'true' }, h('span', {}, '漢字、日語'), h('span', {}, '台羅'), h('span')),
    list,
  );
  const refresh = () => {
    // clearing the second-to-last row leaves two empty rows at the end; keep one
    while (list.children.length > 2) {
      const last = list.lastElementChild;
      if (!isBlankRow(last) || !isBlankRow(last.previousElementSibling) || last.contains(document.activeElement)) break;
      last.remove();
    }
    while (list.children.length < 2) list.append(wordRow(list));
    if (!isBlankRow(list.lastElementChild) && list.children.length < MAX_WORDS) list.append(wordRow(list));
    let filled = 0;
    for (const row of list.children) {
      const blank = isBlankRow(row);
      if (!blank) filled += 1;
      const slot = blank && row === list.lastElementChild && row !== list.firstElementChild;
      row.classList.toggle('word-slot', slot);
      const button = row.querySelector('.icon-button');
      button.setAttribute('aria-label', slot ? '加一个詞' : '提掉這个詞');
      button.title = slot ? '加一个詞' : '提掉';
      // an empty first row has nothing to remove
      button.hidden = blank && row === list.firstElementChild;
    }
    onFilled(filled);
  };
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
    const dropped = pasteWords(list, event.target, text);
    if (dropped > 0) onDropped(dropped);
  });
  refresh();
  return { section, list };
}

function readShared(form) {
  const data = new FormData(form);
  return {
    accents: data.getAll('accents'),
    tags: data.getAll('tags'),
    place: data.get('place') ?? '',
    meaning: data.get('meaning') ?? '',
    example: data.get('example') ?? '',
    note: data.get('note') ?? '',
  };
}

// Errors with a `row` go to that word's line (several joined); the rest to their field's slot.
function showErrors(form, rowElements, errors) {
  for (const el of form.querySelectorAll('.error')) {
    el.hidden = true;
    el.textContent = '';
  }
  for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
  for (const { field: name, row, text } of errors) {
    if (row === undefined) {
      const el = form.querySelector(`#e-${name}`);
      el.textContent = text;
      el.hidden = false;
      form.querySelector(`#f-${name}`)?.setAttribute('aria-invalid', 'true');
    } else {
      const rowEl = rowElements[row];
      const el = rowEl.querySelector('.error');
      el.textContent = el.textContent ? `${el.textContent}；${text}` : text;
      el.hidden = false;
      rowEl.querySelector(`[name="${name}"]`).setAttribute('aria-invalid', 'true');
    }
  }
}

function renderSubmit() {
  const open = WORKER_URL !== '';
  const notice = h('p', { class: 'form-notice', role: 'status', hidden: true });
  const say = (text) => {
    notice.textContent = text;
    notice.hidden = false;
  };
  // The label grows with the count ("檢查 3 个詞"); a hidden copy of its longest form, stacked in the
  // same grid cell, holds the button at that width so it never changes size while typing.
  const submitBase = open ? '登入 GitHub 送出' : '檢查';
  const submitLabel = h('span');
  const submit = h(
    'button',
    { class: 'button button-steady', type: 'submit' },
    h('span', { class: 'button-sizer', 'aria-hidden': 'true' }, `${submitBase} ${MAX_WORDS} 个詞`),
    submitLabel,
  );
  const words = wordList({
    onFilled: (count) => {
      submitLabel.textContent = `${submitBase}${count > 0 ? ` ${count} 个詞` : ''}`;
    },
    onDropped: (dropped) => say(`一擺上濟 ${MAX_WORDS} 个詞，有 ${dropped} 个無貼入去。`),
  });
  matchesPopover(words.list, (el) => {
    const row = el.closest('.word');
    return row && { anchor: row.querySelector('.word-fields'), values: () => wordValues(row) };
  }, WORD_ROW_LIMIT);
  // the words share every field below them; the box around the words says so
  const form = h(
    'form',
    { class: 'form submit-form', novalidate: true },
    words.section,
    field('meaning', '意思', textInput('meaning')),
    field('example', '例句', textInput('example')),
    h('div', { class: 'form' }, accentGroup(), h('div', { 'data-for-accent': true, hidden: true }, field('place', '所在', textInput('place')))),
    tagGroup(),
    field('note', '說明', textInput('note', { multiline: true })),
    h('div', { class: 'actions' }, submit, notice),
  );

  const sync = () => {
    const { accents } = readShared(form);
    form.querySelector('[data-for-accent]').hidden = !accents.includes(ACCENT_OTHER);
  };
  form.addEventListener('change', sync);

  let confirmedKeys = null;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    notice.hidden = true;
    const rowElements = [...words.list.children];
    const { entries, errors } = await checkBatch(readShared(form), rowElements.map(wordValues));
    showErrors(form, rowElements, errors);
    if (errors.length > 0) return;

    // Another contributor's earlier submission does not block (D10); the contributor confirms
    // once for this set of words.
    const already = [];
    try {
      const rows = await loadRows();
      for (const { entry } of entries) {
        const dup = await duplicateStatus(rows, entry.hanji, entry.tl);
        if (dup.status === 'attested') already.push(`${[entry.hanji, entry.tl].filter(Boolean).join(' ')}：${dup.contributors.join('、')} 已經提交過`);
      }
    } catch {
      say(LOAD_ERROR);
      return;
    }
    const keys = entries.map((e) => e.key).join(',');
    if (already.length > 0 && confirmedKeys !== keys) {
      confirmedKeys = keys;
      say(`${already.join('。')}。腔口無仝抑是有補充，請寫佇「說明」才閣送一擺。`);
      return;
    }
    if (!open) say(`${entries.length} 个詞格式無問題。提交猶未開放。`);
    // Phase 2: sign in through the Worker and POST the entries to its /submit endpoint.
  });

  document.title = `貢獻詞 · ${SITE_TITLE}`;
  view.replaceChildren(backToSearch(), hero('貢獻詞'), form);
  sync();
}

function renderSearch() {
  document.title = SITE_TITLE;
  view.replaceChildren(
    hero(SITE_TITLE),
    searchBox(),
    h('p', { class: 'cta' }, h('a', { class: 'text-link', href: SUBMIT_ROUTE }, '貢獻詞', icon('chevron'))),
    chipGroup('標籤', tagChips()),
    chipGroup('貢獻者', contributorChips()),
  );
}

const unique = (values) => [...new Set(values.filter((v) => v !== ''))];

// One word card. Community rows merge their attestations (accents, meaning, example, note,
// contributors); iTaigi rows have readings, tags and ITAIGI_CONTRIBUTOR. With `headword`
// the card leads with the word, linked to its own page (tag pages); a word page already names it
// in the heading.
function wordCard(row, { headword }) {
  const attestations = row.attestations ?? [];
  const pick = (field) => unique(attestations.map((a) => a[field]));
  const tags = attestations.length > 0 ? unique(attestations.flatMap((a) => a.tags)) : (row.tags ?? []).map((index) => TAG_NAMES[index]);
  const accents = unique(attestations.flatMap((a) => a.accents.map((accent) => (accent === ACCENT_OTHER && a.place ? a.place : accent))));
  const details = [
    ['腔口', accents.join('、')],
    ['意思', pick('meaning').join('\n')],
    ['例句', pick('example').join('\n')],
    ['說明', pick('note').join('\n')],
  ].filter(([, value]) => value !== '');
  const contributors = attestations.length > 0 ? pick('contributor') : (row.contributors ?? []);
  // the card's foot: tags on the left, the contributors on the right as a byline (linking to their
  // pages); its 貢獻者 label is read aloud and shown on hover, the corner placement says it to the eye
  const credit =
    contributors.length > 0
      ? h('p', { class: 'card-credit', title: '貢獻者' }, h('span', { class: 'unseen' }, '貢獻者：'), contributorLinks(contributors))
      : null;
  const tagList = tags.length > 0 ? h('nav', { class: 'card-tags', 'aria-label': '標籤' }, tags.map((name) => tagLink(name))) : null;
  return h(
    'article',
    { class: 'word-card' },
    headword ? h('a', { class: 'card-hanji', href: wordRoute(row.hanji, row.tl) }, row.hanji || row.tl) : null,
    h('p', { class: 'card-readings' }, h('span', { class: 'result-tl' }, row.tl), readings(row)),
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

const backToSearch = () => h('a', { class: 'back-link', href: '#/' }, icon('back'), '揣詞');

// A tag's page: every word carrying it, as cards.
function renderTag(tag) {
  document.title = `${tag} · ${SITE_TITLE}`;
  const reading = TAGS.find((listed) => listed.name === tag)?.tl;
  const list = h('div', { class: 'cards' });
  view.replaceChildren(backToSearch(), hero(tag, reading), list);
  withWords(list, (rows, itaigi) => cardList(list, wordsWithTag(rows, itaigi, tag), { headword: true }));
}

// A contributor's page: every word they gave, as cards.
function renderContributor(name) {
  document.title = `${name} · ${SITE_TITLE}`;
  const list = h('div', { class: 'cards' });
  view.replaceChildren(backToSearch(), hero(name), list);
  withWords(list, (rows, itaigi) => cardList(list, wordsByContributor(rows, itaigi, name), { headword: true }));
}

// A word's page: its cards from each source, under the word itself.
function renderWord(hanji, tl) {
  document.title = `${hanji || tl} · ${SITE_TITLE}`;
  const list = h('div', { class: 'cards cards-word' });
  view.replaceChildren(backToSearch(), hero(hanji || tl), list);
  withWords(list, (rows, itaigi) => cardList(list, wordsSpelled(rows, itaigi, hanji, tl), { headword: false }));
}

// Hash routes (logic.js parseRoute): search at #/ and any unknown hash, the form at #/submit,
// cards at #/tag/<name>, #/contributor/<name> and #/word/<hanji>/<tl>.
function route() {
  const target = parseRoute(location.hash);
  if (target.page === 'submit') renderSubmit();
  else if (target.page === 'tag') renderTag(target.tag);
  else if (target.page === 'contributor') renderContributor(target.name);
  else if (target.page === 'word') renderWord(target.hanji, target.tl);
  else renderSearch();
}

initSettings(document.getElementById('settings'));
initSidebar(document.querySelector('.sidebar-toggle'), document.getElementById('sidebar'));

// The focused link is replaced along with the page, so focus moves to the new heading instead of
// falling back to <body>, keeping keyboard and screen-reader users in place.

window.addEventListener('hashchange', () => {
  route();
  window.scrollTo(0, 0);
  const heading = view.querySelector('h1');
  heading.setAttribute('tabindex', '-1');
  heading.focus({ preventScroll: true });
});
route();
