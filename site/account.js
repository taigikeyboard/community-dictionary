import { WORKER_URL } from './config.js';

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

export const signOut = () => call('POST', '/logout');

// → { url, number } of the pull request.
export async function submitWords(body) {
  return (await call('POST', '/submit', body)).pullRequest;
}

// What the form says for a failed submission; `labelOf(key)` names a word by its key.
export function submitErrorText(err, labelOf) {
  const code = err instanceof WorkerError ? err.data.error : null;
  if (code === 'already_submitted') return `你已經提交過：${(err.data.keys ?? []).map(labelOf).join('、')}。欲改請等審查了。`;
  if (code === 'cap_contributor') return '你有幾若个提交猶咧審查，等審查了才閣提交。';
  if (code === 'cap_total') return '這馬審查中 ê 提交傷濟，請小等才閣試。';
  if (code === 'invalid') return `格式有問題：${(err.data.errors ?? []).join('；')}`;
  if (code === 'too_large') return '一擺送傷濟字，請分開提交。';
  return '暫時送袂出去，請小等才閣試。';
}
