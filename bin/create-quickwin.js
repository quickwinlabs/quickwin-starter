#!/usr/bin/env node
// create-quickwin —— QuickWin 应用脚手架（零依赖）
//
//   npm create quickwin my-app
//   npm create quickwin my-app -- --base=x64-wasm --title="我的应用"
//
// 模板随 npm 包一起发布（包内 template/），生成就是纯本地拷贝 —— 断网也能用，
// 且模板和脚手架永远是同一个版本（想用别的模板版本就固定脚手架版本：
// npm create quickwin@<ver> my-app）。没有"从 GitHub 取模板"这条路：那会让模板
// 漂到生成器不认识的样子（哨兵、占位包名都是双方约定）。
//
// 生成时要做的替换（见 patchProject）：
//   template/_gitignore → .gitignore   （npm 打包含不进 .gitignore，故源文件叫 _gitignore）
//   package.json / package-lock.json 的包名
//   src/config.ts 的 APP_NAME / APP_TITLE 哨兵
import {
    cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = resolve(HERE, '..')
const LOCAL_TEMPLATE = join(PKG_ROOT, 'template')
const VERSION = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')).version
const PKG_NAME_PLACEHOLDER = 'quickwin-app'      // template/package.json 里的占位名
const BASES = ['x64-wasm', 'x64-nowasm', 'x86-wasm', 'x86-nowasm']
const DEFAULT_BASE = 'x86-nowasm'                // 体积最小且 XP 可跑

function fail(msg) {
    console.error(`\ncreate-quickwin: ${msg}\n`)
    process.exit(1)
}

function usage() {
    console.log(`
create-quickwin ${VERSION} —— 生成一个 QuickWin 桌面应用骨架

用法:
  npm create quickwin <目录> [-- <选项>]
  npx create-quickwin <目录> [选项]

选项:
  --base=<flavor>   底座（默认 ${DEFAULT_BASE}，写进生成的 build 脚本）
                    ${BASES.join(' | ')}
  --title=<标题>    窗口标题（默认取目录名）
  --force, -f       目标目录非空时也照写
  --version, -v     打印版本
  --help, -h        本帮助

底座的取舍（体积 / 能力）：
  x86-nowasm  最小、XP 可跑，只缺 WebAssembly.*（默认）
  x86-wasm    加 WebAssembly，仍是 32 位
  x64-nowasm  x64、体积次小，Vista+
  x64-wasm    x64 全功能
`)
}

// ── 参数 ──
const argv = process.argv.slice(2)
const opts = { dir: '', base: '', title: '', force: false }
for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    const val = (name) => (a === name ? argv[++i] : null) ?? a.slice(name.length + 1)
    if (a === '--help' || a === '-h') {
        usage()
        process.exit(0)
    } else if (a === '--version' || a === '-v') {
        console.log(VERSION)
        process.exit(0)
    } else if (a === '--force' || a === '-f') opts.force = true
    else if (a === '--base' || a.startsWith('--base=')) opts.base = val('--base')
    else if (a === '--title' || a.startsWith('--title=')) opts.title = val('--title')
    else if (a.startsWith('-')) fail(`未知参数 ${a}（-h 看用法）`)
    else if (!opts.dir) opts.dir = a
    else fail(`多余的参数 ${a}`)
}
if (!opts.dir) {
    usage()
    process.exit(1)
}
if (opts.base && !BASES.includes(opts.base)) fail(`--base 只能是 ${BASES.join(' | ')}`)

// ── 名字：目录名给用户看，包名要合规，窗口类名跟包名走 ──
const target = resolve(process.cwd(), opts.dir)
const projectName = basename(target) || PKG_NAME_PLACEHOLDER
const pkgName = projectName.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[._-]+|[._-]+$/g, '')
    || PKG_NAME_PLACEHOLDER
const title = opts.title || projectName
const esc = (s) => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

function patchProject(dir) {
    // 1) npm 打包含不进 .gitignore（会被改名 .npmignore），故模板里叫 _gitignore
    const gi = join(dir, '_gitignore')
    if (existsSync(gi)) renameSync(gi, join(dir, '.gitignore'))

    // 2) 包名（package-lock.json 也要改，npm ci 会比对）
    const pkgPath = join(dir, 'package.json')
    let pkg = readFileSync(pkgPath, 'utf8')
    if (!pkg.includes(`"name": "${PKG_NAME_PLACEHOLDER}"`)) {
        fail('template/package.json 里没有预期的占位包名，模板可能已改版')
    }
    pkg = pkg.replace(`"name": "${PKG_NAME_PLACEHOLDER}"`, `"name": "${pkgName}"`)
    if (opts.base) {
        pkg = pkg.replace('"build": "tsc && node build.ts"', `"build": "tsc && node build.ts --base=${opts.base}"`)
    }
    writeFileSync(pkgPath, pkg)
    const lockPath = join(dir, 'package-lock.json')
    if (existsSync(lockPath)) {
        writeFileSync(lockPath, readFileSync(lockPath, 'utf8')
            .replaceAll(`"name": "${PKG_NAME_PLACEHOLDER}"`, `"name": "${pkgName}"`))
    }

    // 3) 窗口类名 / 标题
    const cfgPath = join(dir, 'src', 'config.ts')
    let cfg = readFileSync(cfgPath, 'utf8')
    if (!/APP_NAME\s*=\s*'/.test(cfg) || !/APP_TITLE\s*=\s*'/.test(cfg)) {
        fail('template/src/config.ts 里没有 APP_NAME/APP_TITLE 哨兵，模板可能已改版')
    }
    cfg = cfg.replace(/(APP_NAME\s*=\s*)'[^']*'/, `$1'${esc(pkgName)}'`)
        .replace(/(APP_TITLE\s*=\s*)'[^']*'/, `$1'${esc(title)}'`)
    writeFileSync(cfgPath, cfg)
}

// ── 目标目录 ──
if (existsSync(target) && readdirSync(target).length > 0 && !opts.force) {
    fail(`目录 ${opts.dir} 已存在且非空（要往里写就加 --force）`)
}

if (!existsSync(LOCAL_TEMPLATE)) {
    fail(`包内模板缺失：${LOCAL_TEMPLATE}（安装似乎不完整，重装 create-quickwin 试试）`)
}
mkdirSync(target, { recursive: true })
// .npmignore 只服务打包（排除 node_modules/dist），不进 tarball，也别带进用户项目
const skip = new Set(['node_modules', 'dist', '.git', '.npmignore'])
for (const entry of readdirSync(LOCAL_TEMPLATE)) {
    cpSync(join(LOCAL_TEMPLATE, entry), join(target, entry), {
        recursive: true,
        filter: (src) => !skip.has(basename(src)),
    })
}

patchProject(target)

const base = opts.base || DEFAULT_BASE
console.log(`
✔ 已生成 ${opts.dir}  （模板 create-quickwin@${VERSION} 包内副本，底座 ${base}）

下一步:
  cd ${opts.dir}
  npm install
  npm run build          # → dist/app.exe
  node dist/app.exe      # XP 及以上；加 -o CON 可看 stdout

程序入口 src/main.ts，应用名/标题 src/config.ts，打包与底座 build.ts。
`)
