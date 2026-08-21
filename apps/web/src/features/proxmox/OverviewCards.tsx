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

// Live overview: two large charts (CPU + memory) plus a compact stat strip.
export default function OverviewCards({ vps, status }: { vps: { assignmentId?: number | null; clusterId?: number; node?: string; type?: string; vmid?: number }; status: Record<string, unknown> }) {
  const [rrd, setRrd] = React.useState<RrdPoint[]>([]);
  const [timeframe, setTimeframe] = React.useState<'hour' | 'day' | 'week'>('hour');
  const base = vpsApiBase(vps);

  const load = React.useCallback(() => {
    fetchStats(base, timeframe).then(setRrd).catch(() => {});
  }, [base, timeframe]);
  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    if (timeframe !== 'hour') return;
    const t = window.setInterval(load, 10000);
    return () => window.clearInterval(t);
  }, [load, timeframe]);

  const cpuSeries = rrd.map((p) => Number(p.cpu ?? 0));
  const memSeries = rrd.map((p) => Number(p.mem ?? 0));
  const netInSeries = rrd.map((p) => Number(p.netin ?? 0));
  const netOutSeries = rrd.map((p) => Number(p.netout ?? 0));
  const last = rrd[rrd.length - 1] || {};
  const maxmem = Number(status.maxmem ?? 0) || undefined;
  const maxdisk = Number(status.maxdisk ?? 0) || undefined;
  const diskUsed = Number(status.disk ?? 0) || 0;
  const memPct = maxmem ? ((Number(last.mem) || 0) / maxmem) * 100 : 0;
  const diskPct = maxdisk ? (diskUsed / maxdisk) * 100 : 0;

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end' }}>
        <div className="seg-toggle">
          {(['hour', 'day', 'week'] as const).map((tf) => (
            <button key={tf} className={`seg-btn ${timeframe === tf ? 'active' : ''}`} onClick={() => setTimeframe(tf)}>
              {tf === 'hour' ? 'Live' : tf === 'day' ? '24h' : 'Week'}
            </button>
          ))}
        </div>
      </div>

      {/* Big charts */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12 }}>
        <ChartCard
          icon={<FiCpu size={13} />}
          title="CPU"
          value={`${((Number(last.cpu) || 0) * 100).toFixed(1)}%`}
          sub={`${status.cpus ?? '?'} vCPU`}
        >
          <Sparkline data={cpuSeries} color="#60a5fa" max={1} height={140} />
        </ChartCard>
        <ChartCard
          icon={<FiActivity size={13} />}
          title="Memory"
          value={fmtBytes(Number(last.mem) || 0)}
          sub={maxmem ? `of ${fmtBytes(maxmem)} · ${memPct.toFixed(0)}%` : ''}
        >
          <Sparkline data={memSeries} color="#22c55e" max={maxmem} height={140} />
        </ChartCard>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 12 }}>
        <ChartCard
          icon={<FiHardDrive size={13} />}
          title="Network"
          value={`${fmtRate(Number(last.netin) || 0)} ↓ · ${fmtRate(Number(last.netout) || 0)} ↑`}
        >
          <Sparkline data={netOutSeries} color="#a78bfa" height={56} />
          <Sparkline data={netInSeries} color="#22d3ee" height={56} />
        </ChartCard>
        <ChartCard
          icon={<FiDatabase size={13} />}
          title="Disk I/O"
          value={`${fmtRate(Number(last.diskread) || 0)} read · ${fmtRate(Number(last.diskwrite) || 0)} write`}
        >
          <Sparkline data={rrd.map((p) => Number(p.diskread ?? 0))} color="#f59e0b" height={56} />
          <Sparkline data={rrd.map((p) => Number(p.diskwrite ?? 0))} color="#fb7185" height={56} />
        </ChartCard>
      </div>

      {/* Compact stat strip — replaces the old verbose spec cards */}
      <div className="card" style={{ padding: '10px 14px', display: 'flex', flexWrap: 'wrap', gap: '6px 22px', alignItems: 'center', fontSize: 13 }}>
        <span><FiClock size={12} style={{ verticalAlign: -2, color: 'var(--muted)' }} /> <b>{fmtUptime(Number(status.uptime) || 0)}</b></span>
        <span className="muted">Uptime</span>
        <span style={{ width: 1, height: 16, background: 'var(--line)' }} />
        <span><FiCpu size={12} style={{ verticalAlign: -2, color: 'var(--muted)' }} /> <b>{String(status.cpus ?? '?')}</b> vCPU · <b>{maxmem ? fmtBytes(maxmem) : '?'}</b> RAM · <b>{maxdisk ? fmtBytes(maxdisk) : '?'}</b> Disk</span>
        {maxdisk ? (
          <>
            <span style={{ width: 1, height: 16, background: 'var(--line)' }} />
            <span style={{ minWidth: 160, flex: 1, maxWidth: 280 }}>
              <span className="muted" style={{ fontSize: 11 }}>Disk used {diskPct.toFixed(0)}%</span>
              <div style={{ height: 6, borderRadius: 999, background: 'var(--surface-2)', overflow: 'hidden', marginTop: 3 }}>
                <div style={{ width: `${Math.min(diskPct, 100)}%`, height: '100%', background: diskPct > 90 ? '#ef4444' : diskPct > 70 ? '#f59e0b' : '#22c55e' }} />
              </div>
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}

function ChartCard({ title, icon, value, sub, children }: { title: string; icon?: React.ReactNode; value: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ padding: '12px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>{icon}{title}</span>
        <span style={{ fontSize: 18, fontWeight: 700 }}>{value}</span>
        {sub && <span className="muted" style={{ fontSize: 12, marginLeft: 'auto' }}>{sub}</span>}
      </div>
      {children}
    </div>
  );
}
