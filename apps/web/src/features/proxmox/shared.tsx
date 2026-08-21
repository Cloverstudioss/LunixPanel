import React from 'react';

// Shared UI helpers used by the proxmox feature tabs (mirrors main.tsx styles).

export function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="card"><div className="card-head"><h2 className="card-title">{title}</h2>{action}</div><div className="card-body">{children}</div></section>;
}

export function Sparkline({ data, color = '#22c55e', height = 48, max }: { data: number[]; color?: string; height?: number; max?: number }) {
  if (!data.length) return <div className="muted" style={{ fontSize: 12 }}>No data</div>;
  const w = 100;
  const hi = max ?? Math.max(...data, 0.000001);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${height - (Math.min(v, hi) / hi) * (height - 4) - 2}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block' }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      <polygon points={`0,${height} ${pts} ${w},${height}`} fill={color} opacity="0.12" />
    </svg>
  );
}

export function fmtBytes(b: number): string {
  if (!b) return '0 B';
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(2)} GB`;
}

export function fmtRate(bps: number): string {
  return `${fmtBytes(bps)}/s`;
}

// Resolve the API base path for a VPS (assignment id or raw ref).
export function vpsApiBase(vps: { assignmentId?: number | null; clusterId?: number; node?: string; type?: string; vmid?: number }): string {
  if (vps.assignmentId) return `/api/proxmox/vms/${vps.assignmentId}`;
  return `/api/proxmox/vms/raw/${vps.clusterId}/${encodeURIComponent(vps.node || '')}/${vps.type}/${vps.vmid}`;
}

export type RrdPoint = Record<string, number | null>;

export async function fetchStats(base: string, timeframe: string): Promise<RrdPoint[]> {
  const r = await fetch(`${base}/stats?timeframe=${timeframe}`, { credentials: 'include' });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.errors?.[0]?.detail || 'Failed to load stats');
  return j.data || [];
}
