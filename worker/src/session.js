// Signed values (HMAC-SHA256) and the cookies that carry them: the sign-in session and the
// short-lived OAuth state. A value is `<base64url JSON>.<base64url signature>` with an `exp`
// (Unix seconds) inside, so the Worker needs no storage to trust it later.

const encoder = new TextEncoder();

export function base64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(text) {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

export function randomToken(bytes = 32) {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

function hmacKey(secret) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

export async function sign(secret, payload) {
  const body = base64url(encoder.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body));
  return `${body}.${base64url(new Uint8Array(sig))}`;
}

// Returns the payload, or null when the value is malformed, forged or expired.
export async function verify(secret, value, now = Date.now()) {
  if (typeof value !== 'string') return null;
  const [body, sig, extra] = value.split('.');
  if (!body || !sig || extra !== undefined) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), fromBase64url(sig), encoder.encode(body));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(body)));
    return typeof payload.exp === 'number' && payload.exp * 1000 > now ? payload : null;
  } catch {
    return null;
  }
}

export function readCookie(request, name) {
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

// HttpOnly: page scripts never see the value. SameSite=Lax: the site (taigikeyboard.tw) and the
// Worker (a subdomain) are the same site, so the site's credentialed fetch carries it, while
// other sites' cross-site POSTs do not.
export function cookie(name, value, { path = '/', maxAge }) {
  return `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}
