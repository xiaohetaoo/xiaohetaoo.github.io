/* ============================================================
   节日祝福弹窗（festival.js）
   文案来源：《节日祝福弹窗》定稿（2026-09-25 审核通过，逐字一致）。
   外部实现收录版（20260925a），收录时修了三处：
   ① 预渲染守卫：投机规则会把首页设为「悬停即预渲染」（main.js 10 节），
      预渲染副本里不得执行任何逻辑——尤其不能写「看过」标记，否则访客
      还没真进首页，当天的祝福就永远不弹了。与 9/10 节同款守卫。
   ② 等开场动画：首页开场动画期间 body.inert（main.js 6.7），此刻弹窗
      点不到也关不掉、还会和动画叠在一起（实测复现过）。改为一秒十查，
      等 intro-pending 摘掉且 inert 解除再弹，6 秒兜底。
   ③ 焦点锁：弹窗开着时按口令弹窗同款给 main/nav/footer 挂 inert；
      关闭时同样按规矩还——main 要看搜索/口令弹窗是否开着（它们也可能
      正压着 main），不能无脑摘。
   规则：只在节日当天弹一次；看过就不再弹（localStorage 记 id）。
   预览：?festival=<id> 无视日期和「看过」标记强制弹出，不写标记。
   ?static=1 是全站静态渲染约定（入场动画同款），弹窗一并让路。
   样式自包含（注入 <style>），不改 style.css；配色全部走全站 CSS 变量，
   深色 / 浅色 / cn-red 主题自动跟随，浅色两套主题的阴影单独换暖褐/冷灰。
   ============================================================ */
(function () {
  "use strict";

  /* ---------- 1. 文案数据（date 为核实过的公历日；lunar 只做展示，没有农历说法的留空） ---------- */
  var FESTIVALS = [
    { id: "mid-autumn", name: "中秋节", lunar: "八月十五", date: "2026-09-25",
      text: "中秋快乐！愿你抬头有圆月，低头有月饼，身边有伊人。千里共婵娟，我们云端常相见。" },
    { id: "national-day", name: "国庆节", lunar: "", date: "2026-10-01",
      text: "国庆快乐！祝祖国生日快乐，也祝你假期愉快！" },
    { id: "chuxi", name: "除夕", lunar: "腊月廿九", date: "2027-02-05",
      text: "除夕快乐！旧岁将尽，万事翻篇，我们来年再见！" },
    { id: "chunjie", name: "春节", lunar: "正月初一", date: "2027-02-06",
      text: "新年快乐，所愿皆成。心期不负，万事昌隆。" },
    { id: "yuanxiao", name: "元宵节", lunar: "正月十五", date: "2027-02-20",
      text: "元宵快乐！愿你像碗里的汤圆，日子甜甜糯糯，家人团团圆圆，心事都圆圆满满。" },
    { id: "qingming", name: "清明节", lunar: "", date: "2027-04-05",
      text: "清明安康。遥寄思念，愿故人安歇。" },
    { id: "duanwu", name: "端午节", lunar: "五月初五", date: "2027-06-09",
      text: "端午安康！愿粽叶包住烦恼，糯米粘住好运，日子「粽」是顺利。" },
    { id: "qixi", name: "七夕", lunar: "七月初七", date: "2027-08-08",
      text: "七夕吉宁，有情人成。孤身跋涉，世予温情。" }
  ];

  var STORE_KEY = "xht-festival-greet"; // 存「最近弹过的节日 id」，换节日自动重新具备弹出资格

  /* ---------- 2. 命中判断 ----------
     用本地时区的年月日拼串比较：访客本地是哪天就算哪天，
     避免 UTC 偏移把晚上的祝福弹到第二天（或提前）。 */
  function todayStr() {
    var d = new Date();
    var m = d.getMonth() + 1;
    var day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" + m : m) + "-" + (day < 10 ? "0" + day : day);
  }

  /* 眉线小字：有农历说法用「农历××」，没有就用当年公历「×月×日」 */
  function eyebrowOf(f) {
    if (f.lunar) return "农历" + f.lunar;
    var parts = f.date.split("-");
    return parseInt(parts[1], 10) + "月" + parseInt(parts[2], 10) + "日";
  }

  function pickFestival() {
    var want = (location.search.match(/[?&]festival=([a-z-]+)/) || [])[1];
    if (want) {
      for (var i = 0; i < FESTIVALS.length; i++) {
        if (FESTIVALS[i].id === want) return FESTIVALS[i];
      }
    }
    var today = todayStr();
    for (var j = 0; j < FESTIVALS.length; j++) {
      if (FESTIVALS[j].date === today) return FESTIVALS[j];
    }
    return null;
  }

  function alreadyShown(id) {
    try { return localStorage.getItem(STORE_KEY) === id; } catch (e) { return false; }
  }

  function markShown(id) {
    try { localStorage.setItem(STORE_KEY, id); } catch (e) { /* 隐私模式等：弹就弹了，不记 */ }
  }

  /* ---------- 3. 样式 ----------
     居中构图：眉线小字 → 渐变大标题 → 细分隔线 → 祝福正文；
     顶部用柔光晕替代硬渐变条，标题渐变沿用全站 hero 的三色套路。
     阴影分主题：深色用黑影，浅色/中国红换成各自深色低透明度（同 style.css 卡片做法）。 */
  var CSS =
    ".fst-modal{position:fixed;inset:0;z-index:var(--z-modal);display:flex;align-items:center;" +
    "justify-content:center;padding:16px}" +
    ".fst-modal[hidden]{display:none}" +
    ".fst-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.55);" +
    "backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);cursor:pointer;" +
    "animation:fst-fade .2s var(--ease-out) both}" +
    ".fst-panel{position:relative;isolation:isolate;width:100%;max-width:400px;background:var(--bg-panel);" +
    "border:1px solid var(--border-strong);border-radius:var(--radius-lg);" +
    "padding:34px 30px 28px;text-align:center;overflow:hidden;" +
    "box-shadow:0 24px 70px rgba(0,0,0,.5),0 4px 14px rgba(0,0,0,.28);" +
    "animation:fst-pop .42s var(--ease-spring) both}" +
    ":root[data-theme='light'] .fst-panel{box-shadow:0 18px 50px rgba(16,24,40,.16),0 4px 12px rgba(16,24,40,.08)}" +
    ":root[data-theme='cn-red'] .fst-panel{box-shadow:0 18px 50px rgba(90,30,20,.16),0 4px 12px rgba(90,30,20,.08)}" +
    ".fst-halo{position:absolute;top:-96px;left:50%;transform:translateX(-50%);z-index:-1;" +
    "width:320px;height:200px;border-radius:50%;pointer-events:none;" +
    "background:radial-gradient(closest-side,var(--accent-dim),transparent 72%)}" +
    ".fst-close{position:absolute;top:14px;right:14px;width:30px;height:30px;display:flex;" +
    "align-items:center;justify-content:center;border:1px solid var(--border);border-radius:var(--radius-pill);" +
    "background:none;color:var(--text-3);cursor:pointer;transition:color .15s,border-color .15s,background .15s}" +
    ".fst-close:hover{color:var(--text-1);border-color:var(--border-strong);background:var(--bg-panel-2)}" +
    ".fst-close:focus-visible{outline:2px solid var(--accent);outline-offset:2px}" +
    ".fst-eyebrow{font-size:11px;letter-spacing:.34em;padding-left:.34em;color:var(--text-3)}" +
    ".fst-title{margin:10px 0 0;font-size:30px;font-weight:700;line-height:1.25;letter-spacing:.1em;" +
    "color:var(--text-strong)}" +
    "@supports ((-webkit-background-clip:text) or (background-clip:text)){" +
    ".fst-title{background:linear-gradient(115deg,var(--grad-start),var(--accent-bright) 62%,var(--glow-hi));" +
    "-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent}}" +
    ".fst-rule{width:30px;height:2px;margin:16px auto 14px;border-radius:1px;" +
    "background:linear-gradient(90deg,var(--grad-start),var(--accent))}" +
    ".fst-text{margin:0;font-size:16px;line-height:2.05;color:var(--text-1)}" +
    "@keyframes fst-fade{from{opacity:0}to{opacity:1}}" +
    "@keyframes fst-pop{from{opacity:0;transform:translateY(14px) scale(.96)}to{opacity:1;transform:none}}" +
    "@media (max-width:510px){.fst-modal{padding:12px}.fst-panel{max-width:none;border-radius:var(--radius)}}" +
    "@media (prefers-reduced-motion:reduce){.fst-backdrop,.fst-panel{animation:none}}";

  function injectStyle() {
    var el = document.createElement("style");
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  /* ---------- 4. 弹窗 DOM 与行为 ---------- */
  function buildModal(f) {
    var root = document.createElement("div");
    root.className = "fst-modal";
    root.id = "fst-modal";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", "fst-title");

    /* 结构对齐 key-modal：backdrop 负责点关，panel 承载内容 */
    root.innerHTML =
      '<div class="fst-backdrop" data-fst-close></div>' +
      '<div class="fst-panel" role="document">' +
      '<div class="fst-halo" aria-hidden="true"></div>' +
      '<button class="fst-close" type="button" aria-label="关闭" data-fst-close>' +
      '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>' +
      "</button>" +
      '<div class="fst-eyebrow"></div>' +
      '<h2 class="fst-title" id="fst-title"></h2>' +
      '<div class="fst-rule" aria-hidden="true"></div>' +
      '<p class="fst-text"></p>' +
      "</div>";

    root.querySelector(".fst-eyebrow").textContent = eyebrowOf(f);
    root.querySelector(".fst-title").textContent = f.name;
    root.querySelector(".fst-text").textContent = f.text;
    return root;
  }

  function open(f) {
    if (document.getElementById("fst-modal")) return; // 防重复注入（脚本被引两次等）

    injectStyle();
    var root = buildModal(f);
    document.body.appendChild(root);

    /* 焦点锁（对齐 key-modal）：main/nav/footer 全部锁住，键盘焦点出不去；
       弹窗自身在 body 直下、不在被锁子树里，close 按钮照常可聚焦可点。 */
    var mainEl = document.querySelector("main");
    var navEl = document.querySelector("header.nav");
    var footerEl = document.querySelector("footer.footer");
    if (mainEl) mainEl.setAttribute("inert", "");
    if (navEl) navEl.setAttribute("inert", "");
    if (footerEl) footerEl.setAttribute("inert", "");

    var prevFocus = document.activeElement;
    var closeBtn = root.querySelector(".fst-close");
    if (closeBtn) closeBtn.focus();

    function close() {
      root.hidden = true;
      root.remove();
      document.removeEventListener("keydown", onKey);
      /* 还锁要看脸色（与 key-modal 关闭同款）：main 可能正被搜索面板或
         口令弹窗压着——它们先来，就替它们保留；nav/footer 只有本弹窗会锁。 */
      var keyModal = document.getElementById("key-modal");
      var searchOpen = !!document.querySelector(".nav-links.nav-search-open");
      if (mainEl && !searchOpen && (!keyModal || keyModal.hidden)) mainEl.removeAttribute("inert");
      if (navEl) navEl.removeAttribute("inert");
      if (footerEl) footerEl.removeAttribute("inert");
      if (prevFocus && prevFocus.focus) prevFocus.focus();
    }
    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    }

    root.addEventListener("click", function (e) {
      if (e.target.closest("[data-fst-close]")) close();
    });
    document.addEventListener("keydown", onKey);

    /* 预览模式不写「看过」标记：刷新还能再弹，方便逐个节日过一遍。
       此刻开场动画已结束、弹窗真实可见可关，「打开即算看过」成立。 */
    if (!(location.search.match(/[?&]festival=/))) markShown(f.id);
  }

  /* ---------- 5. 等开场动画播完（main.js 6.7 的 finish 会摘 intro-pending 并解除 inert） ---------- */
  function waitIntroDone(fn) {
    var tries = 0;
    (function check() {
      var busy = document.documentElement.classList.contains("intro-pending") || document.body.inert === true;
      if (!busy || ++tries > 60) { fn(); return; } // 6 秒兜底：动画卡死也照弹，不让祝福失踪
      setTimeout(check, 100);
    })();
  }

  /* ---------- 6. 入口 ---------- */
  function boot() {
    if (/[?&]static(?:=1)?(?=&|$)/.test(location.search)) return; // 静态渲染约定：不弹
    var f = pickFestival();
    if (!f) return;
    var preview = !!location.search.match(/[?&]festival=/);
    if (!preview && alreadyShown(f.id)) return;
    waitIntroDone(function () { open(f); });
  }

  /* 预渲染守卫：副本里什么都不做（尤其不写「看过」），真被点开（prerenderingchange）
     再照常跑一遍——日期也按「被点开那天」重新算。 */
  if (document.prerendering) {
    document.addEventListener("prerenderingchange", boot, { once: true });
  } else if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
