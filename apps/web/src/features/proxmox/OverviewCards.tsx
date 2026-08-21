import React from 'react';
import { Sparkline, fetchStats, fmtBytes, fmtRate, vpsApiBase, type RrdPoint } from './shared';
import { FiCpu, FiActivity, FiHardDrive, FiDatabase, FiClock } from 'react-icons/fi';

function fmtUptime(s: number): string {
  if (!s) return '—';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// Live overview cards + mini charts for a VPS (replaces raw JSON dumps).
export default function OverviewCards({ vps, status }: { vps: { assignmentId?: number | null; clusterId?: number; node?: string; type?: string; vmid?: number }; status: Record<string, unknown> }) {
  const [rrd, setRrd] = React.useState<RrdPoint[]>([]);
  const base = vpsApiBase(vps);

  const load = React.useCallback(() => {
    fetchStats(base, 'hour').then(setRrd).catch(() => {});
  }, [base]);
  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    const t = window.setInterval(load, 10000);
    return () => window.clearInterval(t);
  }, [load]);

  const cpuSeries = rrd.map((p) => Number(p.cpu ?? 0));
  const memSeries = rrd.map((p) => Number(p.mem ?? 0));
  const netSeries = rrd.map((p, i) => (i === 0 ? 0 : Number(p.netin ?? 0) + Number(p.netout ?? 0)));
  const ioSeries = rrd.map((p, i) => (i === 0 ? 0 : Number(p.diskread ?? 0) + Number(p.diskwrite ?? 0)));
  const last = rrd[rrd.length - 1] || {};
  const maxmem = Number(status.maxmem ?? 0) || undefined;
  const memPct = maxmem ? ((Number(last.mem) || 0) / maxmem) * 100 : 0;

  return (
    <div className="stack">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <Card title="CPU" icon={<FiCpu size={13} />}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{((Number(last.cpu) || 0) * 100).toFixed(1)}%</div>
          <Sparkline data={cpuSeries} color="#60a5fa" max={1} height={36} />
        </Card>
        <Card title="Memory" icon={<FiActivity size={13} />}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>
            {fmtBytes(Number(last.mem) || 0)}{maxmem ? <span className="muted" style={{ fontSize: 12 }}> / {fmtBytes(maxmem)}</span> : null}
          </div>
          <Sparkline data={memSeries} color="#22c55e" max={maxmem} height={36} />
        </Card>
        <Card title="Network" icon={<FiHardDrive size={13} />}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{fmtRate(Number(last.netin) || 0)} ↓</div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>{fmtRate(Number(last.netout) || 0)} ↑</div>
          <Sparkline data={netSeries} color="#22d3ee" height={24} />
        </Card>
        <Card title="Disk I/O" icon={<FiDatabase size={13} />}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{fmtRate(Number(last.diskread) || 0)} r</div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>{fmtRate(Number(last.diskwrite) || 0)} w</div>
          <Sparkline data={ioSeries} color="#f59e0b" height={24} />
        </Card>
        <Card title="Uptime" icon={<FiClock size={13} />}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{fmtUptime(Number(status.uptime) || 0)}</div>
          <div className="muted" style={{ fontSize: 11 }}>since last boot</div>
        </Card>
      </div>
      {maxmem ? (
        <div>
          <div className="label" style={{ marginBottom: 4 }}>Memory pressure</div>
          <div style={{ height: 8, borderRadius: 999, background: 'var(--surface-2)', overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(memPct, 100)}%`, height: '100%', background: memPct > 90 ? '#ef4444' : memPct > 70 ? '#f59e0b' : '#22c55e', transition: 'width .4s' }} />
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{memPct.toFixed(0)}% of {fmtBytes(maxmem)}</div>
        </div>
      ) : null}
    </div>
  );
}

function Card({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: '10px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)', marginBottom: 2 }}>{icon}{title}</div>
      {children}
    </div>
  );
}
