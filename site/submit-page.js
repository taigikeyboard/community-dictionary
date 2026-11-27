import { MAX_EXAMPLES, MAX_WORDS } from '../lib/entry.js';
import { currentUser, signIn, submitErrorText, submitWords, WorkerError } from './account.js';
import { LOAD_ERROR, loadRows } from './data.js';
import { h } from './dom.js';
import {
  accentGroup,
  clearErrors,
  errorSlot,
  EXAMPLE_LIST,
  field,
  isBlankRow,
  pairList,
  readShared,
  saveDraft,
  showErrors,
  tagGroup,
  takeDraft,
  textInput,
  WORD_LIST,
  wordValues,
} from './form.js';
import { checkBatch, duplicateStatus, wordLabel } from './logic.js';
import { backButton, hero, SITE_TITLE, view } from './page.js';
import { matchesPopover } from './search-box.js';

// The 提交新詞 page: the form, its checks and sending it to the Worker, and the page after it is sent.

// a word row of the form lists only the closest few words already collected
const WORD_ROW_LIMIT = 5;

// The tips above the form, numbered: one list item per tip, each a string or h() nodes.
const SUBMIT_TIPS = [
  ['提交資料需要登入 GitHub 口座，若無口座請先去', h('a', { href: 'https://github.com/signup', target: '_blank', rel: 'noopener' }, '申請'), '。'],
  ['為著整理資料方便，台羅請使用教育部台語羅馬字。'],
  ['若無漢字、日語，彼欄會當留空。'],
];

const submitTips = () => h('section', { class: 'submit-tips', 'aria-label': '填寫提示' }, h('ol', {}, SUBMIT_TIPS.map((tip) => h('li', {}, tip))));

export function renderSubmit() {
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
  const submitLabel = h('span');
  const showLabel = (user) => {
    submitLabel.textContent = user ? '提交' : signedOutLabel;
  };
  const submit = h(
    'button',
    { class: 'button button-steady', type: 'submit' },
    h('span', { class: 'button-sizer', 'aria-hidden': 'true' }, signedOutLabel),
    submitLabel,
  );
  const session = currentUser();
  session.then(showLabel);

  showLabel(null);
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
    if (scope) clearErrors(scope);
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
    const signedIn = await session;

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
