import crypto from 'node:crypto';

function signJwt(payload: Record<string, unknown>, secret: string, expiresInSec = 60): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + expiresInSec })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function wingsAuthHeader(daemonToken: string): string {
  const token = signJwt({ iss: 'lunixpanel' }, daemonToken, 60);
  return `Bearer ${token}`;
}

export async function wingsFetch(node: { fqdn: string; scheme: string; daemonListen: number; daemonToken: string }, path: string, init: RequestInit = {}) {
  const base = `${node.scheme}://${node.fqdn}:${node.daemonListen}`;
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${node.daemonToken}`);
  headers.set('Accept', 'application/json');
  return fetch(`${base}${path}`, { ...init, headers });
}
