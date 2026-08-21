import crypto from 'node:crypto';
import { signJwt } from './jwt.js';

export type WingsNode = { scheme: string; fqdn: string; daemonListen: number; daemonToken: string };

export class WingsError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = 'WingsError';
    this.status = status;
    this.body = body;
  }
}

export function wingsUrl(node: WingsNode) {
  return `${node.scheme}://${node.fqdn}:${node.daemonListen}`;
}

function panelBaseUrl() {
  return (process.env.APP_URL || process.env.CORS_ORIGIN?.split(',')[0] || 'http://localhost:25050').replace(/\/$/, '');
}

function authHeader(node: WingsNode, serverUuid?: string): string {
  // Stock Wings expects a short-lived JWT signed with the daemon token.
  const conn = `${node.fqdn}:${node.daemonListen}`;
  const now = Math.floor(Date.now() / 1000);
  const token = signJwt(node.daemonToken, {
    iss: panelBaseUrl(),
    aud: [conn],
    exp: now + 60,
    jti: crypto.randomUUID(),
    scope: serverUuid ? `server:${serverUuid}` : undefined,
    server_uuid: serverUuid,
    unique_id: crypto.randomUUID(),
  });
  return `Bearer ${token}`;
}

export async function wingsFetch(node: WingsNode, path: string, init: RequestInit & { timeoutMs?: number } = {}, serverUuid?: string): Promise<Response> {
  const { timeoutMs = 15000, ...rest } = init;
  const url = `${wingsUrl(node)}${path}`;
  const headers = new Headers(rest.headers);
  headers.set('Authorization', authHeader(node, serverUuid));
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  headers.delete('Cookie');
  const doFetch = () => fetch(url, { ...rest, headers, signal: rest.signal ?? AbortSignal.timeout(timeoutMs) });
  let r = await doFetch();
  // Custom/modified daemons may accept the raw token instead of signed JWTs — retry once.
  if (r.status === 401 || r.status === 403) {
    const retryHeaders = new Headers(rest.headers);
    retryHeaders.set('Authorization', `Bearer ${node.daemonToken}`);
    if (!retryHeaders.has('Accept')) retryHeaders.set('Accept', 'application/json');
    try {
      const retry = await fetch(url, { ...rest, headers: retryHeaders, signal: AbortSignal.timeout(timeoutMs) });
      if (retry.ok) r = retry;
    } catch { /* keep original response */ }
  }
  return r;
}

async function wingsJson<T>(node: WingsNode, path: string, init: RequestInit & { timeoutMs?: number } = {}, serverUuid?: string): Promise<T> {
  const r = await wingsFetch(node, path, init, serverUuid);
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    const detail = (body as { errors?: { detail?: string }[] } | null)?.errors?.[0]?.detail || `Wings returned ${r.status}`;
    throw new WingsError(detail, r.status, body);
  }
  return r.json() as Promise<T>;
}

async function wingsNoContent(node: WingsNode, path: string, init: RequestInit & { timeoutMs?: number } = {}, serverUuid?: string): Promise<void> {
  const r = await wingsFetch(node, path, init, serverUuid);
  if (!r.ok) {
    const body = await r.json().catch(() => null);
    const detail = (body as { errors?: { detail?: string }[] } | null)?.errors?.[0]?.detail || `Wings returned ${r.status}`;
    throw new WingsError(detail, r.status, body);
  }
}

// ── Server lifecycle ──

export async function createServer(node: WingsNode, payload: Record<string, unknown>): Promise<void> {
  await wingsNoContent(node, '/api/servers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
}

export async function syncServer(node: WingsNode, serverUuid: string): Promise<void> {
  await wingsNoContent(node, `/api/servers/${serverUuid}/sync`, { method: 'POST', timeoutMs: 10000 }, serverUuid);
}

export async function deleteServer(node: WingsNode, serverUuid: string): Promise<void> {
  await wingsNoContent(node, `/api/servers/${serverUuid}`, { method: 'DELETE', timeoutMs: 20000 }, serverUuid);
}

export async function setServerPower(node: WingsNode, serverUuid: string, action: 'start' | 'stop' | 'restart' | 'kill', waitSeconds = 30): Promise<void> {
  await wingsNoContent(node, `/api/servers/${serverUuid}/power`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, wait_seconds: waitSeconds }), timeoutMs: 45000 }, serverUuid);
}

export async function sendServerCommand(node: WingsNode, serverUuid: string, command: string): Promise<void> {
  await wingsNoContent(node, `/api/servers/${serverUuid}/commands`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commands: [command] }) }, serverUuid);
}

export async function getServerLogs(node: WingsNode, serverUuid: string): Promise<string[]> {
  const j = await wingsJson<{ data?: string[] }>(node, `/api/servers/${serverUuid}/logs`, {}, serverUuid);
  return j.data || [];
}

export async function triggerInstall(node: WingsNode, serverUuid: string, reinstall = false): Promise<void> {
  await wingsNoContent(node, `/api/servers/${serverUuid}/install`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reinstall }) }, serverUuid);
}

export async function ping(node: WingsNode): Promise<{ version: string | null }> {
  const j = await wingsJson<Record<string, unknown>>(node, '/', {}, undefined);
  const system = (j as { system?: { version?: string } }).system;
  return { version: system?.version ?? null };
}
