import React from 'react';
import { FiPlus, FiTrash2, FiKey, FiDatabase } from 'react-icons/fi';

type DbRow = {
  id: number;
  database: string;
  username: string;
  remote: string;
  host: { id: number; name: string; host: string; port: number } | null;
};

export default function DatabasesTab({ serverId }: { serverId: number }) {
  const [rows, setRows] = React.useState<DbRow[]>([]);
  const [limit, setLimit] = React.useState(0);
  const [err, setErr] = React.useState('');
  const [msg, setMsg] = React.useState('');
  const [revealed, setRevealed] = React.useState<Record<number, string>>({});
  const [busy, setBusy] = React.useState('');

  const load = React.useCallback(() => {
    fetch(`/api/databases?serverId=${serverId}`, { credentials: 'include' }).then((r) => r.json()).then((j) => {
      if (j.data) { setRows(j.data); setLimit(j.limit ?? 0); } else setErr(j.errors?.[0]?.detail || 'Failed to load databases');
    }).catch(() => setErr('Failed to load databases'));
  }, [serverId]);
  React.useEffect(() => { load(); }, [load]);

  async function create() {
    setBusy('new'); setErr(''); setMsg('');
    const r = await fetch('/api/databases', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ serverId }) });
    const j = await r.json().catch(() => ({}));
    setBusy('');
    if (!r.ok) { setErr(j.errors?.[0]?.detail || 'Create failed'); return; }
    setMsg(`Database ${j.data?.database} created — password shown once below.`);
    if (j.data?.password) window.prompt('New database password (copy now):', j.data.password);
    load();
  }
  async function reveal(id: number) {
    const r = await fetch(`/api/databases/${id}/password`, { credentials: 'include' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.errors?.[0]?.detail || 'Failed'); return; }
    setRevealed((p) => ({ ...p, [id]: j.data.password }));
  }
  async function rotate(id: number) {
    if (!window.confirm('Rotate this database password? Applications using the old password will lose access.')) return;
    const r = await fetch(`/api/databases/${id}/password`, { method: 'POST', credentials: 'include' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.errors?.[0]?.detail || 'Failed'); return; }
    setMsg('Password rotated.');
    setRevealed((p) => ({ ...p, [id]: j.data.password }));
  }
  async function remove(db: DbRow) {
    if (!window.confirm(`Delete database "${db.database}"? All data will be dropped. This cannot be undone.`)) return;
    const r = await fetch(`/api/databases/${db.id}`, { method: 'DELETE', credentials: 'include' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.errors?.[0]?.detail || 'Delete failed'); return; }
    setMsg('Database deleted.');
    load();
  }

  const atLimit = limit !== 0 && rows.length >= limit;

  return (
    <div className="stack">
      {msg && <div className="alert" style={{ borderColor: '#1a2e1a', background: '#0f1a12', color: '#bbf7d0' }}>{msg}</div>}
      {err && <div className="alert alert-error">{err}</div>}
      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <h2 className="card-title">Databases ({rows.length}{limit > 0 ? ` / ${limit}` : ''})</h2>
          <button className="btn btn-primary btn-sm" disabled={atLimit} onClick={create}><FiPlus size={13} /> New database</button>
        </div>
        {atLimit && <div className="alert">Database limit reached ({limit}). Ask an admin to raise it.</div>}
        {rows.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}><FiDatabase size={13} style={{ verticalAlign: -2 }} /> No databases yet.</p>
        ) : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Database</th><th>Username</th><th>Endpoint</th><th>Password</th><th className="right">Actions</th></tr></thead>
            <tbody>{rows.map((d) => (
              <tr key={d.id}>
                <td className="mono">{d.database}</td>
                <td className="mono muted" style={{ fontSize: 12 }}>{d.username}</td>
                <td className="mono muted" style={{ fontSize: 12 }}>{d.host ? `${d.host.host}:${d.host.port}` : '—'}</td>
                <td className="mono" style={{ fontSize: 12 }}>
                  {revealed[d.id] ? revealed[d.id] : <button className="btn btn-ghost btn-sm" onClick={() => reveal(d.id)}><FiKey size={11} /> Show</button>}
                </td>
                <td className="right" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => rotate(d.id)}>Rotate</button>
                  <button className="btn btn-ghost btn-sm" style={{ color: '#f87171' }} onClick={() => remove(d)}><FiTrash2 size={12} /></button>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
