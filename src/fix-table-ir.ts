/**
 * IR 模式下支持 Table 编辑
 *
 * 策略：在 markdown 源码上直接改表格 → vditor.setValue() 重渲染。
 * 不走 DOM 操作（Vditor 的 Lute 引擎会对 HTML 做内部标记，手工创建的 DOM 节点缺属性导致 HTML2Md 丢失）。
 * 不走 execCommand（insertRow/insertCol 仅在 IE 支持，WebKit 不支持）。
 */
const tablePanelId = 'fix-table-ir-wrapper'

// ── 本地复制的 updateHotkeyTip（L2：不再深导入 vditor 内部源码，升级 vditor 不破）──
function updateHotkeyTip(hotkey: string): string {
  const isMac = /Mac/.test(navigator.platform) || navigator.platform === 'iPhone'
  const isFirefox = navigator.userAgent.toLowerCase().indexOf('firefox') > -1
  if (isMac) {
    if (hotkey.indexOf('⇧') > -1 && isFirefox) {
      hotkey = hotkey.replace(';', ':').replace('=', '+').replace('-', '_')
    }
  } else {
    if (hotkey.startsWith('⌘')) {
      hotkey = hotkey.replace('⌘', '⌘+')
    } else if (hotkey.startsWith('⌥') && hotkey.substr(1, 1) !== '⌘') {
      hotkey = hotkey.replace('⌥', '⌥+')
    } else {
      hotkey = hotkey.replace('⇧⌘', '⌘+⇧+').replace('⌥⌘', '⌥+⌘+')
    }
    hotkey = hotkey
      .replace('⌘', 'Ctrl')
      .replace('⇧', 'Shift')
      .replace('⌥', 'Alt')
    if (hotkey.indexOf('Shift') > -1) {
      hotkey = hotkey.replace(';', ':').replace('=', '+').replace('-', '_')
    }
  }
  return hotkey
}

/** 用户最后点击的单元格引用（setValue 重渲染后失效，见 M2） */
let _lastCell: HTMLElement | null = null

/**
 * 用户最后点击的单元格的 markdown 坐标。
 * setValue 重渲染后 _lastCell 指向分离节点，但坐标仍有效，用于操作定位与重绑定（M2）。
 */
let _lastPos: { tableIndex: number; row: number; col: number } | null = null

// ── 选区 ───────────────────────────────────────────

function getCellIndex(cell: HTMLElement): number {
  const tr = cell.closest('tr')
  if (!tr) return -1
  return Array.from(tr.children).indexOf(cell)
}

function getRowIndex(cell: HTMLElement): number {
  const tr = cell.closest('tr')
  if (!tr) return -1
  const table = cell.closest('table')
  if (!table) return -1
  const domRow = Array.from(table.querySelectorAll('tr')).indexOf(tr)
  if (domRow < 0) return -1
  // DOM 行号 → markdown 行号（结构映射，S7）：
  // DOM  0=表头(thead)，1+=数据行
  // md   0=表头，1=分隔行，2+=数据行  → 数据行需 +1
  return domRow === 0 ? 0 : domRow + 1
}

// ── Markdown 表格操作 ─────────────────────────────

/** 解析一行 markdown 表格单元 */
function parseRow(line: string): string[] {
  const trimmed = line.replace(/^\s*\||\|\s*$/g, '')
  return trimmed.split('|').map((c) => c.trim())
}

/**
 * 找指定序号表格在 markdown 中的起止行号。
 *
 * 结构映射（S7）：不用单元格文本反查（空单元格 `includes("")` 恒真会误命中第一张表），
 * 而是用 DOM 中该 `<table>` 在 IR 内容里的序号 → markdown 中同序号的表格。
 * Vditor 按源码顺序渲染表格，两者序号一致。
 *
 * @param tableIndex 表格序号（DOM 中第几个 `<table>`，也是 markdown 中第几个表格）
 */
function findMarkdownTable(md: string, tableIndex: number): { lines: string[]; start: number } | null {
  const lines = md.split('\n')
  let found = 0
  let i = 0
  let inFence = false
  while (i < lines.length) {
    const line = lines[i]
    // 跳过围栏代码块：其中形似表格的文本不会渲染成 <table>，不参与序号计数
    if (/^(`{3,}|~{3,})/.test(line.trimStart())) {
      inFence = !inFence
      i++
      continue
    }
    if (inFence || !line.trimStart().startsWith('|')) { i++; continue }
    // 找到分隔行，确认是完整表格
    if (i + 1 >= lines.length) { i++; continue }
    const sep = lines[i + 1]
    if (!sep.match(/^\s*\|[\s\-:]+\|/)) { i++; continue }

    // 收集完整表格行
    const tableLines: string[] = []
    let j = i
    while (j < lines.length && lines[j].trimStart().startsWith('|')) {
      tableLines.push(lines[j])
      j++
    }
    if (found === tableIndex) {
      return { lines: tableLines, start: i }
    }
    found++
    i = j
  }
  return null
}

/** 构建一列分隔符 */
function sepStr(align: string): string {
  if (align === 'left') return ':---'
  if (align === 'center') return ':---:'
  if (align === 'right') return '---:'
  return '---'
}

/** 重建整个表格行文本 */
function buildRow(cells: string[], aligns: string[], isSep: boolean): string {
  if (isSep) {
    return '|' + cells.map((_, i) => sepStr(aligns[i] || '')).join('|') + '|'
  }
  return '|' + cells.map((c) => c || ' ').join('|') + '|'
}

/** 解析分隔行的对齐信息（M1：插入/删除列时保留列对齐） */
function parseAligns(sepLine: string): string[] {
  return parseRow(sepLine).map((c) => {
    const t = c.trim()
    if (t.startsWith(':') && t.endsWith(':')) return 'center'
    if (t.endsWith(':')) return 'right'
    if (t.startsWith(':')) return 'left'
    return ''
  })
}

/** 在 markdown 上操作后再渲染 */
function modifyTable(
  md: string,
  pos: { tableIndex: number; row: number; col: number },
  fn: (lines: string[], row: number, col: number) => boolean
) {
  const found = findMarkdownTable(md, pos.tableIndex)
  if (!found) return md

  const changed = fn(found.lines, pos.row, pos.col)
  if (!changed) return md

  // 替换原表格
  const allLines = md.split('\n')
  allLines.splice(found.start, found.lines.length, ...found.lines)
  return allLines.join('\n')
}

/** setValue 重渲染后，按 markdown 坐标在新区重新定位单元格（M2） */
function rebindLastCell() {
  if (!_lastPos) return
  const eventRoot = vditor.vditor.ir!.element
  const table = eventRoot.querySelectorAll('table')[_lastPos.tableIndex]
  if (!table) return
  // md 行号 → DOM 行号：md 0=表头=DOM 0；md 2+=数据行 → DOM row-1（md 1 是分隔行，无 DOM 行）
  const domRow = Math.max(0, _lastPos.row - 1)
  const tr = table.querySelectorAll('tr')[domRow]
  if (!tr) return
  const cell = tr.children[_lastPos.col] as HTMLElement | undefined
  if (cell && (cell.tagName === 'TD' || cell.tagName === 'TH')) {
    _lastCell = cell
  }
}

function applyAndSync(fn: (lines: string[], row: number, col: number) => boolean) {
  // 优先用 markdown 坐标定位（重渲染后仍有效，M2）；无坐标时回退到 DOM 单元格推导
  let pos = _lastPos
  if (!pos && _lastCell) {
    const eventRoot = vditor.vditor.ir!.element
    const domTable = _lastCell.closest('table')
    const tableIndex = domTable
      ? Array.from(eventRoot.querySelectorAll('table')).indexOf(domTable)
      : -1
    const row = getRowIndex(_lastCell)
    const col = getCellIndex(_lastCell)
    if (tableIndex >= 0 && row >= 0 && col >= 0) {
      pos = { tableIndex, row, col }
      _lastPos = pos
    }
  }
  if (!pos) return
  try {
    const md = vditor.getValue()
    const newMd = modifyTable(md, pos, fn)
    if (newMd !== md) {
      vditor.setValue(newMd)
      // setValue 重渲染后 _lastCell 失效，按坐标重新绑定（M2）
      rebindLastCell()
    }
  } catch (e) {
    console.error('表格操作失败:', e)
  }
}

// ── 具体操作 ──────────────────────────────────────

function insertRow(above: boolean) {
  applyAndSync((lines, row, col) => {
    // row 从 0 开始，0=表头，1=分隔行，2+=数据行
    const dataRows = lines.slice(2) // 除去表头和分隔行
    const dataIdx = Math.max(0, row - 2)
    // 空表（仅表头+分隔行）时 lines[2] 不存在，按表头列数生成新行（M9）
    const colCount = parseRow(lines[0] || '').length
    const newRow = '|' + Array(colCount).fill(' ').join('|') + '|'
    if (above) {
      dataRows.splice(dataIdx, 0, newRow)
    } else {
      dataRows.splice(dataIdx + 1, 0, newRow)
    }
    // 重组: 表头 + 分隔行 + 数据行
    lines.splice(2, lines.length - 2, ...dataRows)
    return true
  })
}

function deleteRowOp() {
  applyAndSync((lines, row, _col) => {
    if (row < 2) return false // 不删表头和分隔行
    if (lines.length <= 3) return false // 至少保留一行数据
    lines.splice(row, 1)
    return true
  })
}

function insertColumn(left: boolean) {
  applyAndSync((lines, row, col) => {
    const targetCol = left ? col : col + 1
    // 保留原分隔行的对齐，新列用默认对齐（M1：不能传空 aligns，否则全部列对齐被抹平）
    const aligns = parseAligns(lines[1] || '')
    aligns.splice(targetCol, 0, '')
    for (let i = 0; i < lines.length; i++) {
      const cells = parseRow(lines[i])
      cells.splice(targetCol, 0, ' ')
      lines[i] = buildRow(cells, aligns, i === 1)
    }
    return true
  })
}

function deleteColumnOp() {
  applyAndSync((lines, _row, col) => {
    if (lines.length === 0) return false
    if (parseRow(lines[0]).length <= 1) return false // 至少保留一列
    // 保留对齐信息（M1）
    const aligns = parseAligns(lines[1] || '')
    aligns.splice(col, 1)
    for (let i = 0; i < lines.length; i++) {
      const cells = parseRow(lines[i])
      cells.splice(col, 1)
      lines[i] = buildRow(cells, aligns, i === 1)
    }
    return true
  })
}

function alignColumn(align: string) {
  applyAndSync((lines, _row, col) => {
    // 只改目标列对齐，其余列保持原样（M1：传空 aligns 会把整行分隔符抹成默认对齐）
    const aligns = parseAligns(lines[1] || '')
    aligns[col] = align
    const sepCells = parseRow(lines[1])
    lines[1] = buildRow(sepCells, aligns, true)
    return true
  })
}

// ── 操作映射 ──────────────────────────────────────

const handleMap: Record<string, () => void> = {
  left:          () => alignColumn('left'),
  center:        () => alignColumn('center'),
  right:         () => alignColumn('right'),
  insertRowA:    () => insertRow(true),
  insertRowB:    () => insertRow(false),
  deleteRow:     deleteRowOp,
  insertColumnL: () => insertColumn(true),
  insertColumnR: () => insertColumn(false),
  deleteColumn:  deleteColumnOp,
}

let _panelActionFired = false

function handlePanelAction(e: Event) {
  if (_panelActionFired) return
  _panelActionFired = true
  setTimeout(() => { _panelActionFired = false }, 300)

  const target = e.target as HTMLElement
  const button = target.closest('.vditor-icon') as HTMLElement | null
  if (!button) return
  const type = button.getAttribute('data-type')
  if (!type) return
  const handler = handleMap[type]
  if (handler) handler()
}

// ── i18n ───────────────────────────────────────────

function i18n(): any {
  return (window as any).VditorI18n || {}
}

// ── 入口 ───────────────────────────────────────────

export function fixTableIr() {
  const eventRoot = vditor.vditor.ir!.element

  function insertTablePanel(): HTMLDivElement {
    let tablePanel = eventRoot.querySelector<HTMLDivElement>(`#${tablePanelId}`)
    if (!tablePanel) {
      tablePanel = document.createElement('div')
      tablePanel.id = tablePanelId
      eventRoot.appendChild(tablePanel)

      const _ = i18n()
      const makeBtn = (type: string, label: string, svgId: string) =>
        `<button type="button" aria-label="${label}<${updateHotkeyTip('⇧⌘' + type.toUpperCase())}>" data-type="${type}" class="vditor-icon vditor-tooltipped vditor-tooltipped__n"><svg><use xlink:href="#vditor-icon-${svgId}"></use></svg></button>`

      tablePanel.innerHTML = `<div
    class="vditor-panel vditor-panel--none vditor-panel-ir"
    data-top="73"
    style="left: var(--vmd-gutter); top: 73px;display:none"
  >
    ${makeBtn('left', _.alignLeft || 'Left', 'align-left')}
    ${makeBtn('center', _.alignCenter || 'Center', 'align-center')}
    ${makeBtn('right', _.alignRight || 'Right', 'align-right')}
    ${makeBtn('insertRowA', _.insertRowAbove || 'Insert row above', 'insert-rowb')}
    ${makeBtn('insertRowB', _.insertRowBelow || 'Insert row below', 'insert-row')}
    ${makeBtn('insertColumnL', _.insertColumnLeft || 'Insert column left', 'insert-columnb')}
    ${makeBtn('insertColumnR', _.insertColumnRight || 'Insert column right', 'insert-column')}
    ${makeBtn('deleteRow', _['delete-row'] || 'Delete row', 'delete-row')}
    ${makeBtn('deleteColumn', _['delete-column'] || 'Delete column', 'delete-column')}
  </div>
  `
      const panelDiv = tablePanel.children[0] as HTMLDivElement
      panelDiv.addEventListener('mousedown', handlePanelAction)
      panelDiv.addEventListener('click', handlePanelAction)
    }
    return tablePanel.children[0] as HTMLDivElement
  }

  eventRoot.addEventListener('click', () => {
    if (vditor.getCurrentMode() !== 'ir') return
    const tablePanel = insertTablePanel()
    const selection = window.getSelection()
    if (!selection || !selection.anchorNode) return
    const clickEl = selection.anchorNode.parentElement
    if (!clickEl) return
    // 从 anchorNode 向上遍历找目标单元格（兼容空单元格场景）
    let cell: HTMLElement | null = null
    let node: Node | null = selection.anchorNode
    while (node && node !== eventRoot) {
      if (node instanceof HTMLElement && ['TD', 'TH'].includes(node.tagName)) {
        cell = node
        break
      }
      node = node.parentElement
    }
    if (cell) {
      _lastCell = cell
      // 记录 markdown 坐标，setValue 重渲染后据此定位与重绑定（M2）
      const domTable = cell.closest('table')
      const tableIndex = domTable
        ? Array.from(eventRoot.querySelectorAll('table')).indexOf(domTable)
        : -1
      const row = getRowIndex(cell)
      const col = getCellIndex(cell)
      if (tableIndex >= 0 && row >= 0 && col >= 0) {
        _lastPos = { tableIndex, row, col }
      }
      if (tablePanel.style.display !== 'block') {
        tablePanel.style.display = 'block'
      }
      tablePanel.style.top =
        clickEl.getBoundingClientRect().top -
        eventRoot.getBoundingClientRect().top +
        eventRoot.scrollTop -
        25 +
        'px'
    } else {
      if (tablePanel.style.display !== 'none') {
        tablePanel.style.display = 'none'
      }
    }
  })
}
