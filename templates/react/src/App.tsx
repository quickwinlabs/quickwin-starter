// react-qw 没有 DOM/CSS：组件最终都是原生窗口（HWND），布局是 flex 子集
// 属性与组件清单见 node_modules/quickwin/lib/react-qw/README.md
import { useState } from 'react'
import { Button, Input } from 'quickwin/lib/react-qw/index.js'
import { WindowStyle } from 'quickwin/constants'

export function App() {
    const [count, setCount] = useState(0)
    const [name, setName] = useState('')

    return (
        <w type="STATIC" ws={WindowStyle.VISIBLE}
            style={{ flexDirection: 'column', gap: 12, padding: 16, flexGrow: 1 }}>
            <w type="STATIC" ws={WindowStyle.VISIBLE}
                style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <Button onClick={() => setCount(c => c + 1)}>点我 +1</Button>
                <Button onClick={() => setCount(0)}>归零</Button>
            </w>
            <Input value={name} onChange={setName} placeholder="输入名字…" />
            <w type="STATIC" text={`${name ? name + '，' : ''}你点了 ${count} 次`} />
            <w type="STATIC" text="关窗口只是隐藏到托盘；托盘图标左键恢复、右键出菜单。" />
        </w>
    )
}
