// 托盘：Shell_NotifyIcon 把事件投给主窗（消息号自定，WM_APP+1），图标来自 gui.LoadAppIcon()，
// 也就是 build.ts 盖进 exe 的那份 RT_GROUP_ICON
import * as gui from 'gui'
import { NULL, type MaybePtr } from 'quickwin/lib/ffi/ctype.js'
import {
    AppendMenu, CreatePopupMenu, DestroyMenu, GetCursorPos, LoadImageOrdinal, PostQuitMessage,
    SetForegroundWindow, ShowWindow, TrackPopupMenu,
} from 'quickwin/lib/windows/user32.js'
import { NOTIFYICONDATAW, POINT } from 'quickwin/lib/windows/structs.js'
import { ShellNotifyIcon } from 'quickwin/lib/windows/shell32.js'
import {
    IDI, ImageType, LoadImageFlag, MenuFlag, NotifyIconCmd, NotifyIconFlag,
    ShowWindowCmd, TrackPopupMenuFlag, WmMsg,
} from 'quickwin/constants'
import { APP_TITLE } from './config.ts'

const WM_TRAY = 0x8001      // WM_APP + 1
const CMD_SHOW = 1          // TrackPopupMenu 的返回值就是菜单项 ID
const CMD_QUIT = 2

/** 挂上托盘图标；handle() 供主窗 onEvent 转发 WM_TRAY。 */
export function installTray(hwnd: gui.HWND) {
    // LoadImageW 的句柄随 uType 变（HICON/HCURSOR/HBITMAP），绑定给不出具体类型，按裸指针声明
    let hIcon: MaybePtr<''> | null = gui.LoadAppIcon()
    if (!hIcon) hIcon = LoadImageOrdinal(NULL, IDI.APPLICATION, ImageType.ICON, 0, 0, LoadImageFlag.SHARED)

    const added = !!hIcon && !!ShellNotifyIcon(NotifyIconCmd.ADD, {
        cbSize: NOTIFYICONDATAW.size,
        hWnd: hwnd,
        uID: 1,
        uFlags: NotifyIconFlag.MESSAGE | NotifyIconFlag.ICON | NotifyIconFlag.TIP,
        uCallbackMessage: WM_TRAY,
        hIcon,
        szTip: APP_TITLE,
    })
    if (!added) print('[tray] Shell_NotifyIcon(ADD) failed')

    function show() {
        ShowWindow(hwnd, ShowWindowCmd.SHOW)
        SetForegroundWindow(hwnd)
    }

    function quit() {
        ShellNotifyIcon(NotifyIconCmd.DELETE, { cbSize: NOTIFYICONDATAW.size, hWnd: hwnd, uID: 1 })
        PostQuitMessage(0)
    }

    function popupMenu() {
        SetForegroundWindow(hwnd)   // 不先设前台，菜单在别处点击时收不起来
        const pt = POINT.alloc()
        const pos = GetCursorPos(pt.ptr) ? POINT.decode(pt) : null
        const hMenu = CreatePopupMenu()
        if (hMenu === NULL) return
        AppendMenu(hMenu, 0, CMD_SHOW, '显示窗口')
        AppendMenu(hMenu, MenuFlag.SEPARATOR, 0, NULL)
        AppendMenu(hMenu, 0, CMD_QUIT, '退出')
        const cmd = TrackPopupMenu(hMenu, TrackPopupMenuFlag.RETURNCMD | TrackPopupMenuFlag.RIGHTBUTTON,
            pos?.x ?? 0, pos?.y ?? 0, 0, hwnd, NULL)
        DestroyMenu(hMenu)          // RETURNCMD 模式下菜单不会自己销毁
        if (cmd === CMD_SHOW) show()
        else if (cmd === CMD_QUIT) quit()
    }

    return {
        message: WM_TRAY,
        handle(lParam: number) {
            if (lParam === WmMsg.LBUTTONDOWN) show()
            else if (lParam === WmMsg.RBUTTONDOWN || lParam === WmMsg.CONTEXTMENU) popupMenu()
        },
    }
}
