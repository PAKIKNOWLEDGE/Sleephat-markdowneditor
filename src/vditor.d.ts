/**
 * 全局 vditor 实例的类型声明。
 *
 * main.ts 将实例挂载到 window.vditor，浏览器中也可直接以全局变量 `vditor`
 * 访问（utils.ts / toolbar.ts / fix-table-ir.ts 均按全局变量引用）。
 * 这里为裸 `vditor` 声明类型，配合 package.json 的 typecheck（tsc --noEmit）做类型检查（M3）。
 */
declare var vditor: import('vditor').default
