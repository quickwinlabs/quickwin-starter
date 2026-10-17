// 构建链（唯一入口：npm run build = tsc && node build.ts）
//   stage 1: esbuild —— bundle src/main.ts 成自包含 ESM 单文件；运行时模块（gui/std/os/sock/
//            ffi/wolfssl/brotli）保持 external，由 exe 内嵌运行时提供；const enum 由 esbuild
//            直接内联为字面量（constants.ts 是真 .ts 源）。
//   stage 2: icon —— resedit 把 assets/icon.ico 盖进底座 exe。必须在嵌 JS 之前：resedit 重写
//            PE 时不保留尾部数据。
//   stage 3: embed —— brotli 压缩 JS 追加到 exe 尾部：[exe][js][u32 长度]["QWBR"]
//            （与主仓 scripts/embed-js.mjs 同格式，运行时据此定位并解压）
//
// 底座（--base=<flavor>，默认 x86-nowasm：体积最小、XP 可跑，只缺 WebAssembly.*）：
//   x64-wasm | x64-nowasm | x86-wasm | x86-nowasm
//
// 用法：node build.ts [--base=x64-wasm]
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { brotliCompressSync, constants as zc } from 'node:zlib'
import { build } from 'esbuild'
import { Data, NtExecutable, NtExecutableResource, Resource } from 'resedit'

const BASES: Record<string, string> = {
    'x64-wasm': 'qwin.exe',
    'x64-nowasm': 'qwin-nowasm.exe',
    'x86-wasm': 'qwin-x86.exe',
    'x86-nowasm': 'qwin-nowasm-x86.exe',
}
const DEFAULT_BASE = 'x86-nowasm'
const ENTRY = 'src/main.ts'
const OUT_JS = 'dist/app.js'
const OUT_EXE = 'dist/app.exe'
const ICON = 'assets/icon.ico'          // 由 npm run icon 从 assets/icon.svg 生成并提交
const RUNTIME_MODULES = ['gui', 'std', 'os', 'sock', 'ffi', 'wolfssl', 'brotli']

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
const exeName = BASES[base]
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
    external: RUNTIME_MODULES,
    target: 'es2020',
    legalComments: 'none',
    write: false,
})
const jsBytes = result.outputFiles![0].contents
writeFileSync(OUT_JS, jsBytes)

// ── stage 2: 盖图标 ──
let exe = readFileSync(exeSrc)
if (existsSync(ICON)) {
    const plainLen = exe.length
    const pe = NtExecutable.from(exe)
    const res = NtExecutableResource.from(pe)
    const iconFile = Data.IconFile.from(readFileSync(ICON))
    Resource.IconGroupEntry.replaceIconsForResource(
        res.entries,
        101,        // RT_ICON_GROUP ID（底座无现成图标，资源不存在时自动追加）
        1033,       // en-US
        iconFile.icons.map((i) => i.data),
    )
    res.outputResource(pe)
    exe = Buffer.from(pe.generate())
    console.log(`[2/3] icon ${ICON} (${iconFile.icons.length} item, +${exe.length - plainLen}B)`)
} else {
    console.log(`[2/3] icon skipped (${ICON} 不存在；node scripts/gen-icon.mjs 生成后提交)`)
}

// ── stage 3: brotli 压缩 + 内嵌 ──
const packed = brotliCompressSync(jsBytes, {
    params: {
        [zc.BROTLI_PARAM_MODE]: zc.BROTLI_MODE_TEXT,
        [zc.BROTLI_PARAM_QUALITY]: zc.BROTLI_MAX_QUALITY,
        [zc.BROTLI_PARAM_LGWIN]: zc.BROTLI_MAX_WINDOW_BITS,
    },
})
const out = Buffer.alloc(exe.length + packed.length + 8)
exe.copy(out, 0)
packed.copy(out, exe.length)
out.writeUInt32LE(packed.length, exe.length + packed.length)
out.write('QWBR', exe.length + packed.length + 4, 'ascii')
writeFileSync(OUT_EXE, out)
console.log(`[3/3] ${OUT_EXE}: ${exeName} ${exe.length}B + js ${jsBytes.length}B ` +
    `-> brotli ${packed.length}B -> ${out.length}B`)
