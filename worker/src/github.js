import { base64url } from './session.js';

// GitHub REST calls: the OAuth code exchange, the user lookup, and the App's installation token
// that every write goes through (the contributor's own token never writes).

const API = 'https://api.github.com';
const OAUTH = 'https://github.com/login/oauth';
const HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'community-dictionary-worker',
  'X-GitHub-Api-Version': '2022-11-28',
};

export class GitHubError extends Error {
  constructor(method, path, status, body) {
    super(`GitHub ${method} ${path} → ${status}: ${body.slice(0, 300)}`);
    this.status = status;
  }
}

export async function api(token, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { ...HEADERS, Authorization: `Bearer ${token}`, ...(body && { 'Content-Type': 'application/json' }) },
    body: body && JSON.stringify(body),
  });
  if (!res.ok) throw new GitHubError(method, path, res.status, await res.text());
  return res.status === 204 ? null : res.json();
}

// Like `api`, but a 404 is an answer (null), not an error.
export async function apiOrNull(token, method, path) {
  try {
    return await api(token, method, path);
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) return null;
    throw err;
  }
}

export async function exchangeCode(env, { code, verifier, redirectUri }) {
  const res = await fetch(`${OAUTH}/access_token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': HEADERS['User-Agent'] },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || typeof data.access_token !== 'string') {
    throw new Error(`GitHub code exchange failed: ${res.status} ${data.error ?? ''}`);
  }
  return data.access_token;
}

export function authorizeUrl(env, { state, challenge, redirectUri }) {
  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID,
    redirect_uri: redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    allow_signup: 'true',
  });
  return `${OAUTH}/authorize?${params}`;
}

// GitHub hands out PKCS#1 keys; WebCrypto imports PKCS#8 only, so Phase 4 converts it once with
// `openssl pkcs8 -topk8 -nocrypt -in app.pem`.
async function importPrivateKey(pem) {
  const text = pem.replace(/\\n/g, '\n');
  if (text.includes('BEGIN RSA PRIVATE KEY')) {
    throw new Error('GITHUB_APP_PRIVATE_KEY is PKCS#1; convert it with `openssl pkcs8 -topk8 -nocrypt -in app.pem`');
  }
  const der = Uint8Array.from(atob(text.replace(/-----[^-]+-----|\s/g, '')), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

// App JWT per GitHub Docs: RS256, iat 60 s in the past against clock drift, exp ≤ 10 minutes,
// iss = the App's client ID.
export async function appJwt(env, now = Date.now()) {
  const seconds = Math.floor(now / 1000);
  const encode = (obj) => base64url(new TextEncoder().encode(JSON.stringify(obj)));
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iat: seconds - 60, exp: seconds + 540, iss: env.GITHUB_CLIENT_ID })}`;
  const key = await importPrivateKey(env.GITHUB_APP_PRIVATE_KEY);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64url(new Uint8Array(sig))}`;
}

// Installation tokens live an hour; an isolate reuses one until five minutes before it expires.
let cachedToken = null;

export function clearTokenCache() {
  cachedToken = null;
}

export async function installationToken(env) {
  if (cachedToken && cachedToken.expires - 5 * 60_000 > Date.now()) return cachedToken.token;
  const jwt = await appJwt(env);
  const installation = await api(jwt, 'GET', `/repos/${env.GITHUB_REPO}/installation`);
  const [, repoName] = env.GITHUB_REPO.split('/');
  const data = await api(jwt, 'POST', `/app/installations/${installation.id}/access_tokens`, {
    repositories: [repoName],
    permissions: { contents: 'write', pull_requests: 'write' },
  });
  cachedToken = { token: data.token, expires: Date.parse(data.expires_at) };
  return data.token;
}
