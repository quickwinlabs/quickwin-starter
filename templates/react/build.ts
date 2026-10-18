/// <reference types="node" />
// 构建链：tsc 类型检查 → esbuild bundle src/main.tsx → 图标盖进底座 exe → brotli 内嵌
// 图标：assets/icon.svg 现场渲染，无生成产物；必须在嵌 JS 之前（resedit 重写 PE 不保留尾部数据）
// 内嵌格式：[exe][brotli(js)][u32 长度]["QWBR"]（与主仓 scripts/embed-js.mjs 同格式，运行时据此定位）
// 用法：node build.ts [--base=x64]，默认 x86-nowasm
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { brotliCompressSync } from 'node:zlib'
import { build } from 'esbuild'
import { setIcon } from './icon.ts'         // Node 类型剥离直接跑 .ts，故带扩展名

// 底座 → 包内的预备 exe（不带 -nowasm 即带 WebAssembly）
const BASES = {
    'x64': 'qwin.exe',                      // x64 全功能
    'x64-nowasm': 'qwin-nowasm.exe',        // x64、体积次小（Vista+）
    'x86': 'qwin-x86.exe',                  // 32 位 + WebAssembly
    'x86-nowasm': 'qwin-nowasm-x86.exe',    // 32 位、体积最小、XP 可跑，只缺 WebAssembly.*（默认）
} as const
const DEFAULT_BASE = 'x86-nowasm'
const ENTRY = 'src/main.tsx'
const OUT_JS = 'dist/app.js'
const OUT_EXE = 'dist/app.exe'
const ICON_SVG = 'assets/icon.svg'      // 换图标就改这个文件

// ── 参数：--base=xxx / --base xxx ──
const argv = process.argv.slice(2)
let base = DEFAULT_BASE
for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--base') base = argv[++i]
    else if (a.startsWith('--base=')) base = a.slice('--base='.length)
    else {
        console.error(`unknown argument: ${a}`)
        process.exit(1)
    }
}
const exeName = BASES[base as keyof typeof BASES]
if (!exeName) {
    console.error(`unknown base "${base}"; valid: ${Object.keys(BASES).join(' | ')}`)
    process.exit(1)
}
const exeSrc = `node_modules/quickwin/${exeName}`
if (!existsSync(exeSrc)) {
    console.error(`${exeSrc} not found — run npm install first`)
    process.exit(1)
}

// ── stage 1: esbuild ──
// react / react-reconciler 打进 bundle；const enum 由 esbuild 内联为字面量（constants.ts 是真 .ts 源）
console.log(`[1/3] esbuild (base=${base} -> ${exeName})`)
rmSync('dist', { recursive: true, force: true })
mkdirSync('dist', { recursive: true })
const result = await build({
    entryPoints: [ENTRY],
    bundle: true,
    format: 'esm',          // CJS 产物会在运行时报 Dynamic require
    jsx: 'automatic',       // JSX -> react/jsx-runtime
    outfile: OUT_JS,
    // NODE_ENV 决定 react 用生产版；DEBUG 是 react-qw 的裸全局，不定义就是 ReferenceError
    define: { 'process.env.NODE_ENV': '"production"', DEBUG: 'false' },
    external: ['gui', 'std', 'os', 'sock', 'ffi', 'wolfssl', 'brotli'],   // 由 exe 内嵌运行时提供
    target: 'es2020',
    legalComments: 'none',
    write: false,
})
const jsBytes = result.outputFiles![0].contents
writeFileSync(OUT_JS, jsBytes)

// ── stage 2: 盖图标 ──
let exe: Buffer = readFileSync(exeSrc)
if (existsSync(ICON_SVG)) {
    const plainLen = exe.length
    exe = setIcon(exe, ICON_SVG)
    console.log(`[2/3] icon ${ICON_SVG} (+${exe.length - plainLen}B)`)
} else {
    console.log(`[2/3] icon skipped (${ICON_SVG} 不存在)`)
}

// ── stage 3: brotli 压缩 + 内嵌 ──
const packed = brotliCompressSync(jsBytes)      // 不传参数即最高质量（q11）
const out = Buffer.alloc(exe.length + packed.length + 8)
exe.copy(out, 0)
packed.copy(out, exe.length)
out.writeUInt32LE(packed.length, exe.length + packed.length)
out.write('QWBR', exe.length + packed.length + 4, 'ascii')
writeFileSync(OUT_EXE, out)
console.log(`[3/3] ${OUT_EXE}: ${exeName} ${exe.length}B + js ${jsBytes.length}B ` +
    `-> brotli ${packed.length}B -> ${out.length}B`)
