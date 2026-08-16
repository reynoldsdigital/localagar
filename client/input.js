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
      if (e.repeat) return;
      switch (e.key.toLowerCase()) {
        case " ":
        case "space":
          e.preventDefault();
          this.net.split();
          break;
        case "w": this.net.eject("w"); break;
        case "e": this.net.eject("e"); break;
        case "z": this.net.macro("z"); break;
        case "x": this.net.macro("x"); break;
        case "a": this.net.gold("a"); break;
        case "s": this.net.gold("s"); break;
      }
    };
    c.addEventListener("mousemove", onMove);
    c.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    this._handlers.push(["mousemove", c, onMove]);
    this._handlers.push(["mousedown", c, onDown]);
    this._handlers.push(["keydown", window, onKey]);
  }
  stop() {
    for (const [type, target, fn] of this._handlers) target.removeEventListener(type, fn);
    this._handlers = [];
    this._running = false;
  }
  setRenderer(r) {
    this.renderer = r;
  }
}
