// WebSocket client with a 6s open timeout. The hang we saw in some browsers
// (Chrome + Tailscale, corporate proxies) was a silent WS that never fired
// open or close — the timeout surfaces that as a clear diagnostic.

export class Net {
  constructor() {
    this.ws = null;
    this._listeners = {};
    this._seq = 0;
    this._lastInputSent = 0;
    this._inputThrottleMs = 1000 / 30;
    this._timeoutMs = 6000;
    this._lastURL = null;
  }
  on(evt, fn) {
    (this._listeners[evt] = this._listeners[evt] || []).push(fn);
    return () => {
      const arr = this._listeners[evt];
      if (!arr) return;
      this._listeners[evt] = arr.filter(f => f !== fn);
    };
  }
  _emit(evt, payload) {
    const arr = this._listeners[evt];
    if (!arr) return;
    for (const fn of arr) { try { fn(payload); } catch (e) { console.error(e); } }
  }
  connect() {
    const scheme = location.protocol === "https:" ? "wss://" : "ws://";
    const url = scheme + location.host + "/ws";
    this._lastURL = url;
    console.log("[net] connecting to", url);
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      this._emit("error", { message: `WebSocket constructor threw: ${e?.message || e}` });
      return;
    }
    this.ws = ws;

    let settled = false;
    const settle = (kind, payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      this._emit(kind, payload);
    };
    const timer = setTimeout(() => {
      if (ws.readyState !== 1 /* OPEN */) {
        console.warn("[net] open timeout, readyState=", ws.readyState);
        try { ws.close(); } catch (_) {}
        settle("error", {
          message: `WebSocket open timed out after ${this._timeoutMs}ms (URL: ${url}).\n\n` +
                   `This usually means a proxy / firewall / Chrome extension is silently dropping the WebSocket upgrade.\n\n` +
                   `Try these in order:\n` +
                   `  1. Hard reload: Ctrl+Shift+R  (clear the cached version)\n` +
                   `  2. Try the LAN IP instead: http://<lan-ip>:3000\n` +
                   `  3. Open DevTools (F12) -> Network -> WS and check what happens to the ws:// request\n` +
                   `  4. Disable any VPN/proxy/extension that might block WS`,
        });
      }
    }, this._timeoutMs);

    ws.onopen = () => { console.log("[net] open"); settle("open"); };
    ws.onclose = (e) => { console.log("[net] close", e?.code, e?.reason); settle("close", e); };
    ws.onerror = (e) => {
      console.warn("[net] error", e);
      // Browsers give almost no detail on WS errors for security reasons.
      settle("error", {
        message: `WebSocket failed to connect to ${url}.\n` +
                 `Open DevTools -> Network -> WS to see the failed handshake.\n` +
                 `Common causes: proxy / firewall dropping Upgrade header, Chrome extension blocking WS, DNS routing the WS somewhere unexpected.`,
      });
    };
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      this._emit(m.t, m);
    };
  }
  send(msg) {
    if (!this.ws || this.ws.readyState !== 1) return;
    this.ws.send(JSON.stringify(msg));
  }
  join({ name, mode, clan }) {
    this.send({ t: "join", name, mode, clan });
  }
  sendInput(x, y) {
    const now = performance.now();
    if (now - this._lastInputSent < this._inputThrottleMs) return;
    this._lastInputSent = now;
    this.send({ t: "input", x, y });
  }
  split()   { this.send({ t: "split" }); }
  eject(key) { this.send({ t: "eject", key }); }
  macro(key) { this.send({ t: "macro", key }); }
  gold(key)  { this.send({ t: "gold", key }); }
}
