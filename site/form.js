import { ACCENT_OTHER, ACCENTS, LIMITS, MAX_EXAMPLES, MAX_WORDS, TAG_LIMIT } from '../lib/entry.js';
import { h } from './dom.js';
import { icon } from './icons.js';
import { isBlankWord } from './logic.js';
import { TAG_NAMES, TAGS } from './tags.js';

// The submission form's widgets (fields, pill groups, pair lists), its error lines and its draft.

export const errorSlot = (name) => h('div', { class: 'error', id: `e-${name}`, hidden: true });

export function field(name, label, control) {
  return h('div', { class: 'field' }, h('label', { for: `f-${name}` }, label), control, errorSlot(name));
}

export function textInput(name, { multiline = false, romanized = false } = {}) {
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

// The ＋ after a row of pills: it opens an input floating under it, so opening it never reflows the
// pills. `start()` gives the text the input opens with; `commit(text)` takes what was typed (NFC,
// trimmed, maybe empty) on Enter or when the input loses focus. Enter closes the input and returns
// to ＋, or with `stayOpen` keeps it open for the next one; Escape drops what was typed. The second
// argument holds the input's own id, aria-describedby and maxlength. Returns the slot to place
// after the pills.
function addPill(label, { id = null, describedBy = null, maxlength }, { start = () => '', commit, stayOpen = false }) {
  const add = h('button', { class: 'pill-add', type: 'button', 'aria-label': label, 'aria-expanded': 'false', title: label }, icon('plus'));
  const input = h('input', { type: 'text', id, class: 'pill-input', 'aria-label': label, 'aria-describedby': describedBy, autocomplete: 'off', maxlength, hidden: true });
  const slot = h('span', { class: 'tag-add' }, add, input);
  // a ＋ near the right edge opens its input leftward, so it stays inside the column; ＋ moves each
  // time a pill is added before it, so this runs then too
  const place = () => {
    input.classList.toggle('align-end', slot.offsetLeft + input.offsetWidth > slot.parentElement.clientWidth);
  };
  const editing = (on) => {
    add.setAttribute('aria-expanded', String(on));
    input.hidden = !on;
    if (!on) return;
    place();
    input.value = start();
    input.focus();
  };
  const take = () => {
    const text = input.value.normalize('NFC').trim();
    input.value = '';
    commit(text);
    if (stayOpen) place();
  };
  add.addEventListener('click', () => editing(true));
  input.addEventListener('keydown', (event) => {
    if (imeKey(event)) return;
    if (event.key === 'Escape') {
      input.value = '';
      editing(false);
      add.focus();
    } else if (event.key === 'Enter') {
      // Enter keeps what is typed instead of submitting the form
      event.preventDefault();
      take();
      if (stayOpen) return;
      editing(false);
      add.focus();
    }
  });
  input.addEventListener('blur', () => {
    if (input.hidden) return;
    take();
    editing(false);
  });
  return slot;
}

// 腔口: one pill per accent, full names as lib/entry.js lists them, then a ＋ like the tags'. What
// is typed under ＋ (any words, not only a place name) becomes one more pill before ＋, already
// ticked. That pill is the accent 其他 with the text in `place` (lib/entry.js allows one), so typing
// again replaces its text; unticking it leaves `place` out.
export function accentGroup({ accents = [], place = '' } = {}) {
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
  const slot = addPill(
    '其他腔口',
    { id: 'f-place', describedBy: 'e-place', maxlength: LIMITS.place },
    {
      start: () => other?.querySelector('input[type="hidden"]').value ?? '',
      commit: (text) => text !== '' && setOther(text, true),
    },
  );
  const pills = h('div', { class: 'pills' }, ACCENTS.filter((a) => a !== ACCENT_OTHER).map((a) => pill('accents', a, a, { checked: accents.includes(a) })), slot);
  if (place !== '') setOther(place, accents.includes(ACCENT_OTHER));
  return choiceGroup('accents', '腔口', h('div', {}, pills, errorSlot('place')));
}

// 標籤: the site's tags as pills, several may be picked, and a ＋ pill after the last one; an added
// tag becomes one more pill before ＋, already ticked, read and unticked like the others.
export function tagGroup(checked = []) {
  // a tag typed again ticks its pill instead of adding a second one
  const addTag = (name) => {
    if (name === '') return;
    const existing = [...pills.querySelectorAll('input[type="checkbox"]')].find((box) => box.value === name);
    if (existing) existing.checked = true;
    else slot.before(pill('tags', name, name, { checked: true }));
  };
  // Enter adds the tag and stays ready for the next one
  const slot = addPill('家己加標籤', { maxlength: TAG_LIMIT }, { commit: addTag, stayOpen: true });
  // a restored draft's own tags come back as ticked pills after the site's
  const own = checked.filter((name) => !TAG_NAMES.includes(name)).map((name) => pill('tags', name, name, { checked: true }));
  const pills = h('div', { class: 'pills' }, TAGS.map((tag) => pill('tags', tag.name, tag.name, { checked: checked.includes(tag.name) })), own, slot);
  return choiceGroup('tags', '標籤', pills);
}

let nextWordId = 0;

export const wordValues = (row) => ({
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

export const isBlankRow = (row) => isBlankWord(wordValues(row));

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
export const WORD_LIST = { max: MAX_WORDS, add: '加一个詞', remove: '提掉這个詞' };
export const EXAMPLE_LIST = { max: MAX_EXAMPLES, add: '加一句例句', remove: '提掉這句例句' };

// Rows grow on their own: below the filled rows there is always one empty slot row, drawn
// faint with a ＋, and typing into it adds the next one (up to `kind.max`). The first row is a
// plain row even while empty, so a fresh list shows the first row and the slot below it.
// Enter moves on (Hanji → Tâi-lô → next row) instead of submitting the form. `onDropped(count)`
// hears about pasted lines past the limit; `initial` fills the first rows (a restored draft).
// Returns the list element; the caller places it.
export function pairList(kind, { onDropped, initial = [] }) {
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

export function readShared(form, exampleList) {
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

// Hides every error line inside `scope` and drops the aria-invalid marks, its own included.
export function clearErrors(scope) {
  for (const el of scope.querySelectorAll('.error:not([hidden])')) {
    el.hidden = true;
    el.textContent = '';
  }
  for (const el of scope.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
  scope.removeAttribute('aria-invalid');
}

// Errors with a `row` go to that word's line, with an `example` to that filled example row's line
// (several joined); the rest to their field's slot.
export function showErrors(form, rowElements, exampleRows, errors) {
  clearErrors(form);
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

export function saveDraft(form, wordList, exampleList) {
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ words: filledPairs(wordList), ...readShared(form, exampleList) }));
}

// The saved draft, once (it is removed as it is read); null when there is none or it is unreadable.
export function takeDraft() {
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
