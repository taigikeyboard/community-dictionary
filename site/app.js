import { ACCENT_OTHER, ACCENTS, TAG_LIMIT } from '../lib/entry.js';
import { WORKER_URL } from './config.js';
import { icon } from './icons.js';
import { checkBatch, contributedTags, duplicateStatus, findExisting, indexItaigi, MAX_WORDS, searchItaigi, searchRowsByTag } from './logic.js';
import { initSettings } from './settings.js';
import { initSidebar } from './sidebar.js';
import { TAG_NAMES, TAGS } from './tags.js';

// Two pages: search (community entries and iTaigi) and the submission form, whose word rows show
// the community entries already collected.

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

// The search box lists up to 200 matches per source; a word row only the closest few.
const SEARCH_LIMIT = 200;
const WORD_ROW_LIMIT = 5;

// One result row: Hanji, Tâi-lô, then Pe̍h-ōe-jī (only where it differs) and 方音符號, which the
// sidebar's 選單顯示 switches hide through <html data-poj / data-tps>.
function resultItem(row, className = null) {
  return h(
    'li',
    { class: className },
    h(
      'div',
      { class: 'result-head' },
      h('span', { class: 'result-hanji' }, row.hanji),
      h('span', { class: 'result-tl' }, row.tl),
      row.poj ? h('span', { class: 'poj' }, row.poj) : null,
      row.tps ? h('span', { class: 'tps' }, row.tps) : null,
    ),
  );
}

const existingItem = ({ row, exact }) => resultItem(row, exact ? 'exact' : null);

// iTaigi rows (CC0, no attribution required) follow the community entries without a heading.
const itaigiItem = (row) => resultItem(row);

// Popover of words already collected, under whatever field `locate` picks inside `root`:
// locate(element) → { anchor, values() → { hanji, tl } } or null. It floats over the page, so
// opening it never moves anything below, and it stays closed while nothing matches. Loads the
// community entries (and, with `withItaigi`, the iTaigi rows below them) on first use; a failed
// load is retried on the next keystroke.
function matchesPopover(root, locate, limit, { withItaigi = false } = {}) {
  const results = h('ul', { class: 'results' });
  const panel = h('section', { class: 'matches', hidden: true, 'aria-label': withItaigi ? '揣詞結果' : '已經有的詞' }, results);

  let rows = null;
  let itaigi = null;
  let active = null;
  const update = () => {
    if (active && !root.contains(active.anchor)) active = null;
    const { hanji, tl, tag = null } = active ? active.values() : { hanji: '', tl: '' };
    // a tag is a name; iTaigi rows carry the site's tags only, by index (-1: a contributor's own tag)
    const tagIndex = tag === null ? null : TAG_NAMES.indexOf(tag);
    let found = [];
    if (rows) found = tag === null ? findExisting(rows, hanji, tl, limit) : searchRowsByTag(rows, hanji, tag, limit).map((row) => ({ row, exact: false }));
    const foundItaigi = itaigi && tagIndex !== -1 ? searchItaigi(itaigi, hanji, limit, tagIndex) : [];
    panel.hidden = found.length === 0 && foundItaigi.length === 0;
    if (panel.hidden) return;
    if (panel.parentElement !== active.anchor) active.anchor.append(panel);
    // a tag with nothing typed lists only the first `limit` of each source; say how many there are
    let more = null;
    if (tag !== null && hanji.trim() === '') {
      const total = (rows ? searchRowsByTag(rows, '', tag, Infinity).length : 0) + (itaigi && tagIndex !== -1 ? itaigi.filter((r) => r.tags.includes(tagIndex)).length : 0);
      const shown = found.length + foundItaigi.length;
      if (total > shown) more = h('li', { class: 'results-more' }, `攏總 ${total} 个，干焦列頭前 ${shown} 个`);
    }
    results.replaceChildren(...found.map(existingItem), ...foundItaigi.map(itaigiItem), ...(more ? [more] : []));
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
    if (withItaigi && !itaigi) {
      loadItaigi()
        .then((loaded) => {
          itaigi ??= indexItaigi(loaded);
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
  // keep focus in the input while clicking inside the popover
  panel.addEventListener('pointerdown', (event) => event.preventDefault());
  root.addEventListener('words-changed', update);
}

// The page's search box; results open in the same popover as the word rows.
// The page's search box with the tag chips under it; results open in the same popover as the
// word rows, below the chips. A chip narrows the results to its tag (pressed again, it lets go)
// and, with nothing typed, lists the tag's words. Tags contributors made, once in accepted
// entries, follow the site's own as extra chips.
function searchBox() {
  const input = h('input', { type: 'search', 'aria-label': '揣詞', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off' });
  const chipRow = h('div', { class: 'tags', role: 'group', 'aria-label': '標籤' });
  const box = h('div', { class: 'search', role: 'search' }, icon('search'), input, chipRow);
  let tag = null;
  const addChip = (name, reading) => {
    const chip = h('button', { type: 'button', class: 'tag', 'aria-pressed': 'false', title: reading }, name);
    chip.addEventListener('click', () => {
      tag = tag === name ? null : name;
      for (const other of chipRow.children) other.setAttribute('aria-pressed', String(other.textContent === tag));
      // focus stays on the chip (keyboard users keep their place); the input event opens or
      // refreshes the popover for the new tag
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    chipRow.append(chip);
  };
  for (const listed of TAGS) addChip(listed.name, listed.tl);
  loadRows()
    .then((rows) => {
      for (const name of contributedTags(rows, TAG_NAMES)) addChip(name, null);
    })
    .catch(() => {});
  matchesPopover(box, () => ({ anchor: box, values: () => ({ hanji: input.value, tl: '', tag }) }), SEARCH_LIMIT, { withItaigi: true });
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

// options: [value, label, iconName?]
function choiceGroup(name, label, options, { type = 'checkbox', style = 'pills' } = {}) {
  return h(
    'fieldset',
    { class: 'field', id: `f-${name}`, 'aria-describedby': `e-${name}` },
    h('legend', {}, label),
    h(
      'div',
      { class: style },
      options.map(([value, text, iconName]) =>
        h('label', {}, h('input', { type, name, value }), iconName ? icon(iconName) : null, h('span', {}, text)),
      ),
    ),
    errorSlot(name),
  );
}

// 標籤: the site's tags as pills, several may be picked, plus a contributor's own tags. An added
// tag becomes one more pill, already ticked, so it is read and unticked like the others.
function tagGroup() {
  const group = choiceGroup('tags', '標籤', TAGS.map((tag) => [tag.name, tag.name]));
  const pills = group.querySelector('.pills');
  const custom = h('input', { type: 'text', 'aria-label': '家己加標籤', autocomplete: 'off', maxlength: TAG_LIMIT });
  const add = h('button', { class: 'button secondary', type: 'button' }, '加');
  const addTag = () => {
    const name = custom.value.normalize('NFC').trim();
    custom.value = '';
    if (name === '') return;
    const existing = [...pills.querySelectorAll('input')].find((box) => box.value === name);
    if (existing) existing.checked = true;
    else pills.append(h('label', {}, h('input', { type: 'checkbox', name: 'tags', value: name, checked: true }), h('span', {}, name)));
  };
  add.addEventListener('click', addTag);
  // Enter adds the tag instead of submitting the form
  custom.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    addTag();
  });
  group.querySelector('.error').before(h('div', { class: 'tag-add' }, custom, add));
  return group;
}

let nextWordId = 0;

const wordValues = (row) => ({
  hanji: row.querySelector('[name="hanji"]').value,
  tl: row.querySelector('[name="tl"]').value,
});

// One word: Hanji/Japanese and Tâi-lô inputs, a remove button, and the row's error line.
function wordRow(list) {
  const n = nextWordId++;
  const remove = h('button', { class: 'icon-button', type: 'button', 'aria-label': '提掉這个詞', title: '提掉' }, icon('close'));
  const row = h(
    'div',
    { class: 'word' },
    h(
      'div',
      { class: 'word-fields' },
      h('input', { type: 'text', name: 'hanji', 'aria-label': '漢字、日語', 'aria-describedby': `e-word-${n}` }),
      h('input', { type: 'text', name: 'tl', class: 'romanized', spellcheck: 'false', autocapitalize: 'off', 'aria-label': '台羅', 'aria-describedby': `e-word-${n}` }),
      remove,
    ),
    h('div', { class: 'error', id: `e-word-${n}`, hidden: true }),
  );
  remove.addEventListener('click', () => {
    row.remove();
    list.dispatchEvent(new Event('words-changed'));
  });
  return row;
}

const isBlankRow = (row) => {
  const { hanji, tl } = wordValues(row);
  return hanji.trim() === '' && tl.trim() === '';
};

// Words grow on their own: there is always one empty row at the end, and typing into it adds the
// next one (up to MAX_WORDS). A filled row can be removed; the trailing empty row cannot.
function wordList() {
  const list = h('div', { class: 'words' });
  const section = h(
    'div',
    { class: 'field' },
    h('div', { class: 'word-fields words-head', 'aria-hidden': 'true' }, h('span', {}, '漢字、日語'), h('span', {}, '台羅'), h('span')),
    list,
  );
  const refresh = () => {
    // clearing the second-to-last row leaves two empty rows at the end; keep one
    while (list.children.length > 1) {
      const last = list.lastElementChild;
      if (!isBlankRow(last) || !isBlankRow(last.previousElementSibling) || last.contains(document.activeElement)) break;
      last.remove();
    }
    const last = list.lastElementChild;
    if (!last || (!isBlankRow(last) && list.children.length < MAX_WORDS)) {
      list.append(wordRow(list));
    }
    for (const row of list.children) row.querySelector('.icon-button').hidden = row === list.lastElementChild && isBlankRow(row);
  };
  list.addEventListener('input', refresh);
  list.addEventListener('words-changed', refresh);
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
  const words = wordList();
  matchesPopover(words.list, (el) => {
    const row = el.closest('.word');
    return row && { anchor: row.querySelector('.word-fields'), values: () => wordValues(row) };
  }, WORD_ROW_LIMIT);
  const form = h(
    'form',
    { class: 'form panel', novalidate: true },
    words.section,
    h(
      'div',
      { class: 'form' },
      choiceGroup('accents', '腔口', ACCENTS.map((a) => [a, a])),
      h('div', { 'data-for-accent': true, hidden: true }, field('place', '所在', textInput('place'))),
    ),
    tagGroup(),
    field('meaning', '意思', textInput('meaning')),
    field('example', '例句', textInput('example')),
    field('note', '說明', textInput('note', { multiline: true })),
    h('div', { class: 'actions' }, h('button', { class: 'button', type: 'submit' }, icon('check'), open ? '登入 GitHub 送出' : '檢查'), notice),
  );

  const sync = () => {
    const { accents } = readShared(form);
    form.querySelector('[data-for-accent]').hidden = !accents.includes(ACCENT_OTHER);
  };
  form.addEventListener('change', sync);

  const say = (text) => {
    notice.textContent = text;
    notice.hidden = false;
  };
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

  document.title = `提交一个詞 · ${SITE_TITLE}`;
  view.replaceChildren(h('a', { class: 'back-link', href: '#/' }, icon('back'), '揣詞'), hero('提交一个詞'), form);
  sync();
}

function renderSearch() {
  document.title = SITE_TITLE;
  view.replaceChildren(
    hero(SITE_TITLE),
    searchBox(),
    h('p', { class: 'cta' }, h('a', { class: 'text-link', href: SUBMIT_ROUTE }, '提交一个詞', icon('chevron'))),
  );
}

// Two pages on hash routes: search at #/ (and any unknown hash), the submission form at #/submit.
function route() {
  if (location.hash === SUBMIT_ROUTE) renderSubmit();
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
