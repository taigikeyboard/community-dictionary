import { MAX_EXAMPLES, MAX_WORDS } from '../lib/entry.js';
import { currentUser, signIn, signOut, submitErrorText, submitWords, WorkerError } from './account.js';
import { loadRows } from './data.js';
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
import { backButton, hero, pageTitle, view } from './page.js';
import { matchesPopover } from './search-box.js';
import { listJoin, sentenceJoin, t, tParts } from './strings.js';

// The 提交新詞 page and the 修改 page (the same form for one of the contributor's own entries): the
// form, its checks and sending it to the Worker, and the page after it is sent.

// a word row of the form lists only the closest few words already collected
const WORD_ROW_LIMIT = 5;

// The tips above the form, numbered: one list item per tip, the first with a sign-up link.
const submitTips = () => {
  const signUp = h('a', { href: 'https://github.com/signup', target: '_blank', rel: 'noopener' }, t('submit.signUp'));
  const tips = [tParts('submit.tipSignIn', { link: signUp }), t('submit.tipTl'), t('submit.tipHanji')];
  return h('section', { class: 'submit-tips', 'aria-label': t('submit.tips') }, h('ol', {}, tips.map((tip) => h('li', {}, tip))));
};

// The signed-in line under the form and on 我的提交: 「用 <login> 登入 · 我的提交 · 登出」; signing
// out redraws the page signed out. Empty while signed out.
export function accountLine(user, { withMine = true } = {}) {
  if (!user) return null;
  const out = h('button', { class: 'link-button', type: 'button' }, t('account.signOut'));
  out.addEventListener('click', async () => {
    out.disabled = true;
    await signOut();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  const mine = withMine ? [' · ', h('a', { href: '#/mine' }, t('mine.title'))] : [];
  return h('p', { class: 'account-line' }, t('account.signedInAs', { login: user.login }), mine, ' · ', out);
}

// An entry as the form's draft shape, to fill the 修改 form.
const entryDraft = (entry) => ({ ...entry, words: [{ hanji: entry.hanji, tl: entry.tl }] });

// `edit`: { path, entry, key } of the contributor's own entry; without it, the 提交新詞 form.
export function renderSubmit({ edit = null } = {}) {
  const draft = edit ? entryDraft(edit.entry) : takeDraft();
  const notice = h('p', { class: 'form-notice', role: 'status', hidden: true });
  const say = (text) => {
    notice.textContent = text;
    notice.hidden = false;
  };
  // the signed-out label (「登入 GitHub 提交」) while signed out, 「提交」 once signed in; a hidden copy of the longer label,
  // stacked in the same grid cell, holds the button at that width so it never changes size when
  // the session loads or the contributor signs out.
  const signedOutLabel = edit ? t('edit.button') : t('submit.signedOut');
  const submitLabel = h('span');
  const showLabel = (user) => {
    submitLabel.textContent = edit ? t('edit.button') : user ? t('submit.button') : signedOutLabel;
  };
  const account = h('div', { class: 'account-slot' });
  const submit = h(
    'button',
    { class: 'button button-steady', type: 'submit' },
    h('span', { class: 'button-sizer', 'aria-hidden': 'true' }, signedOutLabel),
    submitLabel,
  );
  const session = currentUser();
  session.then((user) => {
    showLabel(user);
    account.replaceChildren(accountLine(user) ?? '');
  });

  showLabel(null);
  // the 修改 form holds its one word
  const words = pairList(edit ? { ...WORD_LIST, max: 1 } : WORD_LIST, {
    onDropped: (dropped) => say(t('form.tooManyWords', { max: MAX_WORDS, dropped })),
    initial: draft?.words ?? [],
  });
  const examples = pairList(EXAMPLE_LIST, {
    onDropped: (dropped) => say(t('form.tooManyExamples', { max: MAX_EXAMPLES, dropped })),
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
      h('span', { class: 'field-label' }, t('field.words')),
      // several words go together only on a new submission; the 修改 form holds one
      edit ? null : h('p', { class: 'field-hint' }, t('form.wordsHint')),
      words,
    ),
    field('meaning', t('field.meaning'), textInput('meaning')),
    // 例句 in the same white box as 詞條 (styles.css .form-box)
    h('div', { class: 'field form-box' }, h('span', { class: 'field-label' }, t('field.examples')), examples, errorSlot('examples')),
    accentGroup(draft ?? {}),
    tagGroup(draft?.tags ?? []),
    field('note', t('field.note'), textInput('note', { multiline: true })),
    h('div', { class: 'actions' }, submit, notice),
    account,
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
        // an edit that keeps its pair finds itself, which is no conflict
        if (dup.status === 'mine' && dup.key !== edit?.key) mine.push({ field: 'tl', row, text: t('form.mine') });
        if (dup.status === 'attested') already.push(t('form.attested', { word: wordLabel(entry), people: listJoin(dup.contributors) }));
      }
    } catch {
      say(t('data.loadError'));
      return;
    }
    if (mine.length > 0) return showErrors(form, rowElements, exampleRows, mine);
    const keys = entries.map((e) => e.key).join(',');
    if (already.length > 0 && confirmedKeys !== keys) {
      confirmedKeys = keys;
      say(t('form.attestedAdvice', { list: sentenceJoin(already) }));
      return;
    }
    // signing in leaves the page; the draft brings the 提交新詞 form back as it was (the 修改 form
    // reloads its entry)
    const goSignIn = () => {
      if (!edit) saveDraft(form, words, examples);
      signIn(location.hash);
    };
    if (!signedIn) return goSignIn();

    submit.disabled = true;
    say(t('submit.sending'));
    try {
      const pairs = entries.map(({ entry }) => ({ hanji: entry.hanji, tl: entry.tl }));
      const pullRequest = await submitWords(edit ? { ...shared, ...pairs[0], path: edit.path } : { ...shared, words: pairs });
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

  const title = t(edit ? 'edit.title' : 'submit.title');
  document.title = pageTitle(title);
  view.replaceChildren(...[backButton(), hero(title), edit ? null : submitTips(), form].filter(Boolean));
}

// After a submission: the pull request the Worker opened, where the maintainer reviews the words.
function renderSubmitted(pullRequest) {
  // only a GitHub page is linked, whatever the reply held
  const url = /^https:\/\/github\.com\//.test(pullRequest?.url) ? pullRequest.url : null;
  view.replaceChildren(
    backButton(),
    hero(t('submit.done')),
    h(
      'div',
      { class: 'submitted' },
      h('p', {}, t('submit.thanks')),
      url ? h('p', {}, h('a', { href: url, target: '_blank', rel: 'noopener' }, t('submit.progress', { number: pullRequest.number }))) : null,
      h('p', {}, h('a', { href: '#/mine' }, t('mine.title'))),
    ),
  );
  window.scrollTo(0, 0);
  view.querySelector('h1').focus({ preventScroll: true });
}
