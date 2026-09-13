# commandcode-turn-notify mod

任务完成、以及任务途中需要你做决定（权限确认 / 模型提问）时，弹 Windows 系统通知
并播放提示音——切去干别的时，该回来的时候会被自动叫回来。
纯后台运行：不显示状态栏、不联网、不向模型注入任何内容，零 token 消耗。

## 行为

- **完成通知**：`onTurnEnd` 钩子，只在 agent 运行结束时通知一次。Command Code 的
  turn 粒度是单次模型请求，长任务内部包含多个 turn（每个思考/工具步骤一轮，
  均带工具调用），中间轮次不弹；只有最后一轮（无工具调用的纯文本回复）才
  通知。「用时」统计整个任务（首个 turn 开始到末轮结束）。用户中断（Esc）
  不通知且计时重置
- **决策提醒**：任务途中需要你做决定时也会通知——
  模型调用 `ask_user_question` 提问 → 「需要你的回复」（精确信号：
  `beforeToolCall` 钩子，该工具执行即阻塞等答复）；模型回复结束后 8 秒仍无
  任何工具开始执行 → 判定卡在权限确认 → 「需要你的确认」（看门狗：模型
  回复结束到首个工具执行之间唯一的阻塞就是权限弹窗；自动放行的工具秒过
  不会误报；8 秒内你自己点完确认也不会弹）
- **错误通知**：运行因错误停止（如模型 429 限流、接口异常）→ 「任务出错」，
  正文为重试提示；错误通知不参与冷却——出错即停、每次运行最多一次，
  是最不该错过的信号。检测走 `onRunEnd` 钩子的 stopReason（1.53.1 的事件桥
  不向 mod 转发 run_error / 工具级事件，钩子是唯一可靠通道）
- **冷却**：5 秒冷却防止横幅连弹；决策类通知与完成类通知分开计时，互不挤占
- **通知形态**：静音系统 toast（横幅本身不出系统音）+ 应用内自放提示音；
  标题分「任务已完成 / 需要你的确认 / 需要你的回复」，正文带任务摘要、
  用时、本轮输出 token 或决策上下文

## 实现

- node `child_process.spawn` 后台调 `powershell.exe`（`windowsHide`，
  不闪黑窗、不阻塞回合）；脚本经 `-EncodedCommand`（UTF-16LE base64）传递，
  无引号转义问题
- toast 与提示音各自独立 try/catch：toast 失败不影响声音，反之亦然
- 提示音两级选择：目录内存在 `task-notification-pop.mp3` 则优先播放（ZCode
  原声，**个人自用副本——无再分发授权，严禁放进公开发布包**）；否则用随包
  分发的 `notification.wav`（Kenney Interface Sounds 的 confirmation_001，
  **CC0 公共领域**，https://kenney.nl/assets/interface-sounds）；两者都缺时
  自动降级为只弹通知不出声
- 来源标签显示发布者的 CLI 名（自定义 AUMID，见下）；摘要取自钩子负载
  `state.messages` 的最后一条 assistant 消息，全文 XML 转义并清理控制字符
- 全程 try/catch 静默，任何异常都不打断回合

## 自定义来源标签与图标

mod 每次加载时幂等注册 `HKCU\Software\Classes\AppUserModelId\<AUMID>`
（`DisplayName` + `IconUri`，HKCU 写入、无需管理员）——Win11 会整体丢弃
未注册 AUMID 的 toast（`Show()` 成功但不弹横幅、不进通知中心），因此发送者
身份必须已注册。默认 AUMID 为 `CommandCode`、显示名 `Command Code`、
图标为包内 `command-code.ico`；改 `TOAST_APP_ID` / `AUMID_DISPLAY` 常量即可
换成自己的名字与图标。注册项被删或 mod 目录移动后，下次加载自动补写。

## 已知边界

- 点击通知不能聚焦终端窗口：宿主 GUI 可监听 click 调自己到前台；mod 发的
  toast 点击只会关闭横幅或进通知中心
- 通知会进 Windows 通知中心留痕，可在系统设置里按来源关闭
- 8 秒确认判定是时序推断，非官方事件；极端慢的自动放行理论上可能误报

## 调试

设 `CC_NOTIFY_DEBUG=1` 启动 CLI，node 侧与 PowerShell 侧的执行痕迹会写入
`%TEMP%\cc-notify-mod.log`；手工验证 toast 与音效可单独跑一遍 `buildScript`
的产物（`buildScript` 为具名导出）。

## 声明

- 本项目为**非官方**社区 mod，与 Command Code 的开发者及发行方无任何隶属或认可关系；「Command Code」名称及商标归其各自所有者所有
- 本项目按「现状」提供，不附带任何明示或默示的保证；使用风险自行承担

*This is an unofficial community mod, not affiliated with or endorsed by the Command Code developers or Z.ai. Provided as-is, without warranty of any kind.*

## 版本

- **v1**（2026-09-12）：首个公开发布版本——完成通知（final-turn 判定、
  全任务用时）、决策提醒（需要你的确认 / 需要你的回复）、CC0 提示音、
  来源身份自动注册
