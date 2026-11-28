import { currentUser, ownSubmissions, signIn } from './account.js';
import { REPO_URL } from './config.js';
import { loadRows } from './data.js';
import { h } from './dom.js';
import { githubIcon, icon } from './icons.js';
import { editRoute, wordRoute, wordTitle } from './logic.js';
import { backButton, hero, pageTitle, view } from './page.js';
import { renderSubmit } from './submit-page.js';
import { t } from './strings.js';

// The 我貢獻 ê 詞 page (the signed-in contributor's words, in review and collected, each with 修改) and
// the 修改 page's loading step (it finds the entry, then draws the form). Both need a GitHub
// sign-in; anyone may edit any entry (D11), each edit is a pull request.

// Signed out: what the page needs and a button that signs in and comes back to this page.
function signInPrompt() {
  const button = h('button', { class: 'button', type: 'button' }, t('mine.signIn'));
  button.addEventListener('click', () => signIn(location.hash));
  return h('div', { class: 'mine-signin' }, h('p', {}, t('mine.signInHint')), button);
}

// The attestations that carry this contributor's id, as { key, login, hanji, tl, entry }.
function collectedBy(rows, user) {
  return rows.flatMap((row) =>
    row.attestations
      .filter((a) => a.contributor_id === user.id)
      .map((a) => ({ key: row.key, login: a.contributor, hanji: row.hanji, tl: row.tl, entry: { hanji: row.hanji, tl: row.tl, ...a } })),
  );
}

// An open submission's file as the same shape; its path names the login and key.
function inReview(submission) {
  const [, login, file] = submission.path.split('/');
  const { entry } = submission;
  return { key: file.replace(/\.json$/, ''), login, hanji: entry.hanji, tl: entry.tl, entry, pullRequest: submission.pullRequest };
}

// One word of the list: the word (a link to its cards), then icon buttons: on GitHub (the pull
// request while in review, the entry's file once collected) and 修改; their words are the tooltip and
// what a screen reader says.
const iconLink = (href, label, glyph, external = false) =>
  h('a', { class: 'icon-button', href, title: label, 'aria-label': label, ...(external ? { target: '_blank', rel: 'noopener' } : {}) }, glyph);

function mineItem(word) {
  const review = word.pullRequest && /^https:\/\/github\.com\//.test(word.pullRequest.url);
  const github = review
    ? iconLink(word.pullRequest.url, t('submit.progress', { number: word.pullRequest.number }), githubIcon(), true)
    : iconLink(`${REPO_URL}/blob/main/entries/${word.login}/${word.key}.json`, t('mine.file'), githubIcon(), true);
  return h(
    'li',
    { class: 'mine-item' },
    h('a', { class: 'mine-word', href: wordRoute(word.hanji, word.tl) }, wordTitle(word)),
    word.hanji ? h('span', { class: 'mine-tl tl' }, word.tl) : null,
    h('span', { class: 'mine-actions' }, github, iconLink(editRoute(word.login, word.key), t('card.edit'), icon('edit'))),
  );
}

const mineSection = (title, words) =>
  words.length > 0 ? h('section', { class: 'mine-section' }, h('h2', { class: 'mine-heading' }, title), h('ul', { class: 'mine-list' }, words.map(mineItem))) : null;

export function renderMine() {
  document.title = pageTitle(t('mine.title'));
  const body = h('div', { class: 'mine' }, h('p', { class: 'empty' }, t('data.loading')));
  view.replaceChildren(backButton(), hero(t('mine.title')), body);
  currentUser().then(async (user) => {
    if (!body.isConnected) return;
    if (!user) return body.replaceChildren(signInPrompt());
    try {
      const [submissions, rows] = await Promise.all([ownSubmissions(), loadRows()]);
      if (!body.isConnected) return;
      const pending = submissions.map(inReview);
      const collected = collectedBy(rows, user);
      body.replaceChildren(
        ...[
          mineSection(t('mine.inReview'), pending),
          mineSection(t('mine.collected'), collected),
          pending.length + collected.length === 0 ? h('p', { class: 'empty' }, t('mine.none')) : null,
        ].filter(Boolean),
      );
    } catch {
      body.replaceChildren(h('p', { class: 'empty' }, t('data.loadError')));
    }
  });
}

// The 修改 page for entries/<login>/<key>.json: the copy in the signed-in contributor's open
// submission when there is one (the Worker edits that branch), else the collected one, whoever
// contributed it.
export function renderEdit(login, key) {
  document.title = pageTitle(t('edit.title'));
  const body = h('div', { class: 'mine' }, h('p', { class: 'empty' }, t('data.loading')));
  view.replaceChildren(backButton(), hero(t('edit.title')), body);
  const path = `entries/${login}/${key}.json`;
  currentUser().then(async (user) => {
    if (!body.isConnected) return;
    if (!user) return body.replaceChildren(signInPrompt());
    try {
      const [submissions, rows] = await Promise.all([ownSubmissions(), loadRows()]);
      if (!body.isConnected) return;
      const row = rows.find((r) => r.key === key);
      const collected = row?.attestations.find((a) => a.contributor === login);
      const found = submissions.map(inReview).find((word) => word.login === login && word.key === key)
        ?? (collected && { entry: { hanji: row.hanji, tl: row.tl, ...collected } });
      if (!found) return body.replaceChildren(h('p', { class: 'empty' }, t('edit.notFound')));
      renderSubmit({ edit: { path, key, entry: found.entry } });
    } catch {
      body.replaceChildren(h('p', { class: 'empty' }, t('data.loadError')));
    }
  });
}
