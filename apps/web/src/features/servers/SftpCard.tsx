import React from 'react';
import { FiTerminal, FiCopy } from 'react-icons/fi';

type SftpInfo = { address: string; port: number; user: string; connection: string };

export default function SftpCard({ serverId }: { serverId: number }) {
  const [info, setInfo] = React.useState<SftpInfo | null>(null);
  const [err, setErr] = React.useState('');
  React.useEffect(() => {
    fetch(`/api/servers/${serverId}/sftp`, { credentials: 'include' }).then((r) => r.json()).then((j) => {
      if (j.data) setInfo(j.data); else setErr(j.errors?.[0]?.detail || 'Failed to load SFTP info');
    }).catch(() => setErr('Failed to load SFTP info'));
  }, [serverId]);
  if (err) return <div className="alert alert-error">{err}</div>;
  if (!info) return null;
  return (
    <div className="card" style={{ padding: 14 }}>
      <h2 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><FiTerminal size={13} /> SFTP access</h2>
      <p className="muted" style={{ fontSize: 12, margin: '6px 0 10px' }}>Connect with your panel account password. Port {info.port}.</p>
      <div className="code-block">
        <div className="mono" style={{ fontSize: 13 }}>{info.user}@{info.address}:{info.port}</div>
      </div>
      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
        <button
          className="btn btn-ghost btn-sm"
          onClick={async () => {
            try { await navigator.clipboard.writeText(info.connection); } catch { /* ignore */ }
          }}
        ><FiCopy size={12} /> Copy sftp:// URL</button>
        <a className="btn btn-ghost btn-sm" href={info.connection} title="Open in your SFTP client">sftp://{info.user}@{info.address}:{info.port}</a>
      </div>
    </div>
  );
}
