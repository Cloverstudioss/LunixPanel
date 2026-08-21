import React from 'react';
import { Card, vpsApiBase, fmtBytes } from './shared';
import { FiPlus, FiRotateCcw, FiArchive } from 'react-icons/fi';

type Backup = { volid: string; content: string; size: number; notes?: string; ctime?: number };

export default function BackupsTab({ vps, toast }: { vps: { assignmentId?: number | null; clusterId?: number; node?: string; type?: string; vmid?: number }; toast?: ((m: string) => void) | undefined }) {
  const [backups, setBackups] = React.useState<Backup[]>([]);
  const [busy, setBusy] = React.useState('');
  const [err, setErr] = React.useState('');
  const [msg, setMsg] = React.useState('');
  const [storage, setStorage] = React.useState('local');
  const base = vpsApiBase(vps);

  const load = React.useCallback(() => {
    fetch(`${base}/backups?storage=${encodeURIComponent(storage)}`, { credentials: 'include' }).then((r) => r.json()).then((j) => {
      if (j.data) setBackups(j.data); else setErr(j.errors?.[0]?.detail || 'Failed to load backups');
    }).catch(() => setErr('Failed to load backups'));
  }, [base, storage]);
  React.useEffect(() => { load(); }, [load]);

  async function create() {
    setBusy('new'); setErr(''); setMsg('');
    const r = await fetch(`${base}/backups`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ storage }) });
    const j = await r.json().catch(() => ({}));
    setBusy('');
    if (!r.ok && r.status !== 202) { setErr(j.errors?.[0]?.detail || 'Backup failed'); return; }
    setMsg('Backup started — this can take a while depending on disk size.');
    toast?.('Backup started');
    setTimeout(load, 3000);
  }
  async function restore(b: Backup) {
    if (!window.confirm(`Restore ${b.volid.split('/').pop()}? The VM will be STOPPED and its disk OVERWRITTEN with the backup. This cannot be undone.`)) return;
    setBusy(b.volid); setErr(''); setMsg('');
    const r = await fetch(`${base}/backups/restore`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archive: b.volid }) });
    const j = await r.json().catch(() => ({}));
    setBusy('');
    if (!r.ok && r.status !== 202) { setErr(j.errors?.[0]?.detail || 'Restore failed (admin only)'); return; }
    setMsg('Restore started — the VM will be stopped during the process.');
    toast?.('Restore started');
  }

  return (
    <div className="stack">
      {msg && <div className="alert" style={{ borderColor: '#1a2e1a', background: '#0f1a12', color: '#bbf7d0' }}>{msg}</div>}
      {err && <div className="alert alert-error">{err}</div>}
      <Card
        title={`Backups (${backups.length})`}
        action={
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input className="input mono" style={{ width: 120, minHeight: 30 }} value={storage} onChange={(e) => setStorage(e.target.value)} placeholder="storage" title="PVE storage for vzdump backups" />
            <button className="btn btn-primary btn-sm" disabled={busy === 'new'} onClick={create}><FiPlus size={13} /> {busy === 'new' ? 'Backing up…' : 'Backup now'}</button>
          </div>
        }
      >
        {backups.length === 0 ? <p className="muted">No vzdump backups on "{storage}" for this VM.</p> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>File</th><th>Size</th><th>Notes</th><th className="right">Actions</th></tr></thead>
            <tbody>{backups.map((b) => (
              <tr key={b.volid}>
                <td><span className="fname-inner"><FiArchive size={13} style={{ color: 'var(--muted-2)' }} /><span className="fname-text mono">{b.volid.split('/').pop()}</span></span></td>
                <td className="mono muted" style={{ fontSize: 12 }}>{fmtBytes(b.size)}</td>
                <td className="muted" style={{ fontSize: 12, maxWidth: 260 }}>{b.notes || '—'}</td>
                <td className="right">
                  <button className="btn btn-ghost btn-sm" disabled={busy === b.volid} onClick={() => restore(b)} title="Restore (destructive)"><FiRotateCcw size={12} /> Restore</button>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
