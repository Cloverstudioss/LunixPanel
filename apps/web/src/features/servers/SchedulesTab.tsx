import React from 'react';
import { FiPlus, FiTrash2, FiPlay, FiEdit3 } from 'react-icons/fi';

type Task = { id?: number; action: 'command' | 'power' | 'backup'; payload: string | null; timeOffsetSeconds: number };
type Schedule = { id: number; name: string; cron: string; active: boolean; lastRunAt: string | null; nextRunAt: string | null; tasks: Task[] };

const CRON_PRESETS = [
  { label: 'Every minute', value: '* * * * *' },
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Daily at 04:00', value: '0 4 * * *' },
  { label: 'Weekly (Sun 04:00)', value: '0 4 * * 0' },
  { label: 'Restart every 6h', value: '0 */6 * * *' },
];

export default function SchedulesTab({ serverId }: { serverId: number }) {
  const [rows, setRows] = React.useState<Schedule[]>([]);
  const [err, setErr] = React.useState('');
  const [msg, setMsg] = React.useState('');
  const [editing, setEditing] = React.useState<Partial<Schedule> | null>(null);

  const load = React.useCallback(() => {
    fetch(`/api/schedules?serverId=${serverId}`, { credentials: 'include' }).then((r) => r.json()).then((j) => {
      if (j.data) setRows(j.data); else setErr(j.errors?.[0]?.detail || 'Failed to load schedules');
    }).catch(() => setErr('Failed to load schedules'));
  }, [serverId]);
  React.useEffect(() => { load(); }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setMsg('');
    const isNew = !editing?.id;
    const body = {
      ...(isNew ? { serverId } : {}),
      name: editing!.name,
      cron: editing!.cron,
      active: editing!.active ?? true,
      tasks: (editing!.tasks || []).map((t) => ({ action: t.action, payload: t.payload, timeOffsetSeconds: t.timeOffsetSeconds || 0 })),
    };
    const res = await fetch(isNew ? '/api/schedules' : `/api/schedules/${editing!.id}`, {
      method: isNew ? 'POST' : 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(j.errors?.[0]?.detail || 'Save failed'); return; }
    setMsg('Schedule saved.'); setEditing(null); load();
  }
  async function toggle(s: Schedule) {
    await fetch(`/api/schedules/${s.id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !s.active }) });
    load();
  }
  async function runNow(s: Schedule) {
    const r = await fetch(`/api/schedules/${s.id}/run`, { method: 'POST', credentials: 'include' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok && r.status !== 202) { setErr(j.errors?.[0]?.detail || 'Run failed'); return; }
    setMsg(`Schedule "${s.name}" triggered.`);
  }
  async function remove(s: Schedule) {
    if (!window.confirm(`Delete schedule "${s.name}"?`)) return;
    await fetch(`/api/schedules/${s.id}`, { method: 'DELETE', credentials: 'include' });
    load();
  }

  return (
    <div className="stack">
      {msg && <div className="alert" style={{ borderColor: '#1a2e1a', background: '#0f1a12', color: '#bbf7d0' }}>{msg}</div>}
      {err && <div className="alert alert-error">{err}</div>}
      <div className="card" style={{ padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <h2 className="card-title">Schedules ({rows.length})</h2>
          <button className="btn btn-primary btn-sm" onClick={() => setEditing({ name: '', cron: '0 4 * * *', active: true, tasks: [{ action: 'command', payload: '', timeOffsetSeconds: 0 }] })}><FiPlus size={13} /> New schedule</button>
        </div>
        {rows.length === 0 ? <p className="muted" style={{ margin: 0 }}>No schedules yet. Automate restarts, commands and backups.</p> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Name</th><th>Cron</th><th>Tasks</th><th>Last / Next run</th><th>Status</th><th className="right">Actions</th></tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td className="mono muted" style={{ fontSize: 12 }}>{s.cron}</td>
                <td className="muted" style={{ fontSize: 12 }}>{s.tasks.map((t) => t.action + (t.payload ? `(${t.payload.slice(0, 18)})` : '')).join(' → ')}</td>
                <td className="mono muted" style={{ fontSize: 11 }}>{s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : '—'}<br />{s.nextRunAt ? `next ${new Date(s.nextRunAt).toLocaleString()}` : ''}</td>
                <td><span className={`badge badge-${s.active ? 'active' : 'suspended'}`}>{s.active ? 'active' : 'paused'}</span></td>
                <td className="right" style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn btn-ghost btn-sm" title="Run now" onClick={() => runNow(s)}><FiPlay size={12} /></button>
                  <button className="btn btn-ghost btn-sm" title={s.active ? 'Pause' : 'Resume'} onClick={() => toggle(s)}>{s.active ? 'Pause' : 'Resume'}</button>
                  <button className="btn btn-ghost btn-sm" title="Edit" onClick={() => setEditing(s)}><FiEdit3 size={12} /></button>
                  <button className="btn btn-ghost btn-sm" title="Delete" style={{ color: '#f87171' }} onClick={() => remove(s)}><FiTrash2 size={12} /></button>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      {editing && (
        <div className="overlay" onClick={() => setEditing(null)} role="presentation">
          <form className="modal" role="dialog" aria-modal="true" onSubmit={save} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
            <div className="modal-head"><h2 className="modal-title">{editing.id ? 'Edit schedule' : 'New schedule'}</h2><button type="button" className="modal-close" onClick={() => setEditing(null)}>×</button></div>
            <div className="modal-body form">
              <label className="field"><span className="label">Name</span><input className="input" value={editing.name || ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Nightly restart" required /></label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label className="field"><span className="label">Cron expression</span><input className="input mono" value={editing.cron || ''} onChange={(e) => setEditing({ ...editing, cron: e.target.value })} placeholder="0 4 * * *" required /></label>
                <label className="field"><span className="label">Preset</span>
                  <select className="input" value="" onChange={(e) => e.target.value && setEditing({ ...editing, cron: e.target.value })}>
                    <option value="">Choose…</option>
                    {CRON_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label} — {p.value}</option>)}
                  </select>
                </label>
              </div>
              <div className="label">Tasks (run in order)</div>
              {(editing.tasks || []).map((t, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '110px 1fr 90px auto', gap: 8, alignItems: 'end' }}>
                  <label className="field"><span className="label">Action</span>
                    <select className="input" value={t.action} onChange={(e) => { const tasks = [...(editing.tasks || [])]; tasks[i] = { ...t, action: e.target.value as Task['action'] }; setEditing({ ...editing, tasks }); }}>
                      <option value="command">Command</option>
                      <option value="power">Power</option>
                      <option value="backup">Backup</option>
                    </select>
                  </label>
                  <label className="field"><span className="label">{t.action === 'backup' ? '(no payload)' : t.action === 'power' ? 'start/stop/restart/kill' : 'Console command'}</span>
                    <input className="input mono" disabled={t.action === 'backup'} value={t.payload || ''} onChange={(e) => { const tasks = [...(editing.tasks || [])]; tasks[i] = { ...t, payload: e.target.value }; setEditing({ ...editing, tasks }); }} placeholder={t.action === 'power' ? 'restart' : t.action === 'command' ? 'say hello' : ''} />
                  </label>
                  <label className="field"><span className="label">Delay s</span><input className="input mono" type="number" min={0} max={3600} value={t.timeOffsetSeconds} onChange={(e) => { const tasks = [...(editing.tasks || [])]; tasks[i] = { ...t, timeOffsetSeconds: parseInt(e.target.value, 10) || 0 }; setEditing({ ...editing, tasks }); }} /></label>
                  <button type="button" className="btn btn-ghost btn-sm" style={{ marginBottom: 10, color: '#f87171' }} onClick={() => setEditing({ ...editing, tasks: (editing.tasks || []).filter((_, j) => j !== i) })}><FiTrash2 size={13} /></button>
                </div>
              ))}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing({ ...editing, tasks: [...(editing.tasks || []), { action: 'command', payload: '', timeOffsetSeconds: 0 }] })}><FiPlus size={13} /> Add task</button>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={editing.active ?? true} onChange={(e) => setEditing({ ...editing, active: e.target.checked })} /> Active</label>
              {err && <div className="alert alert-error">{err}</div>}
            </div>
            <div className="modal-foot">
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Save schedule</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
