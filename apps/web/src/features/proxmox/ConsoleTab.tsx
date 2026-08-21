import React from 'react';
import { vpsApiBase } from './shared';
import { FiTerminal, FiX } from 'react-icons/fi';

type ConsoleProps = {
  vps: { assignmentId?: number | null; clusterId?: number; node?: string; type?: string; vmid?: number };
  vmType: 'qemu' | 'lxc';
};

// Embedded noVNC console for BOTH qemu and lxc — PVE's vncproxy speaks RFB for
// containers too. Everything tunnels through the panel API websocket proxy.
export default function ConsoleTab({ vps, vmType }: ConsoleProps) {
  void vmType;
  const [status, setStatus] = React.useState<'idle' | 'connecting' | 'connected' | 'error'>('idle');
  const [errMsg, setErrMsg] = React.useState('');
  const mountRef = React.useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rfbRef = useRefAny(null);

  function useRefAny(initial: null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return React.useRef<any>(initial);
  }

  const disconnect = React.useCallback(() => {
    try { rfbRef.current?.disconnect(); } catch { /* ignore */ }
    rfbRef.current = null;
    setStatus('idle');
  }, []);

  React.useEffect(() => () => disconnect(), [disconnect]);

  async function connect() {
    disconnect();
    setStatus('connecting');
    setErrMsg('');
    // Clear whatever a previous session rendered.
    if (mountRef.current) mountRef.current.innerHTML = '';
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsPath = vps.assignmentId
      ? `/api/proxmox/vms/${vps.assignmentId}/console/ws`
      : `/api/proxmox/vms/raw/${vps.clusterId}/${encodeURIComponent(vps.node || '')}/${vps.type}/${vps.vmid}/console/ws`;
    const url = `${proto}//${window.location.host}${wsPath}`;

    try {
      // @ts-expect-error — noVNC ships no type declarations
      const { default: RFB } = await import('@novnc/novnc');
      const ws = new WebSocket(url, ['binary']);
      ws.binaryType = 'arraybuffer';

      const rfb = new RFB(mountRef.current!, ws, { shared: false });
      // Hard-patch this instance's Cursor: over plain HTTP Firefox throws
      // SecurityError when noVNC assigns a canvas data: URL as style.cursor;
      // that exception escapes RFB's message loop and freezes the session.
      // Wrapping change/clear keeps the session alive (remote cursor visual is lost).
      const cursor = rfb._cursor as { change?: (...a: unknown[]) => unknown; clear?: (...a: unknown[]) => unknown } | undefined;
      if (cursor) {
        for (const fnName of ['change', 'clear'] as const) {
          const orig = cursor[fnName]?.bind(cursor);
          if (orig) cursor[fnName] = (...args: unknown[]) => { try { return orig(...args); } catch { /* ignore */ } };
        }
      }
      rfb.scaleViewport = true;
      rfb.resizeSession = false;
      rfb.background = '#0b0b0d';
      rfb.addEventListener('connect', () => {
        setStatus('connected');
        // Grab keyboard input so typing works immediately.
        try { rfb.focus(); } catch { /* ignore */ }
      });
      rfb.addEventListener('disconnect', (ev: Event) => {
        const clean = (ev as CustomEvent).detail?.clean ?? true;
        if (clean) setStatus('idle');
        else { setStatus('error'); setErrMsg('Console disconnected unexpectedly.'); }
      });
      rfb.addEventListener('securityfailure', (ev: Event) => {
        const reason = (ev as CustomEvent).detail?.reason || 'authentication failed';
        setStatus('error');
        setErrMsg(`Console rejected: ${reason}`);
      });
      rfbRef.current = rfb;
    } catch (e) {
      setStatus('error');
      setErrMsg(`Failed to load noVNC: ${String((e as Error).message)}`);
    }
  }

  return (
    <div className="stack">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="btn btn-primary btn-sm" onClick={connect} disabled={status === 'connecting'}>
          <FiTerminal size={13} /> {status === 'connected' ? 'Reconnect' : status === 'connecting' ? 'Connecting…' : 'Connect'}
        </button>
        {(status === 'connected' || status === 'connecting') && (
          <button className="btn btn-ghost btn-sm" onClick={disconnect}><FiX size={13} /> Disconnect</button>
        )}
        <span className={`badge badge-${status === 'connected' ? 'active' : status === 'error' ? 'suspended' : ''}`}>{status}</span>
        <span className="muted" style={{ fontSize: 11 }}>noVNC · proxied through panel</span>
      </div>
      {errMsg && <div className="alert alert-error">{errMsg}</div>}
      <div
        ref={mountRef}
        onClick={() => { try { rfbRef.current?.focus(); } catch { /* ignore */ } }}
        style={{
          height: 520, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--line)',
          background: '#0b0b0d',
        }}
      />
      {status === 'idle' && <div className="muted" style={{ fontSize: 12 }}>Click Connect, then click inside the screen to capture your keyboard.</div>}
    </div>
  );
}
