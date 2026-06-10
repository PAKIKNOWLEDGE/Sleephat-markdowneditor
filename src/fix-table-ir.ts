/**
 * IR 模式下支持 Table 编辑
 *
 * 策略：在 markdown 源码上直接改表格 → vditor.setValue() 重渲染。
 * 不走 DOM 操作（Vditor 的 Lute 引擎会对 HTML 做内部标记，手工创建的 DOM 节点缺属性导致 HTML2Md 丢失）。
 * 不走 execCommand（insertRow/insertCol 仅在 IE 支持，WebKit 不支持）。
 */
import { updateHotkeyTip } from 'vditor/src/ts/util/compatibility'

const tablePanelId = 'fix-table-ir-wrapper'

/** 用户最后点击的单元格引用 */
let _lastCell: HTMLElement | null = null

// ── 选区 ───────────────────────────────────────────

function getCellIndex(cell: HTMLElement): number {
  const tr = cell.closest('tr')
  if (!tr) return -1
  return Array.from(tr.children).indexOf(cell)
}

function getRowIndex(cell: HTMLElement): number {
  const tr = cell.closest('tr')
  if (!tr) return -1
  // thead 行也计入（与 markdown 结构一致）
  const table = cell.closest('table')
  if (!table) return -1
  return Array.from(table.querySelectorAll('tr')).indexOf(tr)
}

// ── Markdown 表格操作 ─────────────────────────────

/** 解析一行 markdown 表格单元 */
function parseRow(line: string): string[] {
  const trimmed = line.replace(/^\s*\||\|\s*$/g, '')
  return trimmed.split('|').map((c) => c.trim())
}

/** 找光标所在表格在 markdown 中的起止行号 */
function findMarkdownTable(md: string, cellText: string): { lines: string[]; start: number } | null {
  const lines = md.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trimStart().startsWith('|')) continue
    // 找到表头行
    const headerCells = parseRow(line)
    if (headerCells.length < 1) continue
    // 找到分隔行
    if (i + 1 >= lines.length) continue
    const sep = lines[i + 1]
    if (!sep.match(/^\s*\|[\s\-:]+\|/)) continue

    // 收集完整表格行
    const tableLines: string[] = []
    let j = i
    while (j < lines.length) {
      const l = lines[j]
      if (l.trimStart().startsWith('|')) {
        tableLines.push(l)
        j++
      } else {
        break
      }
    }
    // 检查表格中是否包含目标文本
    if (tableLines.some((l) => l.includes(cellText))) {
      return { lines: tableLines, start: i }
    }
    i = j - 1
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

/** 在 markdown 上操作后再渲染 */
function modifyTable(
  md: string,
  cell: HTMLElement,
  fn: (lines: string[], row: number, col: number) => boolean
) {
  const rawText = (cell.textContent || '').substring(0, 30).trim()
  console.error('[fix-table] modifyTable rawText=', rawText)
  const found = findMarkdownTable(md, rawText)
  console.error('[fix-table] foundTable=', !!found)
  if (!found) return md

  const row = getRowIndex(cell)
  const col = getCellIndex(cell)
  console.error('[fix-table] row=', row, 'col=', col)
  if (row < 0 || col < 0) return md

  const changed = fn(found.lines, row, col)
  console.error('[fix-table] changed=', changed)
  if (!changed) return md

  // 替换原表格
  const allLines = md.split('\n')
  allLines.splice(found.start, found.lines.length, ...found.lines)
  return allLines.join('\n')
}

function applyAndSync(cell: HTMLElement | null, fn: (lines: string[], row: number, col: number) => boolean) {
  console.error('[fix-table] applyAndSync cell=', cell?.tagName, 'text=', cell?.textContent?.substring(0, 20))
  if (!cell) return
  try {
    const md = vditor.getValue()
    console.error('[fix-table] md length=', md.length)
    const newMd = modifyTable(md, cell, fn)
    console.error('[fix-table] match:', newMd !== md, 'newMd length=', newMd.length)
    if (newMd !== md) {
      vditor.setValue(newMd)
    }
  } catch (e) {
    console.error('表格操作失败:', e)
  }
}

// ── 具体操作 ──────────────────────────────────────

function insertRow(above: boolean) {
  applyAndSync(_lastCell, (lines, row, col) => {
    // row 从 0 开始，0=表头，1=分隔行，2+=数据行
    const dataRows = lines.slice(2) // 除去表头和分隔行
    const dataIdx = Math.max(0, row - 2)
    const cols = parseRow(lines[2] || '')
    const newRow = '|' + cols.map(() => ' ').join('|') + '|'
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
  applyAndSync(_lastCell, (lines, row, _col) => {
    if (row < 2) return false // 不删表头和分隔行
    if (lines.length <= 3) return false // 至少保留一行数据
    lines.splice(row, 1)
    return true
  })
}

function insertColumn(left: boolean) {
  applyAndSync(_lastCell, (lines, row, col) => {
    const targetCol = left ? col : col + 1
    for (let i = 0; i < lines.length; i++) {
      const cells = parseRow(lines[i])
      cells.splice(targetCol, 0, ' ')
      lines[i] = buildRow(cells, [], i === 1)
    }
    return true
  })
}

function deleteColumnOp() {
  applyAndSync(_lastCell, (lines, _row, col) => {
    if (lines.length === 0) return false
    if (parseRow(lines[0]).length <= 1) return false // 至少保留一列
    for (let i = 0; i < lines.length; i++) {
      const cells = parseRow(lines[i])
      cells.splice(col, 1)
      lines[i] = buildRow(cells, [], i === 1)
    }
    return true
  })
}

function alignColumn(align: string) {
  applyAndSync(_lastCell, (lines, _row, col) => {
    const sepCells = parseRow(lines[1])
    sepCells[col] = sepStr(align)
    lines[1] = buildRow(sepCells, [], true)
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
  console.error('[fix-table] panelAction fired, type=', e.type, 'fired=', _panelActionFired)
  if (_panelActionFired) return
  _panelActionFired = true
  setTimeout(() => { _panelActionFired = false }, 300)

  const target = e.target as HTMLElement
  const button = target.closest('.vditor-icon') as HTMLElement | null
  console.error('[fix-table] button=', button?.getAttribute('data-type'))
  if (!button) return
  const type = button.getAttribute('data-type')
  if (!type) return
  const handler = handleMap[type]
  console.error('[fix-table] handler=', !!handler)
  if (handler) handler()
}

// ── i18n ───────────────────────────────────────────

function i18n(): any {
  return (window as any).VditorI18n || {}
}

// ── 入口 ───────────────────────────────────────────

export function fixTableIr() {
  const eventRoot = vditor.vditor.ir.element

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
    style="left: 35px; top: 73px;display:none"
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
      console.error('[fix-table] _lastCell set to', _lastCell?.tagName, _lastCell?.textContent?.substring(0, 20))
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
