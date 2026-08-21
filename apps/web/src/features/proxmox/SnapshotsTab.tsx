import React from 'react';
import { Card, vpsApiBase } from './shared';
import { FiPlus, FiRotateCcw, FiTrash2, FiCamera } from 'react-icons/fi';

type Snap = { name: string; description?: string; snaptime?: number; vmstate?: boolean };

export default function SnapshotsTab({ vps, toast }: { vps: { assignmentId?: number | null; clusterId?: number; node?: string; type?: string; vmid?: number }; toast?: ((m: string) => void) | undefined }) {
  return <SnapshotsInner vps={vps} toast={toast} />;
}

function SnapshotsInner({ vps, toast }: { vps: { assignmentId?: number | null; clusterId?: number; node?: string; type?: string; vmid?: number }; toast?: ((m: string) => void) | undefined }) {
  const [snaps, setSnaps] = React.useState<Snap[]>([]);
  const [busy, setBusy] = React.useState('');
  const [err, setErr] = React.useState('');
  const [msg, setMsg] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const [name, setName] = React.useState('');
  const [desc, setDesc] = React.useState('');
  const [withRam, setWithRam] = React.useState(false);
  const base = vpsApiBase(vps);

  const load = React.useCallback(() => {
    fetch(`${base}/snapshots`, { credentials: 'include' }).then((r) => r.json()).then((j) => {
      if (j.data) setSnaps(j.data); else setErr(j.errors?.[0]?.detail || 'Failed to load snapshots');
    }).catch(() => setErr('Failed to load snapshots'));
  }, [base]);
  React.useEffect(() => { load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setMsg(''); setBusy('new');
    const r = await fetch(`${base}/snapshots`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim(), description: desc || undefined, includeRam: withRam }) });
    const j = await r.json().catch(() => ({}));
    setBusy('');
    if (!r.ok && r.status !== 202) { setErr(j.errors?.[0]?.detail || 'Snapshot failed'); return; }
    setMsg(j.data?.task === 'running' ? 'Snapshot in progress…' : 'Snapshot created.');
    setName(''); setDesc(''); setCreating(false);
    toast?.('Snapshot started');
    setTimeout(load, 1500);
  }
  async function rollback(snap: string) {
    if (!window.confirm(`Roll back to snapshot "${snap}"? The VM will be reverted and rebooted. Unsaved data will be lost.`)) return;
    setBusy(snap); setErr(''); setMsg('');
    const r = await fetch(`${base}/snapshots/${encodeURIComponent(snap)}/rollback`, { method: 'POST', credentials: 'include' });
    const j = await r.json().catch(() => ({}));
    setBusy('');
    if (!r.ok && r.status !== 202) { setErr(j.errors?.[0]?.detail || 'Rollback failed'); return; }
    setMsg('Rollback started.');
    toast?.('Rollback started');
  }
  async function remove(snap: string) {
    if (!window.confirm(`Delete snapshot "${snap}"? This cannot be undone.`)) return;
    setBusy(snap); setErr(''); setMsg('');
    const r = await fetch(`${base}/snapshots/${encodeURIComponent(snap)}`, { method: 'DELETE', credentials: 'include' });
    const j = await r.json().catch(() => ({}));
    setBusy('');
    if (!r.ok && r.status !== 202) { setErr(j.errors?.[0]?.detail || 'Delete failed'); return; }
    setMsg('Snapshot deleted.');
    load();
  }

  return (
    <div className="stack">
      {msg && <div className="alert" style={{ borderColor: '#1a2e1a', background: '#0f1a12', color: '#bbf7d0' }}>{msg}</div>}
      {err && <div className="alert alert-error">{err}</div>}
      <Card title={`Snapshots (${snaps.length})`} action={<button className="btn btn-primary btn-sm" onClick={() => setCreating(!creating)}><FiPlus size={13} /> New snapshot</button>}>
        {creating && (
          <form onSubmit={create} className="form" style={{ marginBottom: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 10 }}>
              <label className="field"><span className="label">Name</span><input className="input mono" value={name} onChange={(e) => setName(e.target.value)} pattern="[a-zA-Z0-9_]+" placeholder="pre_update" required /></label>
              <label className="field"><span className="label">Description</span><input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Before big update" /></label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, alignSelf: 'flex-end', paddingBottom: 10 }}><input type="checkbox" checked={withRam} onChange={(e) => setWithRam(e.target.checked)} /> Include RAM</label>
            </div>
            <button className="btn btn-primary btn-sm" type="submit" disabled={busy === 'new'}>{busy === 'new' ? 'Creating…' : 'Create snapshot'}</button>
          </form>
        )}
        {snaps.length === 0 ? <p className="muted">No snapshots yet.</p> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Name</th><th>Description</th><th>Created</th><th className="right">Actions</th></tr></thead>
            <tbody>{snaps.map((s) => (
              <tr key={s.name}>
                <td><span className="fname-inner"><FiCamera size={13} style={{ color: 'var(--muted-2)' }} /><span className="fname-text mono">{s.name}</span></span></td>
                <td className="muted" style={{ fontSize: 12 }}>{s.description || '—'}</td>
                <td className="mono muted" style={{ fontSize: 11 }}>{s.snaptime ? new Date(s.snaptime * 1000).toLocaleString() : '—'}</td>
                <td className="right" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-ghost btn-sm" disabled={busy === s.name} onClick={() => rollback(s.name)} title="Rollback"><FiRotateCcw size={12} /> Rollback</button>
                  <button className="btn btn-ghost btn-sm" disabled={busy === s.name} onClick={() => remove(s.name)} title="Delete" style={{ color: '#f87171' }}><FiTrash2 size={12} /></button>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}
