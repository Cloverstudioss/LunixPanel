import React from 'react';
import { vpsApiBase } from './shared';
import { FiTerminal, FiCopy, FiKey, FiRefreshCw } from 'react-icons/fi';

type SshInfo = { host: string | null; port: number; user: string; password: string | null; command: string | null };

// SSH credentials card with live IP discovery — shown on Overview + Console tabs.
export default function SshCard({ vps, compact }: { vps: { assignmentId?: number | null; clusterId?: number; node?: string; type?: string; vmid?: number }; compact?: boolean }) {
  const [info, setInfo] = React.useState<SshInfo | null>(null);
  const [err, setErr] = React.useState('');
  const [showPw, setShowPw] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const base = vpsApiBase(vps);

  const load = React.useCallback(() => {
    setLoading(true);
    fetch(`${base}/ssh`, { credentials: 'include' })
      .then((r) => r.json())
      .then((j) => { if (j.data) { setInfo(j.data); setErr(''); } else setErr(j.errors?.[0]?.detail || 'Failed to load SSH info'); })
      .catch(() => setErr('Failed to load SSH info'))
      .finally(() => setLoading(false));
  }, [base]);
  React.useEffect(() => { load(); }, [load]);

  async function copy(text: string | null, label: string) {
    if (!text) return;
    try { await navigator.clipboard.writeText(text); } catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
  }

  if (err && !info) return <div className="alert alert-error">{err}</div>;
  if (!info) return <div className="card" style={{ padding: '10px 14px' }}><span className="muted" style={{ fontSize: 12 }}>Loading SSH info…</span></div>;

  return (
    <div className="card" style={{ padding: '12px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <FiTerminal size={13} style={{ color: 'var(--muted)' }} />
        <h2 className="card-title" style={{ margin: 0, fontSize: 13 }}>SSH access</h2>
        <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={load} title="Re-detect IP"><FiRefreshCw size={11} /> Re-detect</button>
      </div>
      {!info.host ? (
        <p className="muted" style={{ fontSize: 12, margin: '0 0 6px' }}>
          IP not detected yet{info.host === null ? '' : ''} — the guest agent may not be running, or the VM uses DHCP without a reported lease.
        </p>
      ) : (
        <Row label="Address" value={`${info.host}:${info.port}`} onCopy={() => copy(`${info.host}:${info.port}`, 'address')} />
      )}
      <Row label="User" value={info.user} onCopy={() => copy(info.user, 'user')} />
      <Row
        label="Password"
        value={showPw ? (info.password || '—') : '••••••••••'}
        onCopy={() => copy(info.password, 'password')}
        right={(
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowPw(!showPw)}>{showPw ? 'Hide' : 'Show'}</button>
          </>
        )}
      />
      {info.command && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
          <code className="mono" style={{ fontSize: 12, background: 'var(--surface-2)', padding: '5px 8px', borderRadius: 6, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{info.command}</code>
          <button className="btn btn-primary btn-sm" onClick={() => copy(info.command, 'SSH command')}><FiCopy size={11} /> Copy</button>
        </div>
      )}
      {!info.password && !loading && <p className="muted" style={{ fontSize: 11, marginTop: 6 }}><FiKey size={10} style={{ verticalAlign: -1 }} /> No password stored — set one when assigning the VPS.</p>}
      {compact ? null : <p className="muted" style={{ fontSize: 11, marginTop: 6 }}>Use these credentials for SSH/SFTP. Keep them private.</p>}
    </div>
  );
}

function Row({ label, value, onCopy, right }: { label: string; value: string; onCopy: () => void; right?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0', fontSize: 13 }}>
      <span className="muted" style={{ width: 70, fontSize: 12 }}>{label}</span>
      <code className="mono" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</code>
      {right}
      <button className="btn btn-ghost btn-sm" onClick={onCopy} title={`Copy ${label.toLowerCase()}`}><FiCopy size={11} /></button>
    </div>
  );
}
