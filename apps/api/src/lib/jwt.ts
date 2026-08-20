import crypto from 'node:crypto';

function b64url(buf: Buffer | string) {
  return Buffer.from(buf).toString('base64url');
}

export function signJwt(secret: string, claims: Record<string, unknown>, extraHeader: Record<string, string> = {}) {
  const header = { alg: 'HS256', typ: 'JWT', ...extraHeader };
  const now = Math.floor(Date.now() / 1000);
  const body = { ...claims, iat: now, nbf: now - 300 };
  const encoded = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(body))}`;
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}