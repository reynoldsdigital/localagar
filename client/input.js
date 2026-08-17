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
    this._spaceHeld = false;
    this._spaceHoldStart = 0;
    this._lastSplitSent = 0;
  }
  start() {
    this._running = true;
    const c = this.canvas;
    const onMove = (e) => {
      const r = c.getBoundingClientRect();
      this.mouseX = e.clientX - r.left;
      this.mouseY = e.clientY - r.top;
      // Read camera state from the renderer so input follows the view.
      const cam = this.renderer?.camera;
      const camX = cam ? cam.x : 0;
      const camY = cam ? cam.y : 0;
      const zoom = cam ? cam.zoom : 1;
      // Mouse pixel -> world coordinates. The world is centered on the
      // viewport, so we subtract the viewport center, divide by zoom, and
      // add the camera position.
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
          // Send initial split
          this.net.split();
          this._lastSplitSent = Date.now();
        }
        e.preventDefault();
      } else if (e.repeat) {
        return;
      } else {
        switch (e.key.toLowerCase()) {
          case "w": this.net.eject("w"); break;
          case "e": this.net.eject("e"); break;
          case "a": this.net.gold("a"); break;
          case "s": this.net.gold("s"); break;
        }
      }
    };
    const onKeyUp = (e) => {
      if (e.key === ' ' || e.key === 'Spacebar') {
        this._spaceHeld = false;
      }
    };
    c.addEventListener("mousemove", onMove);
    c.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    this._handlers.push(["mousemove", c, onMove]);
    this._handlers.push(["mousedown", c, onDown]);
    this._handlers.push(["keydown", window, onKey]);
    this._handlers.push(["keyup", window, onKeyUp]);
    
    // Poll for held spacebar splits
    this._holdInterval = setInterval(() => {
      if (this._spaceHeld && this.net) {
        const holdDuration = Date.now() - this._spaceHoldStart;
        // Send additional splits while holding (every 150ms after initial)
        if (holdDuration > 150 && Date.now() - this._lastSplitSent > 150) {
          this.net.split();
          this._lastSplitSent = Date.now();
        }
      }
    }, 50);
  }
  stop() {
    for (const [type, target, fn] of this._handlers) target.removeEventListener(type, fn);
    if (this._holdInterval) clearInterval(this._holdInterval);
    this._handlers = [];
    this._running = false;
  }
  setRenderer(r) {
    this.renderer = r;
  }
}
