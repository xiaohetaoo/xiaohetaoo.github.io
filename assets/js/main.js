/* ============================================================
   小核桃工作室 · 博客交互脚本
   1) Hero 原子轨道动画（呼应工作室 logo：原子环绕立方体）
   2) 滚动进场（位移 + 模糊，对齐 harness 的 --enter-y/--enter-blur）
   3) 代码复制按钮
   4) 导航滚动高亮
   ============================================================ */

(function () {
  "use strict";

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // ?static：跳过所有动画，直接渲染最终状态（用于截图/打印等确定性场景）
  var staticMode = window.location.search.indexOf("static") !== -1;

  // 渐进增强：只有 JS 正常运行时才启用进场动画的初始隐藏
  if (!reducedMotion && !staticMode) {
    document.documentElement.classList.add("js");
  }

  /* ---------- 1. 原子轨道动画 ---------- */
  var canvas = document.getElementById("orbit-canvas");
  if (canvas) {
    var ctx = canvas.getContext("2d");
    var W = 0, H = 0, DPR = 1;

    function resize() {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      var rect = canvas.getBoundingClientRect();
      W = rect.width;
      H = rect.height;
      canvas.width = W * DPR;
      canvas.height = H * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    }

    // 三条椭圆轨道（角度、半径、转速各不相同），中心一个缓慢旋转的立方体线框
    var orbits = [
      { rx: 0.47, ry: 0.155, rot: -Math.PI / 7,   speed: 0.42, phase: 0.4,  color: "#679efe", _ox: 0, _oy: 0 },
      { rx: 0.47, ry: 0.155, rot:  Math.PI / 7,   speed: 0.30, phase: 2.6,  color: "#4a8ac4", _ox: 0, _oy: 0 },
      { rx: 0.16, ry: 0.455, rot:  0.06,          speed: 0.22, phase: 4.6,  color: "#8ab4ff", _ox: 0, _oy: 0 }
    ];

    // 鼠标互动：电子被轻轻吸引，立方体微微偏转（克制档：作用半径 170px、最大偏移 16px）
    var heroMouse = { x: 0, y: 0, active: false };
    var cubeLean = { x: 0, y: 0 };

    function heroMousePos(e) {
      heroMouse.x = e.clientX;
      heroMouse.y = e.clientY;
      heroMouse.active = true;
    }

    if (!reducedMotion && !staticMode) {
      window.addEventListener("mousemove", heroMousePos, { passive: true });
      document.addEventListener("mouseleave", function () { heroMouse.active = false; });
    }

    function electronPull(o, x, y, dt) {
      dt = dt || 0;
      var tx = 0, ty = 0;
      if (heroMouse.active) {
        var dx = heroMouse.x - x, dy = heroMouse.y - y;
        var d = Math.sqrt(dx * dx + dy * dy);
        var R = 170;
        if (d < R && d > 0.001) {
          var f = (1 - d / R) * 16;
          tx = (dx / d) * f;
          ty = (dy / d) * f;
        }
      }
      var k = Math.min(1, dt * 6);
      o._ox += (tx - o._ox) * k;
      o._oy += (ty - o._oy) * k;
      return [x + o._ox, y + o._oy];
    }

    function drawOrbit(o, t) {
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate(o.rot);
      ctx.beginPath();
      ctx.ellipse(0, 0, o.rx * W * 0.92, o.ry * W * 0.92, 0, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(103, 158, 254, 0.30)";
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.restore();
    }

    function drawElectron(o, t, dt) {
      var a = o.phase + t * o.speed;
      var ex = Math.cos(a) * o.rx * W * 0.92;
      var ey = Math.sin(a) * o.ry * W * 0.92;
      var cos = Math.cos(o.rot), sin = Math.sin(o.rot);
      var pos = electronPull(o, W / 2 + ex * cos - ey * sin, H / 2 + ex * sin + ey * cos, dt);
      var x = pos[0];
      var y = pos[1];

      var r = 5.5;
      var g = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
      g.addColorStop(0, o.color);
      g.addColorStop(0.35, "rgba(103, 158, 254, 0.45)");
      g.addColorStop(1, "rgba(103, 158, 254, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r * 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#cfe2ff";
      ctx.beginPath();
      ctx.arc(x, y, r * 0.62, 0, Math.PI * 2);
      ctx.fill();
    }

    // 立方体线框：绕 Y 轴慢转 + 固定俯角
    var CUBE = [
      [-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1],
      [-1, -1,  1], [1, -1,  1], [1, 1,  1], [-1, 1,  1]
    ];
    var EDGES = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7]
    ];

    var heroRect = null;
    function updateHeroRect() { heroRect = canvas.getBoundingClientRect(); }

    function drawCube(t, dt) {
      dt = dt || 0;
      var s = W * 0.085;
      var tiltX = -0.42;
      var rotY = t * 0.3;
      // 鼠标偏转：立方体朝光标方向轻微倾斜（最大约 0.3 弧度），松手回弹
      var lx = 0, ly = 0;
      if (heroMouse.active && heroRect) {
        lx = Math.max(-1, Math.min(1, (heroMouse.x - (heroRect.left + heroRect.width / 2)) / (heroRect.width / 2)));
        ly = Math.max(-1, Math.min(1, (heroMouse.y - (heroRect.top + heroRect.height / 2)) / (heroRect.height / 2)));
      }
      var k = Math.min(1, dt * 4);
      cubeLean.x += (lx - cubeLean.x) * k;
      cubeLean.y += (ly - cubeLean.y) * k;
      tiltX += cubeLean.y * 0.22;
      rotY += cubeLean.x * 0.35;
      var pts = CUBE.map(function (v) {
        var x = v[0] * s, y = v[1] * s, z = v[2] * s;
        var x1 = x * Math.cos(rotY) + z * Math.sin(rotY);
        var z1 = -x * Math.sin(rotY) + z * Math.cos(rotY);
        var y1 = y * Math.cos(tiltX) - z1 * Math.sin(tiltX);
        return [W / 2 + x1, H / 2 + y1];
      });
      ctx.strokeStyle = "rgba(140, 190, 255, 0.65)";
      ctx.lineWidth = 1.6;
      ctx.lineJoin = "round";
      EDGES.forEach(function (e) {
        ctx.beginPath();
        ctx.moveTo(pts[e[0]][0], pts[e[0]][1]);
        ctx.lineTo(pts[e[1]][0], pts[e[1]][1]);
        ctx.stroke();
      });
      // 顶点微光
      ctx.fillStyle = "rgba(190, 218, 255, 0.85)";
      pts.forEach(function (p) {
        ctx.beginPath();
        ctx.arc(p[0], p[1], 1.8, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    var start = null;
    var lastTs = null;
    function frame(ts) {
      if (start === null) start = ts;
      var dt = lastTs === null ? 0.016 : Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;
      var t = (ts - start) / 1000;
      ctx.clearRect(0, 0, W, H);
      orbits.forEach(function (o) { drawOrbit(o, t); });
      drawCube(t, dt);
      orbits.forEach(function (o) { drawElectron(o, t, dt); });
      if (!reducedMotion && !staticMode && !document.hidden) {
        requestAnimationFrame(frame);
      }
    }

    // 页面重新可见时恢复动画
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && !reducedMotion && !staticMode) requestAnimationFrame(frame);
    });

    window.addEventListener("resize", function () {
      resize();
      updateHeroRect();
      if (reducedMotion || staticMode) {
        ctx.clearRect(0, 0, W, H);
        orbits.forEach(function (o) { drawOrbit(o, 0); });
        drawCube(0.5);
        orbits.forEach(function (o) { drawElectron(o, 0); });
      }
    });

    window.addEventListener("scroll", updateHeroRect, { passive: true });

    resize();
    updateHeroRect();
    if (reducedMotion || staticMode) {
      // 静态渲染一帧
      ctx.clearRect(0, 0, W, H);
      orbits.forEach(function (o) { drawOrbit(o, 0); });
      drawCube(0.5);
      orbits.forEach(function (o) { drawElectron(o, 0); });
    } else {
      requestAnimationFrame(frame);
    }
  }

  /* ---------- 6. 星尘粒子层（全站固定背景，鼠标推开 + 滚动微加速） ---------- */
  if (!reducedMotion) {
    var dustCanvas = document.createElement("canvas");
    dustCanvas.id = "dust-canvas";
    dustCanvas.setAttribute("aria-hidden", "true");
    document.body.insertBefore(dustCanvas, document.body.firstChild);

    var dctx = dustCanvas.getContext("2d");
    var dw = 0, dh = 0, dust = [];
    var dMouse = { x: -9999, y: -9999 };
    var dLastScroll = window.scrollY;
    var dScrollBoost = 0;
    var dLast = null;

    function dustResize() {
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      dw = window.innerWidth;
      dh = window.innerHeight;
      dustCanvas.width = dw * dpr;
      dustCanvas.height = dh * dpr;
      dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // 按视口面积配置数量，上限 90 颗
      var target = Math.min(90, Math.round((dw * dh) / 22000));
      dust = [];
      for (var i = 0; i < target; i++) {
        var glow = Math.random() < 0.09;
        dust.push({
          x: Math.random() * dw,
          y: Math.random() * dh,
          r: glow ? 1.7 + Math.random() * 1.3 : 0.6 + Math.random() * 1.1,
          vx: (Math.random() - 0.5) * 9,
          vy: (Math.random() - 0.5) * 7 - 3,
          a: 0.10 + Math.random() * 0.28,
          glow: glow,
          tw: Math.random() * Math.PI * 2
        });
      }
    }

    window.addEventListener("mousemove", function (e) {
      dMouse.x = e.clientX;
      dMouse.y = e.clientY;
    }, { passive: true });

    window.addEventListener("resize", dustResize);
    if (!staticMode) {
      document.addEventListener("visibilitychange", function () {
        if (!document.hidden) {
          dLast = null;
          requestAnimationFrame(dustFrame);
        }
      });
    }

    function dustDraw(t, dt) {
      if (dLastScroll === undefined) dLastScroll = window.scrollY;

      // 滚动时整体微微加速（随滚动速度衰减）
      var sy = window.scrollY;
      dScrollBoost = dScrollBoost * 0.88 + (sy - dLastScroll) * 0.10;
      dLastScroll = sy;

      dctx.clearRect(0, 0, dw, dh);
      for (var i = 0; i < dust.length; i++) {
        var p = dust[i];
        p.x += p.vx * dt;
        p.y += (p.vy + dScrollBoost * 8) * dt;

        // 鼠标推开：半径 110px 内的微粒被轻轻推开
        var mdx = p.x - dMouse.x, mdy = p.y - dMouse.y;
        var md2 = mdx * mdx + mdy * mdy;
        var R = 110;
        if (md2 < R * R && md2 > 0.0001) {
          var md = Math.sqrt(md2);
          var f = (1 - md / R) * 60 * dt;
          p.x += (mdx / md) * f;
          p.y += (mdy / md) * f;
        }

        // 边缘环绕
        if (p.x < -12) p.x += dw + 24; else if (p.x > dw + 12) p.x -= dw + 24;
        if (p.y < -12) p.y += dh + 24; else if (p.y > dh + 12) p.y -= dh + 24;

        var alpha = p.a * (0.72 + 0.28 * Math.sin(t * 1.4 + p.tw));
        if (p.glow) {
          var g = dctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 6);
          g.addColorStop(0, "rgba(140, 185, 255, " + (alpha * 0.85).toFixed(3) + ")");
          g.addColorStop(1, "rgba(140, 185, 255, 0)");
          dctx.fillStyle = g;
          dctx.beginPath();
          dctx.arc(p.x, p.y, p.r * 6, 0, Math.PI * 2);
          dctx.fill();
        }
        dctx.fillStyle = "rgba(205, 224, 255, " + alpha.toFixed(3) + ")";
        dctx.beginPath();
        dctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        dctx.fill();
      }

      if (!document.hidden && !staticMode) requestAnimationFrame(dustFrame);
    }

    function dustFrame(ts) {
      if (dLast === null) dLast = ts;
      var dt = Math.min(0.05, (ts - dLast) / 1000);
      dLast = ts;
      dustDraw(ts / 1000, dt);
    }

    dustResize();
    if (staticMode) {
      dustDraw(0, 0);
    } else {
      requestAnimationFrame(dustFrame);
    }
  }

  /* ---------- 2. 滚动进场 ---------- */
  var revealEls = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window && !reducedMotion) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            en.target.classList.add("is-visible");
            io.unobserve(en.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -40px 0px" }
    );
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add("is-visible"); });
  }

  /* ---------- 3. 代码复制按钮 ---------- */
  document.querySelectorAll(".copy-btn[data-copy]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var text = btn.getAttribute("data-copy");
      var done = function () {
        var original = btn.innerHTML;
        btn.classList.add("copied");
        btn.innerHTML = "已复制 ✓";
        setTimeout(function () {
          btn.classList.remove("copied");
          btn.innerHTML = original;
        }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, done);
      } else {
        var ta = document.createElement("textarea");
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); } catch (e) {}
        document.body.removeChild(ta);
        done();
      }
    });
  });

  /* ---------- 4. 导航滚动高亮 ---------- */
  var sections = ["posts", "projects", "contact"]
    .map(function (id) { return document.getElementById(id); })
    .filter(Boolean);
  var navAnchors = document.querySelectorAll(".nav-links a[href^='#']");

  if (sections.length && "IntersectionObserver" in window) {
    var spy = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            navAnchors.forEach(function (a) {
              a.classList.toggle(
                "active",
                a.getAttribute("href") === "#" + en.target.id
              );
            });
          }
        });
      },
      { rootMargin: "-30% 0px -60% 0px" }
    );
    sections.forEach(function (s) { spy.observe(s); });
  }

  /* ---------- 5. 页脚年份 ---------- */
  var year = document.getElementById("year");
  if (year) year.textContent = new Date().getFullYear();
})();
