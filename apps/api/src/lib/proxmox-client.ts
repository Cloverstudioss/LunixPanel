import { decrypt } from './crypto.js';

export type ProxmoxCluster = { host: string; apiTokenId: string; apiTokenSecretEncrypted: string; verifyTls: boolean };

export type Upid = string;

type FetchInit = RequestInit & { tls?: { rejectUnauthorized?: boolean }; timeoutMs?: number };

function headersFor(cluster: ProxmoxCluster, encryptionKey: string) {
  const secret = decrypt(cluster.apiTokenSecretEncrypted, encryptionKey);
  return { Authorization: `PVEAPIToken=${cluster.apiTokenId}=${secret}`, Accept: 'application/json' } as Record<string, string>;
}

export async function pveFetch(cluster: ProxmoxCluster, encryptionKey: string, path: string, init: FetchInit = {}) {
  const url = `${cluster.host.replace(/\/$/, '')}/api2/json${path}`;
  const headers = { ...headersFor(cluster, encryptionKey), ...(init.headers as Record<string, string> || {}) };
  const { timeoutMs, ...rest } = init;
  // Bun fetch supports per-request TLS overrides — no global env toggling (race-free).
  const fetchInit = { ...rest, headers, tls: { rejectUnauthorized: !!cluster.verifyTls }, signal: init.signal ?? AbortSignal.timeout(timeoutMs ?? 15000) } as RequestInit;
  return fetch(url, fetchInit);
}

async function pveJson<T>(cluster: ProxmoxCluster, encryptionKey: string, path: string, init: FetchInit = {}): Promise<T> {
  const r = await pveFetch(cluster, encryptionKey, path, init);
  if (!r.ok) throw new Error(`Proxmox ${init.method || 'GET'} ${path} failed: ${r.status} ${await r.text().catch(() => '')}`);
  return (await r.json() as { data: T }).data;
}

export async function listNodes(cluster: ProxmoxCluster, encryptionKey: string) {
  return pveJson<unknown[]>(cluster, encryptionKey, '/nodes');
}

export async function vmAction(cluster: ProxmoxCluster, encryptionKey: string, node: string, type: 'qemu' | 'lxc', vmid: number, action: string) {
  return pveJson<{ data?: string }>(cluster, encryptionKey, `/nodes/${node}/${type}/${vmid}/status/${action}`, { method: 'POST' });
}

export async function getVmStatus(cluster: ProxmoxCluster, encryptionKey: string, node: string, type: 'qemu' | 'lxc', vmid: number) {
  return pveJson<Record<string, unknown>>(cluster, encryptionKey, `/nodes/${node}/${type}/${vmid}/status/current`);
}

export async function getVmConfig(cluster: ProxmoxCluster, encryptionKey: string, node: string, type: 'qemu' | 'lxc', vmid: number) {
  return pveJson<Record<string, unknown>>(cluster, encryptionKey, `/nodes/${node}/${type}/${vmid}/config`);
}

export async function vncProxy(cluster: ProxmoxCluster, encryptionKey: string, node: string, type: 'qemu' | 'lxc', vmid: number, opts: { websocket?: boolean } = {}) {
  const body = new URLSearchParams();
  if (opts.websocket) body.set('websocket', '1');
  return pveJson<{ ticket: string; port: number; cert?: string; upid?: string }>(cluster, encryptionKey, `/nodes/${node}/${type}/${vmid}/vncproxy`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
}

export async function getVmRrdData(cluster: ProxmoxCluster, encryptionKey: string, node: string, type: 'qemu' | 'lxc', vmid: number, timeframe: 'hour' | 'day' | 'week' | 'month' | 'year' = 'hour', cf: 'AVERAGE' | 'MAX' = 'AVERAGE') {
  return pveJson<Record<string, unknown>[]>(cluster, encryptionKey, `/nodes/${node}/${type}/${vmid}/rrddata?timeframe=${timeframe}&cf=${cf}`);
}

export async function listStorages(cluster: ProxmoxCluster, encryptionKey: string, node: string) {
  return pveJson<{ storage: string; type: string; content: string; avail: number; total: number }[]>(cluster, encryptionKey, `/nodes/${node}/storage`);
}

export async function listStorageContent(cluster: ProxmoxCluster, encryptionKey: string, node: string, storage: string, content?: string) {
  const q = content ? `?content=${encodeURIComponent(content)}` : '';
  return pveJson<{ volid: string; content: string; size: number; notes?: string; vmid?: number }[]>(cluster, encryptionKey, `/nodes/${node}/storage/${encodeURIComponent(storage)}/content${q}`);
}

async function formPost(cluster: ProxmoxCluster, encryptionKey: string, path: string, params: Record<string, string | number | undefined>) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) body.set(k, String(v));
  return pveJson<{ data: Upid }>(cluster, encryptionKey, path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(), timeoutMs: 30000 });
}

export async function createQemu(cluster: ProxmoxCluster, encryptionKey: string, node: string, params: Record<string, string | number>) {
  return formPost(cluster, encryptionKey, `/nodes/${node}/qemu`, params);
}

export async function createLxc(cluster: ProxmoxCluster, encryptionKey: string, node: string, params: Record<string, string | number>) {
  return formPost(cluster, encryptionKey, `/nodes/${node}/lxc`, params);
}

export async function listVms(cluster: ProxmoxCluster, encryptionKey: string) {
  const nodes = await listNodes(cluster, encryptionKey) as { node: string }[];
  const out: { node: string; type: 'qemu' | 'lxc'; vmid: number; name: string; status: string; maxmem: number; maxdisk: number; cpus: number }[] = [];
  await Promise.all(nodes.map(async (n) => {
    await Promise.all((['qemu', 'lxc'] as const).map(async (type) => {
      try {
        const list = await pveJson<{ vmid: number; name?: string; status?: string; maxmem?: number; maxdisk?: number; cpus?: number }[]>(cluster, encryptionKey, `/nodes/${n.node}/${type}`);
        for (const vm of list || []) {
          out.push({ node: n.node, type, vmid: vm.vmid, name: vm.name || `VM ${vm.vmid}`, status: vm.status || 'unknown', maxmem: vm.maxmem || 0, maxdisk: vm.maxdisk || 0, cpus: vm.cpus || 0 });
        }
      } catch { /* node may be offline or type unsupported */ }
    }));
  }));
  return out;
}

export async function listNetworkInterfaces(cluster: ProxmoxCluster, encryptionKey: string, node: string) {
  return pveJson<{ iface: string; type: string; address?: string; netmask?: string; gateway?: string; vmbridge?: string; vlan?: string; active: boolean }[]>(cluster, encryptionKey, `/nodes/${node}/network`);
}

export async function deleteVm(cluster: ProxmoxCluster, encryptionKey: string, node: string, type: 'qemu' | 'lxc', vmid: number, opts: { destroyUnreferenced?: boolean } = {}) {
  const q = opts.destroyUnreferenced ? '?destroy-unreferenced-disks=1' : '';
  return pveJson<{ data: Upid }>(cluster, encryptionKey, `/nodes/${node}/${type}/${vmid}${q}`, { method: 'DELETE', timeoutMs: 30000 });
}

export async function renameVm(cluster: ProxmoxCluster, encryptionKey: string, node: string, type: 'qemu' | 'lxc', vmid: number, hostname: string) {
  // QEMU config key is `name`, LXC uses `hostname`.
  const key = type === 'qemu' ? 'name' : 'hostname';
  const body = new URLSearchParams({ [key]: hostname });
  return pveJson<Record<string, unknown>>(cluster, encryptionKey, `/nodes/${node}/${type}/${vmid}/config`, { method: 'PUT', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
}

// ── Tasks ──

export async function getTaskStatus(cluster: ProxmoxCluster, encryptionKey: string, node: string, upid: Upid) {
  return pveJson<{ status: 'running' | 'stopped'; exitcode?: number; type?: string; id?: string; user?: string }>(cluster, encryptionKey, `/nodes/${node}/tasks/${encodeURIComponent(upid)}/status`);
}

export async function waitForTask(cluster: ProxmoxCluster, encryptionKey: string, node: string, upid: Upid, opts: { timeoutMs?: number; intervalMs?: number } = {}) {
  const { timeoutMs = 120000, intervalMs = 1500 } = opts;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const st = await getTaskStatus(cluster, encryptionKey, node, upid);
    if (st.status === 'stopped') {
      if (st.exitcode !== undefined && st.exitcode !== 0) throw new Error(`Proxmox task failed (exit ${st.exitcode}): ${upid}`);
      return st;
    }
    if (Date.now() > deadline) throw new Error(`Proxmox task timed out after ${timeoutMs}ms: ${upid}`);
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

// ── Snapshots ──

export async function listSnapshots(cluster: ProxmoxCluster, encryptionKey: string, node: string, type: 'qemu' | 'lxc', vmid: number) {
  const snaps = await pveJson<{ name: string; description?: string; snaptime?: number; vmstate?: boolean; parent?: string }[]>(cluster, encryptionKey, `/nodes/${node}/${type}/${vmid}/snapshot`);
  return (snaps || []).filter((s) => s.name !== 'current');
}

export async function createSnapshot(cluster: ProxmoxCluster, encryptionKey: string, node: string, type: 'qemu' | 'lxc', vmid: number, opts: { name: string; description?: string; includeRam?: boolean }) {
  return formPost(cluster, encryptionKey, `/nodes/${node}/${type}/${vmid}/snapshot`, { snapname: opts.name, description: opts.description, vmstate: type === 'qemu' && opts.includeRam ? 1 : undefined });
}

export async function rollbackSnapshot(cluster: ProxmoxCluster, encryptionKey: string, node: string, type: 'qemu' | 'lxc', vmid: number, snap: string) {
  return formPost(cluster, encryptionKey, `/nodes/${node}/${type}/${vmid}/snapshot/${encodeURIComponent(snap)}/rollback`, {});
}

export async function deleteSnapshot(cluster: ProxmoxCluster, encryptionKey: string, node: string, type: 'qemu' | 'lxc', vmid: number, snap: string) {
  return pveJson<{ data: Upid }>(cluster, encryptionKey, `/nodes/${node}/${type}/${vmid}/snapshot/${encodeURIComponent(snap)}`, { method: 'DELETE', timeoutMs: 30000 });
}

// ── Backups (vzdump) ──

export async function createBackup(cluster: ProxmoxCluster, encryptionKey: string, node: string, opts: { vmid: number; storage: string; mode?: 'snapshot' | 'suspend' | 'stop'; compress?: 'zstd' | 'lzo' | 'gzip' | '0'; notes?: string }) {
  return formPost(cluster, encryptionKey, `/nodes/${node}/vzdump`, {
    vmid: opts.vmid,
    storage: opts.storage,
    mode: opts.mode || 'snapshot',
    compress: opts.compress || 'zstd',
    notes: opts.notes,
  });
}

export async function listBackups(cluster: ProxmoxCluster, encryptionKey: string, node: string, storage: string, vmid: number) {
  const items = await listStorageContent(cluster, encryptionKey, node, storage, 'backup');
  return items.filter((i) => i.vmid === vmid);
}

export async function restoreQemu(cluster: ProxmoxCluster, encryptionKey: string, node: string, opts: { vmid: number; archive: string; storage: string }) {
  return formPost(cluster, encryptionKey, `/nodes/${node}/qemu`, { vmid: opts.vmid, archive: opts.archive, storage: opts.storage, force: 1, unique: 1 });
}

export async function restoreLxc(cluster: ProxmoxCluster, encryptionKey: string, node: string, opts: { vmid: number; archive: string; storage: string }) {
  return formPost(cluster, encryptionKey, `/nodes/${node}/lxc`, { vmid: opts.vmid, archive: opts.archive, storage: opts.storage, restore: 1, force: 1 });
}
