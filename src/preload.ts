// L5 复核：部分随 vditor 动态加载的第三方库（mermaid/katex 等）会探测 `global`，
// 浏览器环境没有该标识，这里补一个指向 globalThis 的别名，仅在缺失时设置，避免重复覆盖。
// 只污染一个 window 属性，属必要防御，保留。
;(window as any)['global'] = (window as any)['global'] || globalThis