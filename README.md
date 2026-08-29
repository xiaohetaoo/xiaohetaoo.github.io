# xiaohetaoo.github.io

我的个人博客。纯 HTML/CSS/JS 手写，没有框架没有构建，clone 下来双击 `index.html` 就能看。

线上地址：<https://xiaohetaoo.github.io>

## 结构

```text
index.html            首页（文章列表、项目、联系方式都在这）
posts/                文章，一篇一个 html
assets/css/style.css  全站样式，配色变量集中在文件开头的 :root
assets/js/main.js     原子轨道动画、星尘背景、滚动进场、复制按钮
```

## 写新文章

1. 复制 `posts/_template.html`，重命名成英文短横线，比如 `my-post.html`
2. 文件里搜 `TODO`，把标题、日期、标签、正文挨个换成自己的（正文里的 `<` 记得写成 `&lt;`）
3. 打开 `index.html`，在 `post-list` 里照着现有卡片复制一张，链接指向新文章，放最上面

push 之后 GitHub Pages 自动发布，一两分钟生效。

## 为什么要手写

想有个地方放自己写的东西，又不想背一套框架。改起来直接，部署也直接。
