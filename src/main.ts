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
  fixLinkClick,
  fixPanelHover,
  handleToolbarClick,
  saveVditorOptions,
} from './utils'
import { fixTableIr } from './fix-table-ir'
import './styles.css'

// ── 状态 ──
let currentFilePath: string | null = null
let isDirty = false
let saveTimer: ReturnType<typeof setTimeout> | null = null
let isInitialContent = true       // 防止自动保存触发在初始化内容上
let pendingContent: string | null = null

// ── DOM 元素 ──
const welcomeOverlay = document.getElementById('welcome-overlay')!
const btnOpenFile = document.getElementById('btn-open-file')!

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
  document.title = name
    ? `${prefix}${name} — Markdown Editor`
    : 'Markdown Editor'
  invoke('set_dirty', { dirty: isDirty }).catch(() => {})
}

// ── 文件操作 ──

async function openFile(path?: string) {
  // 如果当前有未保存内容，先询问
  if (isDirty && currentFilePath) {
    const result = await ask(
      '当前文件有未保存的修改。是否保存？',
      {
        kind: 'warning',
        buttons: ['保存并继续', '不保存', '取消'],
      }
    )
    if (result === null) return // 取消
    if (result === true) {
      await saveFile()
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
      // setTimeout 确保 setValue 完成后再释放标记
      setTimeout(() => { isInitialContent = false }, 100)
    }
  } catch (e: any) {
    console.error('打开文件失败:', e)
    await message(`打开文件失败: ${e}`, { kind: 'error' })
  }
}

// 全局暴露 saveFile，让 toolbar.ts 可以调用
;(window as any).__saveFile = saveFile
async function saveFile() {
  if (!currentFilePath) {
    await saveFileAs()
    return
  }

  const content = window.vditor?.getValue() || ''
  try {
    await invoke('save_file', { path: currentFilePath, content })
    if (isDirty) {
      isDirty = false
      updateTitle()
    }
  } catch (e: any) {
    console.error('保存失败:', e)
    await message(`保存失败: ${e}`, { kind: 'error' })
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
  } catch (_) {}
}

async function newFile() {
  if (isDirty && currentFilePath) {
    const result = await ask('当前文件有未保存的修改。是否保存？', {
      kind: 'warning',
      buttons: ['保存', '不保存', '取消'],
    })
    if (result === null) return
    if (result === true) {
      await saveFile()
    }
  }
  currentFilePath = null
  isDirty = false
  isInitialContent = true
  window.vditor?.setValue('')
  setTimeout(() => { isInitialContent = false }, 100)
  showWelcome()
  updateTitle()
}

// ── Vditor 初始化 ──

async function initVditor(content: string) {
  let savedOptions: any = {}
  try {
    const config = await invoke<any>('get_config')
    savedOptions = config?.vditor_options || {}
  } catch (_) {}

  const defaultOptions: any = merge({}, savedOptions, {
    preview: {
      math: {
        inlineDigit: true,
      },
    },
  })

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
    mode: 'ir',
    cache: { enable: false },
    toolbar,
    toolbarConfig: { pin: true },
    ...defaultOptions,
    after() {
      fixDarkTheme()
      handleToolbarClick()
      fixTableIr()
      fixPanelHover()
    },
    input() {
      // 跳过初始化时的 content 设置
      if (isInitialContent) return

      // 没打开文件时不要触发自动保存
      if (!currentFilePath) return

      isDirty = true
      updateTitle()

      // 自动保存（防抖 300ms）
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        saveFile()
      }, 300)
    },
    upload: {
      url: '/fuzzy',
      async handler(files: File[]) {
        if (!currentFilePath) {
          await message('请先保存文件再粘贴图片', { kind: 'info' })
          return
        }

        const dirPath = currentFilePath.split(/[/\\]/).slice(0, -1).join('/') + '/assets'

        const fileInfos = await Promise.all(
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

        try {
          const savedFiles = await invoke<string[]>('save_images', {
            dir: dirPath,
            files: fileInfos,
          })

          savedFiles.forEach((f) => {
            const relativePath = `assets/${f}`
            if (f.endsWith('.wav')) {
              window.vditor?.insertValue(
                `\n\n<audio controls="controls" src="${relativePath}"></audio>\n\n`
              )
            } else {
              const img = new Image()
              img.src = relativePath
              img.onload = () => {
                window.vditor?.insertValue(`\n\n![](${relativePath})\n\n`)
              }
              img.onerror = () => {
                window.vditor?.insertValue(`\n\n[${f}](${relativePath})\n\n`)
              }
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

// 欢迎界面的"打开文件"按钮
btnOpenFile.addEventListener('click', () => openFile())

// ── 关闭确认 ──

// ── 关闭确认 ──
// Rust 端 api.prevent_close() 阻止关闭 → 发 close-requested 事件
// 前端弹确认框 → invoke('request_close') 让 Rust 放行关闭

listen('close-requested', async () => {
  // 无修改 → 直接请求关闭（不弹确认）
  if (!isDirty) {
    await invoke('request_close')
    return
  }

  const result = await ask('有未保存的修改。是否在关闭前保存？', {
    kind: 'warning',
    buttons: ['保存并关闭', '不保存', '取消关闭'],
  })

  if (result === true) {
    await saveFile()
    await invoke('request_close')
  } else if (result === false) {
    await invoke('request_close')
  }
  // 取消 → 什么也不做
})

// 监听 Rust 端保存成功事件，清除脏标记
listen('saved', () => {
  if (isDirty) {
    isDirty = false
    updateTitle()
  }
})

// ── 拖拽打开文件 ──

document.addEventListener('dragover', (e) => e.preventDefault())

document.addEventListener('drop', async (e) => {
  e.preventDefault()
  // Tauri v2 WebView 拖拽获取不到文件路径，暂时跳过
})

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
  } else {
    // 无文件 → 显示欢迎界面，但 Vditor 后台仍初始化
    showWelcome()
    await initVditor('')
    isInitialContent = false
  }

  // 外部链接拦截
  fixLinkClick()
  fixCut()
}

main().catch(console.error)
