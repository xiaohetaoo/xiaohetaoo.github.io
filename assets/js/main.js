/* ============================================================
   小核桃工作室 · 博客交互脚本
   1) Hero 原子轨道动画（呼应工作室 logo：原子环绕立方体）
   2) 滚动进场（位移 + 模糊，对齐 harness 的 --enter-y/--enter-blur）
   3) 代码复制按钮
   4) 导航滚动高亮
   5) 文章列表渲染（posts.json：置顶优先，其余按日期倒序）
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

  /* ---------- 0. 深浅主题切换 ---------- */
  // json 数据的缓存版本号，跟页面资源的 ?v= 一起升，避免部署后浏览器还拿旧 json
  var DATA_VER = "20260831j";

  var themeBtn = document.getElementById("theme-toggle");
  var SUN_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>';
  var MOON_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';
  var syncTheme = function () {
    var light = document.documentElement.getAttribute("data-theme") === "light";
    themeBtn.innerHTML = light ? MOON_ICON : SUN_ICON;
    themeBtn.setAttribute("aria-label", light ? "切换到深色主题" : "切换到亮色主题");
  };

  // 切换主题；浏览器支持 View Transitions 时从点击位置做圆形扩散动画
  function applyTheme(next, origin) {
    var commit = function () {
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("theme", next); } catch (e) {}
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute("content", next === "light" ? "#f5f6f8" : "#000000");
      syncTheme();
      document.dispatchEvent(new CustomEvent("themechange", { detail: { theme: next } }));
    };
    if (!document.startViewTransition || reducedMotion) {
      commit();
      return;
    }
    // 主题动画期间挂作用域标记：圆形扩散用自己那份伪元素规则，和跨页面过渡互不干扰
    document.documentElement.classList.add("theme-anim");
    var vt = document.startViewTransition(commit);
    vt.ready.then(function () {
      var x = origin.x, y = origin.y;
      var radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
      document.documentElement.animate(
        {
          clipPath: [
            "circle(0px at " + x + "px " + y + "px)",
            "circle(" + radius + "px at " + x + "px " + y + "px)"
          ]
        },
        { duration: 550, easing: "ease-in-out", pseudoElement: "::view-transition-new(root)" }
      );
    }).catch(function () {});
    vt.finished.then(
      function () { document.documentElement.classList.remove("theme-anim"); },
      function () { document.documentElement.classList.remove("theme-anim"); }
    );
  }

  /* ---------- 0.5 跨页面过渡：卡片/侧栏项放大成文章头 ---------- */
  // 点击文章卡片或侧栏目录项时，给被点的元素挂 view-transition-name="post-hero"，
  // 新页面的 header.article-head 在 CSS 里挂着同名标记，
  // 浏览器就会做"点击项放大成文章头"的共享元素过渡（不支持的浏览器回退普通跳转）。
  // 侧栏项起飞时，当前文章头要让出标记（html.side-morph），否则同页重名会直接跳过过渡。
  var morphedEl = null;
  function clearNavMorph() {
    if (morphedEl) {
      morphedEl.style.viewTransitionName = "";
      morphedEl = null;
    }
    document.documentElement.classList.remove("side-morph");
  }

  document.addEventListener("click", function (e) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.defaultPrevented) return;
    var el = e.target && e.target.closest ? e.target.closest(".post-card[href], .side-item[href]") : null;
    if (!el) {
      // 点了别处（比如主题按钮）：顺手清掉残留标记，避免主题圆形扩散在这块区域漏一块
      clearNavMorph();
      return;
    }
    clearNavMorph();
    morphedEl = el;
    el.style.viewTransitionName = "post-hero";
    if (el.classList.contains("side-item")) {
      document.documentElement.classList.add("side-morph");
    }
  });

  // 返回/恢复页面（bfcache）时元素可能还挂着标记：
  // 若正好有页面过渡就等它放完再摘，否则立刻摘掉，保持状态干净
  window.addEventListener("pagereveal", function (e) {
    if (!morphedEl) return;
    if (e.viewTransition) {
      e.viewTransition.finished.then(clearNavMorph, clearNavMorph);
    } else {
      clearNavMorph();
    }
  });

  /* ---------- 0.6 方向性滑动：查看全部文章/项目 = 下钻，返回 = 上钻 ---------- */
  // 跨文档过渡的动画规则由【新页面】的样式决定（旧页只贡献快照），
  // 所以点击时只写 sessionStorage 方向标记，新页面在 pagereveal 时读标记挂 nav-deep / nav-back 类。
  function markNavDir(dir) {
    try { sessionStorage.setItem("xht-nav-dir", dir); } catch (e) {}
  }

  document.addEventListener("click", function (e) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.defaultPrevented) return;
    var el = e.target && e.target.closest ? e.target : null;
    var deep = el ? el.closest(".all-posts-link[href], .all-projects-link[href]") : null;
    var backLink = null;
    if (!deep) {
      var path = window.location.pathname;
      var onList = path.indexOf("archive.html") !== -1 || path.indexOf("projects.html") !== -1;
      backLink = onList && el ? el.closest(".back-link[href]") : null;
    }
    if (deep) markNavDir("deep");
    else if (backLink) markNavDir("back");
    else {
      // 点了别的入口：清掉残留标记，避免方向滑动污染下一次普通导航
      try { sessionStorage.removeItem("xht-nav-dir"); } catch (err) {}
    }
  });

  // 浏览器返回键：从列表页离开且是后退遍历时，也走反向滑动（点返回链接走上面的 click 路径）
  window.addEventListener("pageswap", function (e) {
    try {
      var path = window.location.pathname;
      if (path.indexOf("archive.html") === -1 && path.indexOf("projects.html") === -1) return;
      var act = e.activation;
      if (act && act.entry && act.oldEntry && act.entry.index < act.oldEntry.index) {
        markNavDir("back");
      }
    } catch (err) {}
  });

  window.addEventListener("pagereveal", function (e) {
    var dir = null;
    try { dir = sessionStorage.getItem("xht-nav-dir"); } catch (err) {}
    if (dir !== "deep" && dir !== "back") return;
    try { sessionStorage.removeItem("xht-nav-dir"); } catch (err) {}
    var dirCls = dir === "deep" ? "nav-deep" : "nav-back";
    document.documentElement.classList.add(dirCls);
    var dirDone = function () { document.documentElement.classList.remove(dirCls); };
    if (e.viewTransition) e.viewTransition.finished.then(dirDone, dirDone);
    else dirDone();
  });

  if (themeBtn) {
    syncTheme();
    themeBtn.addEventListener("click", function (e) {
      var next = document.documentElement.getAttribute("data-theme") === "light" ? "dark" : "light";
      applyTheme(next, { x: e.clientX, y: e.clientY });
    });
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

    // 深浅主题各自的画布配色（轨道 / 电子 / 立方体），切换主题后下一帧自动生效
    var CANVAS_PALETTES = {
      dark: {
        orbitStroke: "rgba(103, 158, 254, 0.30)",
        glowMid: "rgba(103, 158, 254, 0.45)",
        glowEnd: "rgba(103, 158, 254, 0)",
        electronCore: "#cfe2ff",
        cubeStroke: "rgba(140, 190, 255, 0.65)",
        cubeDot: "rgba(190, 218, 255, 0.85)",
        orbitColors: ["#679efe", "#4a8ac4", "#8ab4ff"]
      },
      light: {
        orbitStroke: "rgba(47, 108, 235, 0.38)",
        glowMid: "rgba(47, 108, 235, 0.38)",
        glowEnd: "rgba(47, 108, 235, 0)",
        electronCore: "#1d4ed8",
        cubeStroke: "rgba(37, 99, 235, 0.55)",
        cubeDot: "rgba(30, 79, 174, 0.8)",
        orbitColors: ["#2f6ceb", "#1e4fae", "#5b8def"]
      }
    };
    var currentPal = CANVAS_PALETTES.dark;
    function syncPalette() {
      var pal = document.documentElement.getAttribute("data-theme") === "light"
        ? CANVAS_PALETTES.light
        : CANVAS_PALETTES.dark;
      if (pal !== currentPal) {
        currentPal = pal;
        orbits.forEach(function (o, i) { o.color = pal.orbitColors[i]; });
      }
    }

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
      ctx.strokeStyle = currentPal.orbitStroke;
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
      g.addColorStop(0.35, currentPal.glowMid);
      g.addColorStop(1, currentPal.glowEnd);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r * 4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = currentPal.electronCore;
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
      ctx.strokeStyle = currentPal.cubeStroke;
      ctx.lineWidth = 1.6;
      ctx.lineJoin = "round";
      EDGES.forEach(function (e) {
        ctx.beginPath();
        ctx.moveTo(pts[e[0]][0], pts[e[0]][1]);
        ctx.lineTo(pts[e[1]][0], pts[e[1]][1]);
        ctx.stroke();
      });
      // 顶点微光
      ctx.fillStyle = currentPal.cubeDot;
      pts.forEach(function (p) {
        ctx.beginPath();
        ctx.arc(p[0], p[1], 1.8, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    var start = null;
    var lastTs = null;
    var rafPending = false;
    function scheduleFrame() {
      // 防重入：标签页切走再切回时，挂起的旧帧和 visibilitychange 的重触发只会留下一个循环
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(function (ts) {
        rafPending = false;
        frame(ts);
      });
    }
    function frame(ts) {
      if (start === null) start = ts;
      var dt = lastTs === null ? 0.016 : Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;
      var t = (ts - start) / 1000;
      syncPalette();
      ctx.clearRect(0, 0, W, H);
      orbits.forEach(function (o) { drawOrbit(o, t); });
      drawCube(t, dt);
      orbits.forEach(function (o) { drawElectron(o, t, dt); });
      if (!reducedMotion && !staticMode && !document.hidden && heroVisible) {
        scheduleFrame();
      }
    }

    // 滚出首屏就停帧，回到视口再继续（首页往下阅读时动画不必空转）
    var heroVisible = true;
    if ("IntersectionObserver" in window && !reducedMotion && !staticMode) {
      heroVisible = false;
      new IntersectionObserver(function (entries) {
        var now = entries[0].isIntersecting;
        if (now && !heroVisible) scheduleFrame();
        heroVisible = now;
      }, { threshold: 0 }).observe(canvas);
    }

    // 页面重新可见时恢复动画
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && !reducedMotion && !staticMode) scheduleFrame();
    });

    var resizeTimer = null;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        resize();
        updateHeroRect();
        if (reducedMotion || staticMode) {
          ctx.clearRect(0, 0, W, H);
          orbits.forEach(function (o) { drawOrbit(o, 0); });
          drawCube(0.5);
          orbits.forEach(function (o) { drawElectron(o, 0); });
        }
      }, 120);
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
      scheduleFrame();
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
    var dustPending = false;

    // 深浅主题各自的粒子配色；发光粒子用缓存的精灵图，避免每帧重建径向渐变
    var DUST_PALETTES = {
      dark: { glow: "140, 185, 255", dot: "205, 224, 255" },
      light: { glow: "47, 108, 235", dot: "62, 90, 148" }
    };
    var dustPal = DUST_PALETTES.dark;
    var glowSprite = null;
    function buildGlowSprite() {
      glowSprite = document.createElement("canvas");
      glowSprite.width = glowSprite.height = 64;
      var gctx = glowSprite.getContext("2d");
      var g = gctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, "rgba(" + dustPal.glow + ", 0.85)");
      g.addColorStop(1, "rgba(" + dustPal.glow + ", 0)");
      gctx.fillStyle = g;
      gctx.fillRect(0, 0, 64, 64);
    }
    function syncDustPalette() {
      var pal = document.documentElement.getAttribute("data-theme") === "light"
        ? DUST_PALETTES.light
        : DUST_PALETTES.dark;
      if (pal !== dustPal) {
        dustPal = pal;
        buildGlowSprite();
      }
    }
    buildGlowSprite();

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

    var dustResizeTimer = null;
    window.addEventListener("resize", function () {
      clearTimeout(dustResizeTimer);
      dustResizeTimer = setTimeout(dustResize, 120);
    });
    if (!staticMode) {
      document.addEventListener("visibilitychange", function () {
        if (!document.hidden) scheduleDust();
      });
    }

    function dustDraw(t, dt) {
      if (dLastScroll === undefined) dLastScroll = window.scrollY;

      // 滚动时整体微微加速（随滚动速度衰减）
      var sy = window.scrollY;
      dScrollBoost = dScrollBoost * 0.88 + (sy - dLastScroll) * 0.10;
      dLastScroll = sy;

      syncDustPalette();
      dctx.clearRect(0, 0, dw, dh);
      dctx.fillStyle = "rgb(" + dustPal.dot + ")";
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
        dctx.globalAlpha = p.glow ? alpha * 0.85 : alpha;
        if (p.glow) {
          var gr = p.r * 6;
          dctx.drawImage(glowSprite, p.x - gr, p.y - gr, gr * 2, gr * 2);
        }
        dctx.beginPath();
        dctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        dctx.fill();
      }
      dctx.globalAlpha = 1;

      if (!document.hidden && !staticMode) scheduleDust();
    }

    function dustFrame(ts) {
      if (dLast === null) dLast = ts;
      var dt = Math.min(0.05, (ts - dLast) / 1000);
      dLast = ts;
      dustDraw(ts / 1000, dt);
    }

    function scheduleDust() {
      if (dustPending) return;
      dustPending = true;
      requestAnimationFrame(function (ts) {
        dustPending = false;
        dustFrame(ts);
      });
    }

    dustResize();
    if (staticMode) {
      dustDraw(0, 0);
    } else {
      scheduleDust();
    }
  }

  /* ---------- 2. 滚动进场 ---------- */
  var revealIo = null;
  if ("IntersectionObserver" in window && !reducedMotion) {
    revealIo = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            en.target.classList.add("is-visible");
            revealIo.unobserve(en.target);
          }
        });
      },
      { threshold: 0.08, rootMargin: "0px 0px -40px 0px" }
    );
  }
  // 动态插入的元素（文章卡片）也走同一个观察器
  function watchReveal(el) {
    if (revealIo) revealIo.observe(el);
    else el.classList.add("is-visible");
  }
  document.querySelectorAll(".reveal").forEach(watchReveal);

  /* ---------- 5. 文章列表（posts.json 驱动：置顶优先，其余按日期倒序）
         #post-list     首页，只显示最新 5 篇
         #archive-list  归档页，显示全部
         #sidebar-posts 文章页侧栏导航，当前篇高亮 ---------- */
  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };

  // 同一页面多处列表共用一次请求；文章页在 /posts/ 子目录，要回到站点根再取
  var postsCache = null;
  function loadPosts() {
    if (!postsCache) {
      var root = window.location.pathname.indexOf("/posts/") !== -1 ? ".." : ".";
      postsCache = fetch(root + "/posts.json?v=" + DATA_VER).then(function (r) { return r.json(); });
    }
    return postsCache;
  }

  function sortPosts(posts) {
    return posts.slice().sort(function (a, b) {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      return b.date.localeCompare(a.date);
    });
  }

  function postCardHtml(p, i) {
    var tags = (p.tags || [])
      .map(function (t, j) {
        return '<span class="tag' + (j > 0 ? " tag-gray" : "") + '">' + esc(t) + "</span>";
      })
      .join("");
    var pin = p.pinned ? '<span class="pin-badge">置顶</span>' : "";
    var delay = ' style="--d:' + Math.min(i * 0.05, 0.3).toFixed(2) + 's"';
    return (
      '<a class="post-card reveal"' + delay + ' href="posts/' + esc(p.slug) + '.html">' +
        '<span class="date">' + esc(p.date) + pin + "</span>" +
        "<div><h3>" + esc(p.title) + '</h3><p class="excerpt">' + esc(p.excerpt) + "</p></div>" +
        '<div class="meta-col"><span class="tags">' + tags + '</span><span class="arrow" aria-hidden="true">-&gt;</span></div>' +
      "</a>"
    );
  }

  function postMatches(p, q) {
    var hay = (p.title + " " + p.excerpt + " " + (p.tags || []).join(" ")).toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  function renderPostCards(container, limit, query) {
    var q = (query || "").trim().toLowerCase();
    loadPosts()
      .then(function (posts) {
        var sorted = sortPosts(posts);
        // 搜索时全库匹配、不限条数；否则按各页配额展示
        var shown = q
          ? sorted.filter(function (p) { return postMatches(p, q); })
          : limit > 0 ? sorted.slice(0, limit) : sorted;
        var html = "";
        if (q) {
          html += '<p class="search-hint">找到 <b>' + shown.length + "</b> 篇与「" + esc(query.trim()) + "」相关的文章</p>";
        }
        html += shown.length
          ? shown.map(postCardHtml).join("")
          : '<p class="search-empty">没有找到相关文章，换个关键词试试？</p>';
        container.innerHTML = html;
        if (q) {
          // 打字过程中的连续重渲染，跳过渐显动画避免闪烁
          container.querySelectorAll(".reveal").forEach(function (el) { el.classList.add("is-visible"); });
        } else {
          container.querySelectorAll(".reveal").forEach(watchReveal);
        }
        // 文章总数没超过首页配额时，就不显示「查看全部文章」入口；搜索中也不显示
        var allLink = document.getElementById("all-posts-link");
        if (allLink) allLink.hidden = q ? true : sorted.length <= limit;
      })
      .catch(function () {
        container.innerHTML = '<p class="sub">文章列表加载失败，请刷新重试。</p>';
      });
  }

  var homeList = document.getElementById("post-list");
  var archiveList = document.getElementById("archive-list");
  var searchInput = document.getElementById("post-search");
  var searchTimer = null;

  function rerenderLists() {
    var q = searchInput ? searchInput.value : "";
    if (homeList) renderPostCards(homeList, 5, q);
    if (archiveList) renderPostCards(archiveList, 0, q);
  }

  if (searchInput) {
    // 支持 archive.html?q=关键词 直接带词搜索，链接可分享
    var initialQ = new URLSearchParams(window.location.search).get("q") || "";
    if (initialQ) searchInput.value = initialQ;
    searchInput.addEventListener("input", function () {
      var q = searchInput.value.trim();
      try {
        window.history.replaceState(null, "",
          window.location.pathname + (q ? "?q=" + encodeURIComponent(q) : "") + window.location.hash);
      } catch (e) {}
      clearTimeout(searchTimer);
      searchTimer = setTimeout(rerenderLists, 120);
    });
  }

  rerenderLists();

  /* ---------- 8. 项目列表（projects.json 驱动）
         #project-list     首页，只显示前 6 个
         #project-all-list projects.html，显示全部 ---------- */
  var PROJECT_ICONS = {
    cube: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>',
    gamepad: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="6 3 20 12 6 21 6 3"/></svg>',
    gift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/></svg>',
    presentation: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/><path d="M3.22 12H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"/></svg>'
  };

  function projectCardHtml(p, i) {
    var tags = (p.tags || [])
      .map(function (t) {
        return '<span class="tag tag-gray">' + esc(t) + "</span>";
      })
      .join("");
    var pin = p.pinned ? '<span class="pin-badge">置顶</span>' : "";
    var delay = ' style="--d:' + Math.min(i * 0.08, 0.48).toFixed(2) + 's"';
    var icon = PROJECT_ICONS[p.icon] || PROJECT_ICONS.cube;
    var inner =
      '<div class="p-icon" aria-hidden="true">' + icon + "</div>" +
      "<h3>" + esc(p.title) + '<span class="p-date">' + esc(p.date) + pin + "</span></h3>" +
      '<p class="p-desc">' + esc(p.desc) + "</p>" +
      '<div class="p-foot"><span class="tags">' + tags + '</span><span class="p-link mono">' + esc(p.linkText) + "</span></div>";
    if (p.href) {
      return '<a class="project-card reveal"' + delay + ' href="' + esc(p.href) + '" target="_blank" rel="noopener">' + inner + "</a>";
    }
    return '<div class="project-card reveal"' + delay + ">" + inner + "</div>";
  }

  var projectsCache = null;
  function loadProjects() {
    if (!projectsCache) {
      projectsCache = fetch("projects.json?v=" + DATA_VER).then(function (r) { return r.json(); });
    }
    return projectsCache;
  }

  function sortProjects(projects) {
    // 置顶优先（组内保持 json 里的书写顺序，稳定排序）；其余按日期倒序，新项目排上面
    return projects.slice().sort(function (a, b) {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
      if (!a.pinned) return b.date.localeCompare(a.date);
      return 0;
    });
  }

  function projectMatches(p, q) {
    var hay = (p.title + " " + p.desc + " " + (p.tags || []).join(" ")).toLowerCase();
    return hay.indexOf(q) !== -1;
  }

  function renderProjects(container, limit, query) {
    var q = (query || "").trim().toLowerCase();
    loadProjects()
      .then(function (projects) {
        var sorted = sortProjects(projects);
        // 搜索时全库匹配、不限条数；否则按各页配额展示
        var shown = q
          ? sorted.filter(function (p) { return projectMatches(p, q); })
          : limit > 0 ? sorted.slice(0, limit) : sorted;
        // 网格容器里只能放卡片，结果提示 / 空态放外置元素，避免占掉第一个格子
        var hint = document.querySelector("[data-project-hint]");
        if (hint) {
          if (q && !shown.length) {
            hint.hidden = false;
            hint.className = "search-empty";
            hint.textContent = "没有找到相关项目，换个关键词试试？";
          } else if (q) {
            hint.hidden = false;
            hint.className = "search-hint";
            hint.innerHTML = "找到 <b>" + shown.length + "</b> 个与「" + esc(query.trim()) + "」相关的项目";
          } else {
            hint.hidden = true;
            hint.innerHTML = "";
          }
        }
        container.innerHTML = shown.map(projectCardHtml).join("");
        if (q) {
          // 打字过程中的连续重渲染，跳过渐显动画避免闪烁
          container.querySelectorAll(".reveal").forEach(function (el) { el.classList.add("is-visible"); });
        } else {
          container.querySelectorAll(".reveal").forEach(watchReveal);
        }
        // 项目总数没超过首页配额时，就不显示「查看全部项目」入口；搜索中也不显示
        var allLink = document.getElementById("all-projects-link");
        if (allLink) allLink.hidden = q ? true : projects.length <= limit;
      })
      .catch(function () {
        container.innerHTML = '<p class="sub">项目列表加载失败，请刷新重试。</p>';
      });
  }

  var projectList = document.getElementById("project-list");
  var projectAllList = document.getElementById("project-all-list");
  var projectSearchInput = document.getElementById("project-search");
  var projectSearchTimer = null;

  function rerenderProjectLists() {
    var q = projectSearchInput ? projectSearchInput.value : "";
    if (projectList) renderProjects(projectList, 6, q);
    if (projectAllList) renderProjects(projectAllList, 0, q);
  }

  if (projectSearchInput) {
    // projects.html 上支持 ?q= 直达分享；首页的 ?q= 已被文章搜索占用，项目搜索只做本地过滤
    var isProjectsPage = !!projectAllList;
    var initialProjectQ = isProjectsPage ? (new URLSearchParams(window.location.search).get("q") || "") : "";
    if (initialProjectQ) projectSearchInput.value = initialProjectQ;
    projectSearchInput.addEventListener("input", function () {
      if (isProjectsPage) {
        var q = projectSearchInput.value.trim();
        try {
          window.history.replaceState(null, "",
            window.location.pathname + (q ? "?q=" + encodeURIComponent(q) : "") + window.location.hash);
        } catch (e) {}
      }
      clearTimeout(projectSearchTimer);
      projectSearchTimer = setTimeout(rerenderProjectLists, 120);
    });
  }

  rerenderProjectLists();

  /* ---------- 9. Giscus 评论（GitHub Discussions，仅文章页） ---------- */
  var GISCUS = {
    repo: "xiaohetaoo/xiaohetaoo.github.io",
    repoId: "R_kgDOUHvnPQ",
    category: "Announcements",
    categoryId: "DIC_kwDOUHvnPc4DEhME"
  };
  var giscusBox = document.getElementById("giscus");
  if (giscusBox) {
    var commentsSection = giscusBox.closest(".comments, .section");
    if (GISCUS.categoryId) {
      // 滚到评论区附近才注入脚本，首屏少一个第三方请求
      var injectGiscus = function () {
        var giscusScript = document.createElement("script");
        giscusScript.src = "https://giscus.app/client.js";
        giscusScript.setAttribute("data-repo", GISCUS.repo);
        giscusScript.setAttribute("data-repo-id", GISCUS.repoId);
        giscusScript.setAttribute("data-category", GISCUS.category);
        giscusScript.setAttribute("data-category-id", GISCUS.categoryId);
        giscusScript.setAttribute("data-mapping", "pathname");
        giscusScript.setAttribute("data-strict", "0");
        giscusScript.setAttribute("data-reactions-enabled", "1");
        giscusScript.setAttribute("data-emit-metadata", "0");
        giscusScript.setAttribute("data-input-position", "top");
        giscusScript.setAttribute("data-theme", document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
        giscusScript.setAttribute("data-lang", "zh-CN");
        giscusScript.setAttribute("data-loading", "lazy");
        giscusScript.crossOrigin = "anonymous";
        giscusScript.async = true;
        giscusBox.appendChild(giscusScript);
      };
      if ("IntersectionObserver" in window) {
        var giscusIo = new IntersectionObserver(function (entries) {
          if (entries[0].isIntersecting) {
            giscusIo.disconnect();
            injectGiscus();
          }
        }, { rootMargin: "1200px 0px" });
        giscusIo.observe(giscusBox);
      } else {
        injectGiscus();
      }
      // 评论区跟随站内深浅主题切换（监听主题事件，动画路径下也能拿到切换后的值）
      document.addEventListener("themechange", function (ev) {
        var t = ev.detail && ev.detail.theme === "light" ? "light" : "dark";
        var frame = document.querySelector("iframe.giscus-frame");
        if (frame && frame.contentWindow) {
          frame.contentWindow.postMessage({ giscus: { setConfig: { theme: t } } }, "https://giscus.app");
        }
      });
    } else if (commentsSection) {
      commentsSection.hidden = true;
    }
  }

  /* ---------- 8.5 阅读进度条（仅文章页） ---------- */
  // 顶部 2px 蓝线，rAF 节流 + scaleX 走合成层；只挂 .post-page 存在时
  (function () {
    if (!document.querySelector(".post-page")) return;
    var bar = document.createElement("div");
    bar.className = "reading-progress";
    bar.setAttribute("aria-hidden", "true");
    document.body.appendChild(bar);
    var ticking = false;
    var update = function () {
      var doc = document.documentElement;
      var h = doc.scrollHeight - doc.clientHeight;
      var p = h > 0 ? (window.scrollY / h) * 100 : 0;
      if (p < 0) p = 0; else if (p > 100) p = 100;
      bar.style.transform = "scaleX(" + (p / 100) + ")";
      ticking = false;
    };
    var onScroll = function () {
      if (!ticking) { requestAnimationFrame(update); ticking = true; }
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    update();
  })();

  /* ---------- 7. 文章页侧栏：文章导航 ---------- */
  var sideList = document.getElementById("sidebar-posts");
  if (sideList) {
    loadPosts()
      .then(function (posts) {
        var path = window.location.pathname;
        var root = path.indexOf("/posts/") !== -1 ? ".." : ".";
        sideList.innerHTML = sortPosts(posts)
          .map(function (p) {
            var current = path.indexOf("/" + p.slug + ".html") !== -1;
            return (
              '<a class="side-item' + (current ? " current" : "") + '" href="' + root + "/posts/" + esc(p.slug) + '.html"' +
                (current ? ' aria-current="page"' : "") + ">" +
                '<span class="d">' + esc(p.date) + "</span>" +
                '<span class="t">' + esc(p.title) + "</span>" +
              "</a>"
            );
          })
          .join("");
        // 列表太长时，让当前篇在侧栏里滚到可见位置（nearest 不会牵动整页滚动）
        var currentItem = sideList.querySelector(".side-item.current");
        if (currentItem && currentItem.scrollIntoView) {
          currentItem.scrollIntoView({ block: "nearest" });
        }
      })
      .catch(function () {
        sideList.innerHTML = '<p class="sub">导航加载失败</p>';
      });
  }

  /* ---------- 7.5 文章页右侧目录（自动收集 h2/h3，滚动联动） ---------- */
  // 仅当 .prose 里存在 ≥2 个章节时才生成目录；单章节太短直接跳过
  (function () {
    var prose = document.querySelector(".prose");
    var sideBar = document.querySelector(".post-sidebar");
    if (!prose || !sideBar) return;
    var headings = prose.querySelectorAll("h2, h3");
    if (headings.length < 2) return;

    // 给缺 id 的标题补一个稳定锚点（不覆盖已有 id，如 exist-error 的 ch-0~ch-31）
    var used = {};
    headings.forEach(function (h, i) {
      if (!h.id) {
        var id = "toc-" + i;
        // 极端情况兜底
        while (used[id] || document.getElementById(id)) { id = "toc-" + i + "-" + Object.keys(used).length; }
        h.id = id;
      }
      used[h.id] = true;
    });

    // 目录容器放在「全部文章」链接之前
    var sideAll = sideBar.querySelector(".side-all");
    var tocKick = document.createElement("span");
    tocKick.className = "kicker";
    tocKick.textContent = "$ cat outline";
    var tocList = document.createElement("nav");
    tocList.className = "side-toc";
    tocList.setAttribute("aria-label", "文章目录");
    var html = "";
    headings.forEach(function (h) {
      var level = h.tagName === "H3" ? 3 : 2;
      html += '<a class="toc-h lv-' + level + '" href="#' + esc(h.id) + '">' + esc(h.textContent) + "</a>";
    });
    tocList.innerHTML = html;
    if (sideAll && sideAll.parentNode === sideBar) {
      sideBar.insertBefore(tocKick, sideAll);
      sideBar.insertBefore(tocList, sideAll);
    } else {
      sideBar.appendChild(tocKick);
      sideBar.appendChild(tocList);
    }

    // 平滑滚动（CSS scroll-behavior 已默认 smooth；点击时用 preventDefault 接管以便 focus 当前项）
    tocList.addEventListener("click", function (ev) {
      var a = ev.target.closest && ev.target.closest("a.toc-h");
      if (!a) return;
      var id = a.getAttribute("href").slice(1);
      var target = document.getElementById(id);
      if (!target) return;
      ev.preventDefault();
      target.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" });
      // 更新 hash 但不触发额外跳转
      try { history.replaceState(null, "", "#" + id); } catch (e) {}
    });

    // 滚动联动：进入视口顶部 30% 的章节高亮（避开 reveal 动画阶段，章节可能暂时 translateY 偏移）
    // 滚动节流交给 rAF
    if ("IntersectionObserver" in window) {
      var tocItems = Array.from(tocList.querySelectorAll(".toc-h"));
      var lastCurrent = null;
      var setCurrent = function (id) {
        if (id === lastCurrent) return;
        lastCurrent = id;
        tocItems.forEach(function (a) {
          if (a.getAttribute("href") === "#" + id) a.classList.add("current");
          else a.classList.remove("current");
        });
        // 当前项在目录里滚到可见位置（nearest 不会牵动整页滚动）
        var cur = tocList.querySelector(".toc-h.current");
        if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest" });
      };
      // 顶部时高亮第一个；底部时高亮最后一个
      var visibleMap = {};
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { visibleMap[e.target.id] = e.isIntersecting; });
        // 选第一个"在视口上半部分内"的标题作为 current
        var chosen = null;
        for (var i = 0; i < headings.length; i++) {
          if (visibleMap[headings[i].id]) { chosen = headings[i].id; break; }
        }
        if (!chosen) {
          // 顶部外：选第一个；底部外：选最后一个
          var firstRect = headings[0].getBoundingClientRect();
          var lastRect = headings[headings.length - 1].getBoundingClientRect();
          if (lastRect.bottom < window.innerHeight) chosen = headings[headings.length - 1].id;
          else if (firstRect.top > 0) chosen = headings[0].id;
        }
        if (chosen) setCurrent(chosen);
      }, { rootMargin: "0px 0px -65% 0px", threshold: 0 });
      headings.forEach(function (h) { io.observe(h); });
    }
  })();

  /* ---------- 7.6 文章页文末「推荐阅读」3 篇（按 tag 相似度） ---------- */
  // 注入位置：.post-nav 之后、.comments 之前
  (function () {
    var postNav = document.querySelector(".post-page .post-nav");
    if (!postNav) return;
    var path = window.location.pathname;
    var root = path.indexOf("/posts/") !== -1 ? ".." : ".";
    var currentSlug = (path.match(/\/posts\/([^\/]+)\.html/) || [])[1] || "";
    loadPosts()
      .then(function (posts) {
        var current = posts.find(function (p) { return p.slug === currentSlug; });
        if (!current) return;
        var currentTags = (current.tags || []).map(function (t) { return t.toLowerCase(); });
        var scored = posts
          .filter(function (p) { return p.slug !== currentSlug; })
          .map(function (p) {
            var pt = (p.tags || []).map(function (t) { return t.toLowerCase(); });
            var shared = pt.filter(function (t) { return currentTags.indexOf(t) !== -1; }).length;
            return { p: p, shared: shared };
          });
        // 共享 tag 多 → 排前；同分按日期倒序
        scored.sort(function (a, b) {
          if (b.shared !== a.shared) return b.shared - a.shared;
          return (b.p.date || "").localeCompare(a.p.date || "");
        });
        var top3 = scored.slice(0, 3);
        if (top3.length === 0) return;

        var wrap = document.createElement("section");
        wrap.className = "related";
        wrap.setAttribute("aria-label", "推荐阅读");
        var html = '<div class="related-head"><span class="kicker">$ grep tag:' + esc((current.tags && current.tags[0]) || "") + "</span></div>";
        html += '<div class="related-grid">';
        top3.forEach(function (entry, i) {
          var p = entry.p;
          var tags = (p.tags || []).slice(0, 2).map(function (t) { return '<span class="t">' + esc(t) + "</span>"; }).join("");
          html +=
            '<a class="related-card reveal" href="' + root + "/posts/" + esc(p.slug) + '.html" style="--d:' + (i * 0.05) + 's">' +
              '<span class="date">' + esc(p.date) + "</span>" +
              "<h3>" + esc(p.title) + "</h3>" +
              (tags ? '<div class="tag-row">' + tags + "</div>" : "") +
            "</a>";
        });
        html += "</div>";
        wrap.innerHTML = html;

        // 插在 post-nav 之后；找不到 .comments 时直接跟在 post-nav 后面
        var anchor = postNav.nextElementSibling;
        if (anchor && (anchor.classList.contains("comments") || anchor.tagName === "SECTION")) {
          postNav.parentNode.insertBefore(wrap, anchor);
        } else {
          postNav.parentNode.appendChild(wrap);
        }
        // 触发 reveal 动画
        if (typeof watchReveal === "function") {
          wrap.querySelectorAll(".reveal").forEach(function (el) { watchReveal(el); });
        }
      })
      .catch(function () { /* posts.json 加载失败时静默跳过 */ });
  })();

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
