# 用最简单的方法开发 Windows 程序

使用 [QuickWin](https://github.com/quickwinlabs/quickwin) 开发 Windows 程序：

- 无需配置复杂的开发环境，仅需 Node.js/npm
- 在任意系统上都能构建
- 从 XP 到 Win11 全部支持
- 使用 TypeScript 语言，开发难度低
- 产物体积小，约 1.3MB

![用脚手架生成的 myapp 窗口](https://raw.githubusercontent.com/quickwinlabs/quickwin-starter/main/docs/screenshot.png)

## 前置依赖

安装 [Node.js/npm](https://nodejs.org/zh-cn/download) 22.18 以上版本。

## 快速开始

```bash
npm create -y quickwin@latest myapp
cd myapp
npm install
npm run build        # tsc 类型检查 → esbuild → 图标 → 内嵌，产出 dist\app.exe
dist\app.exe         # 直接运行；exe 里嵌的是 QuickJS，运行时不经过 Node
```

默认模板是 `react`：JSX 声明式界面 + 系统托盘示例（关窗只是隐藏，托盘图标左键恢复、右键出菜单）。想从最朴素的骨架起步：

```bash
npm create -y quickwin@latest myapp -- --template=minimal
```

## 生成的项目

| 文件 | 作用 |
| --- | --- |
| `src/main.tsx` | 入口：建窗、挂载 React 树 |
| `src/App.tsx` | 界面：`useState` 计数器 + 按钮/输入框 |
| `src/tray.ts` | 系统托盘：图标、左键恢复、右键菜单 |
| `src/config.ts` | 应用名与窗口标题（minimal 模板里 APP_NAME 即窗口类名） |
| `build.ts` | 构建脚本；`node build.ts --base=x64` 换底座 |
| `icon.ts` | `icon.svg` → 多条目 ICO，写回 exe |
| `assets/icon.svg` | 图标的唯一来源，改它即可 |

## Build 流程

`npm run build` = `tsc && node build.ts`

1. 类型检查，QuickWin 有完整的 TypeScript 类型支持
2. 用 esbuild 编译 JS bundle（`dist\app.js`）
3. 将图标嵌入 exe 底座（没有 `assets/icon.svg` 就跳过）
4. 将 JS bundle 压缩并嵌入 exe

## 底座

默认 `x86-nowasm`，换法见「生成的项目」表里 `build.ts` 那行：

| `--base=` | 取舍 |
| --- | --- |
| `x86-nowasm` | 默认。最小（约 1.3MB），XP 可跑，只缺 `WebAssembly.*` |
| `x86` | 加 WebAssembly，仍是 32 位 |
| `x64-nowasm` | x64，体积次小，Vista+ |
| `x64` | x64 全功能 |

## 运行

产物位于 `dist\app.exe`，是自包含的 exe，直接双击运行即可。GUI 程序没有控制台，要看输出：

```bash
dist\app.exe -o CON     # 分配控制台
dist\app.exe -o LOG     # 或者落一份日志，自动用当前时间命名
dist\app.exe -o app.log # 或者写到指定文件
```

## 运行时能力

[QuickWin](https://github.com/quickwinlabs/quickwin) —— Windows 的 QuickJS 运行时：原生 GUI 控件、`fetch`/WebSocket、WebAssembly、FFI 调用任意 DLL，以及 **HTTP import** `import('https://esm.sh/...')`。

## 在线更新

由于支持 HTTP import，可以在 exe 里只嵌入一个入口，业务代码放服务器上单独部署 —— 每次重启都运行最新版，不用重新打包 exe：

```ts
import(`https://hostname/app.js?${Date.now()}`)
```

- QuickWin 支持 HTTP 缓存：响应带 `Cache-Control: max-age` 时会落盘到 exe 同目录的 `_cache\`。
- `Date.now()` 保证每次都取新版，否则要设置响应头 `Cache-Control: no-cache`。
- 可以配置 Code Splitting 利用缓存减少资源加载时间。

## License

MIT
