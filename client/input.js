// Captures mouse + keyboard and sends them to the server via Net.
// The Input handler needs to know the current camera (cx, cy, zoom) so it
// can convert mouse-pixel coordinates to world coordinates. It pulls camera
// state from the Renderer on every mousemove so the two stay in sync.

export class Input {
  constructor(canvas, net, renderer) {
    this.canvas = canvas;
    this.net = net;
    this.renderer = renderer; // may be null until renderer is created
    this.mouseX = 0;
    this.mouseY = 0;
    this._running = false;
    this._handlers = [];
    // Space (split) hold state
    this._spaceHeld = false;
    this._spaceHoldStart = 0;
    this._lastSplitSent = 0;
    // Hold-to-repeat action keys (e, s, w, a). Each maps to a minimum
    // interval between repeats (ms). Holding the key keeps firing the action.
    this._held = new Map();          // key -> lastSent timestamp
    this._repeatMs = { e: 120, s: 150, w: 160, a: 160 };
  }

  // Fire the action bound to a key once.
  _doAction(k) {
    if (!this.net) return;
    if (k === "e") this.net.eject("e");
    else if (k === "s") this.net.gold("s");
    else if (k === "w") this.net.eject("w");
    else if (k === "a") this.net.gold("a");
  }

  start() {
    this._running = true;
    const c = this.canvas;
    const onMove = (e) => {
      const r = c.getBoundingClientRect();
      this.mouseX = e.clientX - r.left;
      this.mouseY = e.clientY - r.top;
      const cam = this.renderer?.camera;
      const camX = cam ? cam.x : 0;
      const camY = cam ? cam.y : 0;
      const zoom = cam ? cam.zoom : 1;
      const wx = (this.mouseX - r.width / 2) / zoom + camX;
      const wy = (this.mouseY - r.height / 2) / zoom + camY;
      this.net.sendInput(wx, wy);
    };
    const onDown = (e) => {
      if (e.button === 0) this.net.split();
    };
    const onKey = (e) => {
      if (e.key === ' ' || e.key === 'Spacebar') {
        if (!e.repeat && !this._spaceHeld) {
          this._spaceHeld = true;
          this._spaceHoldStart = Date.now();
          this.net.split();
          this._lastSplitSent = Date.now();
        }
        e.preventDefault();
        return;
      }
      const k = e.key.toLowerCase();
      if (k in this._repeatMs) {
        // Begin a hold: fire immediately, then the poll loop repeats it
        // while the key stays down. Ignore the browser's own key repeats.
        if (!e.repeat && !this._held.has(k)) {
          this._doAction(k);
          this._held.set(k, Date.now());
        }
        e.preventDefault();
      }
    };
    const onKeyUp = (e) => {
      if (e.key === ' ' || e.key === 'Spacebar') {
        this._spaceHeld = false;
        return;
      }
      const k = e.key.toLowerCase();
      if (this._held.has(k)) this._held.delete(k);
    };
    // Scroll-wheel zoom (in-game only — this listener only exists while
    // Input is running, i.e. not on the menu). Up = zoom in, down = zoom out.
    const onWheel = (e) => {
      const cam = this.renderer && this.renderer.camera;
      if (!cam) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      cam.adjustZoom(factor);
    };
    c.addEventListener("mousemove", onMove);
    c.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("wheel", onWheel, { passive: false });
    this._handlers.push(["mousemove", c, onMove]);
    this._handlers.push(["mousedown", c, onDown]);
    this._handlers.push(["keydown", window, onKey]);
    this._handlers.push(["keyup", window, onKeyUp]);
    this._handlers.push(["wheel", window, onWheel]);
    // Start each game at the default zoom.
    if (this.renderer && this.renderer.camera) this.renderer.camera.resetZoom();

    // Poll loop: repeats held keys (space split + e/s/w/a actions) at their
    // throttled intervals.
    this._holdInterval = setInterval(() => {
      const now = Date.now();
      // Space
      if (this._spaceHeld && this.net) {
        if (now - this._spaceHoldStart > 150 && now - this._lastSplitSent > 150) {
          this.net.split();
          this._lastSplitSent = now;
        }
      }
      // Held action keys
      for (const [k, last] of this._held) {
        if (now - last >= this._repeatMs[k]) {
          this._doAction(k);
          this._held.set(k, now);
        }
      }
    }, 50);
  }
  stop() {
    for (const [type, target, fn] of this._handlers) target.removeEventListener(type, fn);
    if (this._holdInterval) clearInterval(this._holdInterval);
    this._handlers = [];
    this._held.clear();
    this._running = false;
  }
  setRenderer(r) {
    this.renderer = r;
  }
}
