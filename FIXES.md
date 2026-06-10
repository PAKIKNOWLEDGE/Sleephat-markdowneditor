# 修复记录 — 2025-06-10

本次会话全部改动，目标：**X11 (WebKitGTK) 兼容** + 漏洞修复，Debian trixie / i3wm 环境。

---

## X11 兼容修复

### 1. 工具栏点击失效 → `fixCut()` 重写
**文件：** `src/utils.ts`

`document.execCommand('delete')` 被 `setTimeout(0)` 异步包装，返回 `undefined`。WebKitGTK 严格检查返回值——收到 `undefined` 认为操作失败，Vditor 的加粗、斜体等整个工具栏操作链被截断。

**改法：** 用重入深度锁（`_cutDepth`）替代 `setTimeout`，保持同步执行 + 返回正确的布尔值。

### 2. 表格面板按钮无反应 → 改为 markdown 源码操作
**文件：** `src/fix-table-ir.ts`

三个问题叠加：
- `new KeyboardEvent()` 产生的 `isTrusted: false` 事件被 WebKitGTK 忽略
- `execCommand('insertRow'/'insertCol')` 是 IE 专属命令，WebKit 从来不支持
- CSS `::after` 白色遮罩挡在所有面板按钮上

**改法：**
- 改用 **markdown 源码直接操作**：`vditor.getValue()` → 解析表格 → 增删行列 → `vditor.setValue()`，不碰 DOM
- `::after` 加 `pointer-events: none` 让点击穿透
- 表格面板加 `.vditor-panel-ir` CSS 覆盖，始终完整显示
- `_lastCell` 检测改为从 `anchorNode` 向上遍历，兼容空单元格

### 3. "三个点"子菜单点不动
**根因：** CSS `.vditor-panel::after` 是个 21×21 白色方块，覆盖在所有面板按钮上。`fixPanelHover()` 没有捕获到动态创建的面板。

**改法：**
- `::after` → `pointer-events: none`
- `fixPanelHover()` 加 `MutationObserver` 捕获动态面板
- Observer 存到模块级变量，复用前先 `disconnect()`

### 4. `after()` 回调容错隔离
**文件：** `src/main.ts`

每个初始化步骤（`fixDarkTheme`、`handleToolbarClick`、`fixTableIr`、`fixPanelHover`）各自 `try-catch` 包裹，一个崩溃不拖垮全部。

---

## 用户体验修复

### 5. 关闭弹窗点"不保存"却存了
auto-save 的 300ms 防抖定时器在确认对话框期间抢跑，用户点"不保存"之前内容已写盘。

**改法：** `close-requested` 事件监听器里立即取消 `saveTimer`。

### 6. auto-save 不再清除 dirty 标记
`saveFile(explicit)` 加参数：显式保存（Ctrl+S / 工具栏按钮）传 `true`，清 dirty；auto-save 传 `false`，只存盘不清标记。确保关闭时只要有过修改就会弹确认框。

### 7. 欢迎界面加"新建文件"按钮
**文件：** `index.html`、`src/main.ts`

加了 `btn-new-file` 按钮和 Ctrl+N 提示。点击直接弹出另存为对话框。

### 8. 命令行打开文件
**文件：** `src-tauri/src/lib.rs`

`setup()` 读取 `std::env::args()`，跳过 flag 和 http 开头的参数，首个有效路径存入 `AppState.current_file`。`sleephat-editor ~/notes/test.md` 可直接打开。

### 9. 窗口标题修复
`appWindow.setTitle()` 因为 `appWindow` 是 `main()` 内局部变量而 `updateTitle()` 是模块级函数，抛 `ReferenceError`。

**改法：** `appWindow` 提到模块顶层。标题统一为 "Sleephat Editor"，打开文件后只显示文件名。

### 10. 外部文件修改检测
窗口获得焦点时调 `check_file_changed` 对比文件 mtime。用 vim 外部改文件后切回编辑器弹提示重载。

---

## 代码审计修复

### 11. `saveFileAs` 吞错误
`catch (_) {}` 改成 `catch (e) { message(error) }`。

### 12. 重置配置前检查脏文件
`reset-config` 的 `click()` 里加了 `invoke('is_dirty')` 检查，有未保存内容先弹确认。

### 13. `force_close` 竞态
`force_close` 的读取和复位放在同一 `Mutex` 锁作用域内，防止双击关闭卡住。

### 14. MutationObserver 泄漏
Observer 存到 `_panelHoverObserver`，Vditor 重建 DOM 时先 `disconnect()`。

### 15. 移除 RPM 打包
`tauri.conf.json` 的 targets 从 `["msi", "rpm"]` 改为 `["msi", "deb"]`。

