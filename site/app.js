import { ACCENT_OTHER, ACCENTS, CATEGORIES, VARIATION_TYPES } from '../lib/entry.js';
import { WORKER_URL } from './config.js';
import { CATEGORY_ICONS, icon, VARIATION_ICONS } from './icons.js';
import { checkForm, describeErrors, duplicateStatus, searchRows } from './logic.js';

// Hash-routed single page: search (#/), submission form (#/submit), explanation (#/about).

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

// Rejects on a network or HTTP failure; a failed load is not cached, so the next call retries.
let rowsPromise;
function loadRows() {
  rowsPromise ??= fetch('search.json')
    .then((res) => {
      if (!res.ok) throw new Error(`search.json: HTTP ${res.status}`);
      return res.json();
    })
    .catch((err) => {
      rowsPromise = undefined;
      throw err;
    });
  return rowsPromise;
}

function resultItem(row) {
  const categories = [...new Set(row.attestations.map((a) => a.category))];
  const accents = [...new Set(row.attestations.flatMap((a) => a.accents))];
  const variations = [...new Set(row.attestations.flatMap((a) => a.variation_types))];
  return h(
    'li',
    {},
    h('div', { class: 'result-head' }, h('span', { class: 'result-hanji' }, row.hanji), h('span', { class: 'result-tl' }, row.tl)),
    h(
      'div',
      { class: 'meta' },
      categories.map((c) => h('span', {}, icon(CATEGORY_ICONS[c]), CATEGORIES[c])),
      variations.map((v) => h('span', {}, icon(VARIATION_ICONS[v]), VARIATION_TYPES[v])),
      accents.length > 0 ? h('span', {}, icon('pin'), accents.join('、')) : null,
    ),
    row.attestations
      .filter((a) => a.note || a.meaning)
      .map((a) => h('p', { class: 'note' }, a.meaning ? `${a.meaning}　` : '', a.note, ' ', h('span', { class: 'by' }, a.contributor))),
  );
}

async function renderSearch() {
  // blank placeholder: no text, it only drives :placeholder-shown for the centered icon
  const input = h('input', { type: 'search', 'aria-label': '揣漢字抑是台羅', placeholder: ' ', spellcheck: 'false', autocapitalize: 'off' });
  const status = h('p', { class: 'status', role: 'status' });
  const results = h('ul', { class: 'results' });
  view.replaceChildren(
    h('img', { class: 'app-icon', src: 'favicon.svg', alt: '' }),
    hero('台語齒盤社群辭典', '腔口差、新詞，佮辭典猶未收的詞。'),
    h('div', { class: 'search' }, icon('search'), input),
    status,
    results,
    h('p', { class: 'cta' }, h('a', { class: 'text-link', href: '#/submit' }, '提交一个詞', icon('chevron'))),
  );

  let rows;
  try {
    rows = await loadRows();
  } catch {
    status.textContent = LOAD_ERROR;
    return;
  }
  const update = () => {
    const found = searchRows(rows, input.value);
    results.replaceChildren(...found.map(resultItem));
    if (rows.length === 0) status.textContent = '猶無詞目';
    else if (input.value.trim() === '') status.textContent = `${rows.length} 个詞目`;
    else status.textContent = found.length === 0 ? '揣無' : '';
  };
  input.addEventListener('input', update);
  update();
}

const errorSlot = (name) => h('div', { class: 'error', id: `e-${name}`, hidden: true });

function field(name, label, control) {
  return h('div', { class: 'field' }, h('label', { for: `f-${name}` }, label), control, errorSlot(name));
}

function textInput(name, { placeholder, multiline = false, romanized = false } = {}) {
  return h(multiline ? 'textarea' : 'input', {
    id: `f-${name}`,
    name,
    type: multiline ? null : 'text',
    placeholder,
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

function readForm(form) {
  const data = new FormData(form);
  return {
    category: data.get('category') ?? '',
    hanji: data.get('hanji') ?? '',
    tl: data.get('tl') ?? '',
    variation_types: data.getAll('variation_types'),
    accents: data.getAll('accents'),
    place: data.get('place') ?? '',
    meaning: data.get('meaning') ?? '',
    source: data.get('source') ?? '',
    note: data.get('note') ?? '',
  };
}

function showErrors(form, errors) {
  for (const el of form.querySelectorAll('.error')) el.hidden = true;
  for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
  for (const { field: name, text } of errors) {
    const el = form.querySelector(`#e-${name}`);
    el.textContent = text;
    el.hidden = false;
    form.querySelector(`#f-${name}`)?.setAttribute('aria-invalid', 'true');
  }
}

function renderSubmit() {
  const open = WORKER_URL !== '';
  const notice = h('p', { class: 'form-notice', role: 'status', hidden: true });
  const form = h(
    'form',
    { class: 'form panel', novalidate: true },
    choiceGroup('category', '分類', Object.entries(CATEGORIES).map(([v, t]) => [v, t, CATEGORY_ICONS[v]]), { type: 'radio', style: 'segmented' }),
    h(
      'div',
      { class: 'row-2' },
      field('hanji', '漢字', textInput('hanji', { placeholder: '食飯' })),
      field('tl', '台羅', textInput('tl', { placeholder: 'tsia̍h-pn̄g', romanized: true })),
    ),
    h(
      'div',
      { class: 'form', 'data-for': 'khiunn-khau', hidden: true },
      choiceGroup('variation_types', '腔口差類型', Object.entries(VARIATION_TYPES).map(([v, t]) => [v, t, VARIATION_ICONS[v]])),
      choiceGroup('accents', '腔口', ACCENTS.map((a) => [a, a])),
      h('div', { 'data-for-accent': true, hidden: true }, field('place', '所在', textInput('place', { placeholder: '佗位的講法' }))),
    ),
    h(
      'div',
      { class: 'row-2', 'data-for': 'sin-su', hidden: true },
      field('meaning', '意思', textInput('meaning', { placeholder: '華語抑是英語' })),
      field('source', '出處', textInput('source', { placeholder: '佇佗位看著，抑是例句' })),
    ),
    field('note', '說明', textInput('note', { multiline: true, placeholder: '佇佗位聽著、啥人按怎講' })),
    h(
      'div',
      { class: 'field' },
      h(
        'label',
        { class: 'consent' },
        h('input', { type: 'checkbox', name: 'consent', id: 'f-consent', 'aria-describedby': 'e-consent' }),
        h('span', {}, '我同意用 CC0 釋出，並公開我的 GitHub 帳號'),
      ),
      errorSlot('consent'),
    ),
    h('div', { class: 'actions' }, h('button', { class: 'button', type: 'submit' }, icon('check'), open ? '登入 GitHub 送出' : '檢查'), notice),
  );

  const sync = () => {
    const { category, accents } = readForm(form);
    for (const el of form.querySelectorAll('[data-for]')) el.hidden = el.dataset.for !== category;
    form.querySelector('[data-for-accent]').hidden = !accents.includes(ACCENT_OTHER);
  };
  form.addEventListener('change', sync);

  const say = (text) => {
    notice.textContent = text;
    notice.hidden = false;
  };
  let confirmedKey = null;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    notice.hidden = true;
    const { entry, errors } = checkForm(readForm(form));
    const shown = describeErrors(errors);
    if (!form.elements.consent.checked) shown.push({ field: 'consent', text: '愛同意才會當提交' });
    showErrors(form, shown);
    if (shown.length > 0) return;

    let dup;
    try {
      dup = await duplicateStatus(await loadRows(), entry.hanji, entry.tl);
    } catch {
      say(LOAD_ERROR);
      return;
    }
    if (dup.status === 'attested' && confirmedKey !== dup.key) {
      confirmedKey = dup.key;
      say(`${dup.contributors.join('、')} 已經提交過。腔口無仝抑是有補充，請寫佇「說明」才閣送一擺。`);
      return;
    }
    if (!open) say('格式無問題。提交猶未開放。');
    // Phase 2: sign in through the Worker and POST the entry to its /submit endpoint.
  });

  view.replaceChildren(hero('提交', open ? null : '猶未開放，表格會當先試。'), form);
  sync();
}

function renderAbout() {
  const tile = (iconName, title, text) => h('section', { class: 'tile' }, icon(iconName), h('h2', {}, title), h('p', {}, text));
  view.replaceChildren(
    hero('說明', '用 GitHub 帳號提交，審查了後收入來。'),
    h(
      'div',
      { class: 'tiles' },
      tile('shield', '人工審查', '每筆提交是一个 pull request，台羅由人工檢查。'),
      tile('globe', 'CC0 1.0', '提交的內容釋出到公眾領域，逐家攏會當用。'),
      tile('person', 'GitHub 帳號', '你的帳號會公開顯示做提交者。'),
      tile('undo', '修改、收回', '嘛愛審查。收回的詞目留佇 git 歷史。'),
      tile('pin', '腔口', `教典十个調查點：${ACCENTS.filter((a) => a !== ACCENT_OTHER).join('、')}。`),
      tile('speaker', '腔口差類型', '參考教育部《臺灣台語常用詞辭典》方言差：語音差異、詞彙差異。'),
    ),
  );
}

const ROUTES = { '/': renderSearch, '/submit': renderSubmit, '/about': renderAbout };

for (const a of document.querySelectorAll('.globalnav [data-icon]')) a.prepend(icon(a.dataset.icon));

function route() {
  const path = location.hash.replace(/^#/, '') || '/';
  for (const a of document.querySelectorAll('.globalnav [data-route]')) {
    if (a.dataset.route === path) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  (ROUTES[path] ?? renderSearch)();
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
route();
