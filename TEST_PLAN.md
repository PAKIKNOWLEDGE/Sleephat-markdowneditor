# Sleephat Editor 测试方案（TEST_PLAN）

> 覆盖批次 1~4（P0/P1/P2/P3 全部修复）+ P4 可选功能。每项给出手动验证步骤。
> 本文档面向**自己编译验证**：改完后跑 `npm run typecheck` 确认 0 错，再 `npm run tauri dev` 实测。

---

## 一、改动总览

### 批次 1（P0 安全 + 防丢数据）— 代码已改，待验证
| 项 | 改动 |
|---|---|
| S1 | `save_images` 路径加固：目录固定为「当前文件目录」，剥离目录成分、扩展名白名单、20MB 上限 |
| S2 | tauri.conf.json 加 CSP、release 关 devtools |
| S3 | `open_link`：拒绝 `javascript:`/`data:`/`file:` 等 scheme、执行型扩展名、相对链接 canonicalize 限文档目录内 |
| S4 | `save_config` 读-改-写合并，不再整体覆盖清空 recent_files/welcome_dark/窗口几何 |
| S5 | `saveFile()` 返回 boolean，关闭时保存失败则中止关闭 |
| S6 | 三态对话框改 `message()` + 按按钮文本比较（plugin-dialog 自定义按钮返回值是 label 不是 key） |

### 批次 2（P1 正确性 + 工程）— 代码已改，待验证
| 项 | 改动 |
|---|---|
| reset 回归 | 新增 `reset_config` Tauri 命令直写默认配置，toolbar reset 按钮改调它 |
| S7 | 表格定位改「DOM 表格序号 → markdown 表格序号」结构映射，弃文本反查（空单元格不再命中首表） |
| M3 | `src/vditor.d.ts` 全局 vditor 类型；`package.json` 加 `typecheck`；修复 buttons/裸 vditor 等类型错 |
| M5 | `openFile`/`newFile` 开头统一清 `saveTimer` |
| M6 | `save_file_as` 补记 `last_file_mtime` + emit `saved` |
| M12 | 打开/另存对话框改 `tauri::async_runtime::channel` 回调桥接，非阻塞不卡 UI |

### 批次 3（P2 健壮/体验）— 代码已改，待验证
| 项 | 改动 |
|---|---|
| M1 | 表格插入/删除列保留各列对齐（parseAligns），不再传空 aligns 抹平对齐 |
| M2 | 新增 `_lastPos` markdown 坐标，`applyAndSync` 用坐标定位；setValue 后 `rebindLastCell()` 按坐标重绑 |
| M9 | 空表 insertRow 按表头列数生成新行 |
| M4 | IPC 节流：`set_dirty` 仅值变化发、`setTitle` 150ms 节流合并 |
| M7/M8 | search MutationObserver disconnect+按 `#app` 顶层变化重绑；Highlight 分批构造（50/批）+500 上限 |
| M11 | upload `Promise.all(fileToBase64)` 包 try-catch，失败弹「图片读取失败」 |
| M13 | 新增 `lock_ok`（容忍 Mutex 中毒），替换全部 `.lock().unwrap()` |
| M14 | 新增 `clear_current_file` 命令，newFile 时清 Rust 端 current_file/is_dirty/mtime |

### 批次 4（P3 清理）— 本次改动
| 项 | 改动 | 文件 |
|---|---|---|
| L1 | 删除 fix-table-ir 全部 `[fix-table]` 调试 console.error（保留 catch 错误日志） | `src/fix-table-ir.ts` |
| L2 | 去深导入：本地复制 `updateHotkeyTip`，不再 `import 'vditor/src/ts/util/compatibility'` | `src/fix-table-ir.ts` |
| L3 | 保存入口去重：`saveVditorOptions` 300ms 防抖合并；toolbar 去重改**按按钮粒度**（原全局标志吞相邻按钮） | `src/utils.ts` |
| L4 | `window.open` 覆写返回 `null`（不再返回 window 自身） | `src/utils.ts` |
| L5 | preload 复核：确认 `global` polyfill 为必要防御（vditor 动态加载库会探测 global），保留并注释说明 | `src/preload.ts` |
| L6 | 去 `isInitialContent` 100ms 定时器（vditor setValue 走 enableInput:false 不触发 input），同步复位标记 | `src/main.ts` |
| L7 | lang 前缀匹配：`zh-Hans-CN` → `zh_CN`，不再回退英文 | `src/lang.ts` |
| L8 | spread 收口：`mode: 'ir'` 移到 `...defaultOptions` 之后；`saveVditorOptions` 不再存 mode | `src/main.ts` `src/utils.ts` |
| L9 | 三处 35px 硬编码收敛为 `:root{--vmd-gutter:35px}` | `src/styles.css` `src/fix-table-ir.ts` |
| L10 | config.json 损坏时备份为 `config.json.bak` 再回落默认，不再静默丢弃 | `src-tauri/src/lib.rs` |
| L11 | capabilities 收敛为 `core:default`+`dialog:default`+`dialog:allow-ask`；rpm 去掉无用 `libappindicator-gtk3`；`WEBKIT_DISABLE_COMPOSITING_MODE` 仅 Wayland 下设置 | `src-tauri/capabilities/default.json` `src-tauri/tauri.conf.json` `src-tauri/src/lib.rs` |
| L12 | copy-markdown/copy-html 文案改中文；清理死代码 `confirm()` 及 toolbar 未用导入 | `src/toolbar.ts` `src/utils.ts` |

### P4 可选功能 — 本次全部实现
| 功能 | 实现方式 | 文件 | 状态/风险 |
|---|---|---|---|
| P4-1 图片相对路径预览（M10 根治） | Rust 注册 `vmd-asset` 自定义协议，按当前文件目录解析相对路径（canonicalize 防穿越）；前端 MutationObserver 把相对 `img/audio/video` src 改写成 `vmd-asset://localhost/<path>`；上传插入改按扩展名（不再用 `new Image().onload` 探测） | `src-tauri/src/lib.rs` `src/utils.ts` `src/main.ts` `src-tauri/tauri.conf.json`（CSP 加 `vmd-asset:`） | **中风险**：自定义协议能否被 WebView2/WebKitGTK 正确路由需实测；音频/视频大文件无 Range 支持可能缓冲慢（图片无影响） |
| P4-2 滚动位置持久化 | 按文件路径存 localStorage，打开文件后轮询 scrollHeight 稳定再重放（参考上游 getScrollEl） | `src/main.ts` | 低风险 |
| P4-3 行号 | 移植上游 lineNumberScript 为 `src/line-numbers.ts`，工具栏加 `#` 切换按钮，样式走 `--vmd-gutter` 变量 | `src/line-numbers.ts`（新增）`src/styles.css` | 中风险（块起始行号计算逻辑复杂，需对表格/列表/代码块实测） |
| P4-4 主题联动 | `welcome_dark` 为 boolean 时手动覆盖；否则跟随系统深浅色（`appWindow.theme()` + `onThemeChanged`），同步 welcome 页 + vditor 主题 | `src/main.ts` | 低风险 |
| P4-5 customCss | config.json 加 `custom_css` 字段（CSS 原文），启动注入 `<style>` | `src-tauri/src/lib.rs` `src/main.ts` | 低风险 |
| P4-6 imageSaveFolder | config.json 加 `image_save_folder` 字段（相对目录，默认 assets，拒绝绝对/穿越）；`save_images` 返回含目录的相对路径 | `src-tauri/src/lib.rs` `src/main.ts` | 低风险 |

---

## 二、构建前置

```bash
npm install
npm run typecheck      # 应 0 错
npm run tauri dev      # 开发验证
npm run tauri build    # 发布
```

> 注意：P4-4 主题联动、P4-1 自定义协议都依赖 `@tauri-apps/api` 的窗口/事件能力，改动未做 git 提交。

---

## 三、回归测试重点（按优先级）

### 🔴 P0（先测这批）
1. **保存/关闭三态**：编辑后关窗 → 「保存并关闭 / 不保存 / 取消关闭」三键各自行为正确；选保存且磁盘写失败（如目录只读）时**不关闭**。
2. **图片上传路径安全**：粘贴图片存到 `<文档目录>/assets/`；伪造文件名带 `../`/绝对路径应被拒；非白名单扩展名应报错。
3. **链接安全**：`javascript:`/`data:` 链接点击无反应且控制台报「禁止打开」；相对链接 `[x](../outside.md)` 被阻止；`[x](./a.md)` 正常打开；`[x](#anchor)` 页内滚动。
4. **主题切换不丢最近文件**：切换 content-theme / welcome 深色后，`recent_files` 仍在（config.json 里 recent_files 不清空）。

### 🟠 P1
5. **reset 配置**：more → Reset config → 确认 → 页面重载，`vditor_options`/`recent_files` 都清空。
6. **表格多表/空单元格**：文档里有 2 张表，编辑第 2 张表的空单元格不误改第 1 张；增删行列定位正确。
7. **打开/另存不卡 UI**：点打开文件后对话框出现期间，窗口可正常拖拽/响应。
8. **另存后不误报外部修改**：另存为新文件 → 切走再切回，不弹「外部修改」。

### 🟡 P2
9. **表格对齐保留**：含 `|:---|:---:|` 的表插入/删除列后各列对齐不变；连续两次增删列不错位；空表插入行与表头同列数。
10. **IPC 节流**：连续打字时 devtools/日志中 `set_dirty` 不随每次按键刷屏；标题更新不频繁。
11. **查找栏**：Ctrl+F 高亮正常；Vditor 重建（reset 后 reload）再 Ctrl+F 仍工作；超大文档搜索不卡死。
12. **图片上传失败不崩**：粘贴超大/损坏图片 → 弹「图片读取失败」，无 unhandled rejection。
13. **新建文件基准正确**：Ctrl+N 后相对链接、图片保存不再基于旧文件目录。

### 🟢 P3（本次清理回归）
14. **控制台无 `[fix-table]` 刷屏**（L1）。
15. **快速连续点两个不同工具栏按钮**：两个都生效，不被吞（L3）。
16. **打开文件后立即输入**：前 100ms 内的输入不被吞（L6）。
17. **`zh-Hans-CN` 等语言**：界面文案是中文而非英文（L7）。
18. **损坏 config.json**：手动写坏 config.json 后启动不崩溃，生成 `config.json.bak`（L10）。

---

## 四、各项手动验证步骤

### 批次 1 重点步骤

**1.1 关闭确认三态（S5/S6）**
1. 打开一个文件，输入内容（dirty）。
2. 点窗口关闭 X → 弹「有未保存的修改。是否在关闭前保存？」。
3. 分别点「保存并关闭」「不保存」「取消关闭」，验证：保存后关闭 / 直接关闭 / 不关闭。
4. 按 Esc 关对话框 → 不关闭。
5. 极端：把文档目录改成只读后再点「保存并关闭」→ 弹保存失败且**窗口不关**。

**1.2 图片上传（S1）**
1. 打开某目录下 md，粘贴一张图片。
2. 确认文件落在 `<md所在目录>/assets/`，markdown 里是 `![](assets/xxx.png)`。
3. 手动改 config（或抓包）构造带 `../evil.png` 的名字 → 应被拒存。
4. 粘贴一个 `.exe`（如拖文件）→ 弹「不支持的图片格式」。

**1.3 链接（S3）**
1. 写 `[a](javascript:alert(1))` → 点击无弹窗。
2. 写 `[b](../../outside.md)` → 点击弹「链接越出文档目录」。
3. 写 `[c](./sub.md)` → 正常用系统默认程序打开。
4. 写 `[d](#heading)` → 页内平滑滚动到标题。

### 批次 2 重点步骤

**2.1 reset 配置**
1. more → Reset config → 出现脏文件提示 → 丢弃并重置 → 二次确认 → 页面重载。
2. 打开 config.json，确认 `vditor_options` 为 null、`recent_files` 为 `[]`。

**2.2 表格空单元格定位（S7）**
1. 建两张表，第 2 张表含空单元格。
2. 点击第 2 张表某单元格 → 操作插入行/列 → 确认改的是第 2 张表。

**2.3 对话框不卡 UI（M12）**
1. 点打开文件，对话框弹出期间拖拽窗口 → 应流畅。
2. 取消对话框 → 无报错。

### 批次 3 重点步骤

**3.1 表格对齐（M1/M2/M9）**
1. 表 `| A | B |` 分隔行 `|:---|:---:|`，选中 B 列插列 → 分隔行仍保留 `:---`/`:---:`，新列默认对齐。
2. 删列 → 其余列对齐保持。
3. 对同一张表连续「插列→删列→插列」→ 不出现错位。
4. 空表（只有表头+分隔行）插行 → 新行与表头同列数。

**3.2 输入时 IPC 下降（M4）**
1. 打开 devtools/Network 或看 Rust 日志。
2. 连续打字 20 次 → `set_dirty` 只在 dirty 值变化时发（约 1 次），`setTitle` 合并。

**3.3 查找栏（M7/M8）**
1. Ctrl+F → 输入关键字 → 高亮与计数正确，Enter/Shift+Enter 切换。
2. reset 配置 reload 后 Ctrl+F → 仍正常。
3. 生成 10 万行文档 → Ctrl+F 搜索 → 不卡死、不高亮超 500 条。

**3.4 上传异常（M11）**
1. 粘贴超大图片（>20MB）→ Rust 弹「图片过大」。
2. 用坏文件（内容非 base64 图片）→ 弹「图片读取失败」。

**3.5 新建文件基准（M14）**
1. 打开 A.md，粘贴图片 → 存到 A 的 assets/。
2. Ctrl+N 新建 → 粘贴图片 → 弹「请先保存文件再粘贴图片」（不基于 A 目录乱存）。

### 批次 4 重点步骤

**4.1 L1 控制台干净**
1. 打开 devtools console，操作表格（插删行列、对齐）→ 无 `[fix-table]` 前缀日志。

**4.2 L3 相邻按钮**
1. 快速连续点「加粗」再点「斜体」（<300ms）→ 两个都生效。
2. 点一次「加粗」→ 只保存一次配置（Network 里 save_config 只发一次）。

**4.3 L4 window.open**
1. 控制台执行 `const w = window.open('https://example.com')` → 返回 `null`，且链接被 open_link 拦截（用系统浏览器打开）。

**4.4 L6 打开后立即输入**
1. 打开大文件，setValue 完成后**立即**打字 → 字符不被吞；dirty 标记出现、自动保存正常触发。

**4.5 L7 语言前缀**
1. 把系统语言设为 `zh-Hans-CN`（或浏览器 navigator.language 为 zh-Hans-CN）→ 工具栏提示/重置文案为中文。

**4.6 L8 模式收口**
1. 编辑器切到「即时渲染/所见即所得」→ 重启 → 仍是 IR 模式（mode 不被已存配置覆盖）。

**4.7 L9 对齐变量**
1. 视觉上编辑器左右留白仍是 35px；表格编辑面板小按钮左缘与文本对齐（`left: var(--vmd-gutter)`）。

**4.8 L10 配置备份**
1. 关应用，手动把 config.json 写坏（如删掉一个逗号）→ 重启不崩溃，config.json 旁生成 `config.json.bak`。

**4.9 L11 权限收敛**
1. 正常打开/保存/另存/对话框/消息 → 全部可用（没因权限收窄而失效）。
2. 外部链接/相对链接 → 正常打开（open_link 是 Rust 命令，不受 capabilities 影响）。

**4.10 L12 文案**
1. more → Copy Markdown / Copy HTML → 成功/失败弹窗为中文。

---

## 五、P4 功能验证步骤

### P4-1 图片相对路径预览（重点，中风险）
1. 打开一个目录下的 md，粘贴图片 → markdown 出现 `![](assets/xxx.png)`。
2. **立即看渲染**：图片应显示（不再 404）；IR 模式下图片正常展示。
3. 打开一个**已含** `![](assets/xxx.png)` 的旧文档（文件存在）→ 图片能显示。
4. 文档中 `![](assets/不存在的.png)` → 显示破图，无 console 报错刷屏。
5. 含空格的图片名（如 `my image.png`）→ 能显示（URL 编码生效）。
6. 音频 `.wav` → `<audio>` 控件出现；视频 `.mp4` → `<video>` 控件出现（若缓冲慢属已知限制）。
7. 恶意路径：markdown 手写 `<img src="vmd-asset://localhost/../../etc/passwd">` → 不显示、无内容泄露。
8. 切到另一文件 → 其相对图片按新文件目录解析。

> ⚠️ 若图片仍 404：优先检查 Rust 端协议是否注册成功（启动日志/`register_uri_scheme_protocol`），以及 CSP 是否含 `vmd-asset:`。

### P4-2 滚动位置持久化
1. 打开大文档，滚到中部 → 关闭窗口。
2. 重新打开同一文件 → 滚动位置恢复到中部（±2 秒内布局稳定后重放）。
3. 打开另一个文件 → 各自保存各自位置，互不干扰。

### P4-3 行号
1. 打开文档 → 左侧出现行号 gutter，行号随内容滚动对齐。
2. 工具栏 `#` 按钮切换开/关。
3. 多行段落/列表/表格/代码块 → 行号显示**块起始行**（与上游行为一致）。
4. 编辑文档增删行 → 行号实时更新不错位。
5. 超大文档 → 滚动不卡（gutter 只渲染可见块）。

### P4-4 主题联动
1. 系统设为深色 → 启动应用 → welcome 页和编辑器都是深色。
2. 系统切浅色 → 应用**自动**变浅色（未手动点过 welcome 主题按钮时）。
3. 点 welcome 页主题按钮手动切到深色 → 再切系统主题 → 不再跟随（手动覆盖生效）。
4. 重启后仍记住手动选择（welcome_dark 配置）。

### P4-5 customCss
1. 打开 config.json（路径见下），加字段：
   ```json
   "custom_css": ".vditor-reset { line-height: 1.8 !important; }"
   ```
2. 重启应用 → 编辑器行高变 1.8。
3. 删掉字段 → 恢复默认。

> config.json 位置：Windows `%APPDATA%\com.sleephat.editor\config.json`；Linux `~/.config/com.sleephat.editor/config.json`（以 `app_config_dir()` 实际为准）。

### P4-6 imageSaveFolder
1. config.json 加字段：
   ```json
   "image_save_folder": "img"
   ```
2. 重启，粘贴图片 → 存到 `<文档目录>/img/`，markdown 里是 `![](img/xxx.png)`，且能预览。
3. 改回删除字段 → 回到默认 `assets`。
4. 配置 `"../evil"` 或绝对路径 → 粘贴报「非法的图片保存目录」，不越界写文件。

---

## 六、跨平台复验（Linux/NixOS）

- 查找栏 Ctrl+F 高亮正常（WebKitGTK 的 CSS Highlight 支持）。
- xdg-portal 打开/另存对话框正常弹出（tauri-plugin-dialog xdg-portal 特性）。
- 相对链接 `[x](./a.md)` 正常打开。
- Wayland 下启动无白屏（WEBKIT_DISABLE_COMPOSITING_MODE 仍生效）；X11 下若曾白屏则需确认 GPU 合成被保留未引发问题。

## 七、已知限制（本次报告）

1. **P4-1 音频/视频大文件**：自定义协议未实现 HTTP Range，长视频可能缓冲慢；图片完全不受影响。
2. **P4-1 自定义协议**：WebView2/WebKitGTK 对 `vmd-asset://` 的路由依赖 Tauri 运行时注册，若个别平台不路由需进一步排查（可在 Rust 协议处理器里加日志确认请求是否到达）。
3. **P4-2 滚动持久化**：localStorage 按文件绝对路径为 key；重命名/移动文件后 key 失效（旧位置丢失，正常现象）。
4. **P4-4 主题联动**：content-theme 工具栏的手动选择在当前会话内仍有效，但重启后若未手动设 welcome_dark，会被系统主题覆盖（联动语义优先）。
5. **config.json 手动编辑**：customCss / imageSaveFolder 目前需手动编辑 config.json，无 UI 入口。
