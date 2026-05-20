/**
 * IR 模式下支持 Table 编辑
 * 从原扩展搬运，去掉 i18n 深层导入（改用 window.VditorI18n）
 */
import { updateHotkeyTip } from 'vditor/src/ts/util/compatibility'

const tablePanelId = 'fix-table-ir-wrapper'

function dispatchShortcut(el: HTMLElement, key: string, ctrl: boolean, shift: boolean) {
  const event = new KeyboardEvent('keydown', {
    key,
    code: `Key${key.toUpperCase()}`,
    ctrlKey: ctrl,
    shiftKey: shift,
    metaKey: ctrl,
    bubbles: true,
    cancelable: true,
  })
  el.dispatchEvent(event)
}

const handleMap: Record<string, { key: string; ctrl: boolean; shift: boolean }> = {
  left:           { key: 'l', ctrl: true, shift: true },
  center:         { key: 'c', ctrl: true, shift: true },
  right:          { key: 'r', ctrl: true, shift: true },
  insertRowA:     { key: 'f', ctrl: true, shift: true },
  insertRowB:     { key: '=', ctrl: true, shift: false },
  deleteRow:      { key: '-', ctrl: true, shift: false },
  insertColumnL:  { key: 'g', ctrl: true, shift: true },
  insertColumnR:  { key: '=', ctrl: true, shift: true },
  deleteColumn:   { key: '_', ctrl: true, shift: true },
}

function i18n(): any {
  return (window as any).VditorI18n || {}
}

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
      panelDiv.addEventListener('click', (e) => {
        const target = e.target as HTMLElement
        const button = target.closest('.vditor-icon') as HTMLElement | null
        if (!button) return
        const type = button.getAttribute('data-type')
        if (!type) return
        const mapping = handleMap[type]
        if (mapping) {
          dispatchShortcut(eventRoot, mapping.key, mapping.ctrl, mapping.shift)
        }
        e.stopPropagation()
      })
    }
    return tablePanel.children[0] as HTMLDivElement
  }

  eventRoot.addEventListener('click', () => {
    if (vditor.getCurrentMode() !== 'ir') return
    const tablePanel = insertTablePanel()
    const selection = window.getSelection()
    if (!selection || !selection.anchorNode) return
    let clickEl = selection.anchorNode.parentElement
    if (!clickEl) return
    if (['TD', 'TH', 'TR'].includes(clickEl.tagName)) {
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
