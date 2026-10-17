// main.ts —— QuickWin 最小可跑骨架
//
// 覆盖四件事（都是后续开发要用的最小面）：
//   1. 窗口：gui.RegisterClass 注册窗口类 → gui.CreateWindow 建主窗
//   2. 控件 + 消息：一个子按钮（BUTTON 类），WM_COMMAND 里切换背景色
//   3. 自绘：WM_PAINT 里用 GDI（FillRect / DrawText）画背景和文字
//   4. 定时器 + 退出：os.setTimeout 每秒刷新；关窗 → WM_DESTROY → PostQuitMessage 结束
//
// 3.0 起的 gui 模块只剩建窗/消息泵原语（清单见 quickwin.d.ts），其余 Win32 调用走
// quickwin/lib/windows/*。调用约定：出参槽只收 def.alloc().ptr，读回用 decode；
// 结构缓冲要先落变量再用 .ptr —— 裸指针不保活，临时值可能在调用前被回收。
//
// 构建：npm run build        （tsc 类型检查 → build.ts：esbuild → 图标 → brotli 内嵌）
// 运行：node dist/app.exe    （GUI 程序无控制台；加 -o CON 看 stdout，-o LOG 落日志文件）
import * as gui from 'gui'
import * as os from 'os'
import * as std from 'std'
import { NULL } from 'quickwin/lib/ffi/ctype.js'
import {
    BeginPaint, DrawText, EndPaint, FillRect, GetClientRect, InvalidateRect,
    PostQuitMessage, ShowWindow, UpdateWindow,
} from 'quickwin/lib/windows/user32.js'
import {
    CreateFontIndirect, CreateSolidBrush, DeleteObject, SelectObject, SetBkMode, SetTextColor,
} from 'quickwin/lib/windows/gdi32.js'
import { PAINTSTRUCT, RECT } from 'quickwin/lib/windows/structs.js'
import { BackgroundMode, CreatePos, ShowWindowCmd, WindowStyle, WmMsg } from 'quickwin/constants'
import { APP_NAME, APP_TITLE } from './config.js'

// ── 可调参数 ──
const WINDOW_W = 460
const WINDOW_H = 320
const TICK_MS = 1000
const BUTTON_ID = 100          // 子控件 ID：WM_COMMAND 的 wParam 就是它
const BUTTON_TEXT = '切换背景色'

// 背景色循环表（COLORREF = 0x00BBGGRR，三个字节是蓝/绿/红倒着写）——都是浅色，配深色文字
const COLORS = [0x00ffffff, 0x00e8f0ff, 0x00e8ffe8, 0x00ffeedd, 0x00f0e8ff]
const TEXT_COLOR = 0x00202020
const DT_FLAGS = 0x00000824    // DT_SINGLELINE | DT_VCENTER | DT_NOPREFIX

// ── 状态 ──
let count = 0                  // tick 次数：画在窗口里，一眼能看出程序在跑
let colorIndex = 0
let bgBrush: any = CreateSolidBrush(COLORS[colorIndex])
const fontBig: any = CreateFontIndirect({ lfHeight: -40, lfWeight: 700, lfFaceName: 'Tahoma' })
const fontSmall: any = CreateFontIndirect({ lfHeight: -16, lfWeight: 400, lfFaceName: 'Tahoma' })
const paintBuf = PAINTSTRUCT.alloc()   // BeginPaint 出参槽（消息内复用；勿跨消息持有）
let hwndMain: any = null

/** 每秒刷新：改计数 → 重绘 → 往 stdout 打一行（`-o LOG` 后可用于自动化判断"程序在跑"） */
function tick() {
    count++
    InvalidateRect(hwndMain, NULL, 0)
    print(`tick ${count}`)
    os.setTimeout(tick, TICK_MS)
}

// ── 窗口过程：所有消息都从这里进来，不处理的原样交回 DefWindowProc ──
gui.RegisterClass(APP_NAME, (hwnd: any, msg: number, wParam: number, lParam: number) => {
    switch (msg) {
        case WmMsg.ERASEBKGND:      // 背景由 WM_PAINT 全量填充，这里吞掉以免闪烁
            return 1
        case WmMsg.PAINT: {
            const hdc = BeginPaint(hwnd, paintBuf.ptr)
            if (hdc) {
                const rc = RECT.alloc()
                GetClientRect(hwnd, rc.ptr)
                const client: any = RECT.decode(rc)
                FillRect(hdc, { left: 0, top: 0, right: client.right, bottom: client.bottom }, bgBrush)
                SetBkMode(hdc, BackgroundMode.TRANSPARENT)   // 文字不画底，否则盖住背景色
                SetTextColor(hdc, TEXT_COLOR)
                SelectObject(hdc, fontBig)
                const rcBig = RECT.encode({ left: 24, top: 24, right: client.right - 24, bottom: 88 })
                DrawText(hdc, `${count}s`, -1, rcBig.ptr, DT_FLAGS)
                SelectObject(hdc, fontSmall)
                const rcLine1 = RECT.encode({ left: 24, top: 104, right: client.right - 24, bottom: 132 })
                DrawText(hdc, `已运行 ${count} 秒（每秒自动刷新）`, -1, rcLine1.ptr, DT_FLAGS)
                const rcLine2 = RECT.encode({ left: 24, top: 132, right: client.right - 24, bottom: 160 })
                DrawText(hdc, '改 src/main.ts 开始写自己的程序；底座在 build.ts 里选', -1, rcLine2.ptr, DT_FLAGS)
            }
            EndPaint(hwnd, paintBuf.ptr)
            return 0
        }
        case WmMsg.COMMAND:
            if (wParam === BUTTON_ID) {
                // 换一种背景色：先把新画刷建好再删旧的，避免用到已删除的句柄
                colorIndex = (colorIndex + 1) % COLORS.length
                const old = bgBrush
                bgBrush = CreateSolidBrush(COLORS[colorIndex])
                DeleteObject(old)
                InvalidateRect(hwnd, NULL, 0)
                print(`background -> 0x00${COLORS[colorIndex].toString(16).padStart(6, '0')} (COLORREF)`)
            }
            return 0
        case WmMsg.DESTROY:
            // 关窗（标题栏 × 由 DefWindowProc 转成 DestroyWindow）→ 通知消息泵退出
            DeleteObject(bgBrush)
            DeleteObject(fontBig)
            DeleteObject(fontSmall)
            PostQuitMessage(0)
            return 0
    }
    return gui.DefWindowProc(hwnd, msg, wParam, lParam)
})

// ── 建主窗 + 子按钮（CW_USEDEFAULT：位置交给系统摆）──
hwndMain = gui.CreateWindow(APP_NAME, APP_TITLE, WindowStyle.OVERLAPPEDWINDOW,
    CreatePos.USEDEFAULT, CreatePos.USEDEFAULT, WINDOW_W, WINDOW_H, null, null)
if (!hwndMain) {
    print('CreateWindow failed')
    std.exit(1)
}
// 子控件：父子关系靠 parent 参数，控件 ID 靠 menu 参数（WM_COMMAND 的 wParam 即此 ID）
gui.CreateWindow('BUTTON', BUTTON_TEXT, WindowStyle.CHILD | WindowStyle.VISIBLE,
    24, WINDOW_H - 104, 160, 36, hwndMain, BUTTON_ID as any)

// 3.0 的 gui.CreateWindow 只管建窗，显示要自己来（旧 gui 的复合语义已拆到 lib/windows）
ShowWindow(hwndMain, ShowWindowCmd.SHOWNORMAL)   // SW_SHOWNORMAL
UpdateWindow(hwndMain)                           // 立刻出首帧，不留白

print(`quickwin app "${APP_TITLE}" started (${WINDOW_W}x${WINDOW_H}, tick ${TICK_MS}ms)`)
os.setTimeout(tick, TICK_MS)
