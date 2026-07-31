# Sleephat Editor — Claude Code 项目说明

## 项目是什么
轻量级所见即所得（WYSIWYG）Markdown 编辑器，基于 **Tauri 2 + Vditor** 构建。
支持三种编辑模式：WYSIWYG / 即时渲染 / 分屏。跨平台（Linux 上通过 nix 构建）。

## 技术栈
- **前端**：TypeScript + Vite，编辑器内核用 [Vditor](https://github.com/Vanessa219/vditor)
- **桌面壳**：Tauri 2（Rust），配置在 `src-tauri/`
- **包管理**：npm（`package-lock.json`），注意不是 pnpm

## 目录结构
```
src/                  # 前端 TS 源码
  main.ts             # 入口，Vditor 初始化与生命周期
  toolbar.ts          # 工具栏
  fix-table-ir.ts     # 表格即时渲染修复
  lang.ts             # 语言/国际化
  utils.ts            # 工具函数
  styles.css          # 样式
  preload.ts          # Tauri preload
src-tauri/            # Rust 壳
  src/lib.rs          # Tauri 命令
  src/main.rs         # 入口
  tauri.conf.json     # Tauri 配置
reference/vscode-markdown-editor/   # ★ 重要参考仓库（只读，勿改）
```

## ★ 核心参考：reference/vscode-markdown-editor
这是 [zaaack/vscode-markdown-editor](https://github.com/zaaack/vscode-markdown-editor) 的克隆（浅克隆，HEAD 与上游一致，可 `git pull` 更新）。
它是本项目（Sleephat Editor）的**灵感来源**（README 中 Inspired by），重写时优先对照这里的实现：
- `src/` — VSCode 扩展的逻辑层（编辑器初始化、文件监听、目录树）
- `media-src/` — webview 前端代码
- `media/` — 构建产物

**注意**：这是 VSCode 扩展（跑在 webview 里），移植到 Tauri 时要改的地方：
- VSCode API（`vscode.workspace`、`vscode.window` 等）→ 换成 Tauri 的 `@tauri-apps/api`（文件系统、对话框、opener 插件）
- 生命周期：VSCode 扩展激活/停用 → Tauri window 的创建/销毁

## 构建命令
```bash
npm install
npm run tauri dev      # 开发
npm run tauri build    # 发布（Linux 产出 .deb）
```

## 约定
- 用户工作目录：本项目位于 `C:\DEV\develop\Sleephat-markdowneditor`（Windows）与 NixOS 双环境
- `reference/` 目录是纯参考，**不要修改、不要提交**（若提交需确认是否已加入 .gitignore）
- 提交信息用中文，简洁
