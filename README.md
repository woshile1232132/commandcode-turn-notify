# commandcode-turn-notify — Command Code 任务完成/决策/出错通知 mod

任务真正完成、或任务途中需要你做决定或出错时，弹 Windows 系统通知并播放提示音：切去干别的时，该回来的时候会被自动叫回来。纯后台运行，不向模型注入任何内容，零 token 消耗。

## 功能

- 任务真正完成时通知一次（长任务中间的思考/工具步骤不弹）：标题「任务已完成」+ 任务摘要 + 整个任务用时 + 本轮输出 token
- 决策提醒：权限确认弹窗 → 「需要你的确认」；模型向你提问 → 「需要你的回复」
- 错误提醒：运行因错误停止（如模型 429 限流）→ 「任务出错」+ 重试提示
- 静音系统横幅 + 自带提示音（默认音量 80%），不依赖系统通知音设置
- 来源显示「Command Code」+ 自定义图标（首次加载自动注册，无需手动配置）
- 5 秒冷却，决策类与完成类通知分开计时，错误通知不参与冷却
- 全程静默容错，任何异常都不影响正常对话

## 环境要求

- Windows 10 / 11
- 已安装支持 Mods 的 Command Code CLI（即 `~/.commandcode/mods` 目录加载可用）

## 安装

1. 解压本压缩包
2. 双击 `install.cmd`（自动复制到 `%USERPROFILE%\.commandcode\mods\commandcode-turn-notify`）
3. 重启 Command Code，随便发一条消息，任务完成后即可看到通知

安装脚本会自动检测 Command Code CLI（显示版本号），并在复制完成后用 `commandcode mods list` 验证 CLI 确实识别到了 mod。未检测到 CLI 时仅警告、不阻断安装。

手动方式：把 `commandcode-turn-notify` 文件夹整体复制到 `%USERPROFILE%\.commandcode\mods\` 下，效果相同。

## 卸载

双击 `uninstall.cmd`（删除 mod 文件夹并清理注册的通知身份），然后重启 Command Code。

## 可调项

编辑 `commandcode-turn-notify\index.mjs` 顶部常量，改完重启 Command Code 生效：

| 常量 | 默认 | 说明 |
|---|---|---|
| `SOUND_VOLUME` | `0.8` | 提示音音量（0.0–1.0） |
| `COOLDOWN_MS` | `5000` | 通知冷却间隔（毫秒） |
| `CONFIRM_TIMEOUT_MS` | `8000` | 判定「卡在权限确认」的超时（毫秒） |

## 没看到横幅 / 没听到声音？

- 检查勿扰模式/专注助手是否开启：横幅会被压制，但提示音照常响
- 若在通知中心点过「关闭 Command Code 的所有通知」：到 系统设置 > 通知 > Command Code 重新打开
- 排障：设 `CC_NOTIFY_DEBUG=1` 启动 Command Code 复现一次，查看 `%TEMP%\cc-notify-mod.log`

## 说明

- 提示音 `notification.wav` 来自 [Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds) 的 confirmation_001，**CC0 公共领域授权**，可随意使用与分发
- 代码以 [MIT License](LICENSE) 发布
- 通知身份通过 `HKCU\Software\Classes\AppUserModelId\CommandCode` 注册（HKCU 写入，无需管理员），卸载脚本会一并清理
- 详细文档见 `commandcode-turn-notify\README.md`

## 声明

- 本项目为**非官方**社区 mod，与 Command Code 的开发者及发行方无任何隶属或认可关系；「Command Code」名称及商标归其各自所有者所有
- 本项目按「现状」提供，不附带任何明示或默示的保证；使用风险自行承担

*This is an unofficial community mod, not affiliated with or endorsed by the Command Code developers or Z.ai. Provided as-is, without warranty of any kind.*

---

# commandcode-turn-notify — Task completion / decision / error notifications for Command Code

Pops a Windows notification and plays a sound when a task actually finishes, when the agent needs your decision mid-run, or when a run fails — so you can switch away and get called back automatically. Runs purely in the background: no status bar, no network access, nothing injected into the model, zero token cost.

## Features

- Notifies once when a task truly completes (intermediate thinking/tool steps don't fire): title "任务已完成", with a task summary, total elapsed time, and this run's output tokens
- Decision alerts: permission prompt → 「需要你的确认」(your confirmation is needed); model asks a question → 「需要你的回复」(your response is needed)
- Error alerts: run stopped by an error (e.g. model rate limit) → 「任务出错」(task error) with a retry hint
- Silent system banner + bundled sound (80% volume by default), independent of system notification sounds
- Source shows "Command Code" with a custom icon (auto-registered on first load, zero configuration)
- 5-second cooldown; decision and completion notifications use separate cooldown buckets; error notifications bypass the cooldown
- Fully fail-silent — any error never affects the conversation

## Requirements

- Windows 10 / 11
- Command Code CLI installed, with Mods support (the `~/.commandcode/mods` directory must be discoverable)

## Install

1. Unzip this archive
2. Double-click `install.cmd` (copies to `%USERPROFILE%\.commandcode\mods\commandcode-turn-notify`)
3. Restart Command Code; send any message and you'll get a notification when the task finishes

The installer auto-detects the Command Code CLI (prints its version) and verifies via `commandcode mods list` that the CLI actually picked the mod up. If no CLI is found it only warns — installation is never blocked.

Manual: copy the `commandcode-turn-notify` folder into `%USERPROFILE%\.commandcode\mods\` — same result.

## Uninstall

Double-click `uninstall.cmd` (removes the mod folder and the registered notification identity), then restart Command Code.

## Configuration

Edit the constants at the top of `commandcode-turn-notify\index.mjs`, then restart Command Code:

| Constant | Default | Description |
|---|---|---|
| `SOUND_VOLUME` | `0.8` | Notification sound volume (0.0–1.0) |
| `COOLDOWN_MS` | `5000` | Notification cooldown (ms) |
| `CONFIRM_TIMEOUT_MS` | `8000` | Timeout before a stall is treated as "waiting for permission" (ms) |

## No banner / no sound?

- Check Do Not Disturb / Focus Assist: banners are suppressed but the sound still plays
- If you ever clicked "Turn off all notifications for Command Code": re-enable in Settings > System > Notifications > Command Code
- Debug: set `CC_NOTIFY_DEBUG=1` before launching Command Code, reproduce once, then check `%TEMP%\cc-notify-mod.log`

## Notes

- The notification sound `notification.wav` is confirmation_001 from [Kenney Interface Sounds](https://kenney.nl/assets/interface-sounds), **CC0 public domain** — free to use and redistribute
- Code released under the [MIT License](LICENSE)
- The notification identity is registered via `HKCU\Software\Classes\AppUserModelId\CommandCode` (HKCU, no admin needed); the uninstaller cleans it up
- Full documentation in `commandcode-turn-notify\README.md` (Chinese)

## Disclaimer

- This is an **unofficial** community mod, not affiliated with or endorsed by the Command Code developers or distributor; the "Command Code" name and trademarks belong to their respective owners
- Provided as-is, without warranty of any kind; use at your own risk

*This is an unofficial community mod, not affiliated with or endorsed by the Command Code developers or Z.ai. Provided as-is, without warranty of any kind.*
