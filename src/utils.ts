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
export function fixPanelHover() {
  document.querySelectorAll('.vditor-panel').forEach((el) => {
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
  })
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
export function handleToolbarClick() {
  document.querySelectorAll(
    '.vditor-toolbar .vditor-panel--left button, .vditor-toolbar .vditor-panel--arrow button'
  ).forEach((btn) => {
    btn.addEventListener('click', () => {
      setTimeout(() => {
        saveVditorOptions()
      }, 500)
    })
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
export function fixCut() {
  const _exec = document.execCommand.bind(document)
  document.execCommand = ((cmd: string, ...args: any[]) => {
    if (cmd === 'delete') {
      setTimeout(() => {
        return _exec(cmd, ...args)
      })
    } else {
      return _exec(cmd, ...args)
    }
  }) as typeof document.execCommand
}
