// createRoot 建主窗 → render 挂 React 树；关窗只隐藏到托盘，托盘右键菜单里退出
// 构建 npm run build；运行 dist\app.exe（-o CON 看 stdout）
import 'quickwin/lib/polyfill.js'   // React 调度要用 setTimeout / console
import { createRoot } from 'quickwin/lib/react-qw/index.js'
import { ShowWindow } from 'quickwin/lib/windows/user32.js'
import { ShowWindowCmd, WmMsg } from 'quickwin/constants'
import { APP_TITLE } from './config.ts'
import { App } from './App.tsx'
import { installTray } from './tray.ts'

const root = createRoot({
    text: APP_TITLE,
    width: 520,
    height: 400,
    // react-qw 不处理的消息转到这里：返回数字即接管，undefined 则继续走 DefWindowProc
    onEvent: ({ msg, lParam }) => {
        if (msg === WmMsg.CLOSE) {                  // 关窗不退出：藏到托盘
            ShowWindow(root.hwnd, ShowWindowCmd.HIDE)
            return 0
        }
        if (msg === tray.message) {                 // 托盘回调（WM_APP+1）
            tray.handle(lParam)
            return 0
        }
    },
})

const tray = installTray(root.hwnd)

root.render(<App />)
