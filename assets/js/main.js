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
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  };

  // 同一页面多处列表共用一次请求；文章页在 /posts/ 子目录，要回到站点根再取
  var postsCache = null;
  function loadPosts() {
    if (!postsCache) {
      var root = window.location.pathname.indexOf("/posts/") !== -1 ? ".." : ".";
      postsCache = fetch(root + "/posts.json").then(function (r) { return r.json(); });
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
    var delay = ' style="--d:' + Math.min(i * 0.08, 0.48).toFixed(2) + 's"';
    var icon = PROJECT_ICONS[p.icon] || PROJECT_ICONS.cube;
    var inner =
      '<div class="p-icon" aria-hidden="true">' + icon + "</div>" +
      "<h3>" + esc(p.title) + '<span class="p-date">' + esc(p.date) + "</span></h3>" +
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
      projectsCache = fetch("projects.json").then(function (r) { return r.json(); });
    }
    return projectsCache;
  }

  function sortProjects(projects) {
    // 置顶优先，组内保持 json 里的书写顺序（稳定排序）
    return projects.slice().sort(function (a, b) {
      if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
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
      })
      .catch(function () {
        sideList.innerHTML = '<p class="sub">导航加载失败</p>';
      });
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
