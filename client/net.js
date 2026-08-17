// WebSocket client with:
//   - 6s open timeout so silent hangs surface as a clear diagnostic
//   - send queue: messages sent before the socket is fully open (or while
//     reconnecting) are queued and flushed on open, fixing a known
//     Safari/iOS quirk where onopen fires before readyState reaches OPEN.
//   - JSON-safe message dispatch via _emit(m.t, m).

export class Net {
  constructor() {
    this.ws = null;
    this._listeners = {};
    this._seq = 0;
    this._lastInputSent = 0;
    this._inputThrottleMs = 1000 / 30;
    this._timeoutMs = 6000;
    this._lastURL = null;
    this._sendQueue = [];
    this._opened = false;
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
    this._opened = false;

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
                   `This usually means a proxy / firewall / browser extension is silently dropping the WebSocket upgrade.\n\n` +
                   `Try these in order:\n` +
                   `  1. Hard reload: Ctrl+Shift+R\n` +
                   `  2. Try a different URL (Tailscale IP, LAN IP, or localhost)\n` +
                   `  3. Open DevTools (F12) -> Network -> WS and check the handshake`,
        });
      }
    }, this._timeoutMs);

    ws.onopen = () => {
      console.log("[net] open, readyState=", ws.readyState);
      this._opened = true;
      // Flush anything queued before open
      const q = this._sendQueue;
      this._sendQueue = [];
      for (const m of q) {
        try { ws.send(JSON.stringify(m)); } catch (e) { console.warn("[net] queue flush failed", e); }
      }
      settle("open");
    };
    ws.onclose = (e) => {
      console.log("[net] close", e?.code, e?.reason);
      this._opened = false;
      settle("close", e);
    };
    ws.onerror = (e) => {
      console.warn("[net] error", e);
      settle("error", {
        message: `WebSocket failed to connect to ${url}.\n` +
                 `Open DevTools -> Network -> WS to see the failed handshake.\n` +
                 `Common causes: proxy / firewall dropping Upgrade header, browser extension blocking WS, DNS misroute.`,
      });
    };
    ws.onmessage = (e) => {
      // Safari/iOS sometimes delivers Blob/ArrayBuffer — coerce to string
      let data = e.data;
      if (data && typeof data !== "string") {
        if (data instanceof Blob) {
          data.text().then(s => this._handleFrame(s)).catch(err => console.warn("[net] blob read", err));
          return;
        }
        if (data instanceof ArrayBuffer) {
          try { data = new TextDecoder().decode(new Uint8Array(data)); } catch { return; }
        }
      }
      this._handleFrame(data);
    };
  }
  _handleFrame(data) {
    if (typeof data !== "string") return;
    let m; try { m = JSON.parse(data); } catch (e) { console.warn("[net] bad json", data); return; }
    if (!m || typeof m.t !== "string") return;
    this._emit(m.t, m);
  }
  send(msg) {
    // If the socket isn't open yet, queue the message and flush on open.
    if (!this.ws || this.ws.readyState !== 1) {
      this._sendQueue.push(msg);
      return;
    }
    try { this.ws.send(JSON.stringify(msg)); }
    catch (e) { console.warn("[net] send failed", e); }
  }
  join({ name, mode, clan, skin, color }) {
    this.send({ t: "join", name, mode, clan, skin, color });
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
  respawn() { this.send({ t: "respawn" }); }
}
