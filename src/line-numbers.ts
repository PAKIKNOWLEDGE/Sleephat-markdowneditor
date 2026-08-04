/**
 * 行号 gutter（P4-3）
 *
 * 移植自上游 zaaack/vscode-markdown-editor 的 lineNumberScript：
 * 在编辑器左侧固定一个 #ln-gutter 浮层，按 markdown 源码的行结构
 * （块级起点）把每一块的起始行号渲染到对应的 DOM 块上。
 *
 * 不修改 Vditor 内部 DOM，只读 getValue() 计算行号，纯展示层。
 * 工具栏右侧加一个 `#` 切换按钮，点击开关行号。
 */

let lnEnabled = true
let lnListening = false
let lnTimer: ReturnType<typeof setInterval> | null = null

function addToggle(): void {
  if (document.getElementById('ln-toggle')) return
  const tb = document.querySelector('.vditor-toolbar')
  if (!tb) return
  const btn = document.createElement('button')
  btn.id = 'ln-toggle'
  btn.type = 'button'
  btn.className = 'vditor-tooltipped vditor-tooltipped__s'
  btn.setAttribute('aria-label', 'Toggle line numbers')
  btn.style.cssText =
    'background:none;border:none;cursor:pointer;padding:4px 3px;color:inherit;font:11px monospace;opacity:0.7;margin-left:2px'
  btn.textContent = '#'
  btn.onclick = () => {
    lnEnabled = !lnEnabled
    btn.style.opacity = lnEnabled ? '0.7' : '0.3'
    const g = document.getElementById('ln-gutter')
    if (g) g.style.display = lnEnabled ? '' : 'none'
    const vditorEl = document.querySelector('.vditor')
    vditorEl?.classList.toggle('vditor-ln-on', lnEnabled)
  }
  tb.appendChild(btn)
}

function syncLineNumbers(): void {
  addToggle()
  if (!lnEnabled) return
  const reset = document.querySelector<HTMLElement>('.vditor-ir .vditor-reset')
  const ir = document.querySelector<HTMLElement>('.vditor-ir')
  if (!reset || !ir || reset.children.length === 0) return

  let g = document.getElementById('ln-gutter')
  if (!g) {
    g = document.createElement('div')
    g.id = 'ln-gutter'
    document.body.appendChild(g)
  }
  const irRect = ir.getBoundingClientRect()
  g.style.left = irRect.left + 'px'
  g.style.top = irRect.top + 'px'
  g.style.height = irRect.height + 'px'

  const kids: HTMLElement[] = []
  for (let j = 0; j < reset.children.length; j++) {
    const c = reset.children[j] as HTMLElement
    if (c.offsetHeight > 0 && c.id !== 'fix-table-ir-wrapper') kids.push(c)
  }

  const srcLines: number[] = []
  try {
    // 始终读实时编辑器内容而非一次性快照：文档被编辑后快照会漂移，导致行号错位
    const src = (window.vditor && window.vditor.getValue) ? (window.vditor.getValue() || '') : ''
    const lines = src.split('\n')
    const starts: number[] = []
    let i = 0
    const fence = '```'
    const rH = /^#{1,6} /
    const rHR = /^(---|[*]{3}|___)$/
    const rLI = /^[-*+] /
    const rOL = /^[0-9]+[.)] /
    const rIND = /^ +[^ ]/
    const isBlock = (s: string) =>
      rH.test(s) ||
      rLI.test(s) ||
      rOL.test(s) ||
      s.indexOf(fence) === 0 ||
      s.charAt(0) === '|' ||
      s.charAt(0) === '>' ||
      rHR.test(s)

    if (lines.length > 0 && lines[0].trim() === '---') {
      starts.push(1)
      i = 1
      while (i < lines.length && lines[i].trim() !== '---') i++
      if (i < lines.length) i++
    }
    while (i < lines.length) {
      if (lines[i].trim() === '') {
        i++
        continue
      }
      starts.push(i + 1)
      const tr = lines[i].trim()
      if (rH.test(tr) || rHR.test(tr)) {
        i++
      } else if (tr.indexOf(fence) === 0) {
        i++
        while (i < lines.length && lines[i].trim().indexOf(fence) !== 0) i++
        if (i < lines.length) i++
      } else if (tr.charAt(0) === '|') {
        while (i < lines.length && lines[i].trim().charAt(0) === '|') i++
      } else if (tr.charAt(0) === '>') {
        while (
          i < lines.length &&
          lines[i].trim() !== '' &&
          lines[i].trimStart().charAt(0) === '>'
        )
          i++
      } else if (rLI.test(tr) || rOL.test(tr)) {
        while (i < lines.length) {
          if (lines[i].trim() === '') {
            let nx = i + 1
            while (nx < lines.length && lines[nx].trim() === '') nx++
            if (
              nx < lines.length &&
              (rLI.test(lines[nx].trim()) ||
                rOL.test(lines[nx].trim()) ||
                rIND.test(lines[nx]))
            ) {
              i = nx
            } else {
              break
            }
          } else {
            i++
          }
        }
      } else {
        i++
        while (i < lines.length && lines[i].trim() !== '') {
          if (isBlock(lines[i].trim())) break
          i++
        }
      }
    }
    for (let j = 0; j < kids.length; j++) {
      srcLines.push(j < starts.length ? starts[j] : j + 1)
    }
  } catch (_) {
    for (let j = 0; j < kids.length; j++) srcLines.push(j + 1)
  }

  let html = ''
  for (let j = 0; j < kids.length; j++) {
    const el = kids[j]
    const rect = el.getBoundingClientRect()
    const t = rect.top - irRect.top
    if (t + rect.height < 0 || t > irRect.height) continue
    const style = window.getComputedStyle(el)
    const fs = parseFloat(style.fontSize) || 16
    let lh = parseFloat(style.lineHeight)
    if (isNaN(lh)) lh = fs * 1.6
    const numTop = t + lh / 2 - 5
    html += '<div class="ln" style="top:' + numTop + 'px">' + srcLines[j] + '</div>'
  }
  g.innerHTML = html

  if (!lnListening) {
    lnListening = true
    ir.addEventListener('scroll', syncLineNumbers)
    document.addEventListener('scroll', syncLineNumbers, true)
    new MutationObserver(() => requestAnimationFrame(syncLineNumbers)).observe(reset, {
      childList: true,
      subtree: true,
      characterData: true,
    })
  }
}

export function initLineNumbers(): void {
  // 幂等：重复调用时只重置定时器
  if (lnTimer) clearInterval(lnTimer)
  const vditorEl = document.querySelector('.vditor')
  vditorEl?.classList.toggle('vditor-ln-on', lnEnabled)
  syncLineNumbers()
  lnTimer = setInterval(syncLineNumbers, 500)
}
