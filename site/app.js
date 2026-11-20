import { ACCENT_OTHER, ACCENTS, CATEGORIES, VARIATION_TYPES } from '../lib/entry.js';
import { WORKER_URL } from './config.js';
import { checkForm, describeErrors, duplicateStatus, searchRows } from './logic.js';

// Hash-routed single page: search (#/), submission form (#/submit), explanation (#/about).

const view = document.getElementById('view');

// Builds an element; children are nodes or strings (always text, never parsed as HTML).
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === false || value == null) continue;
    if (name.startsWith('on')) el.addEventListener(name.slice(2), value);
    else el.setAttribute(name, value === true ? '' : value);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

const CATEGORY_TEXT = {
  'khiunn-khau': '仝一个詞，無仝所在講法無仝。親像「欲」，宜蘭講 bueh、臺北講 beh。',
  'sin-su': '這幾年才出現、辭典猶未收的新詞，親像網路抑是科技的用語。',
  'poo-tshiong': '本底就有、毋過教典猶未收入去的詞。',
  'ki-thann': '無合以上分類的詞。',
};

const VARIATION_TEXT = {
  'gi-im': '字仝款，讀音無仝',
  'su-lui': '意思仝款，用的詞無仝',
  'ki-thann': '分袂清楚的時陣揀這个',
};

// Static markup only (no user data), so a template is safe here.
const SEARCH_ICON =
  '<svg class="search-icon" viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.75" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 10.5l3.5 3.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
function searchIcon() {
  const template = document.createElement('template');
  template.innerHTML = SEARCH_ICON;
  return template.content.firstChild;
}

const LOAD_ERROR = '資料載入失敗，請重新整理網頁。';

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

function categoryCards() {
  return h(
    'div',
    { class: 'categories' },
    Object.entries(CATEGORIES).map(([slug, label]) =>
      h('div', { class: 'category' }, h('h3', {}, label), h('p', {}, CATEGORY_TEXT[slug])),
    ),
  );
}

function resultItem(row) {
  const categories = [...new Set(row.attestations.map((a) => CATEGORIES[a.category]))];
  const accents = [...new Set(row.attestations.flatMap((a) => a.accents))];
  return h(
    'li',
    { class: 'result' },
    h('div', { class: 'result-head' }, h('span', { class: 'result-hanji' }, row.hanji), h('span', { class: 'result-tl' }, row.tl)),
    h('div', { class: 'chips' }, [...categories, ...accents].map((c) => h('span', { class: 'chip' }, c))),
    row.attestations
      .filter((a) => a.note || a.meaning)
      .map((a) =>
        h('div', { class: 'attestation' }, a.meaning ? `${a.meaning}　` : '', a.note, ' ', h('span', { class: 'by' }, `— ${a.contributor}`)),
      ),
  );
}

async function renderSearch() {
  const input = h('input', {
    type: 'search',
    'aria-label': '揣詞',
    placeholder: '輸入漢字抑是台羅',
    spellcheck: 'false',
    autocapitalize: 'off',
  });
  const results = h('ul', { class: 'results' });
  const status = h('p', { class: 'muted', role: 'status' });
  view.replaceChildren(
    h('p', {}, '逐家鬥陣收集台語的詞：腔口差、台語新詞，佮辭典猶未收的詞。每一筆攏會經過人工審查才收入來。'),
    categoryCards(),
    h('h2', {}, '揣詞'),
    h('div', { class: 'search' }, searchIcon(), input),
    status,
    results,
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
    if (rows.length === 0) status.textContent = '目前猶無收入來的詞目，歡迎提交第一筆。';
    else if (input.value.trim() === '') status.textContent = `目前收 ${rows.length} 个詞目。`;
    else status.textContent = found.length === 0 ? '揣無。' : '';
  };
  input.addEventListener('input', update);
  update();
  input.focus();
}

function field(name, label, control, hint) {
  return h(
    'div',
    { class: 'field', 'data-field': name },
    h('label', { for: `f-${name}` }, label, hint ? h('span', { class: 'hint' }, `　${hint}`) : null),
    control,
    h('div', { class: 'error', id: `e-${name}`, hidden: true }),
  );
}

function choiceGroup(name, label, options, { type = 'checkbox', hint } = {}) {
  return h(
    'fieldset',
    { class: 'field', 'data-field': name, id: `f-${name}`, 'aria-describedby': `e-${name}` },
    h('legend', {}, label, hint ? h('span', { class: 'hint' }, `　${hint}`) : null),
    h(
      'div',
      { class: 'choices' },
      options.map(([value, text, title]) =>
        h('label', { class: 'choice', title }, h('input', { type, name, value }), text),
      ),
    ),
    h('div', { class: 'error', id: `e-${name}`, hidden: true }),
  );
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
  const accentOptions = ACCENTS.map((a) => [a, a]);
  const form = h(
    'form',
    { class: 'form', novalidate: true },
    choiceGroup('category', '分類', Object.entries(CATEGORIES).map(([v, t]) => [v, t, CATEGORY_TEXT[v]]), { type: 'radio' }),
    field('hanji', '漢字', textInput('hanji'), '會當漢羅'),
    field('tl', '台羅', textInput('tl', { romanized: true }), '例：tsia̍h-pn̄g'),
    h(
      'div',
      { class: 'form', 'data-for': 'khiunn-khau', hidden: true },
      choiceGroup('variation_types', '腔口差類型', Object.entries(VARIATION_TYPES).map(([v, t]) => [v, t, VARIATION_TEXT[v]]), { hint: '會當複選' }),
      choiceGroup('accents', '腔口', accentOptions, { hint: '會當複選' }),
      h('div', { 'data-for-accent': 'other', hidden: true }, field('place', '所在', textInput('place'), '揀「其他」腔口時，寫是佗位的講法')),
    ),
    h(
      'div',
      { class: 'form', 'data-for': 'sin-su', hidden: true },
      field('meaning', '意思', textInput('meaning'), '華語抑是英語'),
      field('source', '出處', textInput('source'), '佇佗位看著，抑是一句例句'),
    ),
    field('note', '說明', textInput('note', { multiline: true }), '講予審查的人知影這个詞'),
    h(
      'label',
      { class: 'consent' },
      h('input', { type: 'checkbox', name: 'consent', id: 'f-consent', 'aria-describedby': 'e-consent' }),
      h('span', {}, '我同意用 ', h('a', { href: 'https://creativecommons.org/publicdomain/zero/1.0/deed.zh-hant', rel: 'noopener', target: '_blank' }, 'CC0'), ' 釋出我提交的內容，而且我的 GitHub 帳號會公開顯示做提交者。'),
    ),
    h('div', { class: 'error', id: 'e-consent', hidden: true }),
    h('div', { class: 'notice', id: 'form-notice', role: 'status', hidden: true }),
    h('button', { class: 'button', type: 'submit' }, open ? '用 GitHub 登入並送出' : '檢查'),
  );

  const sync = () => {
    const { category, accents } = readForm(form);
    for (const el of form.querySelectorAll('[data-for]')) el.hidden = el.dataset.for !== category;
    form.querySelector('[data-for-accent]').hidden = !accents.includes(ACCENT_OTHER);
  };
  form.addEventListener('change', sync);

  let confirmedKey = null;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const notice = form.querySelector('#form-notice');
    const say = (text) => {
      notice.textContent = text;
      notice.hidden = false;
    };
    notice.hidden = true;
    const values = readForm(form);
    const { entry, errors } = checkForm(values);
    const shown = describeErrors(errors);
    if (!form.elements.consent.checked) shown.push({ field: 'consent', text: '愛同意 CC0 才會當提交' });
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
      say(`這个詞 ${dup.contributors.join('、')} 已經提交過。若你的腔口無仝、抑是有欲補充的說明，請佇「說明」寫清楚，才閣揤一擺送出。`);
      return;
    }
    if (!open) say('檢查過矣，格式無問題。提交功能當咧準備，猶未開放。');
    // Phase 2: sign in through the Worker and POST the entry to its /submit endpoint.
  });

  view.replaceChildren(
    open ? null : h('p', { class: 'notice' }, '提交功能當咧準備：表格會當先試，毋過猶袂當送出。'),
    h('p', { class: 'muted' }, '提交進前請先去「揣詞」看有人提交過無。分類的意思請看「說明」。'),
    form,
  );
  sync();
}

function renderAbout() {
  view.replaceChildren(
    h('h2', {}, '這是啥物'),
    h('p', {}, '台語社群辭典是一个用 git 收集台語詞的所在。逐家用 GitHub 帳號登入、填一張表，就會當提交一个詞；管理者審查了後，這个詞就收入來。'),
    h('h2', {}, '分類'),
    categoryCards(),
    h('h3', {}, '腔口差類型'),
    h('p', {}, '參考教育部《臺灣台語常用詞辭典》的「方言差」：分做語音差異佮詞彙比較兩部份。會當複選；分袂清楚就揀「其他」。'),
    h(
      'dl',
      { class: 'facts' },
      Object.entries(VARIATION_TYPES).flatMap(([v, t]) => [h('dt', {}, t), h('dd', {}, VARIATION_TEXT[v])]),
    ),
    h('h3', {}, '腔口'),
    h('p', {}, `用教典的十个調查點：${ACCENTS.filter((a) => a !== ACCENT_OTHER).join('、')}。攏無合就揀「其他」，閣寫是佗位的講法。`),
    h('h2', {}, '好的提交'),
    h(
      'ul',
      {},
      h('li', {}, '台羅用教育部台灣閩南語羅馬字拼音方案，會當用調符抑是數字。'),
      h('li', {}, '「說明」寫你佇佗位聽著、啥人按怎講，愈詳細愈好。'),
      h('li', {}, '別人已經提交過的詞，若你的腔口無仝，嘛會當閣提交。'),
    ),
    h('h2', {}, '審查'),
    h('p', {}, '每一筆提交攏會變做 GitHub 的 pull request，由管理者人工審查。台羅拼了著毋著是人工檢查，電腦干焦檢查格式。'),
    h('h2', {}, '授權佮帳號'),
    h('dl', { class: 'facts' },
      h('dt', {}, 'CC0'), h('dd', {}, '提交的內容用 CC0 1.0 公眾領域貢獻宣告釋出，任何人攏會當自由使用。'),
      h('dt', {}, 'GitHub 帳號'), h('dd', {}, '提交愛用 GitHub 帳號登入，你的帳號會公開顯示做 commit 的作者。'),
      h('dt', {}, '修改、收回'), h('dd', {}, '你會當修改抑是收回家己的詞目，嘛是經過審查。收回的詞目會對目前的資料提掉，毋過猶原留佇 git 歷史內底，CC0 宣告袂取消。'),
    ),
  );
}

const ROUTES = { '/': renderSearch, '/submit': renderSubmit, '/about': renderAbout };

function route() {
  const path = location.hash.replace(/^#/, '') || '/';
  const render = ROUTES[path] ?? renderSearch;
  for (const a of document.querySelectorAll('.tabs a')) {
    if (a.dataset.route === path) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  render();
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
route();
