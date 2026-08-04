/// <reference types="vite/client" />

// ── 声明 Vditor 全局类型 ──
declare global {
  interface Window {
    vditor: import('vditor').default
  }
}

import './preload'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { message, ask } from '@tauri-apps/plugin-dialog'
import { merge } from 'lodash'
import Vditor from 'vditor'
import { format } from 'date-fns'
import 'vditor/dist/index.css'
import { t, lang } from './lang'
import { toolbar } from './toolbar'
import {
  fileToBase64,
  fixCut,
  fixDarkTheme,
  fixImagePreview,
  fixLinkClick,
  fixPanelHover,
  handleToolbarClick,
  saveVditorOptions,
} from './utils'
import { fixTableIr } from './fix-table-ir'
import { initSearch } from './search'
import { initLineNumbers } from './line-numbers'
import './styles.css'

// 模块级 window 引用，供 updateTitle 等各处使用
const appWindow = getCurrentWindow()

// ── 状态 ──
let currentFilePath: string | null = null
let isDirty = false
let saveTimer: ReturnType<typeof setTimeout> | null = null
let isInitialContent = true       // 防止自动保存触发在初始化内容上
let pendingContent: string | null = null
// IPC 节流缓存（M4）：set_dirty 仅值变化发；setTitle 节流合并
let lastTitleSent = ''
let lastDirtySent: boolean | null = null
let titleTimer: ReturnType<typeof setTimeout> | null = null

// ── DOM 元素 ──
const welcomeOverlay = document.getElementById('welcome-overlay')!
const btnOpenFile = document.getElementById('btn-open-file')!
const btnNewFile = document.getElementById('btn-new-file')!
const btnWelcomeTheme = document.getElementById('btn-welcome-theme') as HTMLButtonElement | null

// ── 欢迎界面 ──
function showWelcome() {
  welcomeOverlay.style.display = 'flex'
}
function hideWelcome() {
  welcomeOverlay.style.display = 'none'
}

// ── 标题栏更新 ──
function updateTitle() {
  const name = currentFilePath
    ? currentFilePath.split(/[/\\]/).pop()
    : ''
  const prefix = isDirty ? '● ' : ''
  const title = name
    ? `${prefix}${name}`
    : 'Sleephat Editor'
  document.title = title
  // set_dirty：仅值变化时调用，避免每次按键都发一次 IPC（M4）
  if (lastDirtySent !== isDirty) {
    lastDirtySent = isDirty
    invoke('set_dirty', { dirty: isDirty }).catch(() => {})
  }
  // setTitle：节流合并连续更新（M4），标题变化才发
  if (title !== lastTitleSent) {
    lastTitleSent = title
    if (titleTimer) clearTimeout(titleTimer)
    titleTimer = setTimeout(() => {
      appWindow.setTitle(title).catch(() => {})
    }, 150)
  }
}

// ── 文件操作 ──

async function openFile(path?: string) {
  // 取消待执行的自动保存，防止旧内容自动存盘到错误路径（M5）
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  // 如果当前有未保存内容，先询问
  if (isDirty && currentFilePath) {
    // 自定义按钮的返回值是「按钮文本」而非按钮 key，需按文本比较（S6）
    const buttons = { yes: '保存并继续', no: '不保存', cancel: '取消' }
    const result = await message('当前文件有未保存的修改。是否保存？', {
      kind: 'warning',
      buttons,
    })
    // 只有明确点了「保存并继续」或「不保存」才继续，其余（含 Esc/关闭对话框）视为取消
    if (result !== buttons.yes && result !== buttons.no) return
    if (result === buttons.yes) {
      const ok = await saveFile()
      if (!ok) return // 保存失败，中止打开
    }
  }

  try {
    let filePath: string | null = null
    let content: string | null = null

    if (path) {
      filePath = path
      content = await invoke<string>('read_file', { path })
    } else {
      const result = await invoke<[string, string] | null>('open_file_dialog')
      if (!result) return // 用户取消对话框
      filePath = result[0]
      content = result[1]
    }

    currentFilePath = filePath
    isDirty = false
    isInitialContent = true
    hideWelcome()
    updateTitle()

    if (window.vditor) {
      window.vditor.setValue(content)
      // setValue 走 enableInput:false，不触发 input 回调，无需定时器释放标记（L6）。
      // 同步复位，避免吞掉打开后立即的真实输入。
      isInitialContent = false
    }
    restoreScrollPosition(filePath)
  } catch (e: any) {
    console.error('打开文件失败:', e)
    await message(`打开文件失败: ${e}`, { kind: 'error' })
  }
}

// 全局暴露 saveFile，让 toolbar.ts 可以调用
;(window as any).__saveFile = saveFile

/**
 * 保存文件
 * @param explicit true=显式保存（Ctrl+S/按钮），清 dirty 标记；false=自动保存，不清 dirty
 */
async function saveFile(explicit = true): Promise<boolean> {
  if (!currentFilePath) {
    await saveFileAs()
    return true
  }

  const content = window.vditor?.getValue() || ''
  try {
    await invoke('save_file', { path: currentFilePath, content })
    // 只有显式保存才清除 dirty 标记，auto-save 只管存盘
    if (explicit && isDirty) {
      isDirty = false
      updateTitle()
    }
    return true
  } catch (e: any) {
    console.error('保存失败:', e)
    await message(`保存失败: ${e}`, { kind: 'error' })
    return false
  }
}

async function saveFileAs() {
  const content = window.vditor?.getValue() || ''
  try {
    const path = await invoke<string | null>('save_file_as', { content })
    if (!path) return // 用户取消
    currentFilePath = path
    isDirty = false
    hideWelcome()
    updateTitle()
  } catch (e: any) {
    console.error('另存为失败:', e)
    await message(`保存失败: ${e}`, { kind: 'error' })
  }
}

async function newFile() {
  // 取消待执行的自动保存，防止新建后误弹另存为对话框（M5）
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (isDirty && currentFilePath) {
    const buttons = { yes: '保存', no: '不保存', cancel: '取消' }
    const result = await message('当前文件有未保存的修改。是否保存？', {
      kind: 'warning',
      buttons,
    })
    if (result !== buttons.yes && result !== buttons.no) return
    if (result === buttons.yes) {
      const ok = await saveFile()
      if (!ok) return // 保存失败，中止新建
    }
  }
  currentFilePath = null
  isDirty = false
  isInitialContent = true
  // 同步清空 Rust 端 current_file / is_dirty / mtime，避免相对链接、图片保存基准陈旧（M14）
  try { await invoke('clear_current_file') } catch (_) {}
  window.vditor?.setValue('')
  // setValue 不触发 input（enableInput:false），同步复位标记（L6）
  isInitialContent = false
  showWelcome()
  updateTitle()
}

// ── Vditor 初始化 ──

async function initVditor(content: string) {
  let savedOptions: any = {}
  let customCss: string | undefined
  // P4-4 主题联动：welcome_dark 为 boolean 时视为手动覆盖，否则跟随系统深浅色
  let initTheme: 'dark' | 'classic' = 'classic'
  try {
    const config = await invoke<any>('get_config')
    savedOptions = config?.vditor_options || {}
    customCss = config?.custom_css
    if (typeof config?.welcome_dark === 'boolean') {
      initTheme = config.welcome_dark ? 'dark' : 'classic'
    } else {
      const t = await appWindow.theme()
      initTheme = t === 'dark' ? 'dark' : 'classic'
    }
  } catch (_) {}

  // P4-5 customCss：用户配置的 CSS 注入到页面
  if (customCss) injectCustomCss(customCss)

  const defaultOptions: any = merge({}, savedOptions, {
    preview: {
      math: {
        inlineDigit: true,
      },
    },
  })
  // 主题联动优先于已存配置：系统/手动主题决定编辑器外观
  defaultOptions.theme = initTheme
  defaultOptions.preview = defaultOptions.preview || {}
  defaultOptions.preview.theme = {
    current: initTheme === 'dark' ? 'dark' : 'light',
  }

  if (window.vditor) {
    window.vditor.destroy()
    window.vditor = null as any
  }

  window.vditor = new Vditor('app', {
    width: '100%',
    height: '100%',
    minHeight: '100%',
    lang,
    value: content,
    cache: { enable: false },
    toolbar,
    toolbarConfig: { pin: true },
    ...defaultOptions,
    mode: 'ir', // spread 收口（L8）：init 硬编码模式不被保存配置覆盖
    after() {
      // 每个步骤独立 try-catch，防止一个崩溃拖垮全局
      try { fixDarkTheme() } catch (e) { console.error('fixDarkTheme failed:', e) }
      try { handleToolbarClick() } catch (e) { console.error('handleToolbarClick failed:', e) }
      try { fixTableIr() } catch (e) { console.error('fixTableIr failed:', e) }
      try { fixPanelHover() } catch (e) { console.error('fixPanelHover failed:', e) }
      // 初始化查找栏（幂等，见 initSearch 内部缓存）
      try { initSearch() } catch (e) { console.error('initSearch failed:', e) }
      // 行号 gutter（P4-3）
      try { initLineNumbers() } catch (e) { console.error('initLineNumbers failed:', e) }
      // 图片相对路径预览（P4-1）
      try { fixImagePreview() } catch (e) { console.error('fixImagePreview failed:', e) }
      // 有文件时自动聚焦编辑器（欢迎页场景不抢焦点）
      if (currentFilePath) {
        try { window.vditor.focus() } catch (e) { console.error('focus failed:', e) }
      }
    },
    input() {
      // 跳过初始化时的 content 设置
      if (isInitialContent) return

      // 没打开文件时不要触发自动保存
      if (!currentFilePath) return

      isDirty = true
      updateTitle()

      // 自动保存（防抖 300ms）—— 不传 explicit=false，不清 dirty 标记
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        saveFile(false)
      }, 300)
    },
    upload: {
      url: '/fuzzy',
      async handler(files: File[]) {
        if (!currentFilePath) {
          await message('请先保存文件再粘贴图片', { kind: 'info' })
          return
        }

        // M11：Promise.all 包 try-catch，避免文件读取失败产生 unhandled rejection
        let fileInfos: { base64: string; name: string }[]
        try {
          fileInfos = await Promise.all(
            files.map(async (f) => {
              const d = new Date()
              return {
                base64: await fileToBase64(f),
                name: `${format(d, 'yyyyMMdd_HHmmss')}_${f.name}`.replace(
                  /[^\w-_.]+/g, '_'
                ),
              }
            })
          )
        } catch (e: any) {
          console.error('图片读取失败:', e)
          await message(`图片读取失败: ${e}`, { kind: 'error' })
          return
        }

        try {
          // P4-6：save_images 返回相对路径（含图片目录，如 assets/xxx.png 或自定义目录）
          const savedFiles = await invoke<string[]>('save_images', {
            files: fileInfos,
          })

          savedFiles.forEach((rel) => {
            const name = rel.split('/').pop() || rel
            const ext = name.split('.').pop()?.toLowerCase() || ''
            // P4-1：不再用 new Image().onload 探测可预览性（桌面端相对路径必然 404），改按扩展名插入
            if (ext === 'wav' || ext === 'mp3') {
              window.vditor?.insertValue(
                `\n\n<audio controls="controls" src="${rel}"></audio>\n\n`
              )
            } else if (ext === 'mp4' || ext === 'webm') {
              window.vditor?.insertValue(
                `\n\n<video controls="controls" src="${rel}"></video>\n\n`
              )
            } else {
              window.vditor?.insertValue(`\n\n![](${rel})\n\n`)
            }
          })
        } catch (e: any) {
          await message(`图片上传失败: ${e}`, { kind: 'error' })
        }
      },
    },
  })
}

// ── 键盘快捷键 ──

document.addEventListener('keydown', async (e) => {
  const isCtrl = e.ctrlKey || e.metaKey

  if (isCtrl && e.key === 's') {
    e.preventDefault()
    await saveFile()
  } else if (isCtrl && e.key === 'o') {
    e.preventDefault()
    await openFile()
  } else if (isCtrl && e.key === 'n') {
    e.preventDefault()
    await newFile()
  }
})

// 欢迎界面的按钮
btnOpenFile.addEventListener('click', () => openFile())
btnNewFile.addEventListener('click', () => {
  // 直接弹出另存为对话框，让用户创建新文件
  saveFileAs()
})

// ── 关闭确认 ──
// Rust 端 api.prevent_close() 阻止关闭 → 发 close-requested 事件
// 前端弹确认框 → invoke('request_close') 让 Rust 放行关闭

listen('close-requested', async () => {
  // 取消待执行的 auto-save，防止在对话框期间偷偷存盘
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }

  // 无修改 → 直接请求关闭（不弹确认）
  if (!isDirty) {
    await invoke('request_close')
    return
  }

  const buttons = { yes: '保存并关闭', no: '不保存', cancel: '取消关闭' }
  const result = await message('有未保存的修改。是否在关闭前保存？', {
    kind: 'warning',
    buttons,
  })

  // 只有明确点了「保存并关闭」或「不保存」才继续关闭，Esc/关闭对话框视为取消关闭（S6）
  if (result !== buttons.yes && result !== buttons.no) return
  // 保存成功才继续关闭（保存失败则中止，防止丢文件）
  if (result === buttons.yes) {
    const ok = await saveFile()
    if (!ok) return
  }
  await invoke('request_close')
})

// ── 拖拽打开文件 ──

document.addEventListener('dragover', (e) => e.preventDefault())

listen<string>('file-dropped', (event) => {
  openFile(event.payload)
})

// ── 滚动位置持久化（P4-2）──
// 按文件路径存 localStorage，跨会话保留阅读位置（参考上游 getScrollEl 的实现）。
function getScrollEl(): HTMLElement | null {
  const candidates = [
    '.vditor-ir .vditor-reset',
    '.vditor-ir',
    '.vditor-content',
    '.vditor-reset',
  ]
    .map((sel) => document.querySelector<HTMLElement>(sel))
    .filter(Boolean) as HTMLElement[]
  const overflowing = candidates.find((el) => el.scrollHeight - el.clientHeight > 10)
  return overflowing || candidates[0] || null
}

const _scrollKey = (path: string) => `vmd-scroll:${path}`

let _scrollTracked = false
function trackScrollPosition() {
  if (_scrollTracked) return
  _scrollTracked = true
  // capture 监听：scroll 事件不冒泡，但 capture 阶段从 document 下行能捕获到
  document.addEventListener(
    'scroll',
    () => {
      const el = getScrollEl()
      if (!el || !currentFilePath) return
      try {
        localStorage.setItem(_scrollKey(currentFilePath), String(el.scrollTop))
      } catch (_) {}
    },
    true
  )
}

function restoreScrollPosition(path: string | null) {
  if (!path) return
  const el = getScrollEl()
  if (!el) return
  let saved = 0
  try {
    saved = parseInt(localStorage.getItem(_scrollKey(path)) || '0', 10) || 0
  } catch (_) {}
  if (!saved) return

  // 大文档的图片/表格/mermaid 异步布局会持续改变 scrollHeight（浏览器 scroll-anchoring
  // 也会挪动 scrollTop），所以轮询 height 稳定后再收手，而不是一次性设置。
  let userScrolled = false
  let done = false
  let pollTimer: ReturnType<typeof setInterval> | null = null

  const apply = () => {
    if (userScrolled || done) return
    el.scrollTop = saved
  }
  const onScroll = () => {
    if (el.scrollTop === saved) return // 自己回放产生的滚动事件，忽略
    userScrolled = true
    finish()
  }
  const finish = () => {
    if (done) return
    done = true
    if (pollTimer) clearInterval(pollTimer)
    document.removeEventListener('scroll', onScroll, true)
  }

  const POLL_MS = 150
  const SETTLE_AFTER_MS = 1200
  const HARD_CAP_MS = 20000
  const startedAt = Date.now()
  let lastHeight = el.scrollHeight
  let lastChangedAt = startedAt

  apply()
  document.addEventListener('scroll', onScroll, true)
  pollTimer = setInterval(() => {
    if (userScrolled) {
      finish()
      return
    }
    const now = Date.now()
    const h = el.scrollHeight
    if (h !== lastHeight) {
      lastHeight = h
      lastChangedAt = now
      apply()
    }
    if (now - lastChangedAt >= SETTLE_AFTER_MS) finish()
    else if (now - startedAt >= HARD_CAP_MS) finish()
  }, POLL_MS)
}

// ── 主题应用（P4-4 联动）──
// dark=true → welcome 深色 + vditor dark；dark=false → welcome 浅色 + vditor classic
function applyTheme(dark: boolean) {
  welcomeOverlay.classList.toggle('welcome-dark', dark)
  if (btnWelcomeTheme) btnWelcomeTheme.textContent = dark ? '☀️' : '🌙'
  try { window.vditor?.setTheme(dark ? 'dark' : 'classic') } catch (_) {}
}

// ── customCss 注入（P4-5）──
function injectCustomCss(css: string) {
  if (!css) return
  let style = document.getElementById('vmd-custom-css') as HTMLStyleElement | null
  if (!style) {
    style = document.createElement('style')
    style.id = 'vmd-custom-css'
    document.head.appendChild(style)
  }
  style.textContent = css
}

// ── 应用启动 ──

async function main() {
  // 尝试从命令行参数获取文件路径
  try {
    const currentFile = await invoke<string | null>('get_current_file')
    if (currentFile) {
      const content = await invoke<string>('read_file', { path: currentFile })
      pendingContent = content
      currentFilePath = currentFile
    }
  } catch (_) {}

  // 有文件内容 → 初始化 Vditor 并隐藏欢迎界面
  if (pendingContent) {
    hideWelcome()
    await initVditor(pendingContent)
    isInitialContent = false
    updateTitle()
    restoreScrollPosition(currentFilePath)
  } else {
    // 无文件 → 显示欢迎界面，但 Vditor 后台仍初始化
    showWelcome()
    await initVditor('')
    isInitialContent = false
  }

  // 滚动位置持续跟踪（幂等）
  trackScrollPosition()

  // 外部链接拦截
  fixLinkClick()
  fixCut()

  // ── 欢迎页深色/浅色 + 系统主题联动（P4-4）──
  // welcome_dark 为 boolean 视为手动覆盖，否则跟随系统深浅色
  let manualTheme: boolean | null = null
  try {
    const config = await invoke<any>('get_config')
    manualTheme = typeof config?.welcome_dark === 'boolean' ? config.welcome_dark : null
  } catch (_) {}
  const initialDark = manualTheme !== null ? manualTheme : (await appWindow.theme()) === 'dark'
  applyTheme(initialDark)

  btnWelcomeTheme?.addEventListener('click', async () => {
    const isDark = !welcomeOverlay.classList.contains('welcome-dark')
    manualTheme = isDark // 手动切换后视为覆盖，不再跟随系统
    applyTheme(isDark)
    try {
      const config = await invoke<any>('get_config')
      config.welcome_dark = isDark
      await invoke('save_config', { config })
    } catch (_) {}
  })

  // 系统深浅色切换时，未手动覆盖则跟随
  appWindow.onThemeChanged(({ payload: theme }) => {
    if (manualTheme !== null) return
    applyTheme(theme === 'dark')
  })

  // ── 外部文件修改检测：切回窗口时检查 mtime ──
  appWindow.onFocusChanged(async ({ payload: focused }) => {
    if (!focused || !currentFilePath) return
    try {
      const changed = await invoke<boolean>('check_file_changed', {
        path: currentFilePath,
      })
      if (!changed) return
      const result = await ask('文件已被外部修改，是否重新加载？', {
        kind: 'warning',
        okLabel: '重新加载',
        cancelLabel: '忽略',
      })
      if (result === true) {
        const content = await invoke<string>('read_file', {
          path: currentFilePath,
        })
        window.vditor?.setValue(content)
        restoreScrollPosition(currentFilePath)
      }
      // result === false （忽略）→ Rust 端 check_file_changed 已更新 mtime，不再重复提示
    } catch (e) {
      console.error('检查文件变更失败:', e)
    }
  })
}

main().catch(console.error)
