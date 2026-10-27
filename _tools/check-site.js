/**
 * 小核桃博客 · 站点一致性自检（发布前必跑）
 * 用法：node D:\zcode\web\_tools\check-site.js（或 cd web 后 node _tools/check-site.js）
 * 位置：脚本自 2026-10-17 起住在 web/_tools/ 并入库——放 `_` 开头目录是刻意的：
 *       GitHub Pages 跑 Jekyll，会跳过 `_` 开头的文件/目录，所以它随仓库走、但不会被发布到站上。
 * 全绿才 commit。覆盖 24 道门禁（2026-10-17 审查批从 19 扩到 24，并加固 13 处旧漏洞；
 * 加固口径经 _mutate-gates.js 变异测试验证：17 拦下 / 0 逃逸 / 5 应通过）：
 *   0. 必需文件存在性（缺文件转成具名 FAIL，不再抛 Node 栈）
 *   1. 版本三件套（DATA_VER == 全部 HTML 的 ?v=；?v= 正则统一、外链排除、
 *      空值拦下、每页至少一个站内 ?v=——自包含页与 _template 豁免）
 *   2. 全部 JSON-LD 可解析（type 属性支持单/双引号与额外属性）
 *   3. 文章数链：posts.json / feed.xml / sitemap / posts 页数 / index+archive noscript
 *      （noscript 按解析后路径分类，绝对根 /posts/ 也认；嵌套 li 不虚增）
 *   4. 项目数链：projects.json / projects.html ItemList / sitemap #p= / index+projects noscript
 *      （noscript 顺序 == sortProjects；标题解码 HTML 实体）
 *   5. ItemList 顺序（含 position 连续）== sortProjects 显示序
 *   6. sitemap 文章 slug 集合、项目锚点集合、<loc> 无重复、顶层 9 页齐全、总数
 *   7. 每篇文章 post-nav 静态链 == sortPosts 邻居（含首/末篇 ghost；nav 恰好一个、
 *      class 允许多值、href 认 ../posts/ 等价写法）
 *   8. feed.xml 结构：根子元素白名单 + 游离文本 0 + 标签配对正确（xmlScan 标签栈，
 *      剥注释与 CDATA，带属性 <entry> 认）
 *   9. sitemap.xml 良构（同一套 xmlScan）+ lastmod 全为真实日期（2026-02-31 拦下）
 *   10. 占位符残留扫描（@@ / {{ / __DATA_VER__ / FIXME / PLACEHOLDER_ / REPLACE_ME；
 *      扩展名含 .mjs/.md/.svg/.yml 与 CNAME 等无扩展名文件；本脚本按全路径豁免）
 *   10.5 模板占位残留（TODO / __SLUG__ / __DATE__ 等，posts/ 已发布页 0 命中）
 *   11. feed entry 级：必备子元素齐全、id==link、category == posts.json tags
 *   12. sitemap 文章条目 lastmod 数值 == updated||date（修订上浮口径）
 *   13. 站内 stylesheet/script 引用必须带 ?v=（rel 支持单/双/无引号与多值、
 *      preload as=style、@import）
 *   14. 内链死链：href/src/poster/srcset 指向的站内文件必须存在（单引号也查、
 *      百分号解码、跳过 javascript:/tel:、目录型要求真有 index.html）
 *   15. 根目录 HTML 全部登记进 TOP（漏登记 = 绕过 1/2 两道门）
 *   16. relatedPost 一致性（slug ∈ posts.json、页面文件真实存在、title 必填且与文章
 *      一致、带 relatedPost 必须有 href）+ 项目标题唯一
 *   17. posts.json 每条 slug 都有对应页面文件（JSON↔磁盘双射）
 *   18. posts.json 日期真实且 updated >= date
 *   19. SEO 头字段矩阵：canonical 按路径自指 / og:url 一致 / og·twitter·title 三者同值 /
 *      robots 白名单（只允许 404/birthday/huiyan）
 *   19b. 文章页 Article JSON-LD 的 datePublished/dateModified == posts.json 的 date/updated‖date
 *   20. 404 专项：window.XHT_AT_404 与 main.js 消费端耦合齐全 + 站内引用全绝对路径
 *   21. 页面结构：每页恰 1 个 h1 + id 全页唯一 + head 内无游离文本
 *   22. 数据完整性：feed 的 title/summary == posts.json + 项目字段齐全（date/icon/desc/tags）
 *   22b. sitemap 非文章条目 lastmod 不早于内容日期（项目锚点 + 顶层页，方案 B 方向性）
 *   23. 列表结构：<li> 开闭配对 + 无连续重复开标签 + 相邻 li 内容重复 + 无空列表容器
 *      （2026-10-21 补：updates.html 曾出现连续两个 upd-item 开标签并已上线，第 21 道
 *      只查 h1/id/head 文本，完全不看列表配对 → 补这道。阳性对照见
 *      tools/_mutate-list-gate.js：5 拦 0 逃 0 误报）
 */
const fs = require('fs');
const path = require('path');

// 门禁自身住在 web/_tools/：WEB 要指回站点根（上一级），不是脚本所在目录
const WEB = path.join(__dirname, '..');
// 带缓存的读文件：同一文件会被多道门禁各读一遍（百余次 readFileSync → 约 40 次），
// 运行期间文件不变，缓存零风险。
// 缺文件守卫：原先任何必需文件被删/改名都会从 read() 抛原始 Node 栈（node:fs:484），
// 操作员看到的是堆栈而不是「哪道门禁挂了」；这里统一转成一个具名门禁失败项。
const _readCache = new Map();
const _missing = new Set();
const read = (f) => {
  if (_missing.has(f)) return '';
  if (!_readCache.has(f)) {
    try {
      _readCache.set(f, fs.readFileSync(path.join(WEB, f), 'utf8'));
    } catch (e) {
      _missing.add(f);
      return '';
    }
  }
  return _readCache.get(f);
};
const readJSON = (f) => {
  const raw = read(f);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
};

// 共用正则单点定义（口径强制一致）；共用 /g 正则跨循环复用要在每轮前清 lastIndex，
// itemList 提前 return 前也要清——否则下一个消费方从残留位置接着扫。
// type 属性允许任意额外属性与单/双引号：`<script id="ld" type='application/ld+json'>`
// 原先整段扫不到（gate 2 可被一个属性绕过）
const LD_RE = /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

// 顶层页清单：updates.html 与 birthday.html 2026-10-05 起纳入——此前漏登记，两页的
// JSON-LD 无人校验、?v= 漂移会静默逃逸（birthday 无 ?v=，门禁 1 零命中无害；404 在列但不入 sitemap，属有意）
const TOP = ['index.html', 'archive.html', 'projects.html', 'updates.html', '404.html', 'about.html',
  'birthday.html', 'teacher-primary.html', 'teacher-junior.html', 'teacher-senior.html', 'huiyan-shisi.html'];
const POST_PAGES = (() => {
  try {
    return fs
      .readdirSync(path.join(WEB, 'posts'))
      .filter((f) => f.endsWith('.html') && !f.startsWith('_'))
      .map((f) => 'posts/' + f);
  } catch (e) {
    return []; // posts/ 目录缺失：由文件存在门禁报出，不在这里抛栈
  }
})();

// 必需文件清单：任一缺失即 FAIL（而不是抛栈）
const REQUIRED_FILES = ['index.html', 'archive.html', 'projects.html', '404.html', 'about.html',
  'updates.html', 'posts.json', 'projects.json', 'feed.xml', 'sitemap.xml', 'robots.txt',
  'assets/js/main.js', 'assets/css/style.css', 'posts/_template.html'];

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log('  \u2713 ' + name);
  } else {
    fail++;
    console.log('  \u2717 ' + name + (detail ? ' \u2014 ' + detail : ''));
  }
}

function sortPosts(list) {
  // 与 main.js sortPosts 同步：排序键 = updated（最后修订日）回落 date（2026-10-05 起）；
  // 置顶次序 2026-10-27 起由 pinOrder 决定（1 = 最前），无号的置顶排在有号之后
  const key = (p) => p.updated || p.date;
  const rank = (p) => (typeof p.pinOrder === 'number' ? p.pinOrder : Infinity);
  return list.slice().sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    if (a.pinned && b.pinned && rank(a) !== rank(b)) return rank(a) < rank(b) ? -1 : 1;
    return key(b).localeCompare(key(a)) || b.date.localeCompare(a.date);
  });
}
function sortProjects(list) {
  return list.slice().sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
    if (!a.pinned) return b.date.localeCompare(a.date);
    return 0;
  });
}

// noscript 回退列表：<ul class="fallback-list">，按 href 前缀区分文章/项目。
// postHrefs/projectHrefs 保留书写序，给门禁 3 的「顺序 == sortPosts」断言用。
// 2026-10-11 加固（变异测试复现）：
//   a) 分类判据从 `href="(\.\./)?posts/` 改为「href 解析后是否指向 posts/」——
//      旧式认不出绝对根 `/posts/x.html`，会把文章列表整块算成项目列表
//      （index-ns 从 17 掉到 0、28 项全进 projects，方向完全反了）
//   b) li 计数改用「只数含链接的顶层 li」：嵌套 <ul> 里的 li 会把条数虚增
//   c) href 支持单引号与无引号写法
const HREF_RE = /href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
function hrefsOf(fragment) {
  return [...fragment.matchAll(HREF_RE)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');
}
function isPostHref(h) {
  const clean = h.split('#')[0].split('?')[0];
  return /^(?:\.\.\/|\.\/|\/)?posts\//.test(clean);
}
function fallbackCounts(html) {
  const out = { posts: 0, projects: 0, postHrefs: [], projectHrefs: [] };
  const re = /<ul class="fallback-list">([\s\S]*?)<\/ul>/g;
  let m;
  while ((m = re.exec(html))) {
    const body = m[1];
    const hrefs = hrefsOf(body);
    // 数「顶层 li」：嵌套 <ul> 里的 li 会把条数虚增，故排除嵌套层；
    // 但不要求 li 必须含链接——项目「粒子轨道可视化」是有意的纯文本项（指向本站首页，无 href）
    const lis = [...body.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)];
    const n = lis.filter((li) => !/<ul\b/.test(li[1]) || !/<li\b/.test(li[1])).length;
    if (hrefs.some(isPostHref)) { out.posts += n; out.postHrefs.push(...hrefs); }
    else { out.projects += n; out.projectHrefs.push(...hrefs); }
  }
  return out;
}

// 项目 noscript 兜底列表的标题书写序（gate 4 顺序断言用）：li 去标签、解码实体、剥「 · 本站首页」尾巴。
// 实体解码是 2026-10-11 补的：旧版只去标签不解码，标题里出现 `&amp;` 会与
// projects.json 的原始 `&` 对不上，报出假失败
function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&'); // &amp; 必须最后解，避免二次解码
}
function nsProjectTitles(html) {
  const out = [];
  const re = /<ul class="fallback-list">([\s\S]*?)<\/ul>/g;
  let m;
  while ((m = re.exec(html))) {
    if (hrefsOf(m[1]).some(isPostHref)) continue; // 文章列表归 gate 3
    for (const li of m[1].match(/<li[^>]*>[\s\S]*?<\/li>/g) || []) {
      out.push(decodeEntities(li.replace(/<[^>]+>/g, '')).replace(/\s*·[\s\S]*$/, '').trim());
    }
  }
  return out;
}

function itemList(html) {
  LD_RE.lastIndex = 0;
  let m;
  while ((m = LD_RE.exec(html))) {
    let o;
    try {
      o = JSON.parse(m[1]);
    } catch (e) {
      continue;
    }
    if (o && o['@type'] === 'ItemList' && Array.isArray(o.itemListElement)) {
      LD_RE.lastIndex = 0; // 提前 return 前复位，共用正则的下一个消费方不被残留 lastIndex 坑
      return o.itemListElement;
    }
  }
  return null;
}

console.log('== 小核桃博客 · 站点一致性自检 ==\n');

// 0. 必需文件存在性（新增门禁）：原先缺任何一个必需文件都从 read() 抛原始栈，
//    操作员看到 node:fs 堆栈而不是具名门禁失败；posts/ 目录缺失更是在模块顶层就抛。
//    这道门禁把「文件没了」变成一个可读的 FAIL 项，且排在所有门禁最前面。
const missingFiles = REQUIRED_FILES.filter((f) => !fs.existsSync(path.join(WEB, f)));
if (!fs.existsSync(path.join(WEB, 'posts'))) missingFiles.push('posts/（目录）');
check('必需文件齐全（' + REQUIRED_FILES.length + ' 项 + posts/ 目录）', missingFiles.length === 0,
  '缺失: ' + missingFiles.join(', '));

// 1. 版本三件套（只扫 link/script 标签的 href/src：正文文本或外链里出现「?v=」字样
//    不该卷进版本集合——全文扫是把整份 HTML 当 haystack 的理论误报源，2026-10-07 收紧）
//    2026-10-11 加固三处（均经变异测试复现）：
//      a) ?v= 捕获从 [A-Za-z0-9_]+ 改为 [^"&'\s]+：旧式在连字符处截断，
//         `?v=<当前版本>-beta` 会被读成 `<当前版本>` 而通过
//         （示例里一律写 <当前版本> 占位、不写版本号字面量——否则每次升号的裸替换都会
//          把这里的示例一起改掉、假造历史；同类注释已全部改成日期或占位）
//      b) 空值 ?v= 不再静默跳过，记为坏值（缓存戳写了等于没写）
//      c) 外链（http/https/protocol-relative）不参与版本集合——旧注释声称排除、
//         代码却没排除，一个 CDN 的 ?v=2.0.1 会让门禁假失败
//      d) 新增「每个页面至少有一个站内 ?v= 引用」断言：旧口径只看全局集合，
//         整页被剥掉全部资源引用也能通过
const dataVer = (read('assets/js/main.js').match(/DATA_VER\s*=\s*"([^"]+)"/) || [])[1];
const verFiles = [...TOP, ...POST_PAGES, 'posts/_template.html'];
const verSet = new Set();
const verBad = [];
const verNoRef = [];
const VER_RE = /\?v=([^"&'\s]*)/;
for (const f of verFiles) {
  const html = read(f);
  if (!html) continue; // 缺文件由门禁 0 报出
  const refs = [];
  for (const m of html.matchAll(/<link\b[^>]*>/g)) {
    const s = m[0].match(/\shref\s*=\s*["']([^"']+)["']/);
    if (s) refs.push(s[1]);
  }
  for (const m of html.matchAll(/<script\b[^>]*>/g)) {
    const s = m[0].match(/\ssrc\s*=\s*["']([^"']+)["']/);
    if (s) refs.push(s[1]);
  }
  let internalHits = 0;
  for (const r of refs) {
    if (/^(https?:)?\/\//.test(r) || r.indexOf('data:') === 0) continue; // 外链/内联不归缓存戳管
    const m = r.match(VER_RE);
    if (!m) continue;
    if (m[1] === '__DATA_VER__') { internalHits++; continue; } // 计划中的 _novel_shell 预留
    if (!m[1]) { verBad.push(f + '=空值'); continue; }        // 空 ?v=：缓存戳无效
    internalHits++;
    verSet.add(m[1]);
    if (m[1] !== dataVer) verBad.push(f + '=' + m[1]);
  }
  // _template 允许无引用（它是模板）；自包含页（birthday/teacher×3/huiyan）按设计
  // 不引 style.css/main.js、无 ?v= 体系，同样豁免；其余页面必须至少一个站内 ?v=
  const NO_VER_OK = new Set(['posts/_template.html', 'birthday.html', 'teacher-primary.html',
    'teacher-junior.html', 'teacher-senior.html', 'huiyan-shisi.html']);
  if (!internalHits && !NO_VER_OK.has(f)) verNoRef.push(f);
}
check(
  '版本三件套：DATA_VER=' + dataVer + '，HTML ?v=' + ([...verSet].join('/') || '(无)'),
  !!dataVer && verSet.size === 1 && verSet.has(dataVer) && verBad.length === 0 && verNoRef.length === 0,
  [verBad.join(', '), verNoRef.length ? '缺站内 ?v= 的页面: ' + verNoRef.join(', ') : ''].filter(Boolean).join(' | ')
);

// 2. JSON-LD 可解析
const ldBad = [];
for (const f of verFiles) {
  LD_RE.lastIndex = 0;
  let m;
  const html = read(f);
  if (!html) continue;
  while ((m = LD_RE.exec(html))) {
    try {
      JSON.parse(m[1]);
    } catch (e) {
      ldBad.push(f + ': ' + e.message);
    }
  }
}
check('JSON-LD 全部可解析', ldBad.length === 0, ldBad.join(' | '));

const posts = readJSON('posts.json') || [];
const projects = readJSON('projects.json') || [];
// 数 <entry> 前先剥注释与 CDATA（两者内部出现 <entry> 字样都不该虚增计数）。
// 2026-10-11 加固：`<entry>` 允许带属性（`<entry xml:lang="zh">` 旧式数不到，
// 直接假失败 17→16）；自闭合 `<entry/>` 不计入——它没有内容，由 gate 11 单独拦。
const feedCleanForCount = read('feed.xml')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
const feedEntries = (feedCleanForCount.match(/<entry(?:\s[^>]*)?>/g) || []).length;
const feedSelfClosed = (feedCleanForCount.match(/<entry\s*\/>/g) || []).length;
const sitemapLocs = [...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
const sitemapPosts = sitemapLocs.filter((u) => u.includes('/posts/'));
const sitemapProjects = sitemapLocs.filter((u) => u.includes('#p='));
const idxNs = fallbackCounts(read('index.html'));
const arcNs = fallbackCounts(read('archive.html'));
const prjNs = fallbackCounts(read('projects.html'));

// 3. 文章数链 + noscript 顺序：fallback 列表书写序 == sortPosts 显示序（修订上浮/
//    新文章插入后忘了同步 noscript 在这里拦下——2026-10-07 起「只数条数」升级为查顺序）
const nsSlug = (h) => (h.match(/posts\/([^\/?#]+)\.html/) || [])[1] || '';
const wantNsSlugs = sortPosts(posts).map((p) => p.slug);
const nsOrderOk =
  JSON.stringify(idxNs.postHrefs.map(nsSlug)) === JSON.stringify(wantNsSlugs) &&
  JSON.stringify(arcNs.postHrefs.map(nsSlug)) === JSON.stringify(wantNsSlugs);
check(
  '文章数链：json ' + posts.length + ' / feed ' + feedEntries + ' / sitemap ' + sitemapPosts.length +
    ' / 页面 ' + POST_PAGES.length + ' / index-ns ' + idxNs.posts + ' / archive-ns ' + arcNs.posts +
    '，noscript 顺序 == sortPosts',
  posts.length === feedEntries &&
    feedSelfClosed === 0 &&
    posts.length === sitemapPosts.length &&
    posts.length === POST_PAGES.length &&
    posts.length === idxNs.posts &&
    posts.length === arcNs.posts &&
    nsOrderOk,
  'index-ns 序 [' + idxNs.postHrefs.map(nsSlug).slice(0, 4).join(',') + '…] / archive-ns 序 [' +
    arcNs.postHrefs.map(nsSlug).slice(0, 4).join(',') + '…] / 期望前 4 [' + wantNsSlugs.slice(0, 4).join(',') + '…]'
);

// 4. 项目数链 + noscript 顺序（2026-10-11 从「只数条数」升级为查顺序，与 gate 3 同款）
const il = itemList(read('projects.html'));
const ilNames = il ? il.map((x) => x.name) : [];
const wantProjNs = sortProjects(projects).map((p) => p.title);
const idxProjNs = nsProjectTitles(read('index.html'));
const prjProjNs = nsProjectTitles(read('projects.html'));
const projNsOrderOk =
  JSON.stringify(idxProjNs) === JSON.stringify(wantProjNs) &&
  JSON.stringify(prjProjNs) === JSON.stringify(wantProjNs);
check(
  '项目数链：json ' + projects.length + ' / ItemList ' + ilNames.length + ' / sitemap ' + sitemapProjects.length +
    ' / index-ns ' + idxNs.projects + ' / projects-ns ' + prjNs.projects + '，noscript 顺序 == sortProjects',
  projects.length === ilNames.length &&
    projects.length === sitemapProjects.length &&
    projects.length === idxNs.projects &&
    projects.length === prjNs.projects &&
    projNsOrderOk,
  'index-ns 序 [' + idxProjNs.slice(0, 4).join(',') + '…] / projects-ns 序 [' + prjProjNs.slice(0, 4).join(',') + '…] / 期望前 4 [' + wantProjNs.slice(0, 4).join(',') + '…]'
);

// 5. ItemList 顺序 + position 连续
const expectProj = sortProjects(projects).map((p) => p.title);
const posOk = !!il && il.every((x, i) => x.position === i + 1);
check(
  'ItemList 顺序 == sortProjects',
  JSON.stringify(ilNames) === JSON.stringify(expectProj) && posOk,
  '实际 [' + ilNames.join(' → ') + '] / 期望 [' + expectProj.join(' → ') + ']' + (posOk ? '' : ' / position 不连续')
);

// 6. sitemap 集合与总数
// 2026-10-11 加固：改用「显式期望集」而不是「size + 成员」——
// 旧口径下把一个顶层页的 <loc> 换成另一页的重复项（如 about.html → 再写一遍
// updates.html），总数仍是 37、两个集合比较也都过，about 就此从 sitemap 消失却无人发现。
// 现在另外比对「<loc> 本身必须两两不同」与「9 个顶层页必须逐个在列」。
const TOP_IN_SITEMAP = ['/', '/archive.html', '/projects.html', '/about.html', '/updates.html',
  '/teacher-primary.html', '/teacher-junior.html', '/teacher-senior.html', '/huiyan-shisi.html'];
const slugs = new Set(posts.map((p) => p.slug));
const locSlugs = new Set(sitemapPosts.map((u) => u.split('/posts/')[1].replace(/\.html$/, '')));
const titles = new Set(projects.map((p) => p.title));
// 坏百分号编码（如被截断的 %E5）不该崩掉整个校验器：按原串入集，随后以集合不等 FAIL
const locTitles = new Set(
  sitemapProjects.map((u) => {
    try { return decodeURIComponent(u.split('#p=')[1]); } catch (e) { return u; }
  })
);
check(
  'sitemap 文章集合 == posts.json',
  slugs.size === locSlugs.size && [...slugs].every((s) => locSlugs.has(s)),
  [...locSlugs].filter((s) => !slugs.has(s)).join(', ')
);
check(
  'sitemap 项目锚点集合 == projects.json',
  titles.size === locTitles.size && [...titles].every((t) => locTitles.has(t)),
  [...locTitles].filter((t) => !titles.has(t)).join(', ')
);
// <loc> 两两不同（重复项会静默顶替被删掉的那一条）
const dupLocs = sitemapLocs.filter((u, i) => sitemapLocs.indexOf(u) !== i);
check('sitemap <loc> 无重复', dupLocs.length === 0, [...new Set(dupLocs)].join(', '));
// 9 个顶层页逐个在列（旧口径只查总数，某页被换成幽灵 URL 也能过）
const topPaths = new Set(
  sitemapLocs
    .filter((u) => !u.includes('/posts/') && !u.includes('#p='))
    .map((u) => {
      try { return new URL(u).pathname; } catch (e) { return u; }
    })
);
const missingTop = TOP_IN_SITEMAP.filter((p) => !topPaths.has(p));
check('sitemap 顶层 9 页齐全', missingTop.length === 0, '缺: ' + missingTop.join(', '));
// 9 个顶层页在 sitemap 里（index / archive / projects / about / updates / 三张恩师画页 / 慧眼识私），404 不入 sitemap
check(
  'sitemap 总数 ' + sitemapLocs.length + ' == 9 + ' + posts.length + ' + ' + projects.length,
  sitemapLocs.length === 9 + posts.length + projects.length
);

// 7. post-nav 静态链
// 2026-10-11 加固：nav 用「全部匹配」而不是只取第一个——旧式只看第一个 nav，
// 页面里多出一个链接写错的 nav 块完全逃逸；class 写成 `post-nav wide` / 单引号
// 也要认。href 允许 `../posts/x.html` 等价写法。
const order = sortPosts(posts);
const navBad = [];
const NAV_RE = /<nav\b[^>]*class\s*=\s*["'][^"']*\bpost-nav\b[^"']*["'][^>]*>([\s\S]*?)<\/nav>/g;
for (let i = 0; i < order.length; i++) {
  const p = order[i];
  const html = read('posts/' + p.slug + '.html');
  const navs = [...html.matchAll(NAV_RE)];
  if (navs.length !== 1) {
    navBad.push(p.slug + ' post-nav 块数=' + navs.length + '（应恰好 1）');
    continue;
  }
  const nav = navs[0][1];
  const anchors = [...nav.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({ attrs: m[1], inner: m[2] }));
  if (anchors.length !== 2) {
    navBad.push(p.slug + ' 锚点数=' + anchors.length);
    continue;
  }
  // attrs 允许单引号；href 归一化到「slug.html」再比较，`../posts/x.html`
  // 与 `x.html` 视为等价（旧式只认后者，合法写法会假失败）
  const attrOf = (attrs, name) => {
    const m = attrs.match(new RegExp(name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i'));
    return m ? (m[1] ?? m[2] ?? m[3] ?? '') : '';
  };
  const normHref = (h) => {
    const clean = (h || '').split('#')[0].split('?')[0];
    const m = clean.match(/([^/]+\.html)$/);
    return m ? m[1] : clean;
  };
  const parse = (a) => ({
    href: normHref(attrOf(a.attrs, 'href')),
    raw: attrOf(a.attrs, 'href'),
    cls: attrOf(a.attrs, 'class'),
    text: (a.inner.match(/<span class=["']t["']>([^<]*)<\/span>/) || [])[1],
  });
  const prev = parse(anchors[0]);
  const next = parse(anchors[1]);
  const expPrev = order[i - 1];
  const expNext = order[i + 1];
  if (expPrev) {
    if (prev.href !== expPrev.slug + '.html' || prev.text !== expPrev.title)
      navBad.push(p.slug + ' 上一篇应为 ' + expPrev.slug + '，实际 ' + prev.raw);
  } else if (prev.href !== 'index.html' || !/ghost/.test(prev.cls) || prev.text !== '这是最新的一篇') {
    navBad.push(p.slug + ' 首篇 prev 应为 ghost（实际 ' + prev.raw + '/' + prev.text + '）');
  }
  if (expNext) {
    if (next.href !== expNext.slug + '.html' || next.text !== expNext.title || !/\bnext\b/.test(next.cls))
      navBad.push(p.slug + ' 下一篇应为 ' + expNext.slug + '，实际 ' + next.raw);
  } else if (next.href !== 'index.html' || !/ghost/.test(next.cls) || !/\bnext\b/.test(next.cls) || next.text !== '还没有下一篇') {
    navBad.push(p.slug + ' 末篇 next 应为 next ghost（实际 ' + next.raw + '/' + next.text + '）');
  }
}
check('post-nav 静态链 == sortPosts 邻居（' + order.length + ' 篇）', navBad.length === 0, navBad.slice(0, 6).join(' | '));

// 8. feed.xml 结构门禁：根下只允许白名单子元素、根层级禁止游离文本。
//    背景：@@ITEMS@@ 模板占位符 2026-09-27 起在 feed 尾部挂了 4 天，只数 <entry> 个数的旧检查抓不到。
//    2026-10-11 重写（旧实现经变异测试暴露 5 个漏洞）：
//      a) 旧版只数深度，从不核对闭合标签名 → `</priorityx>` 照样通过「良构」门禁
//      b) 旧版先算边界再剥注释：注释里出现 `<feed>` / `</feed>` 会让边界错位
//      c) CDATA 未剥离：CDATA 里出现 `<entry>` 会虚增条数
//      d) 属性里含 `>` 会让标签正则错位
//      e) `<entry xml:lang="zh">` 与 `<entry/>` 在旧口径下不可见
//    新实现：先剥注释与 CDATA，再用「标签栈」逐标签核对闭合名，顺带收集根的直接子元素与根层游离文本。
const FEED_KIDS = ['title', 'subtitle', 'link', 'id', 'updated', 'author', 'generator', 'rights', 'entry'];

/* 轻量 XML 结构扫描：返回 { kids, stray, mismatched }。
   kids      = 根元素的直接子元素名（按出现序，带属性的也算）
   stray     = 根层级的游离文本（压缩空白后应为空串）
   mismatched= 闭合标签名不匹配的记录（如 <priority></priorityx>）
   非真 XML 解析器：只覆盖本站自有的、结构可控的 feed/sitemap。 */
function xmlScan(xml, rootTag) {
  if (!xml) return null;
  // 先剥离注释与 CDATA：两者内部都可能出现形似标签的文本
  let s = xml.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  // 标签正则：属性值允许单/双引号（含 > 也 OK，因为引号内整体匹配）
  const TAG_RE = /<(\/?)([A-Za-z_][\w.:-]*)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  const stack = [];
  const kids = [];
  const mismatched = [];
  let stray = '';
  let seenRoot = false;
  let rootDepth = -1;
  let lastEnd = 0;
  let m;
  while ((m = TAG_RE.exec(s))) {
    const closing = m[1] === '/';
    const name = m[2];
    const selfClose = m[4] === '/';
    if (!seenRoot) {
      if (closing || name !== rootTag || selfClose) continue;
      seenRoot = true;
      stack.push(name);
      rootDepth = 1;
      lastEnd = TAG_RE.lastIndex;
      continue;
    }
    if (closing) {
      const top = stack.pop();
      if (top !== name) mismatched.push('</' + name + '> 关了 <' + top + '>');
      // 关掉根元素（栈空）即结束扫描：根闭合标签本身不是游离文本
      if (stack.length === 0) { lastEnd = TAG_RE.lastIndex; break; }
    } else {
      if (stack.length === rootDepth) { kids.push(name); stray += s.slice(lastEnd, m.index); }
      if (!selfClose) stack.push(name);
    }
    if (stack.length === rootDepth) lastEnd = TAG_RE.lastIndex;
  }
  if (seenRoot && stack.length > 0) mismatched.push('未闭合: ' + stack.join(','));
  // 只有正常走到根闭合（栈空）才继续追加尾部文本；提前 break 时 lastEnd 已指向根闭合之后
  stray += s.slice(lastEnd);
  return { kids, stray: stray.replace(/\s+/g, ''), mismatched };
}
const feedScan = xmlScan(read('feed.xml'), 'feed');
const feedBadKids = feedScan ? feedScan.kids.filter((k) => !FEED_KIDS.includes(k)) : [];
check(
  'feed.xml 结构：根子元素 ' + (feedScan ? feedScan.kids.length : 0) + ' 个全在白名单、游离文本 0、标签配对正确',
  !!feedScan && feedScan.stray === '' && feedBadKids.length === 0 && feedScan.mismatched.length === 0,
  feedScan
    ? [feedBadKids.length ? '白名单外 [' + feedBadKids.join(',') + ']' : '',
       feedScan.mismatched.length ? '配对错误 [' + feedScan.mismatched.slice(0, 3).join(';') + ']' : '',
       feedScan.stray ? '游离文本 ' + JSON.stringify(feedScan.stray.slice(0, 60)) : ''].filter(Boolean).join(' / ')
    : 'feed 根元素未找到'
);

// 9. sitemap.xml 良构 + lastmod 格式合法（数值校验：文章条目在门禁 12 == updated||date；
//    项目/顶层页无数据源，仍人工维护、不查数值——方案 B 口径）
const smScan = xmlScan(read('sitemap.xml'), 'urlset');
const smBadKids = smScan ? smScan.kids.filter((k) => k !== 'url') : [];
const lastmods = [...read('sitemap.xml').matchAll(/<lastmod>([^<]*)<\/lastmod>/g)].map((m) => m[1]);
// 日期校验要真解析：`2026-02-31` / `2026-13-45` 旧版只过格式正则就放行
function isRealDate(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, mo, d] = v.split('-').map(Number);
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}
const badLastmod = lastmods.filter((v) => !isRealDate(v));
check(
  'sitemap.xml 良构：url 子元素 ' + (smScan ? smScan.kids.length : 0) + '、lastmod ' + lastmods.length + ' 条全为真实日期、标签配对正确',
  !!smScan && smScan.stray === '' && smBadKids.length === 0 && badLastmod.length === 0 &&
    lastmods.length === sitemapLocs.length && smScan.mismatched.length === 0,
  [smBadKids.length ? '白名单外 [' + smBadKids.join(',') + ']' : '',
   smScan && smScan.mismatched.length ? '配对错误 [' + smScan.mismatched.slice(0, 3).join(';') + ']' : '',
   badLastmod.length ? '坏 lastmod [' + badLastmod.join(',') + ']' : '',
   lastmods.length !== sitemapLocs.length ? '条数 ' + lastmods.length + '≠' + sitemapLocs.length : ''
  ].filter(Boolean).join(' / ')
);

// 10. 占位符残留扫描：@@ / {{ / __DATA_VER__ / FIXME / PLACEHOLDER_ / REPLACE_ME
//     扫全部 html/css/js/json/xml/txt。不匹配 }}——JS 里 catch(e){}} 之类全是噪声（实测 68 条）。
//     2026-10-11 扩表：旧口径漏 .mjs/.md/.svg 与无扩展名文件（CNAME 之类），
//     变异测试证明这些类型里放占位符可以完全逃过扫描。
const MARKERS = ['@@', '{{', '__DATA_VER__', 'FIXME', 'PLACEHOLDER_', 'REPLACE_ME'];
const SCAN_EXT = ['.html', '.css', '.js', '.mjs', '.json', '.xml', '.txt', '.md', '.svg', '.yml', '.yaml'];
// 无扩展名但必须扫的文本文件（自带站点元数据，历史上是占位符常落点）
const SCAN_NOEXT = ['CNAME', 'LICENSE', 'VERSION'];
function walk(dir, out) {
  for (const f of fs.readdirSync(dir)) {
    if (f === '.git' || f === 'node_modules') continue;
    const fp = path.join(dir, f);
    if (fs.statSync(fp).isDirectory()) { walk(fp, out); continue; }
    // 本脚本自身含全部标记字面量（合法）：按「绝对路径 == 本文件」豁免，
    // 而不是按 basename 任意深度豁免（避免同名的另一份副本也被静默放过）
    if (path.resolve(fp) === path.resolve(__filename)) continue;
    const ext = path.extname(f);
    if (SCAN_EXT.includes(ext) || (ext === '' && SCAN_NOEXT.includes(f))) out.push(fp);
  }
  return out;
}
const scanHits = [];
for (const fp of walk(WEB, [])) {
  const rel = path.relative(WEB, fp);
  fs.readFileSync(fp, 'utf8').split(/\r?\n/).forEach((line, i) => {
    for (const mk of MARKERS) {
      if (line.includes(mk)) { scanHits.push(rel + ':' + (i + 1) + ' ' + mk); break; }
    }
  });
}
check(
  '占位符残留扫描（' + MARKERS.join('/') + '，0 命中）',
  scanHits.length === 0,
  scanHits.slice(0, 8).join(' | ')
);

// 10.5 模板陷阱门禁：已发布文章（posts/*.html，不含 _template 自身）不允许残留
//     模板占位——「复制 _template 忘了替换」直接上线在这里被拦下（20261002b）
//     token 必须是 _template.html 里真实存在的占位串：旧占位「文章标题占位/一句话摘要」
//     在模板活值清零后全仓库零命中成死 token，20261002c 换成现占位
// 「上一篇 / 下一篇」是模板里的操作指引：模板自身合法、发布页残留即漏删
//（2026-10-05 审查发现三篇已发布页带着它上线，自检拦不住，遂入 token 清单）
const TPL_TOKENS = ['TODO', '__SLUG__', '__DATE__', 'TODO：文章标题', 'TODO-导语', '上一篇 / 下一篇：没有就整块删除'];
const tplHits = [];
for (const f of POST_PAGES) {
  fs.readFileSync(path.join(WEB, f), 'utf8').split(/\r?\n/).forEach((line, i) => {
    for (const mk of TPL_TOKENS) {
      if (line.includes(mk)) { tplHits.push(f + ':' + (i + 1) + ' ' + mk); break; }
    }
  });
}
check(
  '模板占位残留扫描（' + TPL_TOKENS.join('/') + '，posts/' + POST_PAGES.length + ' 篇 0 命中）',
  tplHits.length === 0,
  tplHits.slice(0, 6).join(' | ')
);

// 11. feed entry 级：必备子元素齐全、id==link、category 与 posts.json 该条 tags 一致、
//     <updated> 数值 == updated||date、全部 entry 书写序 == sortPosts 显示序、
//     feed 级 <updated> == max(entry)。
//     门禁 8 只看根层结构，某条 entry 缺 <updated>/category 拼错照样全绿（2026-10-05 补）；
//     数值/顺序/根值 2026-10-07 补——此前三处「记得同步」全靠 feed.xml 头注释提醒人
//     2026-10-11 口径统一：先剥注释与 CDATA（CDATA 里的 <entry> 不该被当成真条目），
//     entry 开始标签允许带属性，属性值允许单引号（与 gate 8 的 xmlScan 同口径）
const feedClean = read('feed.xml')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
const feedRootUpd = (feedClean.match(/<updated>([^<]*)<\/updated>/) || [])[1] || ''; // feed 头部的第一个 updated
const entryBad = [];
const entryIds = [];
const entryUpds = [];
const entryRe = /<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/g;
let em;
while ((em = entryRe.exec(feedClean))) {
  const body = em[1];
  const inner = (t) => {
    const m = body.match(new RegExp('<' + t + '[ >]([\\s\\S]*?)</' + t + '>'));
    return m ? m[1].trim() : '';
  };
  const id = inner('id');
  const upd = inner('updated');
  const linkHref = (body.match(/<link[^>]*href="([^"]*)"/) || [])[1] || '';
  const cats = [...body.matchAll(/<category[^>]*term="([^"]*)"/g)].map((x) => x[1]);
  const p = posts.find((x) => id === 'https://xiaohetaoo.github.io/posts/' + x.slug + '.html');
  if (!inner('title')) entryBad.push('缺 <title>');
  else if (!id) entryBad.push('缺 <id>');
  else if (!p) entryBad.push('id 不在 posts.json：' + (id || '(空)'));
  else if (!/^\d{4}-\d{2}-\d{2}T/.test(upd)) entryBad.push(p.slug + ' <updated> 格式：' + upd);
  else if (id !== linkHref) entryBad.push(p.slug + ' id≠link href');
  else if (upd.slice(0, 10) !== (p.updated || p.date))
    entryBad.push(p.slug + ' <updated>=' + upd.slice(0, 10) + ' 应为 ' + (p.updated || p.date));
  else if (!inner('summary')) entryBad.push(p.slug + ' 缺 <summary>');
  else if (cats.length !== (p.tags || []).length || !(p.tags || []).every((t) => cats.indexOf(t) !== -1))
    entryBad.push(p.slug + ' category ' + JSON.stringify(cats) + ' ≠ tags ' + JSON.stringify(p.tags));
  entryIds.push(id);
  entryUpds.push(upd);
}
// 全序：entry 书写序 == sortPosts 显示序（修订上浮/新文章插错位在这里拦下，报第一处漂移）
const wantIds = sortPosts(posts).map((p) => 'https://xiaohetaoo.github.io/posts/' + p.slug + '.html');
const driftAt = wantIds.findIndex((u, i) => entryIds[i] !== u);
if (entryIds.length !== wantIds.length || driftAt !== -1)
  entryBad.push('entry 顺序第 ' + (driftAt + 1) + ' 位漂移：应为 ' + (wantIds[driftAt] || '(缺)').split('/').pop() +
    '，实为 ' + (entryIds[driftAt] || '(缺)').split('/').pop());
// feed 级 <updated> == 全站最新（修订上浮时跟着走，feed.xml 头注释的「记得同步」机械化）
const maxUpd = entryUpds.slice().sort().pop() || '';
if (feedRootUpd.slice(0, 10) !== maxUpd.slice(0, 10))
  entryBad.push('feed 级 <updated>=' + (feedRootUpd.slice(0, 10) || '(空)') + ' ≠ 最新 entry ' + maxUpd.slice(0, 10));
check(
  'feed entry 级：子元素/id==link/category==tags/<updated>==updated||date/书写序/feed 级 updated=max（' + feedEntries + ' 条）',
  entryBad.length === 0,
  entryBad.slice(0, 4).join(' | ')
);

// 12. sitemap 文章条目 lastmod 数值 == posts.json 的 updated||date（修订上浮口径，2026-10-05 定）。
//     门禁 9 只查格式；项目/顶层页的 lastmod 无数据源，仍人工维护、不查数值
const lmBad = [];
const urlRe = /<url>([\s\S]*?)<\/url>/g;
let um;
while ((um = urlRe.exec(read('sitemap.xml')))) {
  const block = um[1];
  const loc = (block.match(/<loc>([^<]+)<\/loc>/) || [])[1] || '';
  const lm = (block.match(/<lastmod>([^<]*)<\/lastmod>/) || [])[1];
  const sm = loc.match(/\/posts\/([^/]+)\.html$/);
  if (!sm) continue;
  const p = posts.find((x) => x.slug === sm[1]);
  if (!p) lmBad.push('posts.json 无 ' + sm[1]);
  else if (lm !== (p.updated || p.date)) lmBad.push(sm[1] + ' lastmod=' + lm + ' 应为 ' + (p.updated || p.date));
}
check('sitemap 文章 lastmod 数值 == updated||date', lmBad.length === 0, lmBad.slice(0, 4).join(' | '));

// 13. 站内 stylesheet/script 引用必须带 ?v=：漏写缓存戳 = 部署后吃旧缓存，
//     门禁 1 只校验「已写出来的值」是否一致，拦不住「忘了写」。
//     外链（giscus 等）与 data: 不归缓存戳管。
//     huiyan-shisi 整页豁免（gate 13/14 同口径）：它是上游镜像 + 自包含页，不引
//     style.css/main.js、无 ?v= 体系；豁免边界 = 仅用户点名该页具体问题或上游同步批才动
//     2026-10-11 加固：rel 属性支持单/双引号与无引号、允许 rel 里有多值（`rel="preload stylesheet"`、
//     尾随空格），并把 `<link rel="preload" as="style">` 与 `<style>@import` 也算进来——
//     旧口径只认字面 `rel="stylesheet"`，上述写法都能躲过缓存戳检查。
const vBad = [];
const SRC_ATTR = (tag, name) => {
  const m = tag.match(new RegExp(name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i'));
  return m ? (m[1] ?? m[2] ?? m[3] ?? '') : '';
};
const relOf = (tag) => SRC_ATTR(tag, 'rel').toLowerCase().split(/\s+/).filter(Boolean);
for (const f of [...TOP, ...POST_PAGES]) {
  if (f === 'huiyan-shisi.html') continue;
  const html = read(f);
  const refs = [];
  for (const m of html.matchAll(/<script\b[^>]*>/g)) { const s = SRC_ATTR(m[0], 'src'); if (s) refs.push(s); }
  for (const m of html.matchAll(/<link\b[^>]*>/g)) {
    const tag = m[0];
    const rel = relOf(tag);
    const isSheet = rel.includes('stylesheet');
    const isPreloadStyle = rel.includes('preload') && SRC_ATTR(tag, 'as').toLowerCase() === 'style';
    if (!isSheet && !isPreloadStyle) continue;
    const s = SRC_ATTR(tag, 'href');
    if (s) refs.push(s);
  }
  // <style>@import url(...) 也是外部样式引用
  for (const m of html.matchAll(/@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/g)) refs.push(m[1]);
  for (const r of refs) {
    if (/^(https?:)?\/\//.test(r) || r.indexOf('data:') === 0) continue;
    if (r.indexOf('?v=') === -1) vBad.push(f + ' → ' + r);
  }
}
check('站内 stylesheet/script 引用全带 ?v=（' + vBad.length + ' 漏）', vBad.length === 0, vBad.slice(0, 4).join(' | '));

// 14. 内链死链：href/src 指向的站内文件必须真实存在（外链/纯锚点/data:/mailto 不查）。
//     404 的绝对根路径、posts 的 ../ 相对路径都按所在目录解析
//     2026-10-11 加固：
//       a) 属性值支持单引号与无引号（旧式只认双引号，`href='gone.html'` 可逃逸）
//       b) 补查 srcset / poster
//       c) 跳过 javascript: / tel:（旧式当相对路径处理，会报假死链）
//       d) 百分号解码后再判存在（`%70osts/x.html` 是合法链接，旧式误报）
//       e) 目录型 href（`posts/`）要求目录下真有 index.html，否则线上 404
const deadLinks = [];
const NON_PATH_SCHEMES = /^(?:[a-z][a-z0-9+.-]*:)/i;
for (const f of [...TOP, ...POST_PAGES]) {
  if (f === 'huiyan-shisi.html') continue; // 整页豁免（边界见 gate 13 注释）
  const html = read(f);
  const baseDir = path.dirname(path.join(WEB, f));
  const candidates = [];
  for (const m of html.matchAll(/\b(?:href|src|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    candidates.push(m[1] ?? m[2] ?? m[3] ?? '');
  }
  for (const m of html.matchAll(/\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const v = m[1] ?? m[2] ?? '';
    for (const part of v.split(',')) {
      const u = part.trim().split(/\s+/)[0];
      if (u) candidates.push(u);
    }
  }
  for (const r of candidates) {
    if (!r) continue;
    if (/^(https?:)?\/\//.test(r) || r.charAt(0) === '#' || r.indexOf('data:') === 0) continue;
    if (NON_PATH_SCHEMES.test(r)) continue; // mailto: / tel: / javascript: 等非路径协议
    const clean = r.split('#')[0].split('?')[0];
    if (!clean) continue;
    let decoded = clean;
    try { decoded = decodeURIComponent(clean); } catch (e) { /* 坏编码按原串判 */ }
    const target = path.normalize(decoded.charAt(0) === '/' ? path.join(WEB, decoded) : path.join(baseDir, decoded));
    if (fs.existsSync(target)) {
      // 目录型链接：线上要能取到 index.html
      if (fs.statSync(target).isDirectory() && !fs.existsSync(path.join(target, 'index.html'))) {
        deadLinks.push(f + ' → ' + r + '（目录无 index.html）');
      }
      continue;
    }
    deadLinks.push(f + ' → ' + r);
  }
}
check('内链/资源引用零死链（' + deadLinks.length + ' 断）', deadLinks.length === 0, deadLinks.slice(0, 4).join(' | '));

// 15. 根目录每个 HTML 都必须登记进 TOP：新页面忘了登记 = 版本/JSON-LD 门禁整个绕过
const unregistered = fs.readdirSync(WEB).filter((f) => f.endsWith('.html') && TOP.indexOf(f) === -1);
check('根目录 HTML 全部登记进 TOP（' + TOP.length + ' 页）', unregistered.length === 0, unregistered.join(', '));

// 16. relatedPost 一致性 + 项目标题唯一（2026-10-11 审查补盲区）：
//     projects.json 的 relatedPost 会被弹窗运行时拼成「阅读相关文章」链接（JS 注入
//     DOM），gate 14 的静态死链扫描看不见它——slug 必须存在于 posts.json、title
//     必须与该文章一致（弹窗副文案直接显示它，错文案比坏链更迷惑）；项目标题唯一
//     则是 main.js PROJ_ACTIONS 键与 projects.html #p= 锚点定位的共同前提
const slugSet = new Set(posts.map((p) => p.slug));
const slugTitle = new Map(posts.map((p) => [p.slug, p.title]));
const projTitleSet = new Set();
const rpBad = [];
let rpCount = 0;
for (const p of projects) {
  if (projTitleSet.has(p.title)) rpBad.push('项目标题重复：' + p.title);
  projTitleSet.add(p.title);
  const rp = p.relatedPost;
  if (!rp) continue;
  rpCount++;
  const slug = typeof rp === 'string' ? rp : rp && rp.slug;
  if (!slug || !slugSet.has(slug)) { rpBad.push(p.title + ' → relatedPost.slug 不存在于 posts.json：' + slug); continue; }
  // 2026-10-11 补：slug 在 posts.json 里不等于页面真的存在（删了文件但 JSON 没改，
  // 只有 gate 3 的「页面数」会碰巧拦下）；这里直接查磁盘
  if (!fs.existsSync(path.join(WEB, 'posts', slug + '.html'))) {
    rpBad.push(p.title + ' → relatedPost 指向的页面不存在：posts/' + slug + '.html');
  }
  const rt = typeof rp === 'object' && rp.title;
  if (!rt) {
    // 2026-10-11 补：旧式 `if (rt && ...)` 在 title 缺失时整段跳过，半残数据能过
    rpBad.push(p.title + ' → relatedPost 缺 title 字段（弹窗副文案会空）');
  } else if (rt !== slugTitle.get(slug)) {
    rpBad.push(p.title + ' → relatedPost.title 与文章「' + slugTitle.get(slug) + '」不符：' + rt);
  }
  // 2026-10-11 补：带 relatedPost 的卡会渲染 button 弹窗，「获取资源」那行依赖 href；
  // 缺 href 会让动作行被运行时隐藏（main.js 8.5 有兜底，但数据层面应显式声明）
  if (!p.href) rpBad.push(p.title + ' → 带 relatedPost 但缺 href（弹窗「获取资源」会不可用）');
}
check('relatedPost 一致性 + 项目标题唯一（' + rpCount + ' 条关联）', rpBad.length === 0, rpBad.slice(0, 4).join(' | '));

// 17. posts.json 每条 slug 必须有对应页面文件（2026-10-11 补）：
//     gate 3 只比「计数」，删一页同时删一条 json 就看不出来；这里直接对磁盘做双射校验
const slugFileBad = posts
  .filter((p) => !fs.existsSync(path.join(WEB, 'posts', p.slug + '.html')))
  .map((p) => p.slug);
check('posts.json 每条都有对应页面文件（' + posts.length + ' 条）', slugFileBad.length === 0, '缺: ' + slugFileBad.join(', '));

// 18. 日期真实性 + updated >= date（2026-10-11 补）：
//     旧口径只查 YYYY-MM-DD 格式，2026-02-31 这类不存在的日期能过；
//     updated 早于 date 更是无意义数据
const dateBad = [];
for (const p of posts) {
  for (const [field, v] of [['date', p.date], ['updated', p.updated]]) {
    if (!v) continue;
    if (!isRealDate(v)) { dateBad.push(p.slug + ' ' + field + '=' + v + '（非真实日期）'); continue; }
  }
  if (p.updated && p.date && isRealDate(p.updated) && isRealDate(p.date) && p.updated < p.date) {
    dateBad.push(p.slug + ' updated=' + p.updated + ' 早于 date=' + p.date);
  }
}
check('posts.json 日期真实且 updated >= date（' + posts.length + ' 条）', dateBad.length === 0, dateBad.slice(0, 4).join(' | '));

// ================= 2026-10-18 审查轮新增（19~22）=================
// 起因：一次只读审查 + 逐条变异测试发现，原 24 道门禁在「SEO 报告类元数据」与
// 「页面级结构」上完全空白——注入 noindex、canonical 指向站外、删掉 og:url、
// 删掉整块 Article JSON-LD、feed 标题换成别篇的、删掉 404 的 XHT_AT_404、
// head 塞裸文本、同页两个 h1、重复 id…… 全部 24/24 放行。
// 复现工具：D:\zcode\tools\_mutate-gate-gaps.js（18 条里 17 条逃逸）。
const SITE = 'https://xiaohetaoo.github.io';
const allPages = [...TOP, ...POST_PAGES];
const pageUrl = (f) => (f === 'index.html' ? SITE + '/' : SITE + '/' + f);
const metaOf = (html, re) => {
  const m = html.match(re);
  return m ? decodeEntities(m[1]).trim() : null;
};

// 19. SEO 头字段矩阵（2026-10-18 补）：
//     canonical 按路径现算并自指；og:url == canonical；og:title == twitter:title == <title>；
//     twitter 卡必须用 name= 而不是 property=（历史上批量替换就漏在这）。
//     另加 robots 白名单——这正是 posts/_template.html 自述的
//     「忘删 noindex = 整篇除名且自检全绿」陷阱，此前门禁完全没管。
const seoBad = [];
const NOINDEX_OK = new Set(['404.html', 'birthday.html', 'huiyan-shisi.html']); // huiyan 自包含，二·10 豁免
// huiyan-shisi.html 按二·10 不参与全站审查（上游镜像 + 自包含），它的 og:title 用宣传语
// 而非 <title>，属上游口径 → 整个 SEO 矩阵对它豁免，只保留「不得 noindex」之外的检查跳过
const SEO_SKIP = new Set(['huiyan-shisi.html']);
for (const f of allPages) {
  if (SEO_SKIP.has(f)) continue;
  const html = read(f);
  if (!html) continue;
  const title = metaOf(html, /<title>([^<]*)<\/title>/i);
  const canon = metaOf(html, /<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*href\s*=\s*["']([^"']*)["']/i);
  const ogUrl = metaOf(html, /<meta\b[^>]*property\s*=\s*["']og:url["'][^>]*content\s*=\s*["']([^"']*)["']/i);
  const ogTitle = metaOf(html, /<meta\b[^>]*property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']*)["']/i);
  const twTitle = metaOf(html, /<meta\b[^>]*name\s*=\s*["']twitter:title["'][^>]*content\s*=\s*["']([^"']*)["']/i);
  const want = pageUrl(f);
  if (!canon) seoBad.push(f + ' 缺 canonical');
  else if (canon !== want) seoBad.push(f + ' canonical=' + canon + '（应 ' + want + '）');
  if (ogUrl !== canon) seoBad.push(f + ' og:url 与 canonical 不一致');
  if (!ogTitle) seoBad.push(f + ' 缺 og:title');
  else if (ogTitle !== title) seoBad.push(f + ' og:title ≠ <title>（' + ogTitle + ' vs ' + title + '）');
  if (!twTitle) seoBad.push(f + ' 缺 twitter:title（必须用 name= 而非 property=）');
  else if (twTitle !== ogTitle) seoBad.push(f + ' twitter:title ≠ og:title');
  const noindex = /<meta\b[^>]*name\s*=\s*["']robots["'][^>]*content\s*=\s*["'][^"']*noindex/i.test(html);
  if (noindex && !NOINDEX_OK.has(f)) seoBad.push(f + ' 出现 noindex（只允许 404/birthday）');
}
check('SEO 头字段矩阵：canonical 自指 / og:url 一致 / og·twitter·title 三者同值 / robots 白名单（' + allPages.length + ' 页）',
  seoBad.length === 0, seoBad.slice(0, 4).join(' | '));

// 19b. 文章页 Article JSON-LD 的日期必须等于 posts.json 的 date / updated‖date
//      （此前只校验 posts.json 自身的日期，页面里把年份写错完全没人管）
const artBad = [];
for (const p of posts) {
  const html = read('posts/' + p.slug + '.html');
  if (!html) continue;
  const blocks = html.match(LD_RE) || [];   // LD_RE 带 /g；String.match 会自动重置 lastIndex
  let art = null;
  for (const b of blocks) if (/"@type"\s*:\s*"(?:Article|BlogPosting|NewsArticle)"/.test(b)) art = b;
  if (!art) { artBad.push(p.slug + ' 缺 Article JSON-LD'); continue; }
  const dp = (art.match(/"datePublished"\s*:\s*"([^"]*)"/) || [])[1];
  const dm = (art.match(/"dateModified"\s*:\s*"([^"]*)"/) || [])[1];
  const wantMod = p.updated || p.date;
  if (dp !== p.date) artBad.push(p.slug + ' datePublished=' + dp + '（posts.json date=' + p.date + '）');
  if (dm !== wantMod) artBad.push(p.slug + ' dateModified=' + dm + '（应 ' + wantMod + '）');
}
check('文章页 Article JSON-LD 日期 == posts.json date/updated（' + posts.length + ' 篇）',
  artBad.length === 0, artBad.slice(0, 4).join(' | '));

// 20. 404 专项（2026-10-18 补）：404.html 是全站唯一「会被服务在任意深度路径」的页面，
//     靠 window.XHT_AT_404 与 main.js 的 siteRoot() 协作把 json fetch / 链接切到绝对根。
//     这层耦合此前零覆盖——删掉那行，本地直开 /404.html 照样正常，只有线上深链
//     （/a/b 也返回 404.html）才炸：siteRoot 走 else 返回 "."、posts.json 取不到、列表全空，
//     而自检全绿。另外它每个站内引用都必须以 / 开头（相对路径在深链上解析到错误目录）。
const bad404 = [];
{
  const html = read('404.html');
  if (!html) bad404.push('404.html 读不到');
  else {
    if (!/window\.XHT_AT_404\s*=\s*true/.test(html)) bad404.push('缺 window.XHT_AT_404 = true 声明');
    if (!/window\.XHT_AT_404/.test(read('assets/js/main.js'))) bad404.push('main.js 未消费 XHT_AT_404（siteRoot 会退回相对口径）');
    if (!/name\s*=\s*["']robots["'][^>]*noindex/i.test(html)) bad404.push('缺 robots noindex');
    // 引用扫描同样先剥注释与脚本内容（404.html 各处注释里写着 /assets/… 这类示例路径，
    // 不剥会把注释里的相对写法当成真引用误报）
    const refSrc = html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
    const refs = [...refSrc.matchAll(/\b(?:href|src|poster)\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
    for (const r of refs) {
      if (/^(?:https?:|data:|mailto:|#|javascript:|\/\/)/i.test(r)) continue;
      if (!r.startsWith('/')) bad404.push('站内引用非绝对路径：' + r);
    }
  }
}
check('404 专项：XHT_AT_404 三处耦合齐全 + 站内引用全绝对路径',
  bad404.length === 0, bad404.slice(0, 4).join(' | '));

// 21. 页面结构（2026-10-18 补）：每页恰一个 <h1>、id 全页唯一、head 里无游离文本。
//     最后一条对应 20261011c 那次「模板 head 注释提前闭合 → 裸文本渲染进 head 并随复制
//     传染新文章」的事故类型——当时靠人眼发现，现在由门禁兜住。
const structBad = [];
// 计数前必须剥掉「注释 + script/style 内容」：页内注释与脚本里经常出现 <h1>/id="…" 这类
// 字面量（birthday.html 的注释里就有 4 处 <h1>，直接数会把 1 个真标题报成 5 个；
// 本门禁前一版就是这么误报的）。
const stripForStruct = (html) =>
  html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
// huiyan-shisi.html 按二·10 不参与全站审查（上游镜像 + 自包含）。它的 head 里有
// `<link rel="icon" href="data:image/svg+xml,<svg …></svg>">` —— 属性值内含 `>`，
// 任何「<[^>]*>」式的简易标签剥离都会在此提前截断、留下 `">` 残渣。
// 属上游写法，本轮不动它（改上游资源超出范围），结构检查对它豁免。
const STRUCT_SKIP = new Set(['huiyan-shisi.html']);
for (const f of allPages) {
  if (STRUCT_SKIP.has(f)) continue;
  const html = read(f);
  if (!html) continue;
  const body = stripForStruct(html);
  const h1 = (body.match(/<h1\b/gi) || []).length;
  if (h1 !== 1) structBad.push(f + ' h1 数量=' + h1 + '（应恰 1）');
  const ids = [...body.matchAll(/\sid\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]);
  const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
  if (dup.length) structBad.push(f + ' 重复 id：' + [...new Set(dup)].join('/'));
  const head = (html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i) || [])[1];
  if (head) {
    // 剥「整块（含内容）」的元素后再剥标签——顺序与范围都要对：
    //   ① script/style/title/noscript 都是 head 里的**内容型**元素，只剥标签会留下正文，
    //      被当成游离文本（本门禁前两版分别误报了主题内联脚本与 <title> 的文字）
    //   ② 剥完这些之后，head 里合法的东西只剩 meta/link 这类空元素，剥标签后应为空白
    const naked = head
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, '')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '')
      .replace(/<[^>]*>/g, '')
      .replace(/&[a-z#0-9]+;/gi, '')
      .trim();
    if (naked) structBad.push(f + ' head 有游离文本：' + JSON.stringify(naked.slice(0, 30)));
  }
}
check('页面结构：每页恰 1 个 h1 + id 唯一 + head 无游离文本（' + allPages.length + ' 页）',
  structBad.length === 0, structBad.slice(0, 4).join(' | '));

// 22. 数据完整性（2026-10-18 补）：feed 的 title/summary 此前只判「存在」，
//     内容换成别篇的照样全绿（feed 是订阅端唯一的推送源，错配会直接推错内容）；
//     projects.json 的 date/icon/desc/linkText/tags 也是零校验
//     （icon 改成 banana、desc 清空、date 写成 2026-13-45 都能过）。
const dataBad = [];
{
  const feed = read('feed.xml');
  const entryRe = /<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/g;
  const feedList = [];
  let em;
  while ((em = entryRe.exec(feed))) {
    const body = em[1];
    // 普通成对子元素（title / summary / id）
    const get = (tag) => {
      const m = body.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + tag + '>'));
      return m ? decodeEntities(m[1].trim()) : null;
    };
    // Atom 的 <link> 是**自闭合带属性**写法（<link href="…"/>），不是成对子元素——
    // 按 <link>text</link> 解析会恒为 null（本门禁第一版因此把 17 条全报成"link 不是文章页"）
    const lm = body.match(/<link\b[^>]*href\s*=\s*["']([^"']+)["']/i);
    feedList.push({
      title: get('title'),
      summary: get('summary'),
      link: lm ? decodeEntities(lm[1].trim()) : null,
      id: get('id'),
    });
  }
  const bySlug = new Map(posts.map((p) => [p.slug, p]));
  for (const e of feedList) {
    const slug = e.link ? (e.link.match(/\/posts\/([^./]+)\.html/) || [])[1] : null;
    if (!slug) { dataBad.push('feed 有条目 link 不是文章页：' + e.link); continue; }
    const p = bySlug.get(slug);
    if (!p) { dataBad.push('feed 条目指向不存在的文章：' + slug); continue; }
    if (e.title !== p.title) dataBad.push(slug + ' feed title 与 posts.json 不符');
    if ((e.summary || '').trim() !== (p.excerpt || '').trim()) dataBad.push(slug + ' feed summary 与 posts.json excerpt 不符');
    if (e.id !== e.link) dataBad.push(slug + ' feed id ≠ link');
  }
  const ICONS = new Set(['cube', 'gamepad', 'play', 'gift', 'presentation', 'heart', 'compass']);
  for (const p of projects) {
    if (!p.date || !isRealDate(p.date)) dataBad.push('项目「' + p.title + '」date 非真实日期：' + p.date);
    if (!ICONS.has(p.icon)) dataBad.push('项目「' + p.title + '」icon 未知：' + p.icon);
    if (!p.desc || !String(p.desc).trim()) dataBad.push('项目「' + p.title + '」desc 为空');
    if (!p.linkText || !String(p.linkText).trim()) dataBad.push('项目「' + p.title + '」linkText 为空');
    if (!Array.isArray(p.tags) || !p.tags.length) dataBad.push('项目「' + p.title + '」tags 为空');
  }
}
check('数据完整性：feed title·summary == posts.json + 项目字段齐全（' + projects.length + ' 项）',
  dataBad.length === 0, dataBad.slice(0, 4).join(' | '));

// 22b. sitemap 非文章条目的 lastmod 方向性校验（2026-10-18 补）：
//      文章条目的 lastmod 已由 gate 12 精确校验（== updated‖date），但顶层页与项目锚点
//      此前零校验——随便改成 1999 也全绿。
//      口径说明（手册「方案 B」）：顶层页与项目锚点的 lastmod 是**语义变化日**，
//      允许晚于 content date（例如地理组徽改名的 10-11 就晚于项目加入日 09-04），
//      所以只能断言方向（不得早于 content date），不能强求相等——强求相等会把
//      方案 B 的正常形态判成错误。
const lmDirBad = [];
{
  const sm = read('sitemap.xml');
  const urlRe = /<url>\s*<loc>([^<]*)<\/loc>[\s\S]*?<\/url>/g;
  const projByTitle = new Map(projects.map((p) => [p.title, p]));
  const TOP_DATE_SRC = { // 顶层页的 content date 来源（无 meta date 的用 null 跳过）
    'https://xiaohetaoo.github.io/': 'index.html',
    'https://xiaohetaoo.github.io/archive.html': 'archive.html',
    'https://xiaohetaoo.github.io/projects.html': 'projects.html',
    'https://xiaohetaoo.github.io/updates.html': 'updates.html',
    'https://xiaohetaoo.github.io/about.html': 'about.html',
  };
  let um;
  while ((um = urlRe.exec(sm))) {
    const loc = um[1];
    const lm = (um[0].match(/<lastmod>([^<]*)<\/lastmod>/) || [])[1];
    if (!lm || !isRealDate(lm)) continue;   // 真实日期由 gate 9 管
    // 项目锚点：#p=<百分号编码标题>
    if (loc.includes('#p=')) {
      let title = '';
      try { title = decodeURIComponent(loc.split('#p=')[1]); } catch (e) { title = loc.split('#p=')[1]; }
      const p = projByTitle.get(title);
      if (p && p.date && isRealDate(p.date) && lm < p.date) {
        lmDirBad.push('项目「' + title + '」lastmod=' + lm + ' 早于加入日 ' + p.date);
      }
      continue;
    }
    // 顶层页：用 meta date 作为 content date（无则跳过）
    const src = TOP_DATE_SRC[loc];
    if (!src) continue;
    const md = (read(src).match(/<meta name="date" content="([^"]*)"/) || [])[1];
    if (md && isRealDate(md) && lm < md) {
      lmDirBad.push(src + ' lastmod=' + lm + ' 早于 meta date=' + md);
    }
  }
}
check('sitemap 非文章 lastmod 不早于内容日期（项目锚点 + 顶层页，方案 B 方向性）',
  lmDirBad.length === 0, lmDirBad.slice(0, 4).join(' | '));

// 23. 列表结构完整性（2026-10-21 补）：
//     起因很具体——updates.html 时间轴首行曾出现**连续两个 `<li class="upd-item reveal">`**
//     （插新条目时把原条目的 `<li>` 顶掉了，导致该条目丢失外层 li），而且已经推上线。
//     当时第 21 道只查 h1/id/head 游离文本，完全不看列表配对，所以没拦住。
//     现在查三件事：
//       a) 全页 `<li` 与 `</li>` 数量必须相等（漏闭合 / 多开）
//       b) **连续重复的同一开标签**（`<li class="x">` 后面紧跟又一个完全相同的
//          `<li class="x">`，中间只允许空白）——这正是那次事故的形态。
//          普通配对计数抓不到它：多一个开 + 多一个闭仍然"配平"。
//       c) 空列表容器（`<ul></ul>` 无 li 也无文本）——插入时把内容挤走的典型症状。
//     剥离顺序同第 21 道：先剥注释与 script/style 整块，否则 main.js 注入的模板字符串
//     （含 `'<li>'` 字面量）会被当成真标签误报。
const listBad = [];
{
  const strip = (html) => html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  for (const f of allPages) {
    const html = read(f);
    if (!html) continue;
    const body = strip(html);
    // a) 全局配对
    const liOpen = (body.match(/<li\b/gi) || []).length;
    const liClose = (body.match(/<\/li>/gi) || []).length;
    if (liOpen !== liClose) listBad.push(f + ' <li> 开' + liOpen + ' / 闭' + liClose);
    // b) 连续重复同一开标签（事故形态）
    const dupRe = /<li\b([^>]*)>\s*<li\b\1>/g;
    const dm = body.match(dupRe);
    if (dm) listBad.push(f + ' 连续重复 ' + dm[0].slice(0, 44).replace(/\s+/g, ' '));
    // b2) 相邻两条 <li> 的**内容完全相同**（含标签与文本，压掉空白后比）——
    //     这是复制粘贴插条目的典型后果，且不会被 a) 的开闭配对发现。
    //     只比「紧邻」的两条，避免把正文里正常重复的短语判成错误。
    const liPairs = [...body.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) =>
      m[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim());
    for (let i = 1; i < liPairs.length; i++) {
      const cur = liPairs[i], prev = liPairs[i - 1];
      if (cur && cur === prev && cur.length >= 8) {
        listBad.push(f + ' 相邻 li 内容重复：' + JSON.stringify(cur.slice(0, 40)));
        break;
      }
    }
    // c) 空列表容器
    const containerRe = /<(ul|ol)\b[^>]*>([\s\S]*?)<\/\1>/gi;
    let cm;
    while ((cm = containerRe.exec(body))) {
      const inner = cm[2];
      const n = (inner.match(/<li\b/gi) || []).length;
      if (n === 0 && inner.replace(/<[^>]*>/g, '').trim() === '') {
        listBad.push(f + ' 空 <' + cm[1] + '> 容器（无 li 且无文本）');
        break;
      }
    }
  }
}
check('列表结构：<li> 开闭配对 + 无连续重复开标签 + 无相邻同文 li + 无空列表容器（' + allPages.length + ' 页）',
  listBad.length === 0, listBad.slice(0, 4).join(' | '));

console.log('\n== 结果：' + pass + ' 通过，' + fail + ' 失败 ==');
process.exit(fail ? 1 : 0);
