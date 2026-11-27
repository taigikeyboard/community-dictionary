import { WORKER_URL } from './config.js';
import { describeIssues, listJoin, t } from './strings.js';

// The site's side of the submission Worker (worker/src/index.js): the sign-in session lives in an
// HttpOnly cookie on the Worker's host, so every call sends credentials and page scripts never see
// the session itself.

// A Worker reply that is not 2xx: `status` and the Worker's `error` code (plus its details).
export class WorkerError extends Error {
  constructor(status, data) {
    super(`worker: ${status} ${data?.error ?? ''}`);
    this.status = status;
    this.data = data ?? {};
  }
}

async function call(method, path, body) {
  const res = await fetch(`${WORKER_URL}${path}`, {
    method,
    credentials: 'include',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new WorkerError(res.status, data);
  return data;
}

// { id, login } when signed in, else null. A network failure counts as signed out.
export async function currentUser() {
  try {
    return await call('GET', '/session');
  } catch {
    return null;
  }
}

// Leaves the page for GitHub's sign-in; the Worker sends the browser back to `hash` on this site.
export function signIn(hash) {
  location.assign(`${WORKER_URL}/login?return=${encodeURIComponent(hash)}`);
}

// Ends the session (the Worker clears its cookie); a failure leaves it to expire on its own.
export async function signOut() {
  await call('POST', '/logout').catch(() => {});
}

// The signed-in contributor's open submissions: [{ path, entry, pullRequest: { url, number } }].
export async function ownSubmissions() {
  return (await call('GET', '/mine')).submissions;
}

// → { url, number } of the pull request. A body with `path` edits that entry instead.
export async function submitWords(body) {
  return (await call('POST', '/submit', body)).pullRequest;
}

// What the form says for a failed submission; `labelOf(key)` names a word by its key.
export function submitErrorText(err, labelOf) {
  const code = err instanceof WorkerError ? err.data.error : null;
  if (code === 'already_submitted') return t('worker.already_submitted', { words: listJoin((err.data.keys ?? []).map(labelOf)) });
  if (code === 'invalid') return t('worker.invalid', { details: listJoin(describeIssues(err.data.issues ?? []).map((found) => found.text)) });
  if (['cap_contributor', 'cap_total', 'too_large', 'unchanged'].includes(code)) return t(`worker.${code}`);
  if (code === 'not_owner' || code === 'not_found') return t('edit.notFound');
  return t('worker.try_later');
}
