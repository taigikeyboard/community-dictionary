import { authorizeUrl, exchangeCode, api } from './github.js';
import { cookie, randomToken, readCookie, sign, verify, base64url } from './session.js';
import { LOGIN_RE } from '../../lib/entry.js';
import { submitEdit, submitNew, SubmitError, withdraw } from './submit.js';

// Submission Worker: GitHub sign-in for the static site, and the endpoints that turn a filled-in
// form into a pull request. Routes: GET /login, /callback, /session; POST /logout, /submit,
// /withdraw.

// __Host-: Secure, Path=/ and no Domain, so a sibling *.taigikeyboard.tw page cannot plant one.
const SESSION_COOKIE = '__Host-session';
const OAUTH_COOKIE = '__Host-oauth';
const SESSION_SECONDS = 24 * 3600;
const OAUTH_SECONDS = 10 * 60;
const MAX_BODY_BYTES = 64 * 1024;

function allowedOrigins(env) {
  return env.SITE_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean);
}

function corsHeaders(env, request) {
  const origin = request.headers.get('Origin');
  if (!origin || !allowedOrigins(env).includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'GET, POST',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function json(env, request, status, data, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders(env, request), ...extraHeaders },
  });
}

function redirect(location, cookies = []) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
}

// Where the browser lands after sign-in: a hash route of the site, nothing else (percent-encoded,
// since a Location header takes ASCII only).
function returnUrl(env, ret) {
  return env.SITE_URL + (typeof ret === 'string' && /^#\/[^\s]*$/.test(ret) ? encodeURI(ret) : '#/');
}

async function login(env, request) {
  const url = new URL(request.url);
  const state = randomToken();
  const verifier = randomToken();
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  const ret = url.searchParams.get('return');
  const oauth = await sign(env.SESSION_KEY, OAUTH_COOKIE, { state, verifier, ret, exp: Math.floor(Date.now() / 1000) + OAUTH_SECONDS });
  const redirectUri = `${url.origin}/callback`;
  return redirect(authorizeUrl(env, { state, challenge, redirectUri }), [
    cookie(OAUTH_COOKIE, oauth, { maxAge: OAUTH_SECONDS }),
  ]);
}

async function callback(env, request) {
  const url = new URL(request.url);
  const oauth = await verify(env.SESSION_KEY, OAUTH_COOKIE, readCookie(request, OAUTH_COOKIE));
  const clearOauth = cookie(OAUTH_COOKIE, '', { maxAge: 0 });
  const code = url.searchParams.get('code');
  // Denied consent, an expired attempt or a forged state all end on the site, signed out.
  if (!oauth || !code || url.searchParams.get('state') !== oauth.state) {
    return redirect(returnUrl(env, oauth?.ret), [clearOauth]);
  }
  let user;
  try {
    const userToken = await exchangeCode(env, { code, verifier: oauth.verifier, redirectUri: `${url.origin}/callback` });
    // id and login are read once from GitHub; the user token is dropped right after.
    user = await api(userToken, 'GET', '/user');
  } catch (err) {
    console.error(`worker: sign-in failed: ${err.message}`);
    return redirect(returnUrl(env, oauth.ret), [clearOauth]);
  }
  const session = await sign(env.SESSION_KEY, SESSION_COOKIE, {
    id: user.id,
    login: user.login,
    exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS,
  });
  return redirect(returnUrl(env, oauth.ret), [clearOauth, cookie(SESSION_COOKIE, session, { maxAge: SESSION_SECONDS })]);
}

async function currentUser(env, request) {
  const session = await verify(env.SESSION_KEY, SESSION_COOKIE, readCookie(request, SESSION_COOKIE));
  // Defence in depth behind the signature: the identity must look like a GitHub account.
  if (!session || !Number.isSafeInteger(session.id) || session.id <= 0 || !LOGIN_RE.test(session.login)) return null;
  return { id: session.id, login: session.login };
}

async function readBody(request) {
  if (Number(request.headers.get('Content-Length')) > MAX_BODY_BYTES) throw new SubmitError(413, 'too_large');
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) throw new SubmitError(413, 'too_large');
  try {
    const body = JSON.parse(text);
    if (body !== null && typeof body === 'object' && !Array.isArray(body)) return body;
  } catch {
    // reported below
  }
  throw new SubmitError(400, 'invalid', { errors: ['body: must be a JSON object'] });
}

const ACTIONS = { '/submit': submitNew, '/withdraw': withdraw };

async function post(env, request, path) {
  // Cross-site request forgery guard: only the site's own pages may post.
  if (!allowedOrigins(env).includes(request.headers.get('Origin'))) {
    return json(env, request, 403, { error: 'forbidden_origin' });
  }
  if (path === '/logout') {
    return json(env, request, 200, { ok: true }, { 'Set-Cookie': cookie(SESSION_COOKIE, '', { maxAge: 0 }) });
  }
  const user = await currentUser(env, request);
  if (!user) return json(env, request, 401, { error: 'signed_out' });
  const body = await readBody(request);
  const action = path === '/submit' && body.path !== undefined ? submitEdit : ACTIONS[path];
  return json(env, request, 200, { pullRequest: await action(env, user, body) });
}

async function route(env, request) {
  const { pathname } = new URL(request.url);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(env, request) });
  if (request.method === 'GET') {
    if (pathname === '/login') return login(env, request);
    if (pathname === '/callback') return callback(env, request);
    if (pathname === '/session') {
      const user = await currentUser(env, request);
      return user ? json(env, request, 200, user) : json(env, request, 401, { error: 'signed_out' });
    }
  }
  if (request.method === 'POST' && (pathname === '/logout' || pathname in ACTIONS)) return post(env, request, pathname);
  return json(env, request, 404, { error: 'not_found' });
}

export default {
  async fetch(request, env) {
    try {
      return await route(env, request);
    } catch (err) {
      if (err instanceof SubmitError) {
        return json(env, request, err.status, { error: err.code, ...err.details });
      }
      // Details go to the Worker log; the contributor sees a generic retry message.
      console.error(`worker: ${request.method} ${new URL(request.url).pathname} failed: ${err.stack ?? err}`);
      return json(env, request, 502, { error: 'try_later' });
    }
  },
};
