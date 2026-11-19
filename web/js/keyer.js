// Chroma key for the preview: draws a video or image into a WebGL canvas with
// the same math as the export (ffmpeg colorkey, then despill), so the green
// screen comes out the same in both.
import { spillType } from '/shared/model.js';

const VS = `
attribute vec2 p;
varying vec2 uv;
void main() { uv = vec2(p.x * .5 + .5, .5 - p.y * .5); gl_Position = vec4(p, 0., 1.); }`;

const FS = `
precision highp float;
varying vec2 uv;
uniform sampler2D tex;
uniform vec3 keyc;
uniform float sim, smoothv, spill;
uniform int stype;
void main() {
  vec4 c = texture2D(tex, uv);
  // colorkey: distance to the key color, scaled to 0..1 over the RGB cube diagonal
  vec3 d = (c.rgb - keyc) * 255.;
  float diff = sqrt(dot(d, d) / (255. * 255. * 3.));
  float a = smoothv > .0001 ? clamp((diff - sim) / smoothv, 0., 1.) : (diff > sim ? 1. : 0.);
  vec3 rgb = c.rgb;
  // despill (mix .5, expand 0): pull the key channel down to the other two
  if (stype == 0) { float s = max(rgb.g - (rgb.r * .5 + rgb.b * .5), 0.); rgb.g = max(rgb.g - spill * s, 0.); }
  else if (stype == 1) { float s = max(rgb.b - (rgb.r * .5 + rgb.g * .5), 0.); rgb.b = max(rgb.b - spill * s, 0.); }
  float al = a * c.a;
  gl_FragColor = vec4(rgb * al, al);
}`;

export class Keyer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ok = false;
    const gl = this.canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: false, preserveDrawingBuffer: true });
    if (!gl) return;
    const sh = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    try {
      const prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(prog);
      gl.useProgram(prog);
      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, 'p');
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      this.u = Object.fromEntries(['keyc', 'sim', 'smoothv', 'spill', 'stype'].map((n) => [n, gl.getUniformLocation(prog, n)]));
      this.gl = gl;
      this.ok = true;
    } catch (e) {
      console.warn('kadr: chroma key preview unavailable:', e.message);
    }
  }

  /** Draw `src` (video or image element) keyed with `key` ({ color, similarity, smooth, spill }). */
  draw(src, key) {
    if (!this.ok) return false;
    const w = src.videoWidth || src.naturalWidth || 0;
    const h = src.videoHeight || src.naturalHeight || 0;
    if (!w || !h || (src.tagName === 'VIDEO' && src.readyState < 2)) return false;
    // keep the canvas no larger than needed for the preview
    const f = Math.min(1, 1920 / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * f));
    const chh = Math.max(1, Math.round(h * f));
    const gl = this.gl;
    if (this.canvas.width !== cw || this.canvas.height !== chh) { this.canvas.width = cw; this.canvas.height = chh; }
    gl.viewport(0, 0, cw, chh);
    try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); } catch { return false; }
    const n = parseInt(key.color.slice(1), 16);
    gl.uniform3f(this.u.keyc, ((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
    gl.uniform1f(this.u.sim, Math.max(1e-5, key.similarity));
    gl.uniform1f(this.u.smoothv, key.smooth);
    gl.uniform1f(this.u.spill, key.spill);
    const st = spillType(key.color);
    gl.uniform1i(this.u.stype, st === 'green' ? 0 : st === 'blue' ? 1 : -1);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return true;
  }

  destroy() {
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext();
    this.canvas.remove();
  }
}
