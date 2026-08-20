import { decrypt } from './crypto.js';

export type ProxmoxCluster = { host: string; apiTokenId: string; apiTokenSecretEncrypted: string; verifyTls: boolean };

function headersFor(cluster: ProxmoxCluster, encryptionKey: string) {
  const secret = decrypt(cluster.apiTokenSecretEncrypted, encryptionKey);
  return { Authorization: `PVEAPIToken=${cluster.apiTokenId}=${secret}`, Accept: 'application/json' } as Record<string, string>;
}

export async function pveFetch(cluster: ProxmoxCluster, encryptionKey: string, path: string, init: RequestInit = {}) {
  const url = `${cluster.host.replace(/\/$/, '')}/api2/json${path}`;
  const headers = { ...headersFor(cluster, encryptionKey), ...(init.headers as Record<string, string> || {}) };
  const baseInit: RequestInit & { tls?: { rejectUnauthorized?: boolean } } = { ...init, headers } as RequestInit & { tls?: { rejectUnauthorized?: boolean } };
  if (!cluster.verifyTls) (baseInit as unknown as Record<string, unknown>).tls = { rejectUnauthorized: false };
  const saved = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  if (!cluster.verifyTls) process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  try {
    return await fetch(url, baseInit as RequestInit);
  } finally {
    if (!cluster.verifyTls) {
      if (saved === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = saved;
    }
  }
}

export async function listNodes(cluster: ProxmoxCluster, encryptionKey: string) {
  const r = await pveFetch(cluster, encryptionKey, '/nodes');
  if (!r.ok) throw new Error(`Proxmox listNodes failed: ${r.status}`);
  return (await r.json() as { data: unknown[] }).data;
}

export async function vmAction(cluster: ProxmoxCluster, encryptionKey: string, node: string, type: 'qemu' | 'lxc', vmid: number, action: string) {
  const r = await pveFetch(cluster, encryptionKey, `/nodes/${node}/${type}/${vmid}/status/${action}`, { method: 'POST' });
  if (!r.ok) throw new Error(`Proxmox vmAction ${action} failed: ${r.status} ${await r.text()}`);
  return r.json();
}

export async function getVmStatus(cluster: ProxmoxCluster, encryptionKey: string, node: string, type: 'qemu' | 'lxc', vmid: number) {
  const r = await pveFetch(cluster, encryptionKey, `/nodes/${node}/${type}/${vmid}/status/current`);
  if (!r.ok) throw new Error(`getVmStatus failed: ${r.status} ${await r.text()}`);
  return (await r.json() as { data: Record<string, unknown> }).data;
}

export async function getVmConfig(cluster: ProxmoxCluster, encryptionKey: string, node: string, type: 'qemu' | 'lxc', vmid: number) {
  const r = await pveFetch(cluster, encryptionKey, `/nodes/${node}/${type}/${vmid}/config`);
  if (!r.ok) throw new Error(`getVmConfig failed: ${r.status} ${await r.text()}`);
  return (await r.json() as { data: Record<string, unknown> }).data;
}

export async function vncProxy(cluster: ProxmoxCluster, encryptionKey: string, node: string, type: 'qemu' | 'lxc', vmid: number) {
  const r = await pveFetch(cluster, encryptionKey, `/nodes/${node}/${type}/${vmid}/vncproxy`, { method: 'POST' });
  if (!r.ok) throw new Error(`vncProxy failed: ${r.status} ${await r.text()}`);
  return (await r.json() as { data: { ticket: string; port: number; cert?: string; user?: string } }).data;
}

export async function listStorages(cluster: ProxmoxCluster, encryptionKey: string, node: string) {
  const r = await pveFetch(cluster, encryptionKey, `/nodes/${node}/storage`);
  if (!r.ok) throw new Error(`listStorages failed: ${r.status} ${await r.text()}`);
  return (await r.json() as { data: { storage: string; type: string; content: string; avail: number; total: number }[] }).data;
}

export async function listStorageContent(cluster: ProxmoxCluster, encryptionKey: string, node: string, storage: string, content?: string) {
  const q = content ? `?content=${encodeURIComponent(content)}` : '';
  const r = await pveFetch(cluster, encryptionKey, `/nodes/${node}/storage/${encodeURIComponent(storage)}/content${q}`);
  if (!r.ok) throw new Error(`listStorageContent failed: ${r.status} ${await r.text()}`);
  return (await r.json() as { data: { volid: string; content: string; size: number }[] }).data;
}

export async function createQemu(cluster: ProxmoxCluster, encryptionKey: string, node: string, params: Record<string, string | number>) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) body.set(k, String(v));
  const r = await pveFetch(cluster, encryptionKey, `/nodes/${node}/qemu`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
  if (!r.ok) throw new Error(`createQemu failed: ${r.status} ${await r.text()}`);
  return r.json();
}

export async function createLxc(cluster: ProxmoxCluster, encryptionKey: string, node: string, params: Record<string, string | number>) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) body.set(k, String(v));
  const r = await pveFetch(cluster, encryptionKey, `/nodes/${node}/lxc`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
  if (!r.ok) throw new Error(`createLxc failed: ${r.status} ${await r.text()}`);
  return r.json();
}

export async function listVms(cluster: ProxmoxCluster, encryptionKey: string) {
  const nodesRes = await pveFetch(cluster, encryptionKey, '/nodes');
  if (!nodesRes.ok) return [];
  const nodes = (await nodesRes.json() as { data: { node: string }[] }).data;
  const out: { node: string; type: 'qemu' | 'lxc'; vmid: number; name: string; status: string; maxmem: number; maxdisk: number; cpus: number }[] = [];
  for (const n of nodes) {
    for (const type of ['qemu', 'lxc'] as const) {
      const r = await pveFetch(cluster, encryptionKey, `/nodes/${n.node}/${type}`);
      if (!r.ok) continue;
      const list = (await r.json() as { data: { vmid: number; name?: string; status?: string; maxmem?: number; maxdisk?: number; cpus?: number }[] }).data || [];
      for (const vm of list) {
        out.push({ node: n.node, type, vmid: vm.vmid, name: vm.name || `VM ${vm.vmid}`, status: vm.status || 'unknown', maxmem: vm.maxmem || 0, maxdisk: vm.maxdisk || 0, cpus: vm.cpus || 0 });
      }
    }
  }
  return out;
}
