/**
 * 编辑器内查找栏 —— 基于 CSS Custom Highlight API。
 * 高亮由浏览器通过 ::highlight() 伪元素纯渲染，不改动 vditor 编辑区 DOM，
 * 因此不影响 vditor 内部状态。
 *
 * 移植自上游 zaaack/vscode-markdown-editor 的 media-src/src/search.ts，
 * 样式已移到 styles.css（配色改为 Sleephat 自有的深色查找条）。
 */

let searchRanges: Range[] = []
let currentIndex = -1
let debounceTimer: ReturnType<typeof setTimeout> | null = null

// 高亮上限与分批构造步长（M8）：超大文档直接 new Highlight(...ranges) 展开会栈溢出
const MAX_HIGHLIGHT_RANGES = 500
const HIGHLIGHT_BATCH_SIZE = 50

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function getEditorRoot(): Element | null {
  return (
    document.querySelector('.vditor-ir .vditor-reset') ||
    document.querySelector('.vditor-wysiwyg .vditor-reset') ||
    document.querySelector('.vditor-sv .vditor-reset')
  )
}

function findAllRanges(query: string, caseSensitive: boolean): Range[] {
  const root = getEditorRoot()
  if (!root || !query) return []

  const flags = caseSensitive ? 'g' : 'gi'
  const regex = new RegExp(escapeRegex(query), flags)
  const ranges: Range[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)

  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    const text = node.textContent || ''
    regex.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = regex.exec(text)) !== null) {
      const range = document.createRange()
      range.setStart(node, match.index)
      range.setEnd(node, match.index + match[0].length)
      ranges.push(range)
    }
  }
  return ranges
}

function applyHighlights(ranges: Range[], activeIdx: number) {
  if (typeof CSS === 'undefined' || !CSS.highlights) return

  const Highlight = (window as any).Highlight
  // 只高亮前 N 个，防超大文档渲染卡死（M8）；当前项单独高亮不受此限
  const visible = ranges.slice(0, MAX_HIGHLIGHT_RANGES)

  if (visible.length > 0) {
    // 分批构造：先小批量展开，其余 add()，避免 new Highlight(...超长数组) 栈溢出（M8）
    const hl = new Highlight(...visible.slice(0, HIGHLIGHT_BATCH_SIZE))
    for (let i = HIGHLIGHT_BATCH_SIZE; i < visible.length; i++) {
      hl.add(visible[i])
    }
    CSS.highlights.set('vmd-search-result', hl)
  } else {
    CSS.highlights.delete('vmd-search-result')
  }

  if (activeIdx >= 0 && activeIdx < ranges.length) {
    CSS.highlights.set('vmd-search-current', new Highlight(ranges[activeIdx]))
  } else {
    CSS.highlights.delete('vmd-search-current')
  }
}

function clearHighlights() {
  if (typeof CSS !== 'undefined' && CSS.highlights) {
    CSS.highlights.delete('vmd-search-result')
    CSS.highlights.delete('vmd-search-current')
  }
  searchRanges = []
  currentIndex = -1
}

function scrollToActive(ranges: Range[], idx: number) {
  if (idx < 0 || idx >= ranges.length) return
  try {
    const el = ranges[idx].startContainer.parentElement
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  } catch (_) {
    // range may be stale after a content mutation
  }
}

export function initSearch() {
  // 幂等：重复调用（如 Vditor 重建）时复用已创建的查找栏
  if ((window as any).__vmdSearch) {
    return (window as any).__vmdSearch
  }

  // 构建查找栏（样式见 styles.css）
  const bar = document.createElement('div')
  bar.id = 'vmd-search-bar'
  bar.setAttribute('aria-hidden', 'true')
  bar.innerHTML = `
    <input id="vmd-search-input" type="text" placeholder="Find…" spellcheck="false" autocomplete="off" />
    <span id="vmd-search-count"></span>
    <button id="vmd-search-prev" title="Previous match (Shift+Enter)">&#9650;</button>
    <button id="vmd-search-next" title="Next match (Enter)">&#9660;</button>
    <label id="vmd-search-case-label" title="Match case">
      <input type="checkbox" id="vmd-search-case" /> Aa
    </label>
    <button id="vmd-search-close" title="Close (Esc)">&#10005;</button>
  `
  document.body.appendChild(bar)

  const input = document.getElementById('vmd-search-input') as HTMLInputElement
  const countEl = document.getElementById('vmd-search-count') as HTMLSpanElement
  const prevBtn = document.getElementById('vmd-search-prev') as HTMLButtonElement
  const nextBtn = document.getElementById('vmd-search-next') as HTMLButtonElement
  const caseCheckbox = document.getElementById('vmd-search-case') as HTMLInputElement
  const closeBtn = document.getElementById('vmd-search-close') as HTMLButtonElement

  let isOpen = false

  function open() {
    isOpen = true
    rebindObserver() // 打开查找栏时重绑，确保盯住当前编辑区（M7）
    bar.classList.add('vmd-search-bar--open')
    bar.setAttribute('aria-hidden', 'false')
    input.focus()
    input.select()
    if (input.value) runSearch()
  }

  function close() {
    isOpen = false
    bar.classList.remove('vmd-search-bar--open')
    bar.setAttribute('aria-hidden', 'true')
    clearHighlights()
    countEl.textContent = ''
  }

  function updateCount() {
    const total = searchRanges.length
    countEl.textContent = total > 0 ? `${currentIndex + 1}/${total}` : input.value ? '0/0' : ''
    countEl.classList.toggle('vmd-search-count--nomatch', total === 0 && input.value.length > 0)
  }

  function runSearch() {
    searchRanges = findAllRanges(input.value, caseCheckbox.checked)
    currentIndex = searchRanges.length > 0 ? 0 : -1
    applyHighlights(searchRanges, currentIndex)
    if (currentIndex >= 0) scrollToActive(searchRanges, currentIndex)
    updateCount()
  }

  function goNext() {
    if (searchRanges.length === 0) return
    currentIndex = (currentIndex + 1) % searchRanges.length
    applyHighlights(searchRanges, currentIndex)
    scrollToActive(searchRanges, currentIndex)
    updateCount()
  }

  function goPrev() {
    if (searchRanges.length === 0) return
    currentIndex = (currentIndex - 1 + searchRanges.length) % searchRanges.length
    applyHighlights(searchRanges, currentIndex)
    scrollToActive(searchRanges, currentIndex)
    updateCount()
  }

  input.addEventListener('input', runSearch)
  caseCheckbox.addEventListener('change', runSearch)

  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      e.shiftKey ? goPrev() : goNext()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  })

  prevBtn.addEventListener('click', goPrev)
  nextBtn.addEventListener('click', goNext)
  closeBtn.addEventListener('click', close)

  // Ctrl+F / Cmd+F —— 在浏览器默认行为之前拦截
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === 'f') {
      e.preventDefault()
      e.stopPropagation()
      open()
    }
  }, true)

  // 编辑器内容变化时重跑搜索，保持高亮 range 有效（M7）
  // Vditor 重建（destroy + new Vditor）会替换 .vditor-reset 根节点，旧 observer 盯的是分离节点 → 失效。
  // 这里通过 #app 顶层变化检测重建，disconnect 旧 observer 后重绑新的。
  let searchObserver: MutationObserver | null = null
  let observedRoot: Element | null = null

  function rebindObserver() {
    const root = getEditorRoot()
    if (!root || root === observedRoot) return
    searchObserver?.disconnect()
    observedRoot = root
    searchObserver = new MutationObserver(() => {
      if (!isOpen || !input.value) return
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(runSearch, 300)
    })
    searchObserver.observe(root, { childList: true, subtree: true, characterData: true })
  }

  // 等 vditor 完全挂载后再开始监听
  setTimeout(rebindObserver, 1000)

  // 监听编辑器容器顶层变化：Vditor 重建时根节点被替换，据此重绑（M7）
  const appRoot = document.getElementById('app')
  if (appRoot) {
    new MutationObserver(rebindObserver).observe(appRoot, { childList: true })
  }

  const api = { open, close }
  ;(window as any).__vmdSearch = api
  return api
}
