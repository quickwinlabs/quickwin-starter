/// <reference types="node" />
// 构建链（唯一入口：npm run build = tsc && node build.ts）
//   stage 1: esbuild —— bundle src/main.ts 成自包含 ESM 单文件；运行时模块（gui/std/os/sock/
//            ffi/wolfssl/brotli）保持 external，由 exe 内嵌运行时提供；const enum 由 esbuild
//            直接内联为字面量（constants.ts 是真 .ts 源）。
//   stage 2: icon —— assets/icon.svg 现场渲染成多条目 ICO（icon.ts 的 iconFromSvg），再用
//            resedit 盖进底座 exe。必须在嵌 JS 之前：resedit 重写 PE 时不保留尾部数据。
//            想换图标就改 assets/icon.svg，没有额外的生成步骤或需要提交的 .ico。
//   stage 3: embed —— brotli 压缩 JS 追加到 exe 尾部：[exe][js][u32 长度]["QWBR"]
//            （与主仓 scripts/embed-js.mjs 同格式，运行时据此定位并解压）
//
// 底座（--base=<flavor>，默认 x86-nowasm）：可选值、对应 exe 与取舍见下方 BASES。
//
// 用法：node build.ts [--base=x64]
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { brotliCompressSync } from 'node:zlib'
import { build } from 'esbuild'
import { Data, NtExecutable, NtExecutableResource, Resource } from 'resedit'
import { iconFromSvg } from './icon.ts'     // Node 类型剥离直接跑 .ts，故带扩展名

// 底座 → npm 包里的预备 exe 名（取舍：体积 / 能力；不带 -nowasm 后缀即带 WebAssembly）
const BASES = {
    'x64': 'qwin.exe',                      // x64 全功能
    'x64-nowasm': 'qwin-nowasm.exe',        // x64、体积次小（Vista+）
    'x86': 'qwin-x86.exe',                  // 32 位 + WebAssembly
    'x86-nowasm': 'qwin-nowasm-x86.exe',    // 32 位、体积最小、XP 可跑，只缺 WebAssembly.*（默认）
} as const
const DEFAULT_BASE = 'x86-nowasm'
const ENTRY = 'src/main.ts'
const OUT_JS = 'dist/app.js'
const OUT_EXE = 'dist/app.exe'
const ICON_SVG = 'assets/icon.svg'      // 图标唯一来源：构建时现场渲染，无提交产物

// ── 参数：--base=xxx / --base xxx ──
const argv = process.argv.slice(2)
let base = DEFAULT_BASE
for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--base') base = argv[++i]
    else if (a.startsWith('--base=')) base = a.slice('--base='.length)
    else {ENTRY
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

// ── stage 1: esbuild bundle（直接从 .ts 源打包）──
console.log(`[1/3] esbuild (base=${base} -> ${exeName})`)
rmSync('dist', { recursive: true, force: true })
mkdirSync('dist', { recursive: true })
const result = await build({
    entryPoints: [ENTRY],
    bundle: true,
    format: 'esm',          // 保留 `import * as gui from "gui"`；CJS 产物会在运行时报 Dynamic require
    outfile: OUT_JS,
    // 这些运行时模块由 exe 内嵌的 QuickJS 环境提供（见文件头 stage 1），不打进 bundle
    external: ['gui', 'std', 'os', 'sock', 'ffi', 'wolfssl', 'brotli'],
    target: 'es2020',
    legalComments: 'none',
    write: false,
})
const jsBytes = result.outputFiles![0].contents
writeFileSync(OUT_JS, jsBytes)

// ── stage 2: 盖图标（assets/icon.svg 现场渲染）──
let exe = readFileSync(exeSrc)
if (existsSync(ICON_SVG)) {
    const plainLen = exe.length
    const ico = iconFromSvg(readFileSync(ICON_SVG, 'utf8'))
    const pe = NtExecutable.from(exe)
    const res = NtExecutableResource.from(pe)
    const iconFile = Data.IconFile.from(ico)
    Resource.IconGroupEntry.replaceIconsForResource(
        res.entries,
        101,        // RT_ICON_GROUP ID（底座无现成图标，资源不存在时自动追加）
        1033,       // en-US
        iconFile.icons.map((i) => i.data),
    )
    res.outputResource(pe)
    exe = Buffer.from(pe.generate())
    console.log(`[2/3] icon ${ICON_SVG} -> ico ${ico.length}B (${iconFile.icons.length} item, ` +
        `+${exe.length - plainLen}B)`)
} else {
    console.log(`[2/3] icon skipped (${ICON_SVG} 不存在)`)
}

// ── stage 3: brotli 压缩 + 内嵌 ──
// 不传参数：默认就是最高质量（q11 = BROTLI_MAX_QUALITY），而 mode/lgwin 对几十 KB 的 JS
// 没有影响（实测四种组合都是 9356B）。
const packed = brotliCompressSync(jsBytes)
const out = Buffer.alloc(exe.length + packed.length + 8)
exe.copy(out, 0)
packed.copy(out, exe.length)
out.writeUInt32LE(packed.length, exe.length + packed.length)
out.write('QWBR', exe.length + packed.length + 4, 'ascii')
writeFileSync(OUT_EXE, out)
console.log(`[3/3] ${OUT_EXE}: ${exeName} ${exe.length}B + js ${jsBytes.length}B ` +
    `-> brotli ${packed.length}B -> ${out.length}B`)
