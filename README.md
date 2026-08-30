# xiaohetaoo.github.io

我的个人博客。纯 HTML/CSS/JS 手写，没有框架没有构建。本地预览起个静态服务器就行，比如 `py -3 -m http.server 8123`，或者直接看线上。

线上地址：<https://xiaohetaoo.github.io>

## 结构

```text
index.html            首页（文章列表、项目、联系方式都在这）
posts.json            文章清单：标题、日期、标签，首页列表由它生成
posts/                文章，一篇一个 html
assets/css/style.css  全站样式，配色变量集中在文件开头的 :root
assets/js/main.js     原子轨道动画、星尘背景、文章列表渲染、滚动进场、复制按钮
```

## 为什么要手写

想有个地方放自己写的东西，又不想背一套框架。改起来直接，部署也直接。
