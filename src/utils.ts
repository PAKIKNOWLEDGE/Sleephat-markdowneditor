import { invoke } from '@tauri-apps/api/core'
import { ask } from '@tauri-apps/plugin-dialog'

// ── Confirm dialog (replaces jquery-confirm) ──
export async function confirm(msg: string): Promise<boolean> {
  return await ask(msg, {
    kind: 'warning',
    buttons: ['确认', '取消'],
  })
}

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
export function saveVditorOptions() {
  const options = {
    theme: vditor.vditor.options.theme,
    mode: vditor.vditor.currentMode,
    preview: vditor.vditor.options.preview,
  }
  invoke('save_config', {
    config: { vditor_options: options, recent_files: [] },
  }).catch(console.error)
}

// ── Toolbar 点击时保存配置 ──
// X11 兼容：同时监听 click 和 mousedown（部分 WebKitGTK 版本下 click 不可靠）
let _tbActionFired = false

export function handleToolbarClick() {
  document.querySelectorAll(
    '.vditor-toolbar .vditor-panel--left button, .vditor-toolbar .vditor-panel--arrow button'
  ).forEach((btn) => {
    const handler = () => {
      if (_tbActionFired) return
      _tbActionFired = true
      setTimeout(() => { _tbActionFired = false }, 300)
      setTimeout(() => { saveVditorOptions() }, 500)
    }
    btn.addEventListener('click', handler)
    btn.addEventListener('mousedown', handler)
  })
}

// ── 修复链接点击 ──
export function fixLinkClick() {
  document.addEventListener('click', (e) => {
    let el = e.target as HTMLElement
    // Walk up to find anchor
    while (el && el.tagName !== 'A') {
      el = el.parentElement as HTMLElement
    }
    if (el && el.tagName === 'A') {
      const href = (el as HTMLAnchorElement).href
      if (href) {
        e.preventDefault()
        invoke('open_link', { url: href }).catch(console.error)
      }
    }
  })
  // Override window.open
  window.open = ((url: string, ...args: any[]) => {
    invoke('open_link', { url }).catch(console.error)
    return window
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
