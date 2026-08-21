import React from 'react';
import { Sparkline, fetchStats, fmtBytes, fmtRate, vpsApiBase, type RrdPoint } from './shared';
import { FiCpu, FiHardDrive, FiActivity, FiDatabase, FiRefreshCw } from 'react-icons/fi';

const TIMEFRAMES = [
  { key: 'hour', label: '1h' },
  { key: 'day', label: '24h' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];

export default function StatsTab({ vps, status }: { vps: { assignmentId?: number | null; clusterId?: number; node?: string; type?: string; vmid?: number }; status: Record<string, unknown> | null }) {
  const [timeframe, setTimeframe] = React.useState('hour');
  const [rrd, setRrd] = React.useState<RrdPoint[]>([]);
  const [err, setErr] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const base = vpsApiBase(vps);

  const load = React.useCallback(() => {
    setLoading(true);
    fetchStats(base, timeframe).then((d) => { setRrd(d); setErr(''); }).catch((e) => setErr(String(e.message || e))).finally(() => setLoading(false));
  }, [base, timeframe]);
  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    const t = window.setInterval(load, 15000);
    return () => window.clearInterval(t);
  }, [load]);

  const cpu = rrd.map((p) => Number(p.cpu ?? 0));
  const mem = rrd.map((p) => Number(p.mem ?? 0));
  const maxmem = Number(status?.maxmem ?? 0) || undefined;
  const netin = rrd.map((p) => Number(p.netin ?? 0));
  const netout = rrd.map((p) => Number(p.netout ?? 0));
  const diskr = rrd.map((p) => Number(p.diskread ?? 0));
  const diskw = rrd.map((p) => Number(p.diskwrite ?? 0));
  const last = rrd[rrd.length - 1] || {};
  const memPct = maxmem ? Math.round(((Number(last.mem) || 0) / maxmem) * 100) : 0;

  return (
    <div className="stack">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div className="seg-toggle">
          {TIMEFRAMES.map((t) => (
            <button key={t.key} className={`seg-btn ${timeframe === t.key ? 'active' : ''}`} onClick={() => setTimeframe(t.key)}>{t.label}</button>
          ))}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={load}><FiRefreshCw size={12} /> Refresh</button>
      </div>
      {err && <div className="alert alert-error">{err}</div>}
      {loading && rrd.length === 0 ? <div className="skeleton-card"><div className="skeleton-line" /></div> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
          <div className="card" style={{ padding: 14 }}>
            <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}><FiCpu size={13} /> CPU <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>{((Number(last.cpu) || 0) * 100).toFixed(1)}%</span></div>
            <Sparkline data={cpu} color="#60a5fa" max={1} />
          </div>
          <div className="card" style={{ padding: 14 }}>
            <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}><FiActivity size={13} /> Memory <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>{fmtBytes(Number(last.mem) || 0)}{maxmem ? ` / ${fmtBytes(maxmem)} (${memPct}%)` : ''}</span></div>
            <Sparkline data={mem} color="#22c55e" max={maxmem} />
          </div>
          <div className="card" style={{ padding: 14 }}>
            <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}><FiHardDrive size={13} /> Network in <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>{fmtRate(Number(last.netin) || 0)}</span></div>
            <Sparkline data={netin} color="#22d3ee" />
          </div>
          <div className="card" style={{ padding: 14 }}>
            <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}><FiHardDrive size={13} /> Network out <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>{fmtRate(Number(last.netout) || 0)}</span></div>
            <Sparkline data={netout} color="#a78bfa" />
          </div>
          <div className="card" style={{ padding: 14 }}>
            <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}><FiDatabase size={13} /> Disk read <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>{fmtRate(Number(last.diskread) || 0)}</span></div>
            <Sparkline data={diskr} color="#f59e0b" />
          </div>
          <div className="card" style={{ padding: 14 }}>
            <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}><FiDatabase size={13} /> Disk write <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>{fmtRate(Number(last.diskwrite) || 0)}</span></div>
            <Sparkline data={diskw} color="#ef4444" />
          </div>
        </div>
      )}
    </div>
  );
}
