import React from 'react';
import { vpsApiBase } from './shared';
import { FiTerminal, FiX } from 'react-icons/fi';

type ConsoleProps = {
  vps: { assignmentId?: number | null; clusterId?: number; node?: string; type?: string; vmid?: number };
  vmType: 'qemu' | 'lxc';
};

// Embedded console: noVNC canvas for QEMU VMs, raw 5150-stream terminal for LXC.
// Both tunnel through the panel API websocket proxy (/api/proxmox/.../console/ws).
export default function ConsoleTab({ vps, vmType }: ConsoleProps) {
  const [status, setStatus] = React.useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [errMsg, setErrMsg] = React.useState('');
  const wsRef = React.useRef<WebSocket | null>(null);
  const mountRef = React.useRef<HTMLDivElement>(null);
  const rfbRef = React.useRef<{ disconnect: () => void } | null>(null);
  const termRef = React.useRef<{ dispose: () => void; writeln: (s: string) => void; onData: (cb: (d: string) => void) => void } | null>(null);
  const base = vpsApiBase(vps);

  const disconnect = React.useCallback(() => {
    try { rfbRef.current?.disconnect(); } catch { /* ignore */ }
    rfbRef.current = null;
    try { termRef.current?.dispose(); } catch { /* ignore */ }
    termRef.current = null;
    try { wsRef.current?.close(); } catch { /* ignore */ }
    wsRef.current = null;
    setStatus('idle');
  }, []);

  React.useEffect(() => () => disconnect(), [disconnect]);

  async function connect() {
    disconnect();
    setStatus('connecting');
    setErrMsg('');
    // Build the WS URL against the panel origin (vite dev proxy forwards /api).
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsPath = vps.assignmentId
      ? `/api/proxmox/vms/${vps.assignmentId}/console/ws`
      : `/api/proxmox/vms/raw/${vps.clusterId}/${encodeURIComponent(vps.node || '')}/${vps.type}/${vps.vmid}/console/ws`;
    const url = `${proto}//${window.location.host}${wsPath}`;

    if (vmType === 'qemu') {
      try {
        // @ts-expect-error — noVNC ships no type declarations; its exports map only exposes core/rfb.js
        const { default: RFB } = await import('@novnc/novnc');
        const ws = new WebSocket(url, ['binary']);
        ws.binaryType = 'arraybuffer';
        wsRef.current = ws;
        ws.onopen = () => setStatus('connected');
        ws.onerror = () => { setStatus('error'); setErrMsg('Console connection failed — check that the VM is running.'); };
        ws.onclose = (e) => { if (status !== 'error') { setStatus('error'); setErrMsg(`Console closed (${e.code || ''})`); } };
        const rfb = new RFB(mountRef.current!, ws as unknown as WebSocket, { shared: false });
        rfb.scaleViewport = true;
        rfb.resizeSession = false;
        rfb.addEventListener('disconnect', () => setStatus('idle'));
        rfb.addEventListener('connect', () => setStatus('connected'));
        rfbRef.current = rfb;
      } catch (e) {
        setStatus('error');
        setErrMsg(`Failed to load noVNC: ${String((e as Error).message)}`);
      }
    } else {
      // LXC: PVE's lxcwebsocket speaks a simple newline-framed stream over the same vncwebsocket channel.
      try {
        // xterm v6 exports Terminal as a named export.
        const { Terminal } = await import('@xterm/xterm');
        // @ts-expect-error — CSS side-effect import
        await import('@xterm/xterm/css/xterm.css');
        const term = new Terminal({ cursorBlink: true, fontSize: 13, fontFamily: '"Geist Mono",ui-monospace,Menlo,monospace', theme: { background: '#0b0b0d' } });
        term.open(mountRef.current!);
        termRef.current = term as unknown as typeof termRef.current;
        term.onData((data: string) => {
          const enc = new TextEncoder().encode(data);
          wsRef.current?.send(enc.buffer as ArrayBuffer);
        });
        const ws = new WebSocket(url, ['binary']);
        ws.binaryType = 'arraybuffer';
        wsRef.current = ws;
        const dec = new TextDecoder();
        ws.onmessage = (ev) => {
          const text = dec.decode(ev.data as ArrayBuffer);
          for (const line of text.split('\n')) {
            if (!line.trim()) continue;
            try {
              const msg = JSON.parse(line);
              if (typeof msg.data === 'string') term.write(msg.data);
              else if (msg.error) term.write(`\r\n! ${msg.error}\r\n`);
            } catch {
              term.write(text);
            }
          }
        };
        ws.onopen = () => { setStatus('connected'); term.writeln('Connected to container console.\r'); };
        ws.onerror = () => { setStatus('error'); setErrMsg('Console connection failed — check that the container is running.'); };
        ws.onclose = (e) => { term.write(`\r\n[disconnected ${e.code || ''}]\r\n`); setStatus('idle'); };
      } catch (e) {
        setStatus('error');
        setErrMsg(`Failed to load xterm: ${String((e as Error).message)}`);
      }
    }
  }

  return (
    <div className="stack">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn btn-primary btn-sm" onClick={connect} disabled={status === 'connecting' || status === 'connected'}>
          <FiTerminal size={13} /> {status === 'connected' ? 'Connected' : status === 'connecting' ? 'Connecting…' : 'Connect'}
        </button>
        {(status === 'connected' || status === 'connecting') && (
          <button className="btn btn-ghost btn-sm" onClick={disconnect}><FiX size={13} /> Disconnect</button>
        )}
        <span className={`badge badge-${status === 'connected' ? 'active' : status === 'error' ? 'suspended' : ''}`}>{status}</span>
        <span className="muted" style={{ fontSize: 11 }}>{vmType === 'qemu' ? 'noVNC (graphical)' : 'serial/terminal'} · proxied through panel</span>
      </div>
      {errMsg && <div className="alert alert-error">{errMsg}</div>}
      <div
        ref={mountRef}
        style={{
          height: 520, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--line)',
          background: '#0b0b0d', position: 'relative',
          display: status === 'connected' ? 'block' : 'grid', placeItems: 'center',
        }}
      >
        {status !== 'connected' && (
          <div className="muted" style={{ fontSize: 13 }}>
            {status === 'connecting' ? 'Opening console…' : 'Click Connect to open the embedded console.'}
          </div>
        )}
      </div>
    </div>
  );
}
