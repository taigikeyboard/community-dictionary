import { ACCENT_OTHER, ACCENTS } from '../lib/entry.js';
import { WORKER_URL } from './config.js';
import { icon } from './icons.js';
import { checkBatch, duplicateStatus, findExisting, MAX_WORDS } from './logic.js';

// The site is one page: the submission form, with a live list of words already collected.

const view = document.getElementById('view');
const LOAD_ERROR = '資料載入失敗，請重新整理。';

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

// The search box lists up to 200 matches; a word row only the closest few.
const SEARCH_LIMIT = 200;
const WORD_ROW_LIMIT = 5;

function existingItem({ row, exact }) {
  const meta = [...new Set(row.attestations.flatMap((a) => a.accents)), row.attestations.map((a) => a.contributor).join('、')].join(' · ');
  return h(
    'li',
    { class: exact ? 'exact' : null },
    h(
      'div',
      { class: 'result-head' },
      h('span', { class: 'result-hanji' }, row.hanji),
      h('span', { class: 'result-tl' }, row.tl),
      h('span', { class: 'meta' }, meta),
    ),
  );
}

// Popover of words already collected, under whatever field `locate` picks inside `root`:
// locate(element) → { anchor, values() → { hanji, tl } } or null. It floats over the page, so
// opening it never moves anything below, and it stays closed while nothing matches. Loads the
// community entries on first use; a failed load is retried on the next keystroke.
function matchesPopover(root, locate, limit) {
  const results = h('ul', { class: 'results' });
  const panel = h('section', { class: 'matches', hidden: true, 'aria-label': '已經有的詞' }, results);

  let rows = null;
  let active = null;
  const update = () => {
    if (active && !root.contains(active.anchor)) active = null;
    const { hanji, tl } = active ? active.values() : { hanji: '', tl: '' };
    const found = rows ? findExisting(rows, hanji, tl, limit) : [];
    panel.hidden = found.length === 0;
    if (panel.hidden) return;
    if (panel.parentElement !== active.anchor) active.anchor.append(panel);
    results.replaceChildren(...found.map(existingItem));
  };
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
    if (event.key === 'Escape') close();
  });
  // keep focus in the input while clicking inside the popover
  panel.addEventListener('pointerdown', (event) => event.preventDefault());
  root.addEventListener('words-changed', update);
}

// The page's search box; results open in the same popover as the word rows.
function searchBox() {
  const input = h('input', { type: 'search', 'aria-label': '揣詞', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off' });
  const box = h('div', { class: 'search', role: 'search' }, icon('search'), input);
  matchesPopover(box, () => ({ anchor: box, values: () => ({ hanji: input.value, tl: '' }) }), SEARCH_LIMIT);
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

  view.replaceChildren(hero('台語齒盤社群辭典'), searchBox(), form);
  sync();
}

renderSubmit();
