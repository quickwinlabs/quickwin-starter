#!/usr/bin/env node
// create-quickwin —— QuickWin 应用脚手架（零依赖）
//
//   npm create -y quickwin@latest my-app
//   npm create -y quickwin@latest my-app -- --template=minimal
//   npm create -y quickwin@latest my-app -- --title="我的应用"
//
// 模板随 npm 包一起发布（包内 templates/<名字>/），生成就是纯本地拷贝 —— 断网也能用，
// 且模板和脚手架永远是同一个版本（想用别的模板版本就固定脚手架版本：
// npm create quickwin@<ver> my-app）。没有"从 GitHub 取模板"这条路：那会让模板
// 漂到生成器不认识的样子（哨兵、占位包名都是双方约定）。
//
// 底座不由脚手架选：生成的 build 脚本就是 node build.ts（默认 x86-nowasm），要换底座
// 就手改那一行（node build.ts --base=x64，可选值见模板 build.ts 的 BASES）。
//
// 模板契约（templates/ 下每个目录都要满足，patchProject 靠它打补丁）：
//   _gitignore → .gitignore            （npm 打包含不进 .gitignore，故源文件叫 _gitignore）
//   package.json: "name": "quickwin-app" 占位名 + @types/node（版本按本机 Node 主版本改写）
//   src/config.ts: APP_NAME / APP_TITLE 哨兵
import {
    cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync,
} from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = resolve(HERE, '..')
const TEMPLATES_DIR = join(PKG_ROOT, 'templates')
const DEFAULT_TEMPLATE = 'react'
const VERSION = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')).version
const PKG_NAME_PLACEHOLDER = 'quickwin-app'      // templates/*/package.json 里的占位名
const NODE_MAJOR = process.versions.node.split('.')[0]   // @types/node 大版本 = Node 大版本
const DEFAULT_BASE = 'x86-nowasm'                // 仅用于提示；真值在模板 build.ts 的 DEFAULT_BASE

// 可用模板 = templates/ 下的目录名（不写死数组：加模板只加目录，这里自动跟上）
function templates() {
    if (!existsSync(TEMPLATES_DIR)) return []
    return readdirSync(TEMPLATES_DIR, { withFileTypes: true })
        .filter((e) => e.isDirectory() && /^[a-z0-9-]+$/.test(e.name))
        .map((e) => e.name)
        .sort()
}

function fail(msg) {
    console.error(`\ncreate-quickwin: ${msg}\n`)
    process.exit(1)
}

function usage() {
    console.log(`
create-quickwin ${VERSION} —— 生成一个 QuickWin 桌面应用骨架

用法:
  npm create -y quickwin@latest <目录> [-- <选项>]
  npx create-quickwin <目录> [选项]

选项:
  --template=<名字>  用哪个模板（默认 ${DEFAULT_TEMPLATE}）
                    ${templates().join(' | ')}
  --title=<标题>     窗口标题（默认取目录名）
  --force, -f        目标目录非空时也照写
  --version, -v      打印版本
  --help, -h         本帮助

底座默认 ${DEFAULT_BASE}（写死在生成的 build 脚本里；要换就手改那一行）：
  x86-nowasm  最小、XP 可跑，只缺 WebAssembly.*（默认）
  x86         加 WebAssembly，仍是 32 位
  x64-nowasm  x64、体积次小，Vista+
  x64         x64 全功能
`)
}

// ── 参数 ──
const argv = process.argv.slice(2)
const opts = { dir: '', template: '', title: '', force: false }
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
    else if (a.startsWith('--base')) {
        fail('--base 不再是脚手架选项：改生成的 package.json 里 build 脚本即可' +
            '（"tsc && node build.ts --base=x64"，可选值见 build.ts 的 BASES）')
    }
    else if (a === '--template' || a.startsWith('--template=')) opts.template = val('--template')
    else if (a === '--title' || a.startsWith('--title=')) opts.title = val('--title')
    else if (a.startsWith('-')) fail(`未知参数 ${a}（-h 看用法）`)
    else if (!opts.dir) opts.dir = a
    else fail(`多余的参数 ${a}`)
}
if (!opts.dir) {
    usage()
    process.exit(1)
}

// ── 模板：名字即 templates/ 下的目录名 ──
const template = opts.template || DEFAULT_TEMPLATE
if (!templates().includes(template)) {
    fail(`未知模板 ${template}；可选：${templates().join(' | ')}`)
}
const TEMPLATE_DIR = join(TEMPLATES_DIR, template)

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

    // 2) 包名 + @types/node 版本
    const pkgPath = join(dir, 'package.json')
    let pkg = readFileSync(pkgPath, 'utf8')
    if (!pkg.includes(`"name": "${PKG_NAME_PLACEHOLDER}"`)) {
        fail(`${template}/package.json 里没有预期的占位包名，模板可能已改版`)
    }
    if (!/"@types\/node":\s*"[^"]*"/.test(pkg)) {
        fail(`${template}/package.json 里没有 @types/node，模板可能已改版`)
    }
    pkg = pkg.replace(`"name": "${PKG_NAME_PLACEHOLDER}"`, `"name": "${pkgName}"`)
        .replace(/"@types\/node":\s*"[^"]*"/, `"@types/node": "^${NODE_MAJOR}"`)
    writeFileSync(pkgPath, pkg)

    // 3) 窗口类名 / 标题
    const cfgPath = join(dir, 'src', 'config.ts')
    let cfg = readFileSync(cfgPath, 'utf8')
    if (!/APP_NAME\s*=\s*'/.test(cfg) || !/APP_TITLE\s*=\s*'/.test(cfg)) {
        fail(`${template}/src/config.ts 里没有 APP_NAME/APP_TITLE 哨兵，模板可能已改版`)
    }
    cfg = cfg.replace(/(APP_NAME\s*=\s*)'[^']*'/, `$1'${esc(pkgName)}'`)
        .replace(/(APP_TITLE\s*=\s*)'[^']*'/, `$1'${esc(title)}'`)
    writeFileSync(cfgPath, cfg)

    // 4) 根 README 带进项目（模板里没有 README，唯一来源就是包根这份）
    cpSync(join(PKG_ROOT, 'README.md'), join(dir, 'README.md'))
}

// ── 目标目录 ──
if (existsSync(target) && readdirSync(target).length > 0 && !opts.force) {
    fail(`目录 ${opts.dir} 已存在且非空（要往里写就加 --force）`)
}

if (!existsSync(TEMPLATE_DIR)) {
    fail(`包内模板缺失：${TEMPLATE_DIR}（安装似乎不完整，重装 create-quickwin 试试）`)
}
mkdirSync(target, { recursive: true })
// .npmignore 只服务打包（排除 node_modules/dist），不进 tarball，也别带进用户项目
const skip = new Set(['node_modules', 'dist', '.git', '.npmignore', 'package-lock.json'])
for (const entry of readdirSync(TEMPLATE_DIR)) {
    cpSync(join(TEMPLATE_DIR, entry), join(target, entry), {
        recursive: true,
        filter: (src) => !skip.has(basename(src)),
    })
}

patchProject(target)

console.log(`
✔ 已生成 ${opts.dir}  （模板 ${template}，create-quickwin@${VERSION} 包内副本，
   底座 ${DEFAULT_BASE}，@types/node ^${NODE_MAJOR}）

下一步:
  cd ${opts.dir}
  npm install
  npm run build          # → dist/app.exe
  dist\\app.exe           # XP 及以上，直接跑；加 -o CON 可看 stdout

程序入口 src/main.ts，应用名/标题 src/config.ts，打包与底座 build.ts。
`)
