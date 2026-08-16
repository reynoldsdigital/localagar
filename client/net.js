// WebSocket client. Connects to ws://<host>/ws with a simple event emitter.

export class Net {
  constructor() {
    this.ws = null;
    this._listeners = {};
    this._seq = 0;
    this._lastInputSent = 0;
    this._inputThrottleMs = 1000 / 30;
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
    const url = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws";
    this.ws = new WebSocket(url);
    this.ws.onopen = () => { this._emit("open"); };
    this.ws.onclose = () => { this._emit("close"); };
    this.ws.onerror = (e) => { this._emit("error", e); };
    this.ws.onmessage = (e) => {
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
