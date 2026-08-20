import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate, useLocation, useParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FiGrid, FiServer, FiUser, FiBox, FiHardDrive, FiCloud, FiInbox, FiUsers, FiLogOut, FiActivity, FiTrash2, FiCopy, FiTerminal, FiFolder, FiCpu, FiGlobe, FiSettings, FiPlay, FiSquare, FiRotateCcw, FiUpload, FiDownload, FiPlus, FiChevronLeft, FiSave, FiX, FiFile, FiDatabase, FiMoreVertical, FiCheckSquare, FiArchive, FiRefreshCw } from 'react-icons/fi';
import { QyroMark } from './QyroBrand';
import './styles.css';

const qc = new QueryClient();
const BRAND = { panel: 'LunixPanel', vendor: 'QyroCloud', studio: 'Clover Studios' };

type Me = { email: string; username: string; isAdmin: boolean; status: string; expiresAt: string | null; graceUntil: string | null } | null;

const AuthCtx = React.createContext<{ me: Me; loading: boolean; refresh: () => Promise<void> }>({ me: null, loading: true, refresh: async () => {} });

function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = React.useState<Me>(null);
  const [loading, setLoading] = React.useState(true);
  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/me', { credentials: 'include' });
      const j = await r.json().catch(() => ({ data: null }));
      if (r.ok && j.data) setMe(j.data);
      else setMe(null);
    } catch { setMe(null); }
    finally { setLoading(false); }
  }, []);
  React.useEffect(() => { refresh(); }, [refresh]);
  return <AuthCtx.Provider value={{ me, loading, refresh }}>{children}</AuthCtx.Provider>;
}

function useMe() { return React.useContext(AuthCtx); }

function BrandLockup() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <QyroMark size={28} />
      <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--line)', margin: '2px 0' }} aria-hidden />
      <div style={{ lineHeight: 1 }}>
        <div className="topbar-title" style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
          <span>{BRAND.vendor}</span><span style={{ fontWeight: 400, color: 'var(--muted)' }}>·</span><span style={{ fontWeight: 800 }}>{BRAND.panel}</span>
        </div>
        <div className="topbar-sub">Game & VPS hosting</div>
      </div>
    </div>
  );
}

function Topbar({ me, onLogout }: { me: Me; onLogout: () => void }) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        <BrandLockup />
      </div>
      <div className="topbar-right">
        {me ? (
          <>
            <span className="topbar-email">{me.email}</span>
            {me.isAdmin && <span className="badge badge-admin">Admin</span>}
            <button className="btn btn-ghost btn-sm" onClick={onLogout}><FiLogOut size={13} /> Logout</button>
          </>
        ) : (
          <>
            <NavLink to="/login" className="btn btn-ghost btn-sm">Login</NavLink>
            <NavLink to="/request-access" className="btn btn-primary btn-sm">Request access</NavLink>
          </>
        )}
      </div>
    </header>
  );
}

function CopyBtn({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = React.useState(false);
  const onCopy = async () => {
    try { await navigator.clipboard.writeText(text); } catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
    setDone(true); setTimeout(() => setDone(false), 1400);
  };
  return <button className="btn btn-ghost btn-sm" onClick={onCopy}><FiCopy size={13} /> {done ? 'Copied' : label}</button>;
}

function Skeleton({ lines = 3 }: { lines?: number }) {
  return <div className="skeleton-card" aria-busy="true">{Array.from({ length: lines }).map((_, i) => <div key={i} className="skeleton-line" style={{ width: i === 0 ? '42%' : i === lines - 1 ? '68%' : '88%' }} />)}</div>;
}

function RequireAuth({ children, adminOnly }: { children: React.ReactNode; adminOnly?: boolean }) {
  const { me, loading } = useMe();
  if (loading) return <div className="page"><Skeleton lines={4} /></div>;
  if (!me) return <Navigate to="/login" replace />;
  if (adminOnly && !me.isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function PanelSwitch() {
  const { me } = useMe();
  const loc = useLocation();
  if (!me?.isAdmin) return null;
  const isAdmin = loc.pathname.startsWith('/admin');
  return (
    <div className="panel-switch">
      <NavLink to="/" className={!isAdmin ? 'active' : ''}>User panel</NavLink>
      <NavLink to="/admin" className={isAdmin ? 'active' : ''}>Admin panel</NavLink>
    </div>
  );
}

function UserSidebar() {
  const L = (to: string, label: string, Icon: React.ComponentType<{ size?: number; className?: string }>) => (
    <NavLink to={to} className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}>
      <Icon size={14} className="nav-icon" /><span className="nav-label">{label}</span>
    </NavLink>
  );
  return (
    <nav className="sidebar" aria-label="User">
      <PanelSwitch />
      <div className="sidebar-section"><div className="sidebar-heading">Workspace</div>{L('/', 'Overview', FiGrid)}{L('/settings', 'Settings', FiUser)}</div>
    </nav>
  );
}

function AdminSidebar() {
  const L = (to: string, label: string, Icon: React.ComponentType<{ size?: number; className?: string }>) => (
    <NavLink to={to} className={({ isActive }) => `nav-link ${isActive ? 'nav-link-active' : ''}`}>
      <Icon size={14} className="nav-icon" /><span className="nav-label">{label}</span>
    </NavLink>
  );
  return (
    <nav className="sidebar" aria-label="Admin">
      <PanelSwitch />
      <div className="sidebar-section">
        <div className="sidebar-heading">Manage</div>
        {L('/admin', 'Overview', FiGrid)}{L('/admin/users', 'Users', FiUsers)}{L('/admin/servers', 'Servers', FiServer)}
      </div>
      <div className="sidebar-heading">Infrastructure</div>
      <div className="sidebar-section" style={{ gap: 4 }}>
        {L('/admin/nodes', 'Nodes', FiHardDrive)}{L('/admin/eggs', 'Eggs', FiBox)}{L('/admin/proxmox', 'Proxmox', FiCloud)}
      </div>
      <div className="sidebar-heading">System</div>
      <div className="sidebar-section" style={{ gap: 4 }}>
        {L('/admin/audit', 'Audit logs', FiActivity)}
      </div>
    </nav>
  );
}

function NodeAllocationsPage() {
  const { id } = useParams() as { id: string };
  const [node, setNode] = React.useState<{ id: number; name: string } | null>(null);
  const [rows, setRows] = React.useState<{ id: number; ip: string; ipAlias: string | null; port: number; serverId: number | null }[]>([]);
  const [form, setForm] = React.useState({ ip: '', ports: '', alias: '' });
  const [err, setErr] = React.useState('');
  const [msg, setMsg] = React.useState('');
  const load = React.useCallback(() => {
    fetch(`/api/nodes/${id}`, { credentials: 'include' }).then((r) => r.json()).then((j) => setNode(j.data || null));
    fetch(`/api/nodes/${id}/allocations`, { credentials: 'include' }).then((r) => r.json()).then((j) => setRows(j.data || []));
  }, [id]);
  React.useEffect(() => { load(); }, [load]);
  function parsePorts(s: string): number[] {
    const out = new Set<number>();
    for (const part of s.split(/[,\s]+/).filter(Boolean)) {
      if (part.includes('-')) {
        const [a, b] = part.split('-').map((x) => parseInt(x.trim(), 10));
        if (!a || !b || a > b || b - a > 10000) { setErr(`Invalid range "${part}" — expected like 25565-25700.`); return []; }
        for (let p = a; p <= b; p++) out.add(p);
      } else {
        const p = parseInt(part, 10);
        if (!p || p < 1 || p > 65535) { setErr(`Invalid port "${part}".`); return []; }
        out.add(p);
      }
    }
    return [...out];
  }
  async function add(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setMsg('');
    const ports = parsePorts(form.ports);
    if (ports.length === 0) return;
    const res = await fetch(`/api/nodes/${id}/allocations`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ip: form.ip, ports, alias: form.alias }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(j.errors?.[0]?.detail || 'Failed'); return; }
    setMsg(`Added ${ports.length} allocation${ports.length === 1 ? '' : 's'}.`); setForm({ ip: '', ports: '', alias: '' }); load();
  }
  async function updateAlias(r: { id: number; ip: string; ipAlias: string | null; port: number }) {
    const val = prompt(`Alias for ${r.ip}:${r.port} (leave empty to clear)`, r.ipAlias ?? '');
    if (val === null) return;
    const res = await fetch(`/api/nodes/${id}/allocations/${r.id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ip_alias: val }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(j.errors?.[0]?.detail || 'Failed'); return; }
    setErr(''); load();
  }
  async function remove(r: { id: number; ip: string; ipAlias: string | null; port: number; serverId: number | null }) {
    if (r.serverId) { setErr('Allocation is in use by a server.'); return; }
    if (!confirm(`Delete allocation ${r.ip}:${r.port}?`)) return;
    const res = await fetch(`/api/nodes/${id}/allocations/${r.id}`, { method: 'DELETE', credentials: 'include' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(j.errors?.[0]?.detail || 'Failed'); return; }
    setErr(''); load();
  }
  return (
    <div className="page">
      <div className="page-head"><div><h1 className="h1">Allocations · {node?.name ?? `#${id}`}</h1></div><NavLink to="/admin/nodes" className="btn btn-ghost btn-sm">Back to nodes</NavLink></div>
      <Card title="Add allocations">
        <form onSubmit={add} className="form">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <label className="field"><span className="label">IP address</span><input className="input" value={form.ip} onChange={(e) => setForm({ ...form, ip: e.target.value })} placeholder="10.0.0.10" /></label>
            <label className="field"><span className="label">Ports — comma or range</span><input className="input" value={form.ports} onChange={(e) => setForm({ ...form, ports: e.target.value })} placeholder="25565, 25566-25700" /></label>
            <label className="field"><span className="label">IP alias (optional)</span><input className="input" value={form.alias} onChange={(e) => setForm({ ...form, alias: e.target.value })} placeholder="my.domain.com" /></label>
          </div>
          {err && <div className="alert alert-error" role="alert">{err}</div>}
          {msg && <div className="alert" style={{ borderColor: '#1a2e1a', background: '#0f1a12', color: '#bbf7d0' }}>{msg}</div>}
          <button type="submit" className="btn btn-primary">Add</button>
        </form>
      </Card>
      <div className="table-wrap"><table className="table"><thead><tr><th>IP</th><th>Alias</th><th>Port</th><th>Server</th><th></th></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={5} className="muted">No allocations yet.</td></tr> : rows.map((r) => <tr key={r.id}><td className="mono">{r.ip}</td><td className="mono muted">{r.ipAlias || '—'}</td><td className="mono">{r.port}</td><td className="mono muted">{r.serverId ? `#${r.serverId}` : 'free'}</td><td style={{ whiteSpace: 'nowrap' }}><button className="btn btn-ghost btn-sm" onClick={() => updateAlias(r)}>Alias</button><button className="btn btn-ghost btn-sm" onClick={() => remove(r)}><FiTrash2 /></button></td></tr>)}</tbody></table></div>
    </div>
  );
}

function Shell({ children, me, onLogout }: { children: React.ReactNode; me: Me; onLogout: () => void }) {
  const loc = useLocation();
  const isAuth = loc.pathname === '/login' || loc.pathname === '/register';
  if (isAuth) return <>{children}</>;
  const isAdmin = loc.pathname.startsWith('/admin');
  const mLinks = isAdmin
    ? [{ to: '/admin', label: 'Overview' }, { to: '/admin/users', label: 'Users' }, { to: '/admin/servers', label: 'Servers' }, { to: '/admin/nodes', label: 'Nodes' }, { to: '/admin/eggs', label: 'Eggs' }, { to: '/admin/proxmox', label: 'Proxmox' }]
    : [{ to: '/', label: 'Overview' }, { to: '/settings', label: 'Settings' }];
  return (
    <div className="shell">
      <Topbar me={me} onLogout={onLogout} />
      <div className="m-topbar"><PanelSwitch />{me && <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{me.email}</span>}</div>
      <nav className="m-nav" aria-label="Mobile">{mLinks.map((l) => <NavLink key={l.to} to={l.to} className={({ isActive }) => (isActive ? 'active' : '')}>{l.label}</NavLink>)}</nav>
      <div className="shell-body">
        {isAdmin ? <AdminSidebar /> : <UserSidebar />}
        <main className="content">{children}</main>
      </div>
    </div>
  );
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="card"><div className="card-head"><h2 className="card-title">{title}</h2>{action}</div><div className="card-body">{children}</div></section>;
}

function Modal({ open, onClose, title, children, footer, size }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; footer?: React.ReactNode; size?: 'lg' }) {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open, onClose]);
  React.useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      const el = ref.current?.querySelector<HTMLElement>('input:not([type=hidden]), select, textarea, button');
      el?.focus();
    }, 30);
    return () => clearTimeout(t);
  }, [open]);
  if (!open) return null;
  return (
    <div className="overlay" onClick={onClose} role="presentation">
      <div className={`modal${size === 'lg' ? ' modal-lg' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2 className="modal-title">{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ── Auth ──
function LoginPage() {
  const nav = useNavigate();
  const { me, loading: meLoading } = useMe();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [code, setCode] = React.useState('');
  const [need2fa, setNeed2fa] = React.useState(false);
  const [err, setErr] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  React.useEffect(() => { if (!meLoading && me) nav('/', { replace: true }); }, [me, meLoading, nav]);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setLoading(true);
    try {
      const res = await fetch('/api/auth/login', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, code: need2fa ? code : undefined }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.errors?.[0]?.detail || 'Sign in failed');
      if (j.data?.need_2fa) { setNeed2fa(true); setLoading(false); return; }
      const meRes = await fetch('/api/me', { credentials: 'include' });
      if (!meRes.ok) throw new Error('Session not established.');
      window.location.assign('/');
    } catch (e) { setErr(String((e as Error).message)); } finally { setLoading(false); }
  }
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16, background: 'var(--bg)' }}>
      <div style={{ width: '100%', maxWidth: 360, display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
          <QyroMark size={28} />
          <div style={{ lineHeight: 1, textAlign: 'left' }}>
            <div style={{ fontWeight: 800, letterSpacing: '-0.03em', fontSize: 14 }}>{BRAND.vendor} · {BRAND.panel}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>Game & VPS hosting</div>
          </div>
        </div>
        <div className="auth-card" style={{ padding: 18 }}>
          <h1 className="h2" style={{ margin: 0 }}>Sign in</h1>
          <form onSubmit={submit} className="form" style={{ marginTop: 14 }} autoComplete="off">
            <label className="field"><span className="label">Email</span><input id="login-email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" placeholder="you@qyrocloud.example" /></label>
            <label className="field"><span className="label">Password</span><input id="login-pass" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" placeholder="••••••••" /></label>
            {need2fa && <label className="field"><span className="label">2FA code</span><input id="login-2fa" className="input" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" placeholder="123 456" /></label>}
            {err && <div className="alert alert-error" role="alert">{err}</div>}
            <button type="submit" className="btn btn-primary btn-block" disabled={loading}>{loading ? 'Signing in…' : need2fa ? 'Verify' : 'Sign in'}</button>
          </form>
          <div style={{ marginTop: 10, textAlign: 'center' }}><NavLink to="/register" className="link">New here? Create an account</NavLink></div>
        </div>
      </div>
    </div>
  );
}

function RegisterPage() {
  const [form, setForm] = React.useState({ username: '', email: '', password: '' });
  const [done, setDone] = React.useState(false);
  const [err, setErr] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setLoading(true);
    try {
      const res = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.errors?.[0]?.detail || 'Failed');
      setDone(true);
      setTimeout(() => { window.location.href = '/'; }, 800);
    } catch (e) { setErr(String((e as Error).message)); } finally { setLoading(false); }
  }
  if (done) return <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16, background: 'var(--bg)' }}><div style={{ width: '100%', maxWidth: 360 }}><div className="auth-card"><h1 className="h2" style={{ margin: 0 }}>Account created</h1><p className="muted" style={{ lineHeight: 1.6, fontSize: 13, marginTop: 8 }}>You're signed in. Redirecting…</p></div></div></div>;
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16, background: 'var(--bg)' }}>
      <div style={{ width: '100%', maxWidth: 360, display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
          <QyroMark size={28} />
          <div style={{ lineHeight: 1, textAlign: 'left' }}><div style={{ fontWeight: 800, fontSize: 14, letterSpacing: '-0.03em' }}>{BRAND.vendor} · {BRAND.panel}</div><div style={{ fontSize: 11, color: 'var(--muted)' }}>Game & VPS hosting</div></div>
        </div>
        <div className="auth-card">
          <h1 className="h2" style={{ margin: 0 }}>Create account</h1>
          <form onSubmit={submit} className="form" style={{ marginTop: 14 }}>
            <label className="field"><span className="label">Username</span><input id="reg-user" className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="ava_stone" autoComplete="off" /></label>
            <label className="field"><span className="label">Email</span><input id="reg-email" className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="ava@example.com" autoComplete="off" /></label>
            <label className="field"><span className="label">Password</span><input id="reg-pass" className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="At least 8 characters" autoComplete="off" /></label>
            {err && <div className="alert alert-error" role="alert">{err}</div>}
            <button type="submit" className="btn btn-primary btn-block" disabled={loading}>{loading ? 'Creating…' : 'Create account'}</button>
          </form>
          <div style={{ marginTop: 10, textAlign: 'center' }}><NavLink to="/login" className="link">Have an account? Sign in</NavLink></div>
        </div>
      </div>
    </div>
  );
}

function ServerCard({ s }: { s: { id: number; name: string; status: string; memory: number; disk: number; image?: string; egg?: { banner?: string | null; name?: string } | null } }) {
  const running = s.status === 'running';
  const img = s.egg?.name || (s.image || '').split('/').pop()?.split(':')[0] || 'server';
  const banner = s.egg?.banner || null;
  return (
    <NavLink to={`/server/${s.id}`} className={`server-card${banner ? ' has-banner' : ''}`} style={{ textDecoration: 'none', color: 'inherit', ...(banner ? { backgroundImage: `url("${banner}")` } : {}) }}>
      {banner && <div className="server-card-banner-overlay" style={{ display: 'none' }} />}
      <div className="server-card-banner">
        <div className="server-card-icon"><FiBox size={20} /></div>
        <span className={`badge badge-${s.status}`} style={{ marginLeft: 'auto' }}>{s.status}</span>
      </div>
      <div className="server-card-body">
        <div className="server-card-title">{s.name}</div>
        <div className="server-card-img mono muted">{img}</div>
        <div className="server-card-stats">
          <div className="stat"><FiCpu size={12} /><span>{s.memory} MB</span></div>
          <div className="stat"><FiHardDrive size={12} /><span>{s.disk} MB</span></div>
          <div className="stat"><FiActivity size={12} /><span className={`pulse-dot ${running ? 'on' : 'off'}`} /></div>
        </div>
      </div>
    </NavLink>
  );
}

function VpsCard({ v }: { v: { vmid: number; name: string; status: string; cpus: number; maxmem: number; maxdisk: number; node: string; clusterName: string } }) {
  return (
    <div className="server-card" style={{ cursor: 'default' }}>
      <div className="server-card-banner">
        <div className="server-card-icon"><FiServer size={20} /></div>
        <span className={`badge badge-${v.status === 'running' ? 'active' : 'suspended'}`} style={{ marginLeft: 'auto' }}>{v.status}</span>
      </div>
      <div className="server-card-body">
        <div className="server-card-title">{v.name}</div>
        <div className="server-card-img mono muted">{v.clusterName} · {v.node}</div>
        <div className="server-card-stats">
          <div className="stat"><FiCpu size={12} /><span>{v.cpus} vCPU</span></div>
          <div className="stat"><FiHardDrive size={12} /><span>{Math.round(v.maxmem / 1048576)} MB</span></div>
          <div className="stat"><FiDatabase size={12} /><span>{Math.round(v.maxdisk / 1048576)} GB</span></div>
        </div>
      </div>
    </div>
  );
}

// ── User ──
function UserOverview() {
  const [servers, setServers] = React.useState<{ id: number; name: string; status: string; memory: number; disk: number; image?: string; egg?: { banner?: string | null; name?: string } | null }[]>([]);
  const [vps, setVps] = React.useState<{ vmid: number; name: string; status: string; cpus: number; maxmem: number; maxdisk: number; node: string; clusterName: string }[]>([]);
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => {
    Promise.all([
      fetch('/api/servers', { credentials: 'include' }).then((r) => r.json()).catch(() => ({ data: [] })),
      fetch('/api/proxmox/vms', { credentials: 'include' }).then((r) => r.json()).catch(() => ({ data: [] })),
    ]).then(([s, v]) => { setServers(s.data || []); setVps(v.data || []); }).finally(() => setLoading(false));
  }, []);
  if (loading) return <div className="page"><Skeleton lines={3} /></div>;
  const hasServers = servers.length > 0;
  const hasVps = vps.length > 0;
  return (
    <div className="page">
      <h1 className="h1">Overview</h1>
      {!hasServers && !hasVps ? (
        <div className="transparent-card">
          <div className="transparent-card-title">No servers yet</div>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, margin: 0 }}>Your game servers and VPS will appear here when an admin assigns them.</p>
        </div>
      ) : (
        <>
          {hasServers && (
            <>
              <div className="server-section-title">Game servers</div>
              <div className="server-grid">{servers.map((s) => <ServerCard key={s.id} s={s} />)}</div>
            </>
          )}
          {hasVps && (
            <>
              <div className="server-section-title">VPS</div>
              <div className="server-grid">{vps.map((v) => <VpsCard key={`${v.clusterName}-${v.vmid}`} v={v} />)}</div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function ServerManage() {
  const { id } = useParams() as { id: string };
  const sid = parseInt(id || '0', 10);
  const [tab, setTab] = React.useState('console');
  const [srv, setSrv] = React.useState<{ id: number; uuid: string; name: string; status: string; memory: number; disk: number; cpu: number; image: string; startup: string; description: string | null; allocation: { id: number; ip: string; port: number } | null; node: { name: string; scheme: string; fqdn: string; daemonListen: number } | null } | null>(null);
  const [err, setErr] = React.useState('');
  React.useEffect(() => {
    fetch(`/api/servers/${sid}`, { credentials: 'include' }).then((r) => r.json()).then((j) => { if (j.data) setSrv(j.data); else setErr(j.errors?.[0]?.detail || 'Server not found'); });
  }, [sid]);
  if (err) return <div className="page"><div className="alert alert-error">{err}</div><NavLink to="/" className="btn btn-ghost btn-sm">Back to overview</NavLink></div>;
  if (!srv) return <div className="page"><Skeleton lines={6} /></div>;
  const tabs = [
    { key: 'console', label: 'Console', Icon: FiTerminal },
    { key: 'files', label: 'Files', Icon: FiFolder },
    { key: 'backups', label: 'Backups', Icon: FiDatabase },
    { key: 'allocations', label: 'Allocations', Icon: FiGlobe },
    { key: 'startup', label: 'Startup', Icon: FiCpu },
    { key: 'settings', label: 'Settings', Icon: FiSettings },
  ];
  return (
    <div className="page">
      <div className="page-head"><div><h1 className="h1">{srv.name}</h1><p className="lede mono muted">{srv.uuid}</p></div><NavLink to="/" className="btn btn-ghost btn-sm"><FiChevronLeft size={13} /> Back</NavLink></div>
      <div className="tabs">{tabs.map((t) => <button key={t.key} className={`tab ${tab === t.key ? 'tab-active' : ''}`} onClick={() => setTab(t.key)}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><t.Icon size={13} />{t.label}</span></button>)}</div>
      {tab === 'console' && <ConsoleTab id={sid} />}
      {tab === 'files' && <FilesTab id={sid} />}
      {tab === 'backups' && <BackupsTab id={sid} />}
      {tab === 'allocations' && <AllocationsTab id={sid} srv={srv} />}
      {tab === 'startup' && <StartupTab id={sid} />}
      {tab === 'settings' && <SettingsTab id={sid} srv={srv} onSaved={(d) => setSrv((p) => (p ? { ...p, ...d } : p))} />}
    </div>
  );
}

const ANSI_COLORS: Record<number, string> = {
  30: '#1f2937', 31: '#ef4444', 32: '#22c55e', 33: '#eab308', 34: '#3b82f6', 35: '#d946ef', 36: '#06b6d4', 37: '#e5e7eb',
  90: '#6b7280', 91: '#f87171', 92: '#4ade80', 93: '#facc15', 94: '#60a5fa', 95: '#e879f9', 96: '#22d3ee', 97: '#ffffff',
};
const ANSI_BG: Record<number, string> = {
  40: '#1f2937', 41: '#7f1d1d', 42: '#14532d', 43: '#713f12', 44: '#1e3a8a', 45: '#701a75', 46: '#0e7490', 47: '#e5e7eb',
  100: '#374151', 101: '#7f1d1d', 102: '#3f6212', 103: '#713f12', 104: '#1e40af', 105: '#4a044e', 106: '#155e75', 107: '#d1d5db',
};
function AnsiText({ text }: { text: string }) {
  if (!text) return null;
  const nodes: React.ReactNode[] = [];
  const re = /\u001b\[([0-9;]*)m/g;
  let last = 0; let m: RegExpExecArray | null; let fg = ''; let bg = ''; let bold = false; let key = 0;
  const push = (s: string) => { if (!s) return; nodes.push(<span key={key++} style={{ color: fg || undefined, background: bg || undefined, fontWeight: bold ? 700 : undefined }}>{s}</span>); };
  while ((m = re.exec(text)) !== null) {
    push(text.slice(last, m.index));
    last = m.index + m[0].length;
    const codes = (m[1] || '').split(';').filter(Boolean).map(Number);
    if (codes.length === 0) { fg = ''; bg = ''; bold = false; continue; }
    for (const code of codes) {
      if (code === 0) { fg = ''; bg = ''; bold = false; }
      else if (code === 1 || code === 22) bold = code === 1;
      else if (code >= 30 && code <= 37) fg = ANSI_COLORS[code];
      else if (code >= 90 && code <= 97) fg = ANSI_COLORS[code];
      else if (code >= 40 && code <= 47) bg = ANSI_BG[code];
      else if (code >= 100 && code <= 107) bg = ANSI_BG[code];
      else if (code === 39) fg = '';
      else if (code === 49) bg = '';
    }
  }
  push(text.slice(last));
  return <>{nodes}</>;
}

function ConsoleTab({ id }: { id: number }) {
  const [lines, setLines] = React.useState<{ text: string; key: number }[]>([]);
  const [status, setStatus] = React.useState('connecting');
  const [cmd, setCmd] = React.useState('');
  const [busy, setBusy] = React.useState('');
  const [showEula, setShowEula] = React.useState(false);
  const [eulaBusy, setEulaBusy] = React.useState(false);
  const [eulaMsg, setEulaMsg] = React.useState('');
  const wsRef = React.useRef<WebSocket | null>(null);
  const boxRef = React.useRef<HTMLDivElement>(null);
  const lineKey = React.useRef(0);
  const stripAnsi = (s: string) => s.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').replace(/\u001b\][^\u0007]*\u0007/g, '');
  React.useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    (async () => {
      try {
        const logs = await fetch(`/api/servers/${id}/logs`, { credentials: 'include' }).then((r) => r.json()).then((j) => j.data || []).catch(() => []);
        if (closed) return;
        if (Array.isArray(logs) && logs.length > 0) setLines(logs.slice(-200).map((t: string) => ({ text: String(t), key: lineKey.current++ })));
        const r = await fetch(`/api/servers/${id}/websocket`, { method: 'POST', credentials: 'include' });
        const j = await r.json();
        if (!r.ok || !j.data) { if (!closed) setStatus('error'); return; }
        ws = new WebSocket(j.data.socket);
        wsRef.current = ws;
        ws.onopen = () => ws?.send(JSON.stringify({ event: 'auth', args: [j.data.token] }));
        ws.onmessage = (e) => {
          try {
            const m = JSON.parse(e.data as string);
            if (m.event === 'auth success') setStatus('running');
            else if (m.event === 'status') setStatus(m.args?.[0] || 'unknown');
            else if (m.event === 'console output' || m.event === 'daemon message' || m.event === 'install output') {
              const t = String(m.args?.[0] || '');
              setLines((p) => [...p.slice(-499), { text: t, key: lineKey.current++ }]);
              if (/agree to the EULA|eula\.txt/i.test(t)) setShowEula(true);
            }
            else if (m.event === 'token expired' || m.event === 'token expiring') { /* ignore */ }
          } catch { /* ignore */ }
        };
        ws.onclose = () => { if (wsRef.current === ws) setStatus((s) => (s === 'error' ? s : 'offline')); };
        ws.onerror = () => setStatus('error');
      } catch { if (!closed) setStatus('error'); }
    })();
    return () => { closed = true; ws?.close(); wsRef.current = null; };
  }, [id]);
  React.useEffect(() => { boxRef.current?.scrollTo(0, boxRef.current.scrollHeight); }, [lines]);
  async function power(action: string) {
    setBusy(action);
    try { await fetch(`/api/servers/${id}/power`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) }); }
    catch { /* ignore */ }
    setTimeout(() => setBusy(''), 1200);
  }
  function send(e: React.FormEvent) {
    e.preventDefault();
    if (!cmd.trim()) return;
    wsRef.current?.send(JSON.stringify({ event: 'send command', args: [cmd] }));
    setLines((p) => [...p.slice(-499), { text: `> ${cmd}`, key: lineKey.current++ }]);
    setCmd('');
  }
  async function acceptEula() {
    setEulaBusy(true); setEulaMsg('');
    try {
      const r = await fetch(`/api/servers/${id}/eula`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accept: true }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setEulaMsg(j.errors?.[0]?.detail || 'Failed to accept EULA'); return; }
      setShowEula(false);
      wsRef.current?.send(JSON.stringify({ event: 'send command', args: [''] }));
      power('restart');
    } finally { setEulaBusy(false); }
  }
  return (
    <div className="console">
      <div className="console-head">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span className={`status-dot ${status}`} /> <span className="mono muted" style={{ fontSize: 12 }}>{status}</span></span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => power('start')}><FiPlay size={13} /> Start</button>
          <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => power('restart')}><FiRotateCcw size={13} /> Restart</button>
          <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => power('stop')}><FiSquare size={13} /> Stop</button>
          <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => power('kill')}><FiX size={13} /> Kill</button>
        </div>
      </div>
      <div className="console-body" ref={boxRef}>
        {lines.length === 0 && <span className="dim">Waiting for console output…</span>}
        {lines.map((l) => <div key={l.key} className="console-line"><AnsiText text={l.text} /></div>)}
      </div>
      <form className="console-foot" onSubmit={send}>
        <input className="input" style={{ flex: 1 }} placeholder="Type a command…" value={cmd} onChange={(e) => setCmd(e.target.value)} autoComplete="off" />
        <button className="btn btn-primary" type="submit">Send</button>
      </form>
      <Modal open={showEula} onClose={() => setShowEula(false)} title="Minecraft EULA" footer={<><button className="btn btn-ghost" onClick={() => setShowEula(false)}>Cancel</button><button className="btn btn-primary" disabled={eulaBusy} onClick={acceptEula}>{eulaBusy ? 'Accepting…' : 'Accept EULA'}</button></>}>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          <p style={{ marginTop: 0 }}>This server runs Minecraft software and requires you to agree to the <b>Minecraft End User License Agreement</b> before it can start.</p>
          <p className="muted" style={{ marginBottom: 0 }}>Accepting writes <span className="mono">eula=true</span> to <span className="mono">eula.txt</span> in the server directory and restarts the server.</p>
          <p style={{ margin: '10px 0 0' }}><a href="https://aka.ms/MinecraftEULA" target="_blank" rel="noreferrer" style={{ color: 'var(--text)' }}>Read the EULA →</a></p>
          {eulaMsg && <div className="alert alert-error" style={{ marginTop: 12 }}>{eulaMsg}</div>}
        </div>
      </Modal>
    </div>
  );
}

function FilesTab({ id }: { id: number }) {
  const [dir, setDir] = React.useState('/');
  const [files, setFiles] = React.useState<{ name: string; directory: boolean; size: number; mode: string; modified: string }[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [edit, setEdit] = React.useState<{ path: string; content: string } | null>(null);
  const [msg, setMsg] = React.useState('');
  const [newFolder, setNewFolder] = React.useState('');
  const [newFile, setNewFile] = React.useState('');
  const [showNewFolder, setShowNewFolder] = React.useState(false);
  const [showNewFile, setShowNewFile] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [menu, setMenu] = React.useState<string | null>(null);
  const [archiving, setArchiving] = React.useState(false);
  const load = React.useCallback(() => {
    setLoading(true);
    fetch(`/api/servers/${id}/files?directory=${encodeURIComponent(dir)}`, { credentials: 'include' }).then((r) => r.json()).then((j) => setFiles(j.data || [])).catch(() => setFiles([])).finally(() => setLoading(false));
  }, [id, dir]);
  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => { setSelected(new Set()); }, [dir]);
  const parts = dir.split('/').filter(Boolean);
  const BINARY_EXT = /\.(jar|zip|gz|tar|exe|dll|so|o|a|bin|class|png|jpe?g|gif|webp|ico|mp3|mp4|ogg|wav|woff2?|ttf|eot|dat|sav|world|regions)$/i;
  const isArchive = (name: string) => /\.(zip|tar\.gz|tgz|tar)$/i.test(name);
  async function api(path: string, method: string, body?: unknown) {
    const r = await fetch(`/api/servers/${id}/files${path}`, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); setMsg(j.errors?.[0]?.detail || 'Failed'); return null as unknown as Response; }
    setMsg(''); return r;
  }
  function pathOf(name: string) { return dir === '/' ? `/${name}` : `${dir}/${name}`; }
  function toggle(name: string) {
    setSelected((p) => { const n = new Set(p); if (n.has(name)) n.delete(name); else n.add(name); return n; });
  }
  function open(item: { name: string; directory: boolean }) {
    if (item.directory) setDir((d) => (d === '/' ? `/${item.name}` : `${d}/${item.name}`));
    else if (BINARY_EXT.test(item.name)) setMsg(`${item.name} is a binary file and cannot be opened in the editor.`);
    else fetchContent(item.name);
  }
  function fmt(n: number) { if (!n) return '0 B'; if (n < 1024) return `${n} B`; if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`; return `${(n / 1048576).toFixed(1)} MB`; }
  async function fetchContent(name: string) {
    const r = await fetch(`/api/servers/${id}/files/contents?file=${encodeURIComponent(pathOf(name))}`, { credentials: 'include' });
    if (!r.ok) return;
    const text = await r.text();
    setEdit({ path: pathOf(name), content: text });
  }
  async function saveFile() {
    if (!edit) return;
    if (await api(`/write?file=${encodeURIComponent(edit.path)}`, 'POST', edit.content)) setEdit(null);
  }
  async function del(names: string[]) {
    const list = names.map((n) => pathOf(n));
    if (!confirm(`Delete ${list.length} ${list.length === 1 ? 'item' : 'items'}?`)) return;
    if (await api('/delete', 'POST', { root: '/', files: list })) { setSelected(new Set()); load(); }
  }
  async function rename(name: string) {
    const to = prompt(`Rename ${name} to:`, name);
    if (!to || to === name) return;
    const np = pathOf(to);
    if (await api('/rename', 'POST', { root: '/', files: [{ from: pathOf(name), to: np }] })) load();
  }
  async function makeFolder(e: React.FormEvent) {
    e.preventDefault(); if (!newFolder) return;
    if (await api('/create-directory', 'POST', { name: newFolder, path: dir })) { setNewFolder(''); setShowNewFolder(false); load(); }
  }
  async function makeFile(e: React.FormEvent) {
    e.preventDefault(); if (!newFile) return;
    if (await api('/write?file=' + encodeURIComponent(pathOf(newFile)), 'POST', '')) { setNewFile(''); setShowNewFile(false); load(); }
  }
  async function archive() {
    const list = Array.from(selected).map((n) => pathOf(n));
    if (list.length === 0) return;
    setArchiving(true);
    try {
      const r = await fetch(`/api/servers/${id}/files/compress`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ root: '/', files: list }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(j.errors?.[0]?.detail || 'Archive failed'); return; }
      setMsg(`Archived as ${j.data?.name || 'archive.tar.gz'}.`);
      setSelected(new Set());
      load();
    } finally { setArchiving(false); }
  }
  async function unarchive(name: string) {
    setArchiving(true);
    try {
      const r = await fetch(`/api/servers/${id}/files/decompress`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ root: '/', file: pathOf(name) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(j.errors?.[0]?.detail || 'Extract failed'); return; }
      setMsg(`Extracted ${name}.`);
      load();
    } finally { setArchiving(false); }
  }
  const selCount = selected.size;
  return (
    <div className="stack">
      {msg && <div className="alert alert-error">{msg}</div>}
      <div className="file-breadcrumb">
        <button onClick={() => setDir('/')}>/</button>
        {parts.map((p, i) => <span key={i} style={{ display: 'inline-flex', alignItems: 'center' }}><span className="sep">/</span><button onClick={() => setDir('/' + parts.slice(0, i + 1).join('/'))}>{p}</button></span>)}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
          {selCount > 0 && (
            <>
              <span className="badge badge-active" style={{ alignSelf: 'center' }}>{selCount} selected</span>
              <button className="btn btn-ghost btn-sm" onClick={archive} disabled={archiving}><FiArchive size={12} /> Archive</button>
              <button className="btn btn-ghost btn-sm" style={{ color: '#f87171' }} onClick={() => del(Array.from(selected))}><FiTrash2 size={12} /> Delete</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}><FiX size={12} /> Clear</button>
            </>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => { setShowNewFolder(true); }}><FiPlus size={12} /> Folder</button>
          <button className="btn btn-ghost btn-sm" onClick={() => { setShowNewFile(true); }}><FiPlus size={12} /> File</button>
        </span>
      </div>
      {showNewFolder && (
        <form onSubmit={makeFolder} style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input className="input" placeholder="Folder name" value={newFolder} onChange={(e) => setNewFolder(e.target.value)} autoFocus />
          <button className="btn btn-primary btn-sm" type="submit">Create</button><button className="btn btn-ghost btn-sm" type="button" onClick={() => setShowNewFolder(false)}>Cancel</button>
        </form>
      )}
      {showNewFile && (
        <form onSubmit={makeFile} style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <input className="input" placeholder="File name" value={newFile} onChange={(e) => setNewFile(e.target.value)} autoFocus />
          <button className="btn btn-primary btn-sm" type="submit">Create</button><button className="btn btn-ghost btn-sm" type="button" onClick={() => setShowNewFile(false)}>Cancel</button>
        </form>
      )}
      {loading ? <Skeleton lines={4} /> : files.length === 0 ? <div className="transparent-card"><div className="transparent-card-title">Empty directory</div></div> : (
        <div className="table-wrap"><table className="table file-table">
          <thead><tr>
            <th style={{ width: 34 }}><input type="checkbox" checked={selCount === files.length && files.length > 0} onChange={(e) => { if (e.target.checked) setSelected(new Set(files.map((f) => f.name))); else setSelected(new Set()); }} /></th>
            <th>Name</th><th style={{ width: 90 }}>Size</th><th style={{ width: 150 }}>Modified</th><th style={{ width: 110 }} className="right">Actions</th>
          </tr></thead>
          <tbody>
            {files.map((f) => (
              <tr key={f.name} className={`file-row${selected.has(f.name) ? ' file-row-selected' : ''}`} onClick={() => open(f)}>
                <td className="checkbox" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={selected.has(f.name)} onChange={() => toggle(f.name)} /></td>
                <td className="fname" title={f.name}><span className="fname-inner">{f.directory ? <FiFolder size={14} style={{ color: '#f59e0b', flexShrink: 0 }} /> : <FiFile size={14} style={{ color: 'var(--muted-2)', flexShrink: 0 }} />}<span className="fname-text">{f.name}</span></span></td>
                <td className="mono muted" style={{ fontSize: 12 }}>{f.directory ? '—' : fmt(f.size)}</td>
                <td className="mono muted" style={{ fontSize: 11 }}>{f.modified ? new Date(f.modified).toLocaleString() : '—'}</td>
                <td className="right" style={{ whiteSpace: 'nowrap', position: 'relative' }} onClick={(e) => e.stopPropagation()}>
                  {isArchive(f.name) && !f.directory && <button className="btn btn-ghost btn-sm" style={{ padding: 4 }} title="Extract" onClick={() => unarchive(f.name)} disabled={archiving}><FiRefreshCw size={11} /></button>}
                  {!f.directory && <button className="btn btn-ghost btn-sm" style={{ padding: 4 }} title="Download" onClick={() => window.open(`/api/servers/${id}/files/download?file=${encodeURIComponent(pathOf(f.name))}`, '_blank')}><FiDownload size={11} /></button>}
                  <button className="btn btn-ghost btn-sm" style={{ padding: 4 }} title="More" onClick={() => setMenu(menu === f.name ? null : f.name)}><FiMoreVertical size={11} /></button>
                  {menu === f.name && (
                    <div className="file-menu" onClick={() => setMenu(null)}>
                      <button onClick={() => rename(f.name)}>Rename</button>
                      {!f.directory && <button onClick={() => window.open(`/api/servers/${id}/files/download?file=${encodeURIComponent(pathOf(f.name))}`, '_blank')}>Download</button>}
                      <button style={{ color: '#f87171' }} onClick={() => del([f.name])}>Delete</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {edit && (
        <Modal size="lg" open onClose={() => setEdit(null)} title={`Edit · ${edit.path}`} footer={<><button className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button><button className="btn btn-primary" onClick={saveFile}><FiSave size={13} /> Save</button></>}>
          <textarea className="input textarea mono" style={{ fontFamily: '"Geist Mono",ui-monospace,Menlo,monospace', fontSize: 12, minHeight: 520, resize: 'vertical' }} value={edit.content} onChange={(e) => setEdit({ ...edit, content: e.target.value })} />
        </Modal>
      )}
    </div>
  );
}

function BackupsTab({ id }: { id: number }) {
  const [backups, setBackups] = React.useState<{ uuid: string; name: string; size: number; status: string; createdAt: string; completedAt: string | null }[]>([]);
  const [limit, setLimit] = React.useState(0);
  const [busy, setBusy] = React.useState('');
  const [msg, setMsg] = React.useState('');
  const [err, setErr] = React.useState('');
  const load = React.useCallback(() => {
    fetch(`/api/servers/${id}/backups`, { credentials: 'include' }).then((r) => r.json()).then((j) => { setBackups(j.data?.backups || []); setLimit(j.data?.limit ?? 0); });
  }, [id]);
  React.useEffect(() => { load(); }, [load]);
  async function create() {
    setBusy('new'); setErr(''); setMsg('');
    const r = await fetch(`/api/servers/${id}/backups`, { method: 'POST', credentials: 'include' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.errors?.[0]?.detail || 'Failed to create backup'); } else { setMsg('Backup started.'); }
    setBusy(''); load();
  }
  async function restore(uuid: string) {
    if (!confirm('Restore this backup? This will overwrite the current server files and stop the server.')) return;
    setBusy(uuid); setErr(''); setMsg('');
    const r = await fetch(`/api/servers/${id}/backups/${uuid}/restore`, { method: 'POST', credentials: 'include' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.errors?.[0]?.detail || 'Failed to restore'); } else setMsg('Restore started.');
    setBusy(''); load();
  }
  async function remove(uuid: string) {
    if (!confirm('Delete this backup?')) return;
    setBusy(uuid); setErr(''); setMsg('');
    const r = await fetch(`/api/servers/${id}/backups/${uuid}`, { method: 'DELETE', credentials: 'include' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.errors?.[0]?.detail || 'Failed to delete'); } else setMsg('Backup deleted.');
    setBusy(''); load();
  }
  async function download(uuid: string) {
    setErr(''); setMsg('');
    const r = await fetch(`/api/servers/${id}/backups/${uuid}/download`, { credentials: 'include' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.data?.url) { setErr(j.errors?.[0]?.detail || 'Failed to get download link'); return; }
    window.open(j.data.url, '_blank');
  }
  function fmt(n: number) { if (!n) return '0 B'; if (n < 1024) return `${n} B`; if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`; return `${(n / 1048576).toFixed(1)} MB`; }
  const canAdd = limit === 0 || backups.length < limit;
  return (
    <div className="stack">
      {msg && <div className="alert" style={{ borderColor: '#1a2e1a', background: '#0f1a12', color: '#bbf7d0' }}>{msg}</div>}
      {err && <div className="alert alert-error">{err}</div>}
      <Card title={`Backups (${backups.length}${limit > 0 ? ` / ${limit}` : ''})`} action={<button className="btn btn-primary btn-sm" disabled={busy === 'new' || !canAdd} onClick={create}><FiPlus size={13} /> {busy === 'new' ? 'Starting...' : 'Create'}</button>}>
        {backups.length === 0 ? <p className="muted">No backups yet. Click Create to make one.</p> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Name</th><th style={{ width: 90 }}>Size</th><th style={{ width: 110 }}>Status</th><th style={{ width: 170 }}>Created</th><th style={{ width: 130 }} className="right">Actions</th></tr></thead>
            <tbody>
              {backups.map((b) => (
                <tr key={b.uuid}>
                  <td><span className="fname-inner"><FiDatabase size={14} style={{ color: 'var(--muted-2)', flexShrink: 0 }} /><span className="fname-text">{b.name}</span></span></td>
                  <td className="mono muted" style={{ fontSize: 12 }}>{fmt(b.size)}</td>
                  <td>{b.status === 'completed' ? <span className="badge badge-active">Completed</span> : b.status === 'failed' ? <span className="badge" style={{ color: '#f87171', borderColor: 'rgba(248,113,113,0.3)' }}>Failed</span> : <span className="badge" style={{ color: '#facc15', borderColor: 'rgba(250,204,21,0.3)' }}>Running</span>}</td>
                  <td className="mono muted" style={{ fontSize: 11 }}>{new Date(b.createdAt).toLocaleString()}</td>
                  <td className="right" style={{ whiteSpace: 'nowrap' }}>
                    {b.status === 'completed' && <button className="btn btn-ghost btn-sm" disabled={busy === b.uuid} onClick={() => download(b.uuid)} title="Download"><FiDownload size={12} /></button>}
                    {b.status === 'completed' && <button className="btn btn-ghost btn-sm" disabled={busy === b.uuid} onClick={() => restore(b.uuid)} title="Restore"><FiRotateCcw size={12} /></button>}
                    <button className="btn btn-ghost btn-sm" disabled={busy === b.uuid} onClick={() => remove(b.uuid)} title="Delete" style={{ color: '#f87171' }}><FiTrash2 size={12} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Card>
    </div>
  );
}

function AllocationsTab({ id, srv }: { id: number; srv: { allocation: { id: number; ip: string; port: number } | null; node: { name: string; scheme: string; fqdn: string; daemonListen: number } | null } }) {
  const [data, setData] = React.useState<{ primary_id: number | null; assigned: { id: number; ip: string; port: number; alias?: string | null }[]; limit: number; can_add: boolean; free_count: number } | null>(null);
  const [busy, setBusy] = React.useState('');
  const [msg, setMsg] = React.useState('');
  const [err, setErr] = React.useState('');
  const load = React.useCallback(() => {
    fetch(`/api/servers/${id}/allocations`, { credentials: 'include' }).then((r) => r.json()).then((j) => setData(j.data || null));
  }, [id]);
  React.useEffect(() => { load(); }, [load]);
  async function assign() {
    setBusy('add'); setErr(''); setMsg('');
    const r = await fetch(`/api/servers/${id}/allocations`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.errors?.[0]?.detail || 'Failed to add allocation'); } else setMsg(`Added ${j.data?.allocation?.ip}:${j.data?.allocation?.port}.`);
    setBusy(''); load();
  }
  async function remove(aid: number) {
    setBusy(String(aid)); setErr(''); setMsg('');
    const r = await fetch(`/api/servers/${id}/allocations/${aid}`, { method: 'DELETE', credentials: 'include' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErr(j.errors?.[0]?.detail || 'Failed to remove'); } else setMsg('Allocation removed.');
    setBusy(''); load();
  }
  const atLimit = data ? data.limit !== 0 && data.assigned.length >= data.limit : true;
  return (
    <div className="stack">
      {msg && <div className="alert" style={{ borderColor: '#1a2e1a', background: '#0f1a12', color: '#bbf7d0' }}>{msg}</div>}
      {err && <div className="alert alert-error">{err}</div>}
      <Card title={`Allocations (${data?.assigned.length ?? 0}${data && data.limit !== 0 ? ` / ${data.limit}` : ''})`} action={<button className="btn btn-primary btn-sm" disabled={busy === 'add' || atLimit || (data ? !data.can_add : true)} onClick={assign}><FiPlus size={13} /> {busy === 'add' ? 'Adding…' : 'Add allocation'}</button>}>
        {data && data.assigned.map((a) => (
          <div key={a.id} className="alloc-row" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--border)', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span className="mono" style={{ fontSize: 14, fontWeight: 600 }}>{a.ip}:{a.port}</span>
              {a.alias && <span className="badge badge-active" style={{ fontStyle: 'italic' }}>{a.alias}</span>}
              {a.id === data.primary_id && <span className="badge badge-active">Primary</span>}
            </div>
            <button className="btn btn-ghost btn-sm" disabled={busy === String(a.id) || a.id === data.primary_id} onClick={() => remove(a.id)} style={a.id === data.primary_id ? { opacity: 0.35, cursor: 'not-allowed' } : undefined}><FiTrash2 size={13} /> Remove</button>
          </div>
        ))}
        {(!data || data.assigned.length === 0) && <p className="muted">No allocations assigned.</p>}
      </Card>
      {data && data.free_count === 0 && <div className="alert">No free ports left on this node.</div>}
      <Card title="Node">
        {srv.node ? (
          <p className="mono muted" style={{ margin: 0 }}>{srv.node.name} · {srv.node.scheme}://{srv.node.fqdn}:{srv.node.daemonListen}</p>
        ) : <p className="muted">No node.</p>}
      </Card>
    </div>
  );
}

function StartupTab({ id }: { id: number }) {
  const [data, setData] = React.useState<{ name: string; startup: string; image: string; dockerImages: Record<string, string>; variables: { id: number; name: string; description: string; env_variable: string; default_value: string; user_viewable: boolean; user_editable: boolean; rules: string; value: string }[] } | null>(null);
  const [vars, setVars] = React.useState<Record<string, string>>({});
  const [image, setImage] = React.useState('');
  const [startup, setStartup] = React.useState('');
  const [msg, setMsg] = React.useState('');
  const [err, setErr] = React.useState('');
  React.useEffect(() => {
    fetch(`/api/servers/${id}/startup`, { credentials: 'include' }).then((r) => r.json()).then((j) => {
      setData(j.data || null);
      if (j.data) {
        setImage(j.data.image); setStartup(j.data.startup);
        const v: Record<string, string> = {};
        j.data.variables?.forEach((x: { env_variable: string; value: string }) => { v[x.env_variable] = x.value; });
        setVars(v);
      }
    });
  }, [id]);
  if (!data) return <Skeleton lines={5} />;
  async function saveStartup() {
    if (!data) return;
    setErr(''); setMsg('');
    const res = await fetch(`/api/servers/${id}/startup/variables`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ variables: vars }) });
    const j = await res.json();
    if (!res.ok) { setErr(j.errors?.[0]?.detail || 'Failed'); return; }
    if (image !== data.image || startup !== data.startup) {
      const r2 = await fetch(`/api/servers/${id}/settings`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image, startup }) });
      const j2 = await r2.json();
      if (!r2.ok) { setErr(j2.errors?.[0]?.detail || 'Failed'); return; }
    }
    setMsg('Startup saved.');
  }
  const imgNames = Object.keys(data.dockerImages || {});
  return (
    <div className="stack">
      {msg && <div className="alert" style={{ borderColor: '#1a2e1a', background: '#0f1a12', color: '#bbf7d0' }}>{msg}</div>}
      {err && <div className="alert alert-error">{err}</div>}
      <Card title="Docker image">
        {imgNames.length > 0 ? (
          <div className="file-grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))' }}>
            {imgNames.map((k) => <button key={k} className={`file-item ${image === data.dockerImages[k] ? 'file-item-active' : ''}`} style={{ borderColor: image === data.dockerImages[k] ? '#22c55e' : undefined }} onClick={() => setImage(data.dockerImages[k])}>{k}</button>)}
          </div>
        ) : (
          <input className="input mono" value={image} onChange={(e) => setImage(e.target.value)} />
        )}
      </Card>
      <Card title="Startup command">
        <input className="input mono" value={startup} onChange={(e) => setStartup(e.target.value)} />
      </Card>
      <Card title="Variables">
        {data.variables.filter((v) => v.user_editable && v.user_viewable).map((v) => (
          <div className="var-row" key={v.id}>
            <span className="var-name">{v.name} <span className="mono muted" style={{ fontWeight: 400, fontSize: 11 }}>{v.env_variable}</span></span>
            <span className="var-desc">{v.description || '—'}</span>
            <input className="input mono" value={vars[v.env_variable] ?? ''} onChange={(e) => setVars((p) => ({ ...p, [v.env_variable]: e.target.value }))} />
          </div>
        ))}
        {data.variables.filter((v) => v.user_editable && v.user_viewable).length === 0 && <p className="muted">No editable variables.</p>}
      </Card>
      <div><button className="btn btn-primary" onClick={saveStartup}><FiSave size={13} /> Save</button></div>
    </div>
  );
}

function SettingsTab({ id, srv, onSaved }: { id: number; srv: { name: string; description: string | null; memory: number; disk: number; cpu: number; image: string }; onSaved: (d: Partial<{ name: string; description: string | null }>) => void }) {
  const [name, setName] = React.useState(srv.name);
  const [description, setDescription] = React.useState(srv.description || '');
  const [msg, setMsg] = React.useState('');
  const [err, setErr] = React.useState('');
  const [booting, setBooting] = React.useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setMsg('');
    const res = await fetch(`/api/servers/${id}/settings`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, description }) });
    const j = await res.json();
    if (!res.ok) { setErr(j.errors?.[0]?.detail || 'Failed'); return; }
    setMsg('Saved.'); onSaved(j.data || { name, description });
  }
  async function reinstall() {
    if (!confirm('Reinstall this server? All existing server files will be wiped and reinstalled.')) return;
    setErr(''); setMsg(''); setBooting(true);
    try {
      const res = await fetch(`/api/servers/${id}/reinstall`, { method: 'POST', credentials: 'include' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.errors?.[0]?.detail || 'Failed to reinstall'); return; }
      setMsg('Reinstall started.');
    } finally { setBooting(false); }
  }
  return (
    <div className="stack">
      {msg && <div className="alert" style={{ borderColor: '#1a2e1a', background: '#0f1a12', color: '#bbf7d0' }}>{msg}</div>}
      {err && <div className="alert alert-error">{err}</div>}
      <Card title="General">
        <form onSubmit={save} className="form">
          <label className="field"><span className="label">Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field"><span className="label">Description</span><input className="input" value={description} onChange={(e) => setDescription(e.target.value)} /></label>
          <button className="btn btn-primary" type="submit"><FiSave size={13} /> Save</button>
        </form>
      </Card>
      <Card title="Allocation">
        <p className="mono muted" style={{ margin: 0 }}>{srv.image.split('/').pop()?.split(':')[0] || 'unknown'} · {srv.memory} MB RAM · {srv.disk} MB disk · {srv.cpu}% CPU</p>
      </Card>
      <Card title="Danger zone">
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>Reinstalling wipes all server files and re-runs the egg install script.</p>
        <button className="btn btn-danger" disabled={booting} onClick={reinstall}>{booting ? 'Reinstalling…' : 'Reinstall server'}</button>
      </Card>
    </div>
  );
}

function SettingsPage() {
  const [me, setMe] = React.useState<{ email: string; username: string; status: string; expiresAt: string | null } | null>(null);
  const [pw, setPw] = React.useState({ current: '', next: '', confirm: '' });
  const [msg, setMsg] = React.useState(''); const [err, setErr] = React.useState('');
  React.useEffect(() => { fetch('/api/me', { credentials: 'include' }).then((r) => r.json()).then((j) => setMe(j.data || null)); }, []);
  async function changePw(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setMsg('');
    if (pw.next !== pw.confirm) { setErr('Passwords do not match'); return; }
    const res = await fetch('/api/auth/change-password', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current: pw.current, next: pw.next }) });
    const j = await res.json();
    if (!res.ok) { setErr(j.errors?.[0]?.detail || 'Failed'); return; }
    setMsg('Password updated — sign in again.'); setPw({ current: '', next: '', confirm: '' });
  }
  if (!me) return <div className="page"><Skeleton lines={3} /></div>;
  return (
    <div className="page" style={{ maxWidth: 640, gap: 16 }}>
      <h1 className="h1">Settings</h1>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 14, background: 'transparent', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ width: 40, height: 40, borderRadius: 999, background: 'var(--text)', color: 'var(--bg)', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 14 }}>{me.username.slice(0, 1).toUpperCase()}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 650, fontSize: 14 }}>{me.username}</div>
          <div className="mono muted" style={{ fontSize: 12 }}>{me.email}</div>
        </div>
        <span className={`badge badge-${me.status}`} style={{ marginLeft: 'auto' }}>{me.status}</span>
      </div>
      <Card title="Profile">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div><div className="label">Email</div><div className="mono" style={{ fontSize: 13, marginTop: 4 }}>{me.email}</div></div>
          <div><div className="label">Username</div><div className="mono" style={{ fontSize: 13, marginTop: 4 }}>{me.username}</div></div>
          <div><div className="label">Status</div><div style={{ marginTop: 6 }}><span className={`badge badge-${me.status}`}>{me.status}</span></div></div>
          <div><div className="label">Expires</div><div className="mono muted" style={{ fontSize: 13, marginTop: 4 }}>{me.expiresAt ? new Date(me.expiresAt).toLocaleString() : '—'}</div></div>
        </div>
      </Card>
      <Card title="Security">
        <div style={{ display: 'grid', gap: 16 }}>
          <form onSubmit={changePw} className="form" style={{ marginTop: 0 }}>
            <div className="label">Change password</div>
            <label className="field"><span className="label">Current password</span><input id="cp-cur" type="password" className="input" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" /></label>
            <label className="field"><span className="label">New password</span><input id="cp-new" type="password" className="input" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" /></label>
            <label className="field"><span className="label">Confirm new password</span><input id="cp-conf" type="password" className="input" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} autoComplete="new-password" /></label>
            {err && <div className="alert alert-error" role="alert">{err}</div>}
            {msg && <div className="alert" style={{ borderColor: '#1a2e1a', background: '#0f1a12', color: '#bbf7d0' }}>{msg}</div>}
            <button type="submit" className="btn btn-primary">Update password</button>
          </form>
          <div style={{ height: 1, background: 'var(--line)' }} />
          <div>
            <div className="label" style={{ marginBottom: 8 }}>Two-factor</div>
            <TwoFactorCard />
          </div>
        </div>
      </Card>
    </div>
  );
}

function PanelSettingsCard() {
  const [settings, setSettings] = React.useState<Record<string, string> | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [sMsg, setSMsg] = React.useState('');
  React.useEffect(() => { fetch('/api/settings', { credentials: 'include' }).then((r) => r.json()).then((j) => setSettings(j.data || null)).catch(() => setSettings({})); }, []);
  async function saveSettings(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setSMsg('');
    const res = await fetch('/api/settings', { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) setSMsg(j.errors?.[0]?.detail || 'Failed to save');
    else setSMsg('Saved');
    setSaving(false);
  }
  const envHint: Record<string, string> = {
    panel_name: 'APP_NAME', company: 'APP_VENDOR', studio: 'APP_STUDIO', grace_days: 'GRACE_DAYS',
    app_url: 'APP_URL', cors_origin: 'CORS_ORIGIN',
  };
  return (
    <Card title="Panel settings">
      {!settings ? <Skeleton lines={3} /> : (
        <form onSubmit={saveSettings} className="form" style={{ marginTop: 0 }}>
          {Object.entries(settings).length === 0 ? <p className="muted" style={{ fontSize: 13, margin: 0 }}>No editable settings yet — add keys to <span className="mono">settings</span> table or expose more .env keys.</p> : Object.entries(settings).map(([k, v]) => (
            <label key={k} className="field">
              <span className="label">{k} <span className="mono muted" style={{ fontWeight: 400, fontSize: 11 }}>· {envHint[k] || k}</span></span>
              <input className="input" value={v} onChange={(e) => setSettings({ ...settings, [k]: e.target.value })} />
            </label>
          ))}
          {sMsg && <div className="alert" style={{ borderColor: '#1a2e1a', background: '#0f1a12', color: '#bbf7d0' }}>{sMsg}</div>}
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
        </form>
      )}
    </Card>
  );
}

function TwoFactorCard() {
  const [qr, setQr] = React.useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = React.useState(''); const [msg, setMsg] = React.useState(''); const [err, setErr] = React.useState('');
  async function setup() {
    setErr(''); setMsg('');
    const res = await fetch('/api/auth/2fa/setup', { method: 'POST', credentials: 'include' });
    const j = await res.json();
    if (!res.ok) { setErr(j.errors?.[0]?.detail || 'Failed'); return; }
    setQr(j.data);
  }
  async function enable() {
    setErr(''); setMsg('');
    const res = await fetch('/api/auth/2fa/enable', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    const j = await res.json();
    if (!res.ok) { setErr(j.errors?.[0]?.detail || 'Invalid code'); return; }
    setMsg('2FA enabled.'); setQr(null); setCode('');
  }
  return (
    <div className="stack">
      <p className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>TOTP 2FA — add the secret to your authenticator, then verify.</p>
      {!qr ? <button className="btn btn-ghost" onClick={setup}>Setup 2FA</button> : (
        <div className="stack">
          <div className="code-block"><div className="label">Secret</div><pre className="pre">{qr.secret}</pre><div className="mono muted" style={{ fontSize: 11, wordBreak: 'break-all' }}>{qr.uri}</div></div>
          <label className="field"><span className="label">Code</span><input id="2fa-code" className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="123 456" inputMode="numeric" /></label>
          <button className="btn btn-primary" onClick={enable}>Verify</button>
        </div>
      )}
      {err && <div className="alert alert-error" role="alert">{err}</div>}
      {msg && <div className="alert" style={{ borderColor: '#1a2e1a', background: '#0f1a12', color: '#bbf7d0' }}>{msg}</div>}
    </div>
  );
}

// ── Admin ──
function AdminOverview() {
  const [c, setC] = React.useState({ users: '—', servers: '—', nodes: '—' });
  React.useEffect(() => {
    Promise.all([
      fetch('/api/users', { credentials: 'include' }).then((r) => r.json()).catch(() => ({ data: [] })),
      fetch('/api/servers', { credentials: 'include' }).then((r) => r.json()).catch(() => ({ data: [] })),
      fetch('/api/nodes', { credentials: 'include' }).then((r) => r.json()).catch(() => ({ data: [] })),
    ]).then(([u, s, n]) => setC({ users: String(u.data?.length ?? 0), servers: String(s.data?.length ?? 0), nodes: String(n.data?.length ?? 0) }));
  }, []);
  return (
    <div className="page">
      <h1 className="h1">Admin</h1>
      <div className="kpi-grid">
        <div className="kpi kpi--primary"><div className="kpi-label">Users</div><div className="kpi-value">{c.users}</div><div className="kpi-meta">Accounts</div></div>
        <div className="kpi"><div className="kpi-label">Servers</div><div className="kpi-value">{c.servers}</div><div className="kpi-meta">Game · VPS</div></div>
      </div>
      <div className="meta-row"><span>Nodes: {c.nodes} · Wings</span></div>
      <Card title="Go to">
        <div className="stack">
          <NavLink to="/admin/users" className="row-link"><span className="row-link-title">Users</span><span className="row-link-meta">Create and suspend</span></NavLink>
          <NavLink to="/admin/servers" className="row-link"><span className="row-link-title">Servers</span><span className="row-link-meta">Assign with resources</span></NavLink>
        </div>
      </Card>
      <PanelSettingsCard />
    </div>
  );
}

function UsersAdmin() {
  const [rows, setRows] = React.useState<{ id: number; username: string; email: string; status: string; isAdmin: boolean }[]>([]);
  const [open, setOpen] = React.useState(false);
  const [edit, setEdit] = React.useState<{ id: number; username: string; email: string; is_admin: boolean; status: string } | null>(null);
  const [f, setF] = React.useState({ username: '', email: '', password: '', is_admin: false });
  const [err, setErr] = React.useState(''); const [msg, setMsg] = React.useState('');
  const load = React.useCallback(() => fetch('/api/users', { credentials: 'include' }).then((r) => r.json()).then((j) => setRows(j.data || [])), []);
  React.useEffect(() => { load(); }, [load]);
  async function create(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setMsg('');
    const res = await fetch('/api/users', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: f.username, email: f.email, password: f.password, is_admin: f.is_admin }) });
    const j = await res.json();
    if (!res.ok) { setErr(j.errors?.[0]?.detail || 'Failed'); return; }
    setMsg(`Created ${j.data.email}`); setF({ username: '', email: '', password: '', is_admin: false }); setOpen(false); load();
  }
  async function saveEdit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    if (!edit) return;
    const res = await fetch(`/api/users/${edit.id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: edit.username, email: edit.email, is_admin: edit.is_admin, status: edit.status }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(j.errors?.[0]?.detail || 'Failed to save'); return; }
    setEdit(null); load();
  }
  async function suspend(id: number, s: string) {
    const path = s === 'suspended' ? 'unsuspend' : 'suspend';
    await fetch(`/api/users/${id}/${path}`, { method: 'POST', credentials: 'include' }); load();
  }
  return (
    <div className="page">
      <div className="page-head"><div><h1 className="h1">Users</h1></div><button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>New user</button></div>
      {msg && <div className="alert" style={{ borderColor: '#1a2e1a', background: '#0f1a12', color: '#bbf7d0' }}>{msg}</div>}
      <div className="table-wrap"><table className="table"><thead><tr><th>User</th><th>Email</th><th>Status</th><th></th></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={4} className="muted">No users.</td></tr> : rows.map((u) => <tr key={u.id}><td>{u.username} {u.isAdmin && <span className="badge badge-admin">admin</span>}</td><td className="mono" style={{ fontSize: 12 }}>{u.email}</td><td><span className={`badge badge-${u.status}`}>{u.status}</span></td><td><div style={{ display: 'flex', gap: 6 }}><button className="btn btn-ghost btn-sm" onClick={() => setEdit({ id: u.id, username: u.username, email: u.email, is_admin: u.isAdmin, status: u.status })}>Edit</button><button className="btn btn-ghost btn-sm" onClick={() => suspend(u.id, u.status)}>{u.status === 'suspended' ? 'Unsuspend' : 'Suspend'}</button></div></td></tr>)}</tbody></table></div>
      <Modal open={open} onClose={() => setOpen(false)} title="New user" footer={<><button className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary" form="user-create">Create</button></>}>
        <form id="user-create" onSubmit={create} className="form">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label className="field"><span className="label">Username</span><input id="u-user" className="input" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} placeholder="ava_stone" /></label>
            <label className="field"><span className="label">Email</span><input id="u-email" className="input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="ava@qyrocloud.example" /></label>
          </div>
          <label className="field"><span className="label">Password</span><input id="u-pass" className="input" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder="At least 8" /></label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={f.is_admin} onChange={(e) => setF({ ...f, is_admin: e.target.checked })} /> Admin</label>
          {err && <div className="alert alert-error" role="alert">{err}</div>}
        </form>
      </Modal>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={`Edit ${edit?.username || ''}`} footer={<><button className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button><button className="btn btn-primary" form="user-edit">Save</button></>}>
        {edit && (
          <form id="user-edit" onSubmit={saveEdit} className="form">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <label className="field"><span className="label">Username</span><input className="input" value={edit.username} onChange={(e) => setEdit({ ...edit, username: e.target.value })} /></label>
              <label className="field"><span className="label">Email</span><input className="input" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></label>
            </div>
            <label className="field"><span className="label">Status</span><select className="input" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}><option value="active">Active</option><option value="suspended">Suspended</option></select></label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}><input type="checkbox" checked={edit.is_admin} onChange={(e) => setEdit({ ...edit, is_admin: e.target.checked })} /> Admin</label>
            {err && <div className="alert alert-error" role="alert">{err}</div>}
          </form>
        )}
      </Modal>
    </div>
  );
}

type ServerFormState = { name: string; description: string; userId: string; nodeId: string; eggId: string; allocationId: string; memory: string; swap: string; disk: string; io: string; cpu: string; threads: string; image: string; startup: string; oom_disabled: boolean; allocation_limit: string; backup_limit: string; expires_at: string };

function ServerForm({ initial, users, nodes, eggs, submitLabel, formId = 'server-form', onSubmit }: {
  initial: ServerFormState;
  users: { id: number; username: string }[];
  nodes: { id: number; name: string }[];
  eggs: { id: number; name: string; dockerImages: Record<string, string>; dockerImage: string; startup: string }[];
  submitLabel: string;
  formId?: string;
  onSubmit: (f: ServerFormState) => Promise<string | null>;
}) {
  const [f, setF] = React.useState(initial);
  const [allocs, setAllocs] = React.useState<{ id: number; ip: string; port: number; serverId: number | null }[]>([]);
  const [adv, setAdv] = React.useState(false);
  const [err, setErr] = React.useState('');
  React.useEffect(() => {
    const id = parseInt(f.nodeId || '0', 10);
    if (!id) { setAllocs([]); setF((p) => ({ ...p, allocationId: '' })); return; }
    fetch(`/api/nodes/${id}/allocations`, { credentials: 'include' }).then((r) => r.json()).then((j) => {
      const free = (j.data || []).filter((a: { serverId: number | null }) => !a.serverId);
      setAllocs(free);
      if (!f.allocationId && free.length) setF((p) => ({ ...p, allocationId: String(free[0].id) }));
    });
  }, [f.nodeId]);
  function onEggChange(eggId: string) {
    setF((p) => ({ ...p, eggId }));
    const egg = eggs.find((e) => String(e.id) === eggId);
    if (egg) setF((p) => ({ ...p, image: Object.values(egg.dockerImages)[0] || egg.dockerImage || '', startup: egg.startup }));
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    const msg = await onSubmit(f);
    if (msg) setErr(msg);
  }
  return (
    <form id={formId} onSubmit={submit} className="form">
      <label className="field"><span className="label">Name</span><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="survival-01" /></label>
      <label className="field"><span className="label">Description</span><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Optional note" /></label>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label className="field"><span className="label">Owner</span><select className="input" value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}><option value="">Choose…</option>{users.map((u) => <option key={u.id} value={u.id}>{u.username}</option>)}</select></label>
        <label className="field"><span className="label">Node</span><select className="input" value={f.nodeId} onChange={(e) => setF({ ...f, nodeId: e.target.value, allocationId: '' })}><option value="">Choose…</option>{nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <label className="field"><span className="label">Egg</span><select className="input" value={f.eggId} onChange={(e) => onEggChange(e.target.value)}><option value="">Choose…</option>{eggs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label className="field"><span className="label">Allocation {allocs.length === 0 ? '(no free ports)' : '(auto)'}</span><select className="input" value={f.allocationId} onChange={(e) => setF({ ...f, allocationId: e.target.value })}><option value="">Choose IP:port…</option>{allocs.filter((a) => !a.serverId || String(a.id) === f.allocationId).map((a) => <option key={a.id} value={a.id}>{a.ip}:{a.port}</option>)}</select></label>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <label className="field"><span className="label">RAM MB</span><input className="input" value={f.memory} onChange={(e) => setF({ ...f, memory: e.target.value })} /></label>
        <label className="field"><span className="label">Disk MB</span><input className="input" value={f.disk} onChange={(e) => setF({ ...f, disk: e.target.value })} /></label>
        <label className="field"><span className="label">CPU %</span><input className="input" value={f.cpu} onChange={(e) => setF({ ...f, cpu: e.target.value })} /></label>
      </div>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdv(!adv)}>{adv ? 'Hide advanced options' : 'Show advanced options'}</button>
      {adv && (
        <div className="stack" style={{ marginTop: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <label className="field"><span className="label">Swap MB</span><input className="input" value={f.swap} onChange={(e) => setF({ ...f, swap: e.target.value })} placeholder="0" /></label>
            <label className="field"><span className="label">IO weight</span><input className="input" value={f.io} onChange={(e) => setF({ ...f, io: e.target.value })} placeholder="500" /></label>
            <label className="field"><span className="label">Threads (cgroup)</span><input className="input" value={f.threads} onChange={(e) => setF({ ...f, threads: e.target.value })} placeholder="0-3" /></label>
          </div>
          <label className="field"><span className="label">Expires at (optional)</span><input type="datetime-local" className="input" value={f.expires_at} onChange={(e) => setF({ ...f, expires_at: e.target.value })} /></label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label className="field"><span className="label">Allocation limit (0 = unlimited)</span><input className="input" value={f.allocation_limit} onChange={(e) => setF({ ...f, allocation_limit: e.target.value })} placeholder="1" /></label>
            <label className="field"><span className="label">Backup limit (0 = unlimited)</span><input className="input" value={f.backup_limit} onChange={(e) => setF({ ...f, backup_limit: e.target.value })} placeholder="0" /></label>
          </div>
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><input type="checkbox" className="input" style={{ width: 'auto' }} checked={f.oom_disabled} onChange={(e) => setF({ ...f, oom_disabled: e.target.checked })} /><span className="label" style={{ margin: 0 }}>Disable OOM killer</span></label>
        </div>
      )}
      <label className="field"><span className="label">Image (auto-filled from egg)</span><input className="input mono" value={f.image} onChange={(e) => setF({ ...f, image: e.target.value })} placeholder="ghcr.io/pterodactyl/yolks:java_21" /></label>
      <label className="field"><span className="label">Startup (auto-filled from egg)</span><input className="input mono" value={f.startup} onChange={(e) => setF({ ...f, startup: e.target.value })} placeholder="java -jar server.jar" /></label>
      {err && <div className="alert alert-error" role="alert">{err}</div>}
      <button className="btn btn-primary" type="submit">{submitLabel}</button>
    </form>
  );
}

function NewServerPage() {
  const nav = useNavigate();
  const [users, setUsers] = React.useState<{ id: number; username: string }[]>([]);
  const [nodes, setNodes] = React.useState<{ id: number; name: string }[]>([]);
  const [eggs, setEggs] = React.useState<{ id: number; name: string; dockerImages: Record<string, string>; dockerImage: string; startup: string }[]>([]);
  React.useEffect(() => {
    fetch('/api/users', { credentials: 'include' }).then((r) => r.json()).then((j) => setUsers(j.data || []));
    fetch('/api/nodes', { credentials: 'include' }).then((r) => r.json()).then((j) => setNodes(j.data || []));
    fetch('/api/eggs', { credentials: 'include' }).then((r) => r.json()).then((j) => setEggs(j.data || []));
  }, []);
  const empty: ServerFormState = { name: '', description: '', userId: '', nodeId: '', eggId: '', allocationId: '', memory: '1024', swap: '0', disk: '10240', io: '500', cpu: '100', threads: '', image: '', startup: '', oom_disabled: false, allocation_limit: '1', backup_limit: '0', expires_at: '' };
  async function submit(f: ServerFormState) {
    const res = await fetch('/api/servers', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      name: f.name, description: f.description || undefined, userId: parseInt(f.userId, 10), nodeId: parseInt(f.nodeId, 10), eggId: parseInt(f.eggId, 10), allocationId: parseInt(f.allocationId, 10), memory: parseInt(f.memory, 10), swap: parseInt(f.swap, 10), disk: parseInt(f.disk, 10), io: parseInt(f.io, 10), cpu: parseInt(f.cpu, 10), threads: f.threads || undefined, oom_disabled: f.oom_disabled, image: f.image, startup: f.startup, allocation_limit: parseInt(f.allocation_limit || '1', 10), backup_limit: parseInt(f.backup_limit || '0', 10), expires_at: f.expires_at || null,
    }) });
    const j = await res.json();
    if (!res.ok) return j.errors?.[0]?.detail || 'Failed';
    nav('/admin/servers');
    return null;
  }
  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <div className="page-head"><div><h1 className="h1">New server</h1><p className="lede">Provision a game server onto a Wings node.</p></div><NavLink to="/admin/servers" className="btn btn-ghost btn-sm">Back</NavLink></div>
      <Card title="Details"><ServerForm initial={empty} users={users} nodes={nodes} eggs={eggs} submitLabel="Create server" onSubmit={submit} /></Card>
    </div>
  );
}

function ServerEditorPage() {
  const { id } = useParams() as { id: string };
  const serverId = Number(id);
  const nav = useNavigate();
  const [srv, setSrv] = React.useState<any>(null);
  const [users, setUsers] = React.useState<{ id: number; username: string; email: string }[]>([]);
  const [nodes, setNodes] = React.useState<{ id: number; name: string }[]>([]);
  const [eggs, setEggs] = React.useState<{ id: number; name: string; dockerImages: Record<string, string>; dockerImage: string; startup: string }[]>([]);
  const [allocs, setAllocs] = React.useState<{ id: number; ip: string; port: number; serverId: number | null }[]>([]);
  const [vars, setVars] = React.useState<{ variable_id: number; name: string; description: string | null; env_variable: string; default_value: string; rules: string; value: string; user_editable: boolean }[]>([]);
  const [f, setF] = React.useState({
    name: '', description: '', userId: '', nodeId: '', eggId: '', allocationId: '', memory: '', swap: '0', disk: '', io: '500', cpu: '', threads: '', image: '', startup: '', oom_disabled: false, status: 'active', allocation_limit: '1', backup_limit: '0', expires_at: '',
  });
  const [err, setErr] = React.useState(''); const [msg, setMsg] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [showToken, setShowToken] = React.useState(false);
  const [booting, setBooting] = React.useState(false);
  const load = React.useCallback(() => {
    fetch(`/api/servers/${id}`, { credentials: 'include' }).then((r) => r.json()).then((j) => {
      const s = j.data;
      if (!s) { setErr('Server not found'); return; }
      setSrv(s);
      setF({ name: s.name, description: s.description || '', userId: String(s.userId), nodeId: String(s.nodeId), eggId: String(s.eggId), allocationId: String(s.allocationId), memory: String(s.memory), swap: String(s.swap ?? 0), disk: String(s.disk), io: String(s.io ?? 500), cpu: String(s.cpu), threads: s.threads || '', image: s.image, startup: s.startup, oom_disabled: !!s.oomDisabled, status: s.status || 'active', allocation_limit: String(s.allocationLimit ?? 1), backup_limit: String(s.backupLimit ?? 0), expires_at: s.expiresAt ? String(s.expiresAt).slice(0, 16) : '' });
    });
    fetch('/api/users', { credentials: 'include' }).then((r) => r.json()).then((j) => setUsers(j.data || []));
    fetch('/api/nodes', { credentials: 'include' }).then((r) => r.json()).then((j) => setNodes(j.data || []));
    fetch('/api/eggs', { credentials: 'include' }).then((r) => r.json()).then((j) => setEggs(j.data || []));
    fetch(`/api/servers/${id}/variables`, { credentials: 'include' }).then((r) => r.json()).then((j) => setVars(j.data || []));
  }, [id]);
  React.useEffect(() => { load(); }, [load]);
  React.useEffect(() => {
    const nid = parseInt(f.nodeId || '0', 10);
    if (!nid) { setAllocs([]); return; }
    fetch(`/api/nodes/${nid}/allocations`, { credentials: 'include' }).then((r) => r.json()).then((j) => setAllocs(j.data || []));
  }, [f.nodeId]);
  function onEggChange(eggId: string) {
    setF((p) => ({ ...p, eggId }));
    const egg = eggs.find((e) => String(e.id) === eggId);
    if (egg) setF((p) => ({ ...p, image: Object.values(egg.dockerImages)[0] || egg.dockerImage || '', startup: egg.startup }));
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setMsg(''); setSaving(true);
    const body: Record<string, unknown> = {
      name: f.name.trim(), description: f.description || null, userId: parseInt(f.userId, 10), nodeId: parseInt(f.nodeId, 10), eggId: parseInt(f.eggId, 10), allocationId: parseInt(f.allocationId, 10),
      memory: parseInt(f.memory, 10), swap: parseInt(f.swap, 10), disk: parseInt(f.disk, 10), io: parseInt(f.io, 10), cpu: parseInt(f.cpu, 10), threads: f.threads || null,
      oom_disabled: f.oom_disabled, image: f.image, startup: f.startup, status: f.status, allocation_limit: parseInt(f.allocation_limit || '1', 10), backup_limit: parseInt(f.backup_limit || '0', 10), expires_at: f.expires_at || null,
    };
    const res = await fetch(`/api/servers/${id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) { setErr(j.errors?.[0]?.detail || 'Save failed'); return; }
    setMsg('Server saved. Config synced to Wings.'); setSrv(j.data);
  }
  async function saveVars() {
    setErr(''); setMsg('');
    const variables: Record<string, string> = {};
    for (const v of vars) variables[v.env_variable] = v.value;
    const res = await fetch(`/api/servers/${id}/variables`, { method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ variables }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(j.errors?.[0]?.detail || 'Failed'); return; }
    setMsg('Environment variables saved.');
  }
  async function setVar(i: number, value: string) { setVars((p) => p.map((v, j) => (j === i ? { ...v, value } : v))); }
  async function reinstall() {
    if (!confirm('Reinstall this server? Its files will be wiped and the install script re-run.')) return;
    setErr(''); setMsg(''); setBooting(true);
    const res = await fetch(`/api/servers/${id}/reinstall`, { method: 'POST', credentials: 'include' });
    const j = await res.json().catch(() => ({}));
    setBooting(false);
    if (!res.ok) { setErr(j.errors?.[0]?.detail || 'Failed'); return; }
    setMsg('Reinstall started on the daemon.'); load();
  }
  async function del() {
    if (!confirm('Delete this server permanently? This wipes it from Wings too.')) return;
    const res = await fetch(`/api/servers/${id}`, { method: 'DELETE', credentials: 'include' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(j.errors?.[0]?.detail || 'Failed'); return; }
    nav('/admin/servers');
  }
  if (!srv) return <div className="page"><div className="lede">Loading server…</div></div>;
  return (
    <div className="page" style={{ maxWidth: 780 }}>
      <div className="page-head"><div><h1 className="h1">Server · {srv.name}</h1><p className="lede">Full configuration for this server.</p></div><NavLink to="/admin/servers" className="btn btn-ghost btn-sm"><FiChevronLeft /> Back</NavLink></div>
      {msg && <div className="alert" style={{ borderColor: '#1a2e1a', background: '#0f1a12', color: '#bbf7d0' }}>{msg}</div>}
      {err && <div className="alert alert-error" role="alert">{err}</div>}
      <Card title="Identity">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label className="field"><span className="label">Name</span><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <label className="field"><span className="label">Status</span><select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="active">active</option><option value="suspended">suspended</option><option value="installing">installing</option><option value="restoring">restoring</option></select></label>
        </div>
        <label className="field"><span className="label">Description</span><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="field"><span className="label">UUID</span><div className="mono muted" style={{ fontSize: 12 }}>{srv.uuid}</div></div>
          <div className="field"><span className="label">Short UUID</span><div className="mono muted" style={{ fontSize: 12 }}>{srv.uuidShort}</div></div>
        </div>
        <div className="field"><span className="label">Expires at (optional)</span><input type="datetime-local" className="input" value={f.expires_at} onChange={(e) => setF({ ...f, expires_at: e.target.value })} /></div>
      </Card>
      <Card title="Owner & placement">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label className="field"><span className="label">Owner</span><select className="input" value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}>{users.map((u) => <option key={u.id} value={u.id}>{u.username} · {u.email}</option>)}</select></label>
          <label className="field"><span className="label">Node</span><select className="input" value={f.nodeId} onChange={(e) => setF({ ...f, nodeId: e.target.value, allocationId: '' })}>{nodes.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <label className="field"><span className="label">Egg</span><select className="input" value={f.eggId} onChange={(e) => onEggChange(e.target.value)}>{eggs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
          <label className="field"><span className="label">Allocation</span><select className="input" value={f.allocationId} onChange={(e) => setF({ ...f, allocationId: e.target.value })}>{allocs.filter((a) => !a.serverId || String(a.id) === f.allocationId).map((a) => <option key={a.id} value={a.id}>{a.ip}:{a.port}{a.serverId ? ' (in use)' : ''}</option>)}</select></label>
        </div>
      </Card>
      <Card title="Resources">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
          <label className="field"><span className="label">RAM (MB)</span><input className="input" value={f.memory} onChange={(e) => setF({ ...f, memory: e.target.value })} /></label>
          <label className="field"><span className="label">Swap (MB)</span><input className="input" value={f.swap} onChange={(e) => setF({ ...f, swap: e.target.value })} /></label>
          <label className="field"><span className="label">Disk (MB)</span><input className="input" value={f.disk} onChange={(e) => setF({ ...f, disk: e.target.value })} /></label>
          <label className="field"><span className="label">CPU %</span><input className="input" value={f.cpu} onChange={(e) => setF({ ...f, cpu: e.target.value })} /></label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 10 }}>
          <label className="field"><span className="label">IO weight</span><input className="input" value={f.io} onChange={(e) => setF({ ...f, io: e.target.value })} /></label>
          <label className="field"><span className="label">Threads (cgroup)</span><input className="input mono" value={f.threads} onChange={(e) => setF({ ...f, threads: e.target.value })} /></label>
          <label className="field" style={{ display: 'flex', alignItems: 'flex-end' }}><label style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 10 }}><input type="checkbox" checked={f.oom_disabled} onChange={(e) => setF({ ...f, oom_disabled: e.target.checked })} /> Disable OOM killer</label></label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
          <label className="field"><span className="label">Allocation limit (0 = unlimited)</span><input className="input" value={f.allocation_limit} onChange={(e) => setF({ ...f, allocation_limit: e.target.value })} placeholder="1" /></label>
          <label className="field"><span className="label">Backup limit (0 = unlimited)</span><input className="input" value={f.backup_limit} onChange={(e) => setF({ ...f, backup_limit: e.target.value })} placeholder="0" /></label>
        </div>
      </Card>
      <Card title="Runtime">
        <label className="field"><span className="label">Image</span><input className="input mono" value={f.image} onChange={(e) => setF({ ...f, image: e.target.value })} /></label>
        <label className="field"><span className="label">Startup command</span><input className="input mono" value={f.startup} onChange={(e) => setF({ ...f, startup: e.target.value })} /></label>
        <div style={{ marginTop: 12 }}><button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save configuration'}</button></div>
      </Card>
      <Card title={`Environment variables (${vars.length})`}>
        {vars.length === 0 ? <div className="muted">No variables defined for this egg.</div> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>Variable</th><th>Env var</th><th>Value</th><th>Default</th></tr></thead><tbody>{vars.map((v, i) => (
            <tr key={v.variable_id}>
              <td>{v.name}{v.description ? <div className="muted" style={{ fontSize: 11 }}>{v.description}</div> : null}</td>
              <td className="mono" style={{ fontSize: 12 }}>{v.env_variable}</td>
              <td><input className="input mono" style={{ minWidth: 160 }} value={v.value} onChange={(e) => setVar(i, e.target.value)} /></td>
              <td className="mono muted" style={{ fontSize: 12 }}>{v.default_value}</td>
            </tr>
          ))}</tbody></table></div>
        )}
        {vars.length > 0 && <div style={{ marginTop: 10 }}><button className="btn btn-primary" onClick={saveVars}>Save variables</button></div>}
      </Card>
      <Card title="Danger zone">
        <div className="stack">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" onClick={reinstall} disabled={booting}>{booting ? 'Starting…' : 'Reinstall server'}</button>
            <NavLink to={`/server/${id}`} className="btn btn-ghost">Open user panel</NavLink>
            <button className="btn" style={{ borderColor: 'rgba(239,68,68,0.4)', color: '#f87171' }} onClick={del}>Delete server</button>
          </div>
          <div className="field"><span className="label" style={{ cursor: 'pointer' }} onClick={() => setShowToken(!showToken)}>Daemon token (raw) — click to {showToken ? 'hide' : 'show'}</span>{showToken && <div className="mono muted" style={{ fontSize: 11 }}>{srv.node?.daemonToken || '(no node)'}</div>}</div>
        </div>
      </Card>
    </div>
  );
}

function AdminServers() {
  const [rows, setRows] = React.useState<{ id: number; name: string; status: string; userId: number; memory: number; disk: number; cpu: number; nodeId: number; eggId: number }[]>([]);
  const [users, setUsers] = React.useState<{ id: number; username: string }[]>([]);
  const [nodes, setNodes] = React.useState<{ id: number; name: string }[]>([]);
  const [eggs, setEggs] = React.useState<{ id: number; name: string; dockerImages: Record<string, string>; dockerImage: string; startup: string }[]>([]);
  const load = React.useCallback(() => {
    fetch('/api/servers', { credentials: 'include' }).then((r) => r.json()).then((j) => setRows(j.data || []));
    fetch('/api/users', { credentials: 'include' }).then((r) => r.json()).then((j) => setUsers(j.data || []));
    fetch('/api/nodes', { credentials: 'include' }).then((r) => r.json()).then((j) => setNodes(j.data || []));
    fetch('/api/eggs', { credentials: 'include' }).then((r) => r.json()).then((j) => setEggs(j.data || []));
  }, []);
  React.useEffect(() => { load(); }, [load]);
  async function setStatus(id: number, status: string) {
    const res = await fetch(`/api/servers/${id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { alert(j.errors?.[0]?.detail || 'Failed'); return; }
    load();
  }
  async function delServer(id: number) {
    if (!confirm('Delete this server? This cannot be undone.')) return;
    const res = await fetch(`/api/servers/${id}`, { method: 'DELETE', credentials: 'include' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { alert(j.errors?.[0]?.detail || 'Failed'); return; }
    load();
  }
  const nodeName = (id: number) => nodes.find((n) => n.id === id)?.name ?? `#${id}`;
  const eggName = (id: number) => eggs.find((e) => e.id === id)?.name ?? `#${id}`;
  return (
    <div className="page">
      <div className="page-head"><div><h1 className="h1">Servers</h1></div><NavLink to="/admin/servers/new" className="btn btn-primary btn-sm"><FiPlus size={13} /> New server</NavLink></div>
      <div className="table-wrap"><table className="table"><thead><tr><th>Server</th><th>Owner</th><th>Node</th><th>Egg</th><th>Resources</th><th>Status</th><th></th></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={7} className="muted">No servers yet.</td></tr> : rows.map((r) => <tr key={r.id}>
        <td className="mono">{r.name}</td>
        <td>{users.find((u) => u.id === r.userId)?.username ?? '—'}</td>
        <td>{nodeName(r.nodeId)}</td>
        <td>{eggName(r.eggId)}</td>
        <td className="mono" style={{ fontSize: 12 }}>{r.memory}MB / {r.disk}MB / {r.cpu}%</td>
        <td><span className={`badge badge-${r.status}`}>{r.status}</span></td>
        <td><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><NavLink to={`/admin/servers/${r.id}`} className="btn btn-ghost btn-sm">Edit</NavLink>{r.status !== 'suspended' ? <button className="btn btn-ghost btn-sm" onClick={() => setStatus(r.id, 'suspended')}>Suspend</button> : <button className="btn btn-ghost btn-sm" onClick={() => setStatus(r.id, 'active')}>Unsuspend</button>}<button className="btn btn-ghost btn-sm" onClick={() => delServer(r.id)} title="Delete server"><FiTrash2 size={13} /></button></div></td>
      </tr>)}</tbody></table></div>
    </div>
  );
}

function NodeEditorPage() {
  const { id } = useParams() as { id: string };
  const nodeId = Number(id);
  const nav = useNavigate();
  const [node, setNode] = React.useState<any>(null);
  const [f, setF] = React.useState({
    name: '', fqdn: '', scheme: 'https', daemonListen: '8080', memory: '0', memoryOverallocate: '0', disk: '0', diskOverallocate: '0', uploadSize: '100', daemonBase: '/var/lib/pterodactyl/volumes', public: true, behindProxy: false,
  });
  const [err, setErr] = React.useState(''); const [msg, setMsg] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [health, setHealth] = React.useState<{ status: string; detail?: string; version?: string | null }>({ status: 'checking' });
  const load = React.useCallback(() => {
    fetch(`/api/nodes/${id}`, { credentials: 'include' }).then((r) => r.json()).then((j) => {
      if (!j.data) return;
      const n = j.data;
      setNode(n);
      setF({ name: n.name, fqdn: n.fqdn, scheme: n.scheme || 'https', daemonListen: String(n.daemonListen), memory: String(n.memory ?? 0), memoryOverallocate: String(n.memoryOverallocate ?? 0), disk: String(n.disk ?? 0), diskOverallocate: String(n.diskOverallocate ?? 0), uploadSize: String(n.uploadSize ?? 100), daemonBase: n.daemonBase || '/var/lib/pterodactyl/volumes', public: !!n.public, behindProxy: !!n.behindProxy });
    }).catch(() => setErr('Failed to load node'));
  }, [id]);
  React.useEffect(() => { load(); }, [load]);
  const checkHealth = React.useCallback(async () => {
    setHealth({ status: 'checking' });
    try {
      const r = await fetch(`/api/nodes/${id}/health`, { credentials: 'include' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.errors?.[0]?.detail || `HTTP ${r.status}`);
      const d = j.data as { status: string; detail?: string; version?: string };
      if (d.status === 'online') setHealth({ status: 'online', version: d.version || null });
      else setHealth({ status: 'error', detail: d.detail || 'Wings returned an error' });
    } catch (e) { setHealth({ status: 'error', detail: String((e as Error).message || e) }); }
  }, [id]);
  React.useEffect(() => { if (node) checkHealth(); }, [node, checkHealth]);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setSaving(true);
    const body: Record<string, unknown> = {
      name: f.name.trim(), fqdn: f.fqdn.trim(), scheme: f.scheme, daemonListen: parseInt(f.daemonListen, 10) || 8080,
      memory: parseInt(f.memory, 10) || 0, memoryOverallocate: parseInt(f.memoryOverallocate, 10) || 0,
      disk: parseInt(f.disk, 10) || 0, diskOverallocate: parseInt(f.diskOverallocate, 10) || 0,
      uploadSize: parseInt(f.uploadSize, 10) || 100, daemonBase: f.daemonBase.trim() || '/var/lib/pterodactyl/volumes',
      public: f.public, behindProxy: f.behindProxy,
    };
    const res = await fetch(`/api/nodes/${id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) { setErr(j.errors?.[0]?.detail || 'Save failed'); return; }
    setMsg('Node saved.'); setNode(j.data); load();
  }
  async function regen() {
    if (!confirm('Regenerate the daemon token? Wings will stop accepting the old token until you update its config.')) return;
    setErr('');
    const res = await fetch(`/api/nodes/${id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ regenerateToken: true }) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(j.errors?.[0]?.detail || 'Failed'); return; }
    setMsg('Token regenerated — copy the new token into Wings config.'); setNode(j.data);
  }
  if (!node) return <div className="page"><div className="lede">Loading node…</div></div>;
  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <div className="page-head"><div><h1 className="h1">Node · {node.name}</h1><p className="lede">Full configuration for this Wings daemon.</p></div><NavLink to="/admin/nodes" className="btn btn-ghost btn-sm"><FiChevronLeft /> Back</NavLink></div>
      {msg && <div className="alert" style={{ borderColor: '#1a2e1a', background: '#0f1a12', color: '#bbf7d0' }}>{msg}</div>}
      {err && <div className="alert alert-error" role="alert">{err}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <Card title="Daemon status">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 10, height: 10, borderRadius: 999, background: health.status === 'online' ? '#22c55e' : health.status === 'error' ? '#ef4444' : '#3a3a3e' }} />
            <span className="mono">{health.status === 'online' ? `Online${health.version ? ` · v${health.version}` : ''}` : health.status === 'error' ? 'Error' : 'Checking…'}</span>
            <button className="btn btn-ghost btn-sm" onClick={checkHealth}>Re-check</button>
          </div>
          {health.detail && <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>{health.detail}</div>}
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted-2)' }}>
            <div>UUID: <span className="mono">{node.uuid}</span></div>
            <div style={{ marginTop: 4 }}>Allocations: <span className="mono">{node.allocations_count ?? 0}</span> · Servers: <span className="mono">{node.servers_count ?? 0}</span></div>
            {node.location && <div style={{ marginTop: 4 }}>Location: <span className="mono">{node.location.short || node.location.long || node.location.name || `#${node.locationId}`}</span></div>}
          </div>
        </Card>
        <Card title="Actions">
          <div className="stack">
            <NavLink to={`/admin/nodes/${id}/allocations`} className="btn btn-ghost">Manage allocations</NavLink>
            <button className="btn btn-ghost" onClick={regen}>Regenerate daemon token</button>
            <button className="btn btn-ghost" onClick={() => nav(`/admin/nodes/${id}/configuration`)}>View Wings config</button>
          </div>
        </Card>
      </div>
      <Card title="Connection">
        <form id="node-editor-form" onSubmit={save} className="form">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label className="field"><span className="label">Name</span><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <label className="field"><span className="label">FQDN</span><input className="input mono" value={f.fqdn} onChange={(e) => setF({ ...f, fqdn: e.target.value })} /></label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label className="field"><span className="label">Scheme</span><select className="input" value={f.scheme} onChange={(e) => setF({ ...f, scheme: e.target.value })}><option value="http">http</option><option value="https">https</option></select></label>
            <label className="field"><span className="label">Daemon port</span><input className="input" value={f.daemonListen} onChange={(e) => setF({ ...f, daemonListen: e.target.value })} /></label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label className="field"><span className="label">Data directory (daemon_base)</span><input className="input mono" value={f.daemonBase} onChange={(e) => setF({ ...f, daemonBase: e.target.value })} /></label>
            <label className="field"><span className="label">Max upload size (MB)</span><input className="input" value={f.uploadSize} onChange={(e) => setF({ ...f, uploadSize: e.target.value })} /></label>
          </div>
          <div style={{ display: 'flex', gap: 16 }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={f.public} onChange={(e) => setF({ ...f, public: e.target.checked })} /> Public node</label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={f.behindProxy} onChange={(e) => setF({ ...f, behindProxy: e.target.checked })} /> Behind reverse proxy</label>
          </div>
        </form>
      </Card>
      <Card title="Resources">
        <form className="form">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <label className="field"><span className="label">Memory (MB, 0 = unlimited)</span><input className="input" value={f.memory} onChange={(e) => setF({ ...f, memory: e.target.value })} /></label>
            <label className="field"><span className="label">Memory over-allocation %</span><input className="input" value={f.memoryOverallocate} onChange={(e) => setF({ ...f, memoryOverallocate: e.target.value })} /></label>
            <label className="field"><span className="label">Disk (MB, 0 = unlimited)</span><input className="input" value={f.disk} onChange={(e) => setF({ ...f, disk: e.target.value })} /></label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
            <label className="field"><span className="label">Disk over-allocation %</span><input className="input" value={f.diskOverallocate} onChange={(e) => setF({ ...f, diskOverallocate: e.target.value })} /></label>
            <div />
          </div>
          <div style={{ marginTop: 12 }}><button className="btn btn-primary" form="node-editor-form" disabled={saving}>{saving ? 'Saving…' : 'Save node'}</button></div>
        </form>
      </Card>
    </div>
  );
}

function NodeConfigurationPage() {
  const { id } = useParams() as { id: string };
  const [cfg, setCfg] = React.useState<{ config: string; autoDeploy: string; panelUrl: string; fqdn: string } | null>(null);
  const [err, setErr] = React.useState('');
  React.useEffect(() => {
    fetch(`/api/nodes/${id}/configuration`, { credentials: 'include' }).then((r) => r.json()).then((j) => {
      if (!j.data) { setErr(j.errors?.[0]?.detail || 'Failed'); return; }
      setCfg(j.data);
    }).catch(() => setErr('Failed to load configuration'));
  }, [id]);
  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <div className="page-head"><div><h1 className="h1">Wings config · node #{id}</h1></div><NavLink to={`/admin/nodes/${id}`} className="btn btn-ghost btn-sm"><FiChevronLeft /> Back to node</NavLink></div>
      {err && <div className="alert alert-error" role="alert">{err}</div>}
      {cfg && (
        <div className="stack">
          <Card title="config.yml">
            <pre className="pre" style={{ whiteSpace: 'pre-wrap' }}>{cfg.config}</pre>
            <div style={{ marginTop: 8 }}><CopyBtn text={cfg.config} /></div>
          </Card>
          <Card title="Auto deploy (SSH into the node and run)">
            <pre className="pre" style={{ whiteSpace: 'pre-wrap' }}>{cfg.autoDeploy}</pre>
            <div style={{ marginTop: 8 }}><CopyBtn text={cfg.autoDeploy} label="Copy deploy" /></div>
          </Card>
        </div>
      )}
    </div>
  );
}

function NewNodePage() {
  const nav = useNavigate();
  const [f, setF] = React.useState({ name: '', fqdn: '', scheme: 'http', daemonListen: '8080' });
  const [err, setErr] = React.useState('');
  async function create(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    const res = await fetch('/api/nodes', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: f.name, fqdn: f.fqdn, scheme: f.scheme, daemonListen: parseInt(f.daemonListen, 10) }) });
    const j = await res.json();
    if (!res.ok) { setErr(j.errors?.[0]?.detail || 'Failed'); return; }
    nav('/admin/nodes');
  }
  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <div className="page-head"><div><h1 className="h1">New node</h1><p className="lede">Register a Wings daemon on this panel.</p></div><NavLink to="/admin/nodes" className="btn btn-ghost btn-sm">Back</NavLink></div>
      <Card title="Details">
        <form id="node-form" onSubmit={create} className="form">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label className="field"><span className="label">Name</span><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="us-1" /></label>
            <label className="field"><span className="label">FQDN</span><input className="input" value={f.fqdn} onChange={(e) => setF({ ...f, fqdn: e.target.value })} placeholder="node1.qyrocloud.example" /></label>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label className="field"><span className="label">Scheme</span><select className="input" value={f.scheme} onChange={(e) => setF({ ...f, scheme: e.target.value })}><option value="http">http</option><option value="https">https</option></select></label>
            <label className="field"><span className="label">Daemon port</span><input className="input" value={f.daemonListen} onChange={(e) => setF({ ...f, daemonListen: e.target.value })} /></label>
          </div>
          {err && <div className="alert alert-error" role="alert">{err}</div>}
          <button className="btn btn-primary" type="submit">Create node</button>
        </form>
      </Card>
    </div>
  );
}

function NodesPage() {
  const [rows, setRows] = React.useState<{ id: number; name: string; fqdn: string; scheme: string; daemonListen: number }[]>([]);
  const [health, setHealth] = React.useState<Record<number, { status: 'online' | 'error' | 'checking'; detail?: string }>>({});
  const [err, setErr] = React.useState('');
  const load = React.useCallback(() => fetch('/api/nodes', { credentials: 'include' }).then((r) => r.json()).then((j) => setRows(j.data || [])), []);
  React.useEffect(() => { load(); }, [load]);
  const checkHealth = React.useCallback(async (id: number) => {
    setHealth((h) => ({ ...h, [id]: { status: 'checking' } }));
    try {
      const r = await fetch(`/api/nodes/${id}/health`, { credentials: 'include' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.errors?.[0]?.detail || `HTTP ${r.status}`);
      const d = j.data as { status: string; detail?: string; http?: number; url?: string };
      if (d.status === 'online') setHealth((h) => ({ ...h, [id]: { status: 'online' } }));
      else {
        const msg = d.detail || `HTTP ${d.http || ''} — check devtools → network for ${d.url || ''}`;
        console.warn(`[node ${id} health]`, d);
        setHealth((h) => ({ ...h, [id]: { status: 'error', detail: msg } }));
      }
    } catch (e) {
      const msg = String((e as Error).message || e);
      console.warn(`[node ${id} health]`, msg);
      setHealth((h) => ({ ...h, [id]: { status: 'error', detail: msg } }));
    }
  }, []);
  React.useEffect(() => { rows.forEach((n) => { if (!health[n.id]) checkHealth(n.id); }); }, [rows, health, checkHealth]);
  async function delNode(id: number) {
    if (!confirm('Delete this node? This cannot be undone. Remove servers first.')) return;
    const r = await fetch(`/api/nodes/${id}`, { method: 'DELETE', credentials: 'include' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { alert(j.errors?.[0]?.detail || 'Failed'); return; }
    load();
  }
  return (
    <div className="page">
      <div className="page-head"><div><h1 className="h1">Nodes</h1></div><NavLink to="/admin/nodes/new" className="btn btn-primary btn-sm"><FiPlus size={13} /> New node</NavLink></div>
      <div className="table-wrap"><table className="table"><thead><tr><th>Node</th><th>Address</th><th>Daemon</th><th></th></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={4} className="muted">No nodes yet.</td></tr> : rows.map((n) => {
        const h = health[n.id];
        const dot = h?.status === 'online' ? '#22c55e' : h?.status === 'error' ? '#ef4444' : '#3a3a3e';
        const title = h?.status === 'error' ? h.detail || 'Error connecting — check console' : h?.status === 'online' ? 'Online' : 'Checking…';
        return (
          <tr key={n.id}>
            <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><span title={title} style={{ width: 8, height: 8, borderRadius: 999, background: dot, boxShadow: h?.status === 'online' ? '0 0 0 3px rgba(34,197,94,0.18)' : h?.status === 'error' ? '0 0 0 3px rgba(239,68,68,0.18)' : 'none', flexShrink: 0 }} />{n.name}</span></td>
            <td className="mono" style={{ fontSize: 12 }}>{n.scheme}://{n.fqdn}</td>
            <td className="mono">{n.daemonListen}{h?.status === 'error' && <span className="mono muted" style={{ fontSize: 11, marginLeft: 6 }} title={h.detail}>· check console</span>}</td>
            <td><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}><NavLink to={`/admin/nodes/${n.id}`} className="btn btn-ghost btn-sm">Edit</NavLink><button className="btn btn-ghost btn-sm" onClick={() => checkHealth(n.id)}>Check</button><NavLink to={`/admin/nodes/${n.id}/configuration`} className="btn btn-ghost btn-sm">Wings config</NavLink><NavLink to={`/admin/nodes/${n.id}/allocations`} className="btn btn-ghost btn-sm">Allocations</NavLink><button className="btn btn-ghost btn-sm" onClick={() => delNode(n.id)} title="Delete node"><FiTrash2 size={13} /></button></div></td>
          </tr>
        );
      })}</tbody></table></div>
    </div>
  );
}

function EggsPage() {
  const nav = useNavigate();
  const [rows, setRows] = React.useState<{ id: number; name: string; author: string; dockerImage: string; description: string | null }[]>([]);
  const [mode, setMode] = React.useState<'import' | null>(null);
  const [json, setJson] = React.useState('');
  const [file, setFile] = React.useState<File | null>(null);
  const [err, setErr] = React.useState(''); const [msg, setMsg] = React.useState('');
  const load = React.useCallback(() => fetch('/api/eggs', { credentials: 'include' }).then((r) => r.json()).then((j) => setRows(j.data || [])), []);
  React.useEffect(() => { load(); }, [load]);
  async function importEgg(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setMsg('');
    let body: unknown;
    if (file) {
      try { body = JSON.parse(await file.text()); } catch { setErr('Invalid JSON — not a valid egg file.'); return; }
    } else {
      try { body = JSON.parse(json); } catch { setErr('Invalid JSON — paste the raw egg JSON or upload a .egg file.'); return; }
    }
    const res = await fetch('/api/eggs/import', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json();
    if (!res.ok) { setErr(j.errors?.[0]?.detail || 'Import failed'); return; }
    setMsg(`Imported “${j.data.name}”.`); setJson(''); setFile(null); setMode(null); load();
  }
  async function del(e: { id: number; name: string }) {
    if (!confirm(`Delete egg “${e.name}”? This cannot be undone.`)) return;
    const res = await fetch(`/api/eggs/${e.id}`, { method: 'DELETE', credentials: 'include' });
    const j = await res.json();
    if (!res.ok) { setErr(j.errors?.[0]?.detail || 'Failed'); return; }
    setMsg(`Deleted “${e.name}”.`); load();
  }
  return (
    <div className="page">
      <div className="page-head"><div><h1 className="h1">Eggs</h1></div><div style={{ display: 'flex', gap: 8 }}><button className="btn btn-ghost btn-sm" onClick={() => { setErr(''); setMode('import'); }}>Import</button><NavLink to="/admin/eggs/new" className="btn btn-primary btn-sm">New egg</NavLink></div></div>
      {msg && <div className="alert" style={{ borderColor: '#1a2e1a', background: '#0f1a12', color: '#bbf7d0' }}>{msg}</div>}
      {err && <div className="alert alert-error" role="alert">{err}</div>}
      <div className="table-wrap"><table className="table"><thead><tr><th>Egg</th><th>Author</th><th>Image</th><th></th></tr></thead><tbody>{rows.length === 0 ? <tr><td colSpan={4} className="muted">No eggs yet — import or create one.</td></tr> : rows.map((e) => <tr key={e.id}><td>{e.name}{e.description ? <div className="muted" style={{ fontSize: 12 }}>{e.description}</div> : null}</td><td>{e.author}</td><td className="mono muted" style={{ fontSize: 12 }}>{e.dockerImage}</td><td style={{ whiteSpace: 'nowrap' }}><NavLink to={`/admin/eggs/${e.id}`} className="btn btn-ghost btn-sm">Edit</NavLink><button className="btn btn-ghost btn-sm" onClick={() => del(e)}><FiTrash2 /></button></td></tr>)}</tbody></table></div>
      <Modal open={mode === 'import'} onClose={() => setMode(null)} title="Import egg" footer={<><button className="btn btn-ghost" onClick={() => setMode(null)}>Cancel</button><button className="btn btn-primary" form="egg-import">Import</button></>}>
        <form id="egg-import" onSubmit={importEgg} className="form">
          <label className="field"><span className="label">Upload Pterodactyl egg file (.egg / .json)</span><input type="file" accept=".egg,.json,application/json" onChange={(e) => { setFile(e.target.files?.[0] || null); if (e.target.files?.[0]) { e.target.files[0].text().then((t) => setJson(t)).catch(() => {}); } }} /></label>
          <label className="field"><span className="label">Or paste egg JSON</span><textarea id="egg-json" className="input textarea" value={json} onChange={(e) => { setJson(e.target.value); setFile(null); }} placeholder='{"name":"Paper","docker_images":{...}}' rows={8} /></label>
          {err && <div className="alert alert-error" role="alert">{err}</div>}
        </form>
      </Modal>
    </div>
  );
}

function EggEditor() {
  const { id } = useParams();
  const editing = id !== undefined && id !== 'new';
  const eggId = Number(id);
  const nav = useNavigate();
  const [f, setF] = React.useState({
    name: '', author: 'Clover Studios', description: '', banner: '',
    dockerImages: [] as { key: string; image: string }[],
    startup: '',
    configText: '', scriptText: '',
    scriptEntry: 'ash', scriptContainer: 'ghcr.io/pterodactyl/installers:alpine', scriptPrivileged: false,
  });
  const [vars, setVars] = React.useState<{ id?: number; name: string; description: string; env_variable: string; default_value: string; user_viewable: boolean; user_editable: boolean; rules: string; sort: number }[]>([]);
  const [err, setErr] = React.useState(''); const [msg, setMsg] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [varEdit, setVarEdit] = React.useState<number | 'new' | null>(null);
  const [loading, setLoading] = React.useState(editing);

  React.useEffect(() => {
    if (!editing) return;
    fetch(`/api/eggs/${eggId}`, { credentials: 'include' }).then((r) => r.json()).then((j) => {
      const e = j.data;
      if (!e) return;
      setF({
        name: e.name || '', author: e.author || '', description: e.description || '', banner: e.banner || '',
        dockerImages: Object.entries(e.dockerImages || {}).map(([k, v]) => ({ key: k, image: v as string })),
        startup: e.startup || '',
        configText: JSON.stringify(e.config || {}, null, 2),
        scriptText: String((e.script && (e.script.script || e.script.install)) || ''),
        scriptEntry: String((e.script && (e.script.entry || e.script.entrypoint)) || 'ash'),
        scriptContainer: String((e.script && (e.script.container || e.script.image)) || 'ghcr.io/pterodactyl/installers:alpine'),
        scriptPrivileged: Boolean(e.script && e.script.privileged),
      });
      setVars((e.variables || []).map((v: { id: number; name: string; description: string | null; envVariable: string; defaultValue: string; userViewable: boolean; userEditable: boolean; rules: string; sort: number }) => ({ id: v.id, name: v.name, description: v.description || '', env_variable: v.envVariable, default_value: v.defaultValue, user_viewable: v.userViewable, user_editable: v.userEditable, rules: v.rules, sort: v.sort })));
      setLoading(false);
    }).catch(() => { setErr('Failed to load egg'); setLoading(false); });
  }, [editing, eggId]);

  function updateDocker(i: number, field: 'key' | 'image', value: string) {
    setF((p) => { const d = [...p.dockerImages]; d[i] = { ...d[i], [field]: value }; return { ...p, dockerImages: d }; });
  }
  function dockerObj(): Record<string, string> {
    const o: Record<string, string> = {};
    for (const d of f.dockerImages) if (d.key.trim()) o[d.key.trim()] = d.image.trim();
    if (Object.keys(o).length === 0 && f.dockerImages.length === 0) o['default'] = 'ghcr.io/pterodactyl/yolks:alpine';
    return o;
  }
  function parseConfig(): Record<string, unknown> {
    try { return JSON.parse(f.configText || '{}'); } catch { throw new Error('Config must be valid JSON.'); }
  }
  function emptyVar() { return { name: '', description: '', env_variable: '', default_value: '', user_viewable: true, user_editable: true, rules: 'required|string|max:191', sort: 0 }; }

  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setMsg(''); setSaving(true);
    try {
      const images = dockerObj();
      const config = parseConfig();
      const body = {
        name: f.name.trim(), author: f.author.trim(), description: f.description.trim() || null,
        banner: f.banner.trim() || null,
        docker_image: Object.values(images)[0], docker_images: images,
        startup: f.startup.trim(), config,
        script: { entrypoint: f.scriptEntry || 'ash', container: f.scriptContainer || 'ghcr.io/pterodactyl/installers:alpine', image: f.scriptContainer || 'ghcr.io/pterodactyl/installers:alpine', script: f.scriptText, privileged: f.scriptPrivileged },
      };
      let res = editing
        ? await fetch(`/api/eggs/${eggId}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        : await fetch('/api/eggs', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      let j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.errors?.[0]?.detail || 'Save failed');
      const savedId = editing ? eggId : j.data?.id;
      if (!savedId) throw new Error('No egg id returned');

      const existingIds = vars.map((v) => v.id).filter((x): x is number => x !== undefined);
      for (const v of vars) {
        const payload = { name: v.name, description: v.description, env_variable: v.env_variable, default_value: v.default_value, user_viewable: v.user_viewable, user_editable: v.user_editable, rules: v.rules, sort: v.sort };
        if (v.id !== undefined) {
          res = await fetch(`/api/eggs/${savedId}/variables/${v.id}`, { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        } else {
          res = await fetch(`/api/eggs/${savedId}/variables`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        }
        j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.errors?.[0]?.detail || 'Failed to save a variable');
      }
      if (editing) {
        const idsOnServer = (await fetch(`/api/eggs/${savedId}`, { credentials: 'include' }).then((r) => r.json()).then((x) => (x.data?.variables || []).map((v: { id: number }) => v.id)) as number[]);
        for (const vid of idsOnServer) if (!existingIds.includes(vid)) await fetch(`/api/eggs/${savedId}/variables/${vid}`, { method: 'DELETE', credentials: 'include' });
      }
      setMsg(`Saved “${f.name.trim()}”.`); setSaving(false);
      if (!editing) nav(`/admin/eggs/${savedId}`, { replace: true });
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : 'Save failed'); setSaving(false); }
  }

  if (loading) return <div className="page"><div className="lede">Loading egg…</div></div>;

  const varDraft = varEdit === null ? null : varEdit === 'new' ? emptyVar() : vars[varEdit];

  return (
    <div className="page">
      <div className="page-head">
        <div><button className="btn btn-ghost btn-sm" onClick={() => nav('/admin/eggs')}><FiChevronLeft /> Back</button></div>
        <div><h1 className="h1">{editing ? 'Edit egg' : 'New egg'}</h1></div>
        <div><button className="btn btn-primary btn-sm" form="egg-editor-form" disabled={saving}>{saving ? 'Saving…' : 'Save egg'}</button></div>
      </div>
      {msg && <div className="alert" style={{ borderColor: '#1a2e1a', background: '#0f1a12', color: '#bbf7d0' }}>{msg}</div>}
      {err && <div className="alert alert-error" role="alert">{err}</div>}
      <form id="egg-editor-form" onSubmit={save} className="form">
        <div className="card" style={{ padding: 16 }}>
          <h3 className="h3">Basics</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label className="field"><span className="label">Name</span><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Paper" required /></label>
            <label className="field"><span className="label">Author</span><input className="input" value={f.author} onChange={(e) => setF({ ...f, author: e.target.value })} /></label>
          </div>
          <label className="field"><span className="label">Description</span><input className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
          <label className="field"><span className="label">Banner image URL</span><input className="input mono" value={f.banner} onChange={(e) => setF({ ...f, banner: e.target.value })} placeholder="https://…/banner.png" /></label>
          {f.banner && <div style={{ borderRadius: 10, overflow: 'hidden', border: '1px solid var(--line)', maxWidth: 420 }}><img src={f.banner} alt="Banner preview" style={{ width: '100%', display: 'block' }} /></div>}
        </div>

        <div className="card" style={{ padding: 16 }}>
          <h3 className="h3">Docker images</h3>
          {f.dockerImages.map((d, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <input className="input" style={{ width: 200 }} value={d.key} placeholder="Java 21" onChange={(e) => updateDocker(i, 'key', e.target.value)} />
              <input className="input mono" value={d.image} placeholder="ghcr.io/pterodactyl/yolks:java_21" onChange={(e) => updateDocker(i, 'image', e.target.value)} />
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setF((p) => ({ ...p, dockerImages: p.dockerImages.filter((_, j) => j !== i) }))}><FiX /></button>
            </div>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setF((p) => ({ ...p, dockerImages: [...p.dockerImages, { key: '', image: '' }] }))}><FiPlus /> Add image</button>
        </div>

        <div className="card" style={{ padding: 16 }}>
          <h3 className="h3">Startup</h3>
          <label className="field"><span className="label">Startup command</span><input className="input mono" value={f.startup} onChange={(e) => setF({ ...f, startup: e.target.value })} placeholder="java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar {{SERVER_JARFILE}}" /></label>
        </div>

        <div className="card" style={{ padding: 16 }}>
          <h3 className="h3">Process config</h3>
          <label className="field"><span className="label">Config JSON <span className="muted">(files, startup, stop, logs)</span></span>
            <textarea className="input textarea mono" style={{ minHeight: 160 }} value={f.configText} onChange={(e) => setF({ ...f, configText: e.target.value })} placeholder='{"files":{},"startup":{},"stop":"stop"}' /></label>
        </div>

        <div className="card" style={{ padding: 16 }}>
          <h3 className="h3">Install script</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 10, marginBottom: 10 }}>
            <label className="field"><span className="label">Entry</span><input className="input mono" value={f.scriptEntry} onChange={(e) => setF({ ...f, scriptEntry: e.target.value })} /></label>
            <label className="field"><span className="label">Installer image</span><input className="input mono" value={f.scriptContainer} onChange={(e) => setF({ ...f, scriptContainer: e.target.value })} /></label>
            <label className="field" style={{ display: 'flex', alignItems: 'flex-end' }}><span className="label"><label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={f.scriptPrivileged} onChange={(e) => setF({ ...f, scriptPrivileged: e.target.checked })} /> Privileged</label></span></label>
          </div>
          <label className="field"><span className="label">Install script (shell)</span><textarea className="input textarea mono" style={{ minHeight: 200 }} value={f.scriptText} onChange={(e) => setF({ ...f, scriptText: e.target.value })} placeholder={'#!/bin/ash\n\napk add --no-cache curl\ncurl -o server.jar $DOWNLOAD_URL'} /></label>
        </div>

        <div className="card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h3 className="h3">Variables</h3>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setVarEdit('new')}><FiPlus /> Add variable</button>
          </div>
          <div className="table-wrap"><table className="table"><thead><tr><th>Name</th><th>Env var</th><th>Default</th><th>User editable</th><th></th></tr></thead>
            <tbody>{vars.length === 0 ? <tr><td colSpan={5} className="muted">No variables.</td></tr> : vars.map((v, i) => (
              <tr key={v.id ?? `new-${i}`}>
                <td>{v.name || <span className="muted">—</span>}</td>
                <td className="mono" style={{ fontSize: 12 }}>{v.env_variable}</td>
                <td className="mono" style={{ fontSize: 12 }}>{v.default_value || '—'}</td>
                <td>{v.user_editable ? 'Yes' : 'No'}</td>
                <td style={{ whiteSpace: 'nowrap' }}><button type="button" className="btn btn-ghost btn-sm" onClick={() => setVarEdit(i)}>Edit</button><button type="button" className="btn btn-ghost btn-sm" onClick={() => { if (confirm('Delete variable?')) setVars((p) => p.filter((_, j) => j !== i)); }}><FiTrash2 /></button></td>
              </tr>
            ))}</tbody></table></div>
        </div>
      </form>

      {varDraft && (() => {
        const isNewVar = varEdit === 'new';
        const saveVar = () => {
          const payload = { ...varDraft, env_variable: varDraft.env_variable.toUpperCase().trim() };
          if (!payload.name.trim()) { setErr('Variable needs a name.'); return; }
          if (!payload.env_variable) { setErr('Variable needs an env variable name.'); return; }
          setErr('');
          if (isNewVar) setVars((p) => [...p, payload]);
          else setVars((p) => p.map((v, j) => (j === varEdit ? payload : v)));
          setVarEdit(null);
        };
        return (
          <Modal open onClose={() => setVarEdit(null)} title={isNewVar ? 'New variable' : 'Edit variable'} footer={<><button className="btn btn-ghost" onClick={() => setVarEdit(null)}>Cancel</button><button className="btn btn-primary" onClick={saveVar}>Save variable</button></>}>
            <div className="form">
              <label className="field"><span className="label">Name</span><input className="input" value={varDraft.name} onChange={(e) => setVars((p) => p.map((v, j) => (j === varEdit ? { ...v, name: e.target.value } : v)))} placeholder="Server jar file" /></label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label className="field"><span className="label">Environment variable</span><input className="input mono" value={varDraft.env_variable} onChange={(e) => setVars((p) => p.map((v, j) => (j === varEdit ? { ...v, env_variable: e.target.value } : v)))} placeholder="SERVER_JARFILE" /></label>
                <label className="field"><span className="label">Default value</span><input className="input mono" value={varDraft.default_value} onChange={(e) => setVars((p) => p.map((v, j) => (j === varEdit ? { ...v, default_value: e.target.value } : v)))} placeholder="server.jar" /></label>
              </div>
              <label className="field"><span className="label">Description</span><textarea className="input textarea" rows={2} value={varDraft.description} onChange={(e) => setVars((p) => p.map((v, j) => (j === varEdit ? { ...v, description: e.target.value } : v)))} /></label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label className="field"><span className="label">Rules</span><input className="input mono" value={varDraft.rules} onChange={(e) => setVars((p) => p.map((v, j) => (j === varEdit ? { ...v, rules: e.target.value } : v)))} placeholder="required|string|max:191" /></label>
                <label className="field"><span className="label">Sort</span><input className="input mono" type="number" value={varDraft.sort} onChange={(e) => setVars((p) => p.map((v, j) => (j === varEdit ? { ...v, sort: Number(e.target.value) } : v)))} /></label>
              </div>
              <div style={{ display: 'flex', gap: 16 }}>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={varDraft.user_viewable} onChange={(e) => setVars((p) => p.map((v, j) => (j === varEdit ? { ...v, user_viewable: e.target.checked } : v)))} /> User viewable</label>
                <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={varDraft.user_editable} onChange={(e) => setVars((p) => p.map((v, j) => (j === varEdit ? { ...v, user_editable: e.target.checked } : v)))} /> User editable</label>
              </div>
              {err && <div className="alert alert-error" role="alert">{err}</div>}
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}

function AuditPage() {
  const [rows, setRows] = React.useState<{ id: number; action: string; targetType: string | null; targetId: string | null; ip: string | null; createdAt: string; user: { username: string | null; email: string | null } | null; meta: Record<string, unknown> | null }[]>([]);
  const [filter, setFilter] = React.useState('');
  React.useEffect(() => {
    const q = filter ? `?action=${encodeURIComponent(filter)}` : '';
    fetch(`/api/audit${q}`, { credentials: 'include' }).then((r) => r.json()).then((j) => setRows(j.data || [])).catch(() => {});
  }, [filter]);
  return (
    <div className="page">
      <div className="page-head"><div><h1 className="h1">Audit logs</h1><p className="lede">Every admin and user action — login, requests, users, servers, nodes and settings.</p></div>
        <select className="input" style={{ width: 180 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All actions</option>
          <option value="auth.login">auth.login</option>
          <option value="auth.logout">auth.logout</option>
          <option value="request.approved">request.approved</option>
          <option value="request.rejected">request.rejected</option>
          <option value="user.created">user.created</option>
          <option value="user.suspended">user.suspended</option>
          <option value="server.created">server.created</option>
          <option value="node.created">node.created</option>
        </select>
      </div>
      <div className="table-wrap"><table className="table"><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Target</th><th>IP</th></tr></thead>
        <tbody>{rows.length === 0 ? <tr><td colSpan={5} className="muted">No events yet.</td></tr> : rows.map((r) => (
          <tr key={r.id}><td className="mono" style={{ fontSize: 11, whiteSpace: 'nowrap' }}>{new Date(r.createdAt).toLocaleString()}</td><td className="mono" style={{ fontSize: 12 }}>{r.user?.email || r.user?.username || (r.user ? `#${r.user}` : '—')}</td><td><span className="badge">{r.action}</span></td><td className="mono muted" style={{ fontSize: 11 }}>{r.targetType ? `${r.targetType} #${r.targetId || ''}` : '—'}</td><td className="mono muted" style={{ fontSize: 11 }}>{r.ip || '—'}</td></tr>
        ))}</tbody></table></div>
    </div>
  );
}

function ProxmoxPage() {
  const [clusters, setClusters] = React.useState<{ id: number; name: string; host: string }[]>([]);
  const [open, setOpen] = React.useState(false);
  const [f, setF] = React.useState({ name: '', host: '', api_token_id: '', api_token_secret: '' });
  const [err, setErr] = React.useState('');
  const load = React.useCallback(() => fetch('/api/proxmox/clusters', { credentials: 'include' }).then((r) => r.json()).then((j) => setClusters(j.data || [])), []);
  React.useEffect(() => { load(); }, [load]);
  async function create(e: React.FormEvent) {
    e.preventDefault(); setErr('');
    const res = await fetch('/api/proxmox/clusters', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
    const j = await res.json();
    if (!res.ok) { setErr(j.errors?.[0]?.detail || 'Failed'); return; }
    setF({ name: '', host: '', api_token_id: '', api_token_secret: '' }); setOpen(false); load();
  }
  return (
    <div className="page">
      <div className="page-head"><div><h1 className="h1">Proxmox</h1></div><button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>New cluster</button></div>
      <div className="table-wrap"><table className="table"><thead><tr><th>Cluster</th><th>Host</th></tr></thead><tbody>{clusters.length === 0 ? <tr><td colSpan={2} className="muted">No clusters.</td></tr> : clusters.map((c) => <tr key={c.id}><td>{c.name}</td><td className="mono muted" style={{ fontSize: 12 }}>{c.host}</td></tr>)}</tbody></table></div>
      <Modal open={open} onClose={() => setOpen(false)} title="New Proxmox cluster" footer={<><button className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary" form="pve-form">Add cluster</button></>}>
        <form id="pve-form" onSubmit={create} className="form">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label className="field"><span className="label">Name</span><input id="pve-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="qyro-prod" /></label>
            <label className="field"><span className="label">Host</span><input id="pve-host" className="input" value={f.host} onChange={(e) => setF({ ...f, host: e.target.value })} placeholder="https://pve.example" /></label>
          </div>
          <label className="field"><span className="label">API token ID</span><input id="pve-tid" className="input mono" value={f.api_token_id} onChange={(e) => setF({ ...f, api_token_id: e.target.value })} placeholder="lunixpanel@pve!panel" /></label>
          <label className="field"><span className="label">API token secret</span><input id="pve-sec" className="input mono" type="password" value={f.api_token_secret} onChange={(e) => setF({ ...f, api_token_secret: e.target.value })} /></label>
          {err && <div className="alert alert-error" role="alert">{err}</div>}
        </form>
      </Modal>
    </div>
  );
}

function AppInner() {
  const nav = useNavigate();
  const { me, refresh } = useMe();
  const logout = async () => { await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }); await refresh(); nav('/login'); };
  return (
    <Shell me={me} onLogout={logout}>
      <Routes>
        <Route path="/" element={<RequireAuth><UserOverview /></RequireAuth>} />
        <Route path="/settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />
        <Route path="/server/:id" element={<RequireAuth><ServerManage /></RequireAuth>} />
        <Route path="/account" element={<Navigate to="/settings" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/admin" element={<RequireAuth adminOnly><AdminOverview /></RequireAuth>} />
        <Route path="/admin/users" element={<RequireAuth adminOnly><UsersAdmin /></RequireAuth>} />
        <Route path="/admin/servers" element={<RequireAuth adminOnly><AdminServers /></RequireAuth>} />
        <Route path="/admin/servers/new" element={<RequireAuth adminOnly><NewServerPage /></RequireAuth>} />
        <Route path="/admin/servers/:id" element={<RequireAuth adminOnly><ServerEditorPage /></RequireAuth>} />
        <Route path="/admin/nodes" element={<RequireAuth adminOnly><NodesPage /></RequireAuth>} />
        <Route path="/admin/nodes/new" element={<RequireAuth adminOnly><NewNodePage /></RequireAuth>} />
        <Route path="/admin/nodes/:id" element={<RequireAuth adminOnly><NodeEditorPage /></RequireAuth>} />
        <Route path="/admin/nodes/:id/configuration" element={<RequireAuth adminOnly><NodeConfigurationPage /></RequireAuth>} />
        <Route path="/admin/nodes/:id/allocations" element={<RequireAuth adminOnly><NodeAllocationsPage /></RequireAuth>} />
        <Route path="/admin/eggs" element={<RequireAuth adminOnly><EggsPage /></RequireAuth>} />
        <Route path="/admin/eggs/new" element={<RequireAuth adminOnly><EggEditor /></RequireAuth>} />
        <Route path="/admin/eggs/:id" element={<RequireAuth adminOnly><EggEditor /></RequireAuth>} />
        <Route path="/admin/proxmox" element={<RequireAuth adminOnly><ProxmoxPage /></RequireAuth>} />
        <Route path="/admin/audit" element={<RequireAuth adminOnly><AuditPage /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={qc}>
    <BrowserRouter>
      <AuthProvider>
        <AppInner />
      </AuthProvider>
    </BrowserRouter>
  </QueryClientProvider>,
);
