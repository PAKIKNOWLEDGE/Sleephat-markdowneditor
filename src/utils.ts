import { invoke } from '@tauri-apps/api/core'

// ── 切换 content-theme 时自动修改 vditor theme ──
export function fixDarkTheme() {
  const ct = document.querySelector('[data-type="content-theme"]')
  if (!ct) return
  const next = ct.nextElementSibling
  if (!next) return
  next.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    if (target.tagName !== 'BUTTON') return
    const type = target.getAttribute('data-type')
    if (type === 'dark') {
      vditor.setTheme(type)
    } else {
      vditor.setTheme('classic')
    }
    saveVditorOptions()
  })
}

// ── Panel hover 加定时延迟 ──
// X11 兼容：MutationObserver 捕获动态创建的三个点子面板
function _bindPanelHover(el: Element) {
  let timer: ReturnType<typeof setTimeout>
  el.addEventListener('mouseenter', () => {
    timer && clearTimeout(timer)
    el.classList.add('vditor-panel_hover')
  })
  el.addEventListener('mouseleave', () => {
    timer = setTimeout(() => {
      el.classList.remove('vditor-panel_hover')
    }, 2000)
  })
}

let _panelHoverObserver: MutationObserver | null = null

export function fixPanelHover() {
  // 绑定已有的面板
  document.querySelectorAll('.vditor-panel').forEach(_bindPanelHover)

  // 断开旧 observer 防泄漏（Vditor 重建 DOM 时复用）
  if (_panelHoverObserver) _panelHoverObserver.disconnect()

  // 监听后续动态创建的面板（如"三个点"子菜单）
  _panelHoverObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node instanceof HTMLElement) {
          if (node.classList.contains('vditor-panel')) {
            _bindPanelHover(node)
          }
          node.querySelectorAll('.vditor-panel').forEach(_bindPanelHover)
        }
      }
    }
  })
  _panelHoverObserver.observe(document.body, { childList: true, subtree: true })
}

// ── 文件转 base64 用于传输 ──
export const fileToBase64 = async (file: File): Promise<string> => {
  return new Promise((res, rej) => {
    const reader = new FileReader()
    reader.onload = function (evt) {
      res((evt.target!.result as string).split(',')[1])
    }
    reader.onerror = rej
    reader.readAsDataURL(file)
  })
}

// ── 保存 vditor 配置 ──
// 防抖合并：同一批多次触发（content-theme 的 fixDarkTheme + toolbar 面板 handler）只写一次 IPC（L3）
let _saveOptionsTimer: ReturnType<typeof setTimeout> | null = null
export function saveVditorOptions() {
  if (_saveOptionsTimer) clearTimeout(_saveOptionsTimer)
  _saveOptionsTimer = setTimeout(() => {
    // 不存 mode：initVditor 硬编码 ir，spread 收口后存了也会被覆盖，无需持久化（L8）
    const options = {
      theme: vditor.vditor.options.theme,
      preview: vditor.vditor.options.preview,
    }
    // 只传 vditor_options，Rust 端 save_config 做字段合并，避免清空 recent_files/welcome_dark（S4）
    invoke('save_config', {
      config: { vditor_options: options },
    }).catch(console.error)
  }, 300)
}

// ── Toolbar 点击时保存配置 ──
// X11 兼容：同时监听 click 和 mousedown（部分 WebKitGTK 版本下 click 不可靠）。
// 去重按按钮粒度而非全局：mousedown 与 click 在同一按钮上 300ms 内只记一次，
// 但相邻两次点击不同按钮不被吞掉（L3，原全局 _tbActionFired 会吞相邻按钮）。
function _isRecent(el: HTMLElement): boolean {
  const key = '__tbSaveAt'
  const now = Date.now()
  const prev = (el as any)[key]
  if (prev && now - prev < 300) return true
  ;(el as any)[key] = now
  return false
}

export function handleToolbarClick() {
  document.querySelectorAll(
    '.vditor-toolbar .vditor-panel--left button, .vditor-toolbar .vditor-panel--arrow button'
  ).forEach((btn) => {
    const handler = () => {
      if (_isRecent(btn as HTMLElement)) return
      saveVditorOptions()
    }
    btn.addEventListener('click', handler)
    btn.addEventListener('mousedown', handler)
  })
}

/**
 * Approximates the GitHub-style heading slug so in-page `#anchor` links (e.g. a Table
 * of Contents) can be matched against the rendered heading text.
 */
function slugifyHeading(text: string): string {
  return text
    .trim()
    // Vditor 的 IR 模式把字面 `#`/`##` 标记保留在 heading 的 textContent 里
    // （与最终渲染输出不同），先剥掉
    .replace(/^#{1,6}\s*/, '')
    .toLowerCase()
    .replace(/[`*_~]/g, '')
    .replace(/[^\p{L}\p{N}\- ]+/gu, '')
    // GitHub 的 slugger 逐个替换空格而不折叠连续空白，
    // 因此 "Foo & Bar"（"&" 剥掉后变 "foo  bar"）→ "foo--bar" 而非 "foo-bar"
    .replace(/ /g, '-')
}

/**
 * 滚动到与页内 `#anchor` 匹配的标题。找到并滚动返回 true。
 */
function scrollToHeadingAnchor(fragment: string): boolean {
  const target = decodeURIComponent(fragment).toLowerCase()
  const headings = document.querySelectorAll(
    '.vditor-reset h1, .vditor-reset h2, .vditor-reset h3, .vditor-reset h4, .vditor-reset h5, .vditor-reset h6'
  )
  for (const h of Array.from(headings)) {
    if (slugifyHeading(h.textContent || '') === target) {
      h.scrollIntoView({ block: 'start', behavior: 'smooth' })
      return true
    }
  }
  return false
}

// ── 修复链接点击 ──
// Vditor 的 IR 模式不会渲染真实的 <a href>：链接语法由 [data-type="a"] 包裹层内的
// .vditor-ir__marker--link span 持有 URL（见上游 zaaack/vscode-markdown-editor 对
// fixLinkClick 的重写）。因此不能简单向上找 <A> 标签，否则 IR 模式下点击链接无响应。
export function fixLinkClick() {
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement
    const link = target.closest('a')
    const irLinkMarker = target
      .closest<HTMLElement>('[data-type="a"]')
      ?.querySelector('.vditor-ir__marker--link')
    const href = link?.getAttribute('href') || irLinkMarker?.textContent || undefined

    if (!href) return
    e.preventDefault()
    e.stopPropagation()
    // 页内锚点：直接滚动到对应标题
    if (href.startsWith('#')) {
      scrollToHeadingAnchor(href.slice(1))
      return
    }
    invoke('open_link', { url: href }).catch(console.error)
  })
  // Override window.open
  // 返回 null 而非 window 自身（L4）：防止调用方拿到主窗口引用后做危险操作，
  // 也符合浏览器对"被拦截弹窗"的规范行为。
  window.open = ((url: string, ...args: any[]) => {
    invoke('open_link', { url }).catch(console.error)
    return null
  }) as typeof window.open
}

// ── 修复 execCommand recursive call bug ──
// WebKitGTK (X11) 需要同步返回 true/false，setTimeout 异步丢掉返回值会导致 Vditor 工具栏操作链中断
let _cutDepth = 0

export function fixCut() {
  const _exec = document.execCommand.bind(document)
  document.execCommand = ((cmd: string, ...args: any[]) => {
    if (cmd === 'delete') {
      if (_cutDepth > 0) return true // 重入保护，返回成功
      _cutDepth++
      try {
        return _exec(cmd, ...args)
      } finally {
        _cutDepth--
      }
    }
    return _exec(cmd, ...args)
  }) as typeof document.execCommand
}

// ── 修复图片/音视频相对路径预览（P4-1 / M10 根治）──
// 桌面端 markdown 里 `![](assets/x.png)` 的相对 src 不会按文档目录解析 → 404。
// 方案：Rust 注册自定义 vmd-asset 协议，按「当前文件所在目录」解析相对路径。
// 这里把渲染出的相对 src 改写成 vmd-asset://localhost/<path>，让 webview 走该协议。
const VMD_ASSET_SCHEME = 'vmd-asset://localhost/'

function getMediaRoot(): Element | null {
  return (
    document.querySelector('.vditor-ir .vditor-reset') ||
    document.querySelector('.vditor-wysiwyg .vditor-reset') ||
    document.querySelector('.vditor-sv .vditor-reset')
  )
}

function rewriteMediaSrcs() {
  const root = getMediaRoot()
  if (!root) return
  root
    .querySelectorAll<HTMLElement>('img[src], audio[src], video[src]')
    .forEach((el) => {
      const src = el.getAttribute('src') || ''
      if (!src) return
      // 已是绝对/协议化 URL 或锚点 → 不动
      if (/^(https?:|data:|blob:|vmd-asset:|file:|#|\/\/)/i.test(src)) return
      el.setAttribute('src', VMD_ASSET_SCHEME + encodeURI(src))
    })
}

let _mediaObserver: MutationObserver | null = null
let _mediaObservedRoot: Element | null = null
let _mediaAppObserver: MutationObserver | null = null

export function fixImagePreview() {
  const rebind = () => {
    const root = getMediaRoot()
    if (!root || root === _mediaObservedRoot) return
    _mediaObserver?.disconnect()
    _mediaObservedRoot = root
    _mediaObserver = new MutationObserver(() => rewriteMediaSrcs())
    _mediaObserver.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src'],
    })
    rewriteMediaSrcs()
  }
  rebind()
  // Vditor 重建（destroy + new Vditor）会替换 .vditor-reset 根节点，观察 #app 顶层变化重绑
  const appRoot = document.getElementById('app')
  if (appRoot) {
    if (_mediaAppObserver) _mediaAppObserver.disconnect()
    _mediaAppObserver = new MutationObserver(rebind)
    _mediaAppObserver.observe(appRoot, { childList: true })
  }
}
