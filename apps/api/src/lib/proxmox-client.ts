import { decrypt } from './crypto.js';

export type ProxmoxCluster = { host: string; apiTokenId: string; apiTokenSecretEncrypted: string; verifyTls: boolean };

function headersFor(cluster: ProxmoxCluster, encryptionKey: string) {
  const secret = decrypt(cluster.apiTokenSecretEncrypted, encryptionKey);
  return { Authorization: `PVEAPIToken=${cluster.apiTokenId}=${secret}`, Accept: 'application/json' } as Record<string, string>;
}

export async function pveFetch(cluster: ProxmoxCluster, encryptionKey: string, path: string, init: RequestInit = {}) {
  const url = `${cluster.host.replace(/\/$/, '')}/api2/json${path}`;
  const headers = { ...headersFor(cluster, encryptionKey), ...(init.headers as Record<string, string> || {}) };
  return fetch(url, { ...init, headers } as RequestInit);
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
