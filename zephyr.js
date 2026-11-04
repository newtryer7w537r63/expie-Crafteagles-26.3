/*
 * Zephyr 1.0 - WebGL2 command-stream optimizer for Eaglercraft.
 *
 * Sits between the game (compiled wasm) and the browser's WebGL2 implementation and
 * removes work that cannot change the result:
 *   - redundant state changes (bindBuffer/useProgram/bindTexture/enable/blend/viewport...)
 *   - redundant vertex-attribute setup and uniform uploads
 *   - repeated lookups (getUniformLocation, getAttribLocation, getParameter caps, getExtension)
 * and asks for the high-performance GPU. Only WebGL2 is touched (WebGL1 has extensions
 * that change state behind our back, so it is left alone).
 *
 * Safety rule: a call is skipped only when it repeats the exact arguments of the last
 * successful call for the same piece of state. Unknown state is never assumed.
 * Everything is reset on context loss/restore.
 *
 * URL switches:  ?zephyr=0 (off)   ?zephyr=stats (log skipped calls every 5 s)
 *                ?dpr=1.5 (cap devicePixelRatio, default 2)   ?aa=0 (force antialias off)
 */
(function () {
  'use strict';
  if (window.__zephyr || typeof WebGL2RenderingContext === 'undefined') return;
  var qs = location.search;
  if (/[?&]zephyr=0(?:&|$)/.test(qs)) return;
  var STATS = /[?&]zephyr=stats(?:&|$)/.test(qs);
  var Z = window.__zephyr = { version: '1.0', total: 0, skipped: {} };
  var SYM = Symbol('zephyr');
  var P = WebGL2RenderingContext.prototype;

  function sk(name) { Z.total++; Z.skipped[name] = (Z.skipped[name] || 0) + 1; }

  function newState() {
    var v0 = { eab: null, ep: 0, p: [], en: [], dv: [] };
    return {
      epoch: 0, prog: null, vao: null, vs: v0, v0: v0,
      buf: {}, unit: 0, tex: {}, smp: [], fbD: null, fbR: null, rb: null,
      caps: {}, bf: undefined, be: undefined
    };
  }
  function init(gl) { return (gl[SYM] = newState()); }

  function wrap(name, mk) {
    var o = P[name];
    if (typeof o !== 'function') return;
    P[name] = mk(o, name);
  }

  // ---- buffers ------------------------------------------------------------------
  // Generic (non-VAO) buffer targets we track. ELEMENT_ARRAY_BUFFER is per-VAO state.
  var TRACK = {0x8892: 1, 0x8A11: 1, 0x8F36: 1, 0x8F37: 1, 0x88EB: 1, 0x88EC: 1};
  wrap('bindBuffer', function (o, n) {
    return function (t, b) {
      var s = this[SYM] || init(this);
      if (t === 0x8893) {
        var v = s.vs;
        if (v.eab === b && v.ep === s.epoch) { if (STATS) sk(n); return; }
        v.eab = b; v.ep = s.epoch;
      } else if (TRACK[t] === 1) {
        if (s.buf[t] === b) { if (STATS) sk(n); return; }
        s.buf[t] = b;
      }
      return o.call(this, t, b);
    };
  });
  wrap('bindBufferBase', function (o) {
    return function (t, i, b) {
      var s = this[SYM] || init(this);
      if (TRACK[t] === 1) s.buf[t] = b;
      return o.call(this, t, i, b);
    };
  });
  wrap('bindBufferRange', function (o) {
    return function (t, i, b, off, size) {
      var s = this[SYM] || init(this);
      if (TRACK[t] === 1) s.buf[t] = b;
      return o.call(this, t, i, b, off, size);
    };
  });
  wrap('deleteBuffer', function (o) {
    return function (b) {
      var s = this[SYM] || init(this);
      s.epoch++; // invalidates every per-VAO element/attribute cache entry at once
      for (var t in s.buf) if (s.buf[t] === b) s.buf[t] = undefined;
      return o.call(this, b);
    };
  });

  // ---- vertex arrays and attributes --------------------------------------------
  wrap('bindVertexArray', function (o, n) {
    return function (v) {
      var s = this[SYM] || init(this);
      if (s.vao === v) { if (STATS) sk(n); return; }
      s.vao = v;
      s.vs = v ? (v[SYM] || (v[SYM] = { eab: null, ep: s.epoch, p: [], en: [], dv: [] })) : s.v0;
      return o.call(this, v);
    };
  });
  wrap('deleteVertexArray', function (o) {
    return function (v) {
      var s = this[SYM] || init(this);
      if (s.vao === v) { s.vao = null; s.vs = s.v0; }
      if (v) v[SYM] = undefined;
      return o.call(this, v);
    };
  });
  wrap('vertexAttribPointer', function (o, n) {
    return function (i, size, type, norm, stride, off) {
      var s = this[SYM] || init(this), b = s.buf[0x8892], vs = s.vs;
      if (b !== undefined) {
        var e = vs.p[i];
        if (e !== undefined) {
          if (e.ep === s.epoch && e.b === b && e.I === 0 && e.sz === size && e.t === type
              && e.n === norm && e.st === stride && e.o === off) { if (STATS) sk(n); return; }
        } else e = vs.p[i] = {};
        e.ep = s.epoch; e.b = b; e.I = 0; e.sz = size; e.t = type; e.n = norm; e.st = stride; e.o = off;
      }
      return o.call(this, i, size, type, norm, stride, off);
    };
  });
  wrap('vertexAttribIPointer', function (o, n) {
    return function (i, size, type, stride, off) {
      var s = this[SYM] || init(this), b = s.buf[0x8892], vs = s.vs;
      if (b !== undefined) {
        var e = vs.p[i];
        if (e !== undefined) {
          if (e.ep === s.epoch && e.b === b && e.I === 1 && e.sz === size && e.t === type
              && e.st === stride && e.o === off) { if (STATS) sk(n); return; }
        } else e = vs.p[i] = {};
        e.ep = s.epoch; e.b = b; e.I = 1; e.sz = size; e.t = type; e.n = false; e.st = stride; e.o = off;
      }
      return o.call(this, i, size, type, stride, off);
    };
  });
  wrap('enableVertexAttribArray', function (o, n) {
    return function (i) {
      var vs = (this[SYM] || init(this)).vs;
      if (vs.en[i] === true) { if (STATS) sk(n); return; }
      vs.en[i] = true;
      return o.call(this, i);
    };
  });
  wrap('disableVertexAttribArray', function (o, n) {
    return function (i) {
      var vs = (this[SYM] || init(this)).vs;
      if (vs.en[i] === false) { if (STATS) sk(n); return; }
      vs.en[i] = false;
      return o.call(this, i);
    };
  });
  wrap('vertexAttribDivisor', function (o, n) {
    return function (i, d) {
      var vs = (this[SYM] || init(this)).vs;
      if (vs.dv[i] === d) { if (STATS) sk(n); return; }
      vs.dv[i] = d;
      return o.call(this, i, d);
    };
  });

  // ---- programs, textures, framebuffers -----------------------------------------
  wrap('useProgram', function (o, n) {
    return function (p) {
      var s = this[SYM] || init(this);
      if (s.prog === p) { if (STATS) sk(n); return; }
      s.prog = p;
      return o.call(this, p);
    };
  });
  wrap('deleteProgram', function (o) {
    return function (p) {
      var s = this[SYM] || init(this);
      if (s.prog === p) s.prog = undefined;
      return o.call(this, p);
    };
  });
  wrap('linkProgram', function (o) {
    return function (p) {
      if (p) { p.__locs = undefined; p.__attrs = undefined; } // locations die on relink
      return o.call(this, p);
    };
  });
  wrap('getUniformLocation', function (o, n) {
    return function (p, name) {
      if (!p) return o.call(this, p, name);
      var c = p.__locs || (p.__locs = Object.create(null));
      if (name in c) { if (STATS) sk(n); return c[name]; }
      var loc = o.call(this, p, name);
      if (loc) loc.__p = p;
      c[name] = loc;
      return loc;
    };
  });
  wrap('getAttribLocation', function (o, n) {
    return function (p, name) {
      if (!p) return o.call(this, p, name);
      var c = p.__attrs || (p.__attrs = Object.create(null));
      if (name in c) { if (STATS) sk(n); return c[name]; }
      return (c[name] = o.call(this, p, name));
    };
  });
  wrap('activeTexture', function (o, n) {
    return function (e) {
      var s = this[SYM] || init(this), u = e - 0x84C0;
      if (s.unit === u) { if (STATS) sk(n); return; }
      s.unit = u;
      return o.call(this, e);
    };
  });
  wrap('bindTexture', function (o, n) {
    return function (t, tex) {
      var s = this[SYM] || init(this), a = s.tex[t] || (s.tex[t] = []), u = s.unit;
      if (a[u] === tex) { if (STATS) sk(n); return; }
      a[u] = tex;
      return o.call(this, t, tex);
    };
  });
  wrap('deleteTexture', function (o) {
    return function (tex) {
      var s = this[SYM] || init(this);
      for (var t in s.tex) { var a = s.tex[t]; for (var u = 0; u < a.length; u++) if (a[u] === tex) a[u] = undefined; }
      return o.call(this, tex);
    };
  });
  wrap('bindSampler', function (o, n) {
    return function (u, smp) {
      var s = this[SYM] || init(this);
      if (s.smp[u] === smp) { if (STATS) sk(n); return; }
      s.smp[u] = smp;
      return o.call(this, u, smp);
    };
  });
  wrap('deleteSampler', function (o) {
    return function (smp) {
      var s = this[SYM] || init(this);
      for (var u = 0; u < s.smp.length; u++) if (s.smp[u] === smp) s.smp[u] = undefined;
      return o.call(this, smp);
    };
  });
  wrap('bindFramebuffer', function (o, n) {
    return function (t, fb) {
      var s = this[SYM] || init(this);
      if (t === 0x8D40) {
        if (s.fbD === fb && s.fbR === fb) { if (STATS) sk(n); return; }
        s.fbD = fb; s.fbR = fb;
      } else if (t === 0x8CA9) {
        if (s.fbD === fb) { if (STATS) sk(n); return; }
        s.fbD = fb;
      } else if (t === 0x8CA8) {
        if (s.fbR === fb) { if (STATS) sk(n); return; }
        s.fbR = fb;
      }
      return o.call(this, t, fb);
    };
  });
  wrap('deleteFramebuffer', function (o) {
    return function (fb) {
      var s = this[SYM] || init(this);
      if (s.fbD === fb) s.fbD = undefined;
      if (s.fbR === fb) s.fbR = undefined;
      return o.call(this, fb);
    };
  });
  wrap('bindRenderbuffer', function (o, n) {
    return function (t, rb) {
      var s = this[SYM] || init(this);
      if (s.rb === rb) { if (STATS) sk(n); return; }
      s.rb = rb;
      return o.call(this, t, rb);
    };
  });
  wrap('deleteRenderbuffer', function (o) {
    return function (rb) {
      var s = this[SYM] || init(this);
      if (s.rb === rb) s.rb = undefined;
      return o.call(this, rb);
    };
  });

  // ---- fixed-function-style state -------------------------------------------------
  wrap('enable', function (o, n) {
    return function (c) {
      var s = this[SYM] || init(this);
      if (s.caps[c] === true) { if (STATS) sk(n); return; }
      s.caps[c] = true;
      return o.call(this, c);
    };
  });
  wrap('disable', function (o, n) {
    return function (c) {
      var s = this[SYM] || init(this);
      if (s.caps[c] === false) { if (STATS) sk(n); return; }
      s.caps[c] = false;
      return o.call(this, c);
    };
  });
  // blendFunc/blendFuncSeparate and blendEquation/blendEquationSeparate share state.
  wrap('blendFunc', function (o, n) {
    return function (a, b) {
      var s = this[SYM] || init(this), f = s.bf;
      if (f !== undefined && f[0] === a && f[1] === b && f[2] === a && f[3] === b) { if (STATS) sk(n); return; }
      s.bf = [a, b, a, b];
      return o.call(this, a, b);
    };
  });
  wrap('blendFuncSeparate', function (o, n) {
    return function (a, b, c, d) {
      var s = this[SYM] || init(this), f = s.bf;
      if (f !== undefined && f[0] === a && f[1] === b && f[2] === c && f[3] === d) { if (STATS) sk(n); return; }
      s.bf = [a, b, c, d];
      return o.call(this, a, b, c, d);
    };
  });
  wrap('blendEquation', function (o, n) {
    return function (m) {
      var s = this[SYM] || init(this), e = s.be;
      if (e !== undefined && e[0] === m && e[1] === m) { if (STATS) sk(n); return; }
      s.be = [m, m];
      return o.call(this, m);
    };
  });
  wrap('blendEquationSeparate', function (o, n) {
    return function (a, b) {
      var s = this[SYM] || init(this), e = s.be;
      if (e !== undefined && e[0] === a && e[1] === b) { if (STATS) sk(n); return; }
      s.be = [a, b];
      return o.call(this, a, b);
    };
  });
  function simple(name, key, count) {
    wrap(name, function (o, n) {
      return function (a, b, c, d) {
        var s = this[SYM] || init(this), m = s[key];
        if (m !== undefined && m[0] === a && (count < 2 || m[1] === b)
            && (count < 3 || m[2] === c) && (count < 4 || m[3] === d)) { if (STATS) sk(n); return; }
        if (m === undefined) m = s[key] = [0, 0, 0, 0];
        m[0] = a; if (count > 1) m[1] = b; if (count > 2) m[2] = c; if (count > 3) m[3] = d;
        // forward with the exact arity the API declares
        if (count === 1) return o.call(this, a);
        if (count === 2) return o.call(this, a, b);
        return o.call(this, a, b, c, d);
      };
    });
  }
  simple('depthFunc', 'k_depthFunc', 1);
  simple('depthMask', 'k_depthMask', 1);
  simple('cullFace', 'k_cullFace', 1);
  simple('frontFace', 'k_frontFace', 1);
  simple('clearDepth', 'k_clearDepth', 1);
  simple('lineWidth', 'k_lineWidth', 1);
  simple('depthRange', 'k_depthRange', 2);
  simple('polygonOffset', 'k_polyOff', 2);
  simple('colorMask', 'k_colorMask', 4);
  simple('clearColor', 'k_clearColor', 4);
  simple('blendColor', 'k_blendColor', 4);
  simple('viewport', 'k_viewport', 4);
  simple('scissor', 'k_scissor', 4);

  // ---- uniforms --------------------------------------------------------------------
  // The last call per location is remembered (tagged by which uniform* function made it)
  // and a repeat with identical values is dropped. Only trusted when the location belongs
  // to the current program, and never across a relink (locations are re-queried then).
  var tagN = 1;
  function scalarUniform(name, count) {
    var tag = tagN++;
    wrap(name, function (o, n) {
      return function (loc, a, b, c, d) {
        var s = this[SYM] || init(this);
        if (loc && loc.__p === s.prog) {
          var m = loc.__m;
          if (m !== undefined && loc.__t === tag && m[0] === a && (count < 2 || m[1] === b)
              && (count < 3 || m[2] === c) && (count < 4 || m[3] === d)) { if (STATS) sk(n); return; }
          if (m === undefined) m = loc.__m = new Float64Array(4);
          m[0] = a; if (count > 1) m[1] = b; if (count > 2) m[2] = c; if (count > 3) m[3] = d;
          loc.__t = tag;
        }
        if (count === 1) return o.call(this, loc, a);
        if (count === 2) return o.call(this, loc, a, b);
        if (count === 3) return o.call(this, loc, a, b, c);
        return o.call(this, loc, a, b, c, d);
      };
    });
  }
  ['uniform1f', 'uniform1i', 'uniform1ui'].forEach(function (nm) { scalarUniform(nm, 1); });
  ['uniform2f', 'uniform2i', 'uniform2ui'].forEach(function (nm) { scalarUniform(nm, 2); });
  ['uniform3f', 'uniform3i', 'uniform3ui'].forEach(function (nm) { scalarUniform(nm, 3); });
  ['uniform4f', 'uniform4i', 'uniform4ui'].forEach(function (nm) { scalarUniform(nm, 4); });

  function same(loc, tag, v) {
    var a = loc.__v, n = v.length;
    if (a !== undefined && loc.__t === tag && a.length === n) {
      var i = 0;
      while (i < n && a[i] === v[i]) i++;
      if (i === n) return true;
      for (; i < n; i++) a[i] = v[i];
      return false;
    }
    a = loc.__v = new Float64Array(n);
    for (var j = 0; j < n; j++) a[j] = v[j];
    loc.__t = tag;
    return false;
  }
  function vectorUniform(name) {
    var tag = tagN++;
    wrap(name, function (o, n) {
      return function (loc, v) {
        var s = this[SYM] || init(this);
        if (loc && loc.__p === s.prog) {
          if (arguments.length === 2 && v && typeof v.length === 'number') {
            if (same(loc, tag, v)) { if (STATS) sk(n); return; }
          } else loc.__t = 0; // offset/length form: forget what we knew
        }
        return o.apply(this, arguments);
      };
    });
  }
  function matrixUniform(name) {
    var tagF = tagN++, tagT = tagN++;
    wrap(name, function (o, n) {
      return function (loc, transpose, v) {
        var s = this[SYM] || init(this);
        if (loc && loc.__p === s.prog) {
          if (arguments.length === 3 && v && typeof v.length === 'number') {
            if (same(loc, transpose ? tagT : tagF, v)) { if (STATS) sk(n); return; }
          } else loc.__t = 0;
        }
        return o.apply(this, arguments);
      };
    });
  }
  ['uniform1fv', 'uniform2fv', 'uniform3fv', 'uniform4fv', 'uniform1iv', 'uniform2iv', 'uniform3iv',
   'uniform4iv', 'uniform1uiv', 'uniform2uiv', 'uniform3uiv', 'uniform4uiv'].forEach(vectorUniform);
  ['uniformMatrix2fv', 'uniformMatrix3fv', 'uniformMatrix4fv', 'uniformMatrix2x3fv', 'uniformMatrix3x2fv',
   'uniformMatrix2x4fv', 'uniformMatrix4x2fv', 'uniformMatrix3x4fv', 'uniformMatrix4x3fv'].forEach(matrixUniform);

  // ---- constant queries (each can be a synchronous GPU round trip) ----------------
  var CONST_PARAMS = {};
  [0x0D33, 0x0D3A, 0x1F00, 0x1F01, 0x1F02, 0x8B8C, 0x8869, 0x8872, 0x8B4C, 0x8B4D, 0x8DFC, 0x8DFB,
   0x8DFD, 0x84E8, 0x851C, 0x8824, 0x8CDF, 0x8073, 0x88FF, 0x8D57, 0x8A2F, 0x9245, 0x9246]
    .forEach(function (p) { CONST_PARAMS[p] = 1; });
  wrap('getParameter', function (o, n) {
    return function (p) {
      if (CONST_PARAMS[p] === 1) {
        var s = this[SYM] || init(this), c = s.params || (s.params = {});
        if (p in c) { if (STATS) sk(n); return c[p]; }
        return (c[p] = o.call(this, p));
      }
      return o.call(this, p);
    };
  });
  wrap('getExtension', function (o, n) {
    return function (name) {
      var s = this[SYM] || init(this), c = s.exts || (s.exts = Object.create(null));
      if (name in c) { if (STATS) sk(n); return c[name]; }
      return (c[name] = o.call(this, name));
    };
  });
  wrap('getSupportedExtensions', function (o, n) {
    return function () {
      var s = this[SYM] || init(this);
      if (s.supported) { if (STATS) sk(n); return s.supported.slice(); }
      var r = o.call(this);
      s.supported = r ? r.slice() : r;
      return r;
    };
  });

  // ---- context creation: GPU preference, optional AA off, reset on loss -------------
  var origGetContext = HTMLCanvasElement.prototype.getContext;
  var forceNoAA = /[?&]aa=0(?:&|$)/.test(qs);
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (type === 'webgl2' || type === 'webgl' || type === 'experimental-webgl') {
      var a = {};
      if (attrs) for (var k in attrs) a[k] = attrs[k];
      if (a.powerPreference === undefined) a.powerPreference = 'high-performance';
      if (forceNoAA) a.antialias = false;
      var ctx = origGetContext.call(this, type, a);
      if (ctx && !this.__zl) {
        this.__zl = true;
        var reset = function () { ctx[SYM] = undefined; };
        this.addEventListener('webglcontextlost', reset, false);
        this.addEventListener('webglcontextrestored', reset, false);
      }
      return ctx;
    }
    return origGetContext.apply(this, arguments);
  };

  // ---- cap devicePixelRatio (fill-rate is the usual bottleneck on hi-DPI screens) ---
  try {
    var m = /[?&]dpr=([0-9.]+)/.exec(qs), cap = m ? parseFloat(m[1]) : 2;
    var d = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
    if (cap > 0 && d && d.get && d.configurable) {
      Object.defineProperty(window, 'devicePixelRatio', {
        configurable: true, enumerable: d.enumerable,
        get: function () { var v = d.get.call(window); return v > cap ? cap : v; }
      });
    }
  } catch (e) {}

  if (STATS) {
    setInterval(function () {
      console.log('[zephyr] skipped ' + Z.total + ' redundant GL calls', JSON.stringify(Z.skipped));
    }, 5000);
  }
})();
