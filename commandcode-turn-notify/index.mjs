// commandcode-turn-notify mod v1（2026-09-12，公开发布版）— 任务完成、以及任务途中需要你
// 做决定（权限确认 / 模型提问）或出错时，弹 Windows 系统通知并播放提示音：
// 切去干别的时，该回来的时候会被叫回来。
// 不向模型注入任何内容，零 token 消耗。
//
// 通知形态参照 ZCode 桌面端的任务通知设计：静音系统 toast + 应用内自放提示音，
// 正文带任务上下文。默认提示音为 Kenney Interface Sounds 的 confirmation_001
// （CC0 公共领域，https://kenney.nl/assets/interface-sounds）；自用可在 mod
// 目录内放置 task-notification-pop.mp3（ZCode 原声）优先播放——该文件无再
// 分发授权，严禁进入公开发布包。
//
// 检测层（1.53.1 实测）：事件桥只向 mod 转发生命周期事件（turn/model 层），
// tool_queued / tool_running 等工具级事件不会到达，因此：
//   - 「需要你回复」走 beforeToolCall 钩子（CLI 保证每个工具执行前必触发）
//   - 「需要你确认」走 model_request_end 事件（已桥接）+ 8 秒看门狗：
//     模型回复结束到首个工具开始之间唯一的阻塞就是权限确认
//   - 「任务出错」与运行边界清理走 onRunEnd 钩子（任何原因退出循环必触发）
//
// 已知边界：点击通知不能聚焦终端窗口（宿主是 Electron 应用可监听 click，
// mod 发的 toast 点击只会关闭或进通知中心）。
//
// 全程 try/catch 静默，绝不抛错、绝不打断回合。
import { spawn } from "node:child_process";
import { appendFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const COOLDOWN_MS = 5_000;      // 冷却：连续快问快答时防止横幅连弹
const CONFIRM_TIMEOUT_MS = 8_000; // model_request_end 后超时无下文 → 判定卡在权限确认
                                 // （CLI 生成工具描述上限 5 秒 + 余量；正常放行时
                                 //  beforeToolCall 秒到，不会误报）
// 发送者身份必须是本机已注册的 AUMID：Win11 会把未注册 AUMID 的 toast 整体丢弃
// （Show() 成功但不显示横幅、不进通知中心，本机实测）。自定义身份 "CommandCode"
// 由本 mod 在每次加载时注册（幂等、HKCU 无需管理员），来源标签与图标即由此而来。
const TOAST_APP_ID = "CommandCode";
const AUMID_DISPLAY = "Command Code";
// 提示音两级选择：目录内存在 task-notification-pop.mp3（ZCode 原声，个人自用
// 副本——严禁放进公开发布包，该文件无再分发授权）则优先播放；否则用随包分发
// 的 CC0 默认音 notification.wav；两者都缺 → 静音横幅
const SOUND_CANDIDATES = ["task-notification-pop.mp3", "notification.wav"];
const SOUND_VOLUME = 0.8;       // 提示音相对音量（0.0–1.0；1.0 为音源满格，实际听感再叠加系统主音量）
const ICO_FILE = "command-code.ico"; // 来源图标（与发布者自己的 CLI 启动器同款）
const MOD_DIR = dirname(fileURLToPath(import.meta.url));
const soundFile = SOUND_CANDIDATES.find((f) => existsSync(join(MOD_DIR, f))) || null;
const SOUND_URI = soundFile ? "file:///" + join(MOD_DIR, soundFile).replace(/\\/g, "/") : null;

// 这些工具执行即阻塞等用户答复，beforeToolCall 钩子就是精确的「需要你回复」信号
const INTERACTIVE_TOOLS = new Set(["ask_user_question"]);

let lastNotify = 0;          // 完成通知的冷却基准
let lastDecisionNotify = 0;  // 决策类通知（确认/回复）的冷却基准，与完成通知分开，
                             // 避免「确认后立刻跑完」时完成通知被冷却吞掉
let turnStart = 0;
let watchdog = null;         // 权限确认看门狗（model_request_end 后 8 秒无工具开始）
let subscribed = false;

// 排障日志：CC_NOTIFY_DEBUG=1 时写入 %TEMP%/cc-notify-mod.log（与 usage-status 同款模式）
const debug = (msg) => {
  if (process.env.CC_NOTIFY_DEBUG === "1") {
    try { appendFileSync(join(process.env.TEMP || ".", "cc-notify-mod.log"), `${new Date().toISOString()} ${msg}\n`); } catch {}
  }
};

// toast XML 文本节点转义，并清理控制字符（摘要来自模型输出，不可信任）
function esc(s) {
  return s
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// 与 CLI 内置 lastAssistantText 同逻辑：取最后一条 assistant 消息的纯文本
function lastAssistantText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m && m.role === "assistant") {
      return (m.content || [])
        .filter((c) => c && c.type === "text")
        .map((c) => c.text || "")
        .join("");
    }
  }
  return "";
}

// 摘要：压成单行，按字符（非字节）截断，保留中文与 emoji 完整性
function excerpt(text, max = 40) {
  const s = text.replace(/\s+/g, " ").trim();
  const chars = [...s];
  return chars.length <= max ? s : chars.slice(0, max).join("") + "…";
}

function fmtTokens(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function fmtDuration(sec) {
  return sec < 60 ? `${sec} 秒` : `${Math.floor(sec / 60)} 分 ${sec % 60} 秒`;
}

// 组装 PowerShell 脚本：toast 与提示音各自独立 try/catch——toast 失败不影响声音；
// L 函数在 CC_NOTIFY_DEBUG=1 时把 PS 侧结果落到同一个排障日志
function buildScript(xml) {
  const lines = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "function L($m){ if($env:CC_NOTIFY_DEBUG -eq '1'){ try{ Add-Content ([IO.Path]::Combine($env:TEMP,'cc-notify-mod.log')) $m }catch{} } }",
    "try {",
    "  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
    "  [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null",
    "  $x = New-Object Windows.Data.Xml.Dom.XmlDocument",
    "  $x.LoadXml(@'",
    xml,
    "'@)",
    "  $t = New-Object Windows.UI.Notifications.ToastNotification $x",
    `  $n = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('${TOAST_APP_ID}')`,
    "  $n.Show($t)",
    "  L 'ps: toast shown'",
    "} catch { L ('ps: toast error: ' + $_.Exception.Message) }",
  ];
  if (soundFile) {
    lines.push(
      "try {",
      "  Add-Type -AssemblyName PresentationCore",
      "  $p = New-Object System.Windows.Media.MediaPlayer",
      `  $p.Open([Uri]'${SOUND_URI}')`,
      `  $p.Volume = ${SOUND_VOLUME}`,
      "  Start-Sleep -Milliseconds 500",
      "  $p.Play()",
      "  Start-Sleep -Milliseconds 1800",
      "  $p.Close()",
      "  L 'ps: sound played'",
      "} catch { L ('ps: sound error: ' + $_.Exception.Message) }",
    );
  }
  return lines.join("\n");
}

// 后台弹出：windowsHide（不闪黑窗）；脚本走 -EncodedCommand（UTF-16LE base64），
// 彻底绕开 PowerShell/cmd 的引号转义问题。
// 注意不能用 detached + unref：父进程先退出时分离的子进程会被直接终止，
// PowerShell 还没来得及执行。普通子进程即可——spawn 异步不阻塞回合，
// CLI 长驻期间子进程约 3 秒自然跑完。
function showToast(xml) {
  const b64 = Buffer.from(buildScript(xml), "utf16le").toString("base64");
  const child = spawn("powershell.exe", ["-NoProfile", "-EncodedCommand", b64], {
    windowsHide: true,
    stdio: "ignore",
  });
  child.on("error", () => {});
}

// 幂等注册发送者身份（HKCU\Software\Classes\AppUserModelId\CommandCode）：
// DisplayName 决定横幅来源标签，IconUri 决定来源图标。每次加载静默补写，
// 注册项被删或 mod 目录移动后也能在下一次加载时自愈。
// reg.exe 由 node 直接 spawn、不经 shell，参数无引号/路径转换问题。
function ensureAumid() {
  const key = "HKCU\\Software\\Classes\\AppUserModelId\\" + TOAST_APP_ID;
  for (const [name, value] of [["DisplayName", AUMID_DISPLAY], ["IconUri", join(MOD_DIR, ICO_FILE)]]) {
    const child = spawn("reg.exe", ["add", key, "/v", name, "/d", value, "/f"], { windowsHide: true, stdio: "ignore" });
    child.on("error", () => {});
  }
}

function toastXml(title, lines) {
  return `<toast><visual><binding template="ToastGeneric">` +
    `<text>${esc(title)}</text>` +
    lines.filter(Boolean).map((l) => `<text>${esc(l)}</text>`).join("") +
    `</binding></visual><audio silent="true"/></toast>`;
}

// 摘要取 input 里最有信息量的字段（shell 命令 / 文件路径 / 问题文本）
function inputDetail(input, max = 40) {
  if (!input || typeof input !== "object") return "";
  for (const k of ["command", "cmd", "file_path", "path", "pattern", "question", "query"]) {
    const v = input[k];
    if (typeof v === "string" && v.trim()) return excerpt(v, max);
  }
  for (const k of ["questions", "options"]) {
    if (Array.isArray(input[k]) && input[k].length) {
      const joined = input[k]
        .map((x) => (x && typeof x === "object" && x.question) || (typeof x === "string" ? x : ""))
        .filter(Boolean).join("；");
      if (joined) return excerpt(joined, max);
    }
  }
  return "";
}

function clearWatchdog() {
  if (watchdog) { clearTimeout(watchdog); watchdog = null; }
}

// 权限确认看门狗：model_request_end（模型回复完毕）之后、首个工具执行之前，
// 流程中唯一的阻塞点就是权限确认弹窗；正常流转时 beforeToolCall/onTurnEnd
// 会在几秒内清除看门狗，超时未清 → 用户大概率不在屏幕前
function armConfirmWatchdog() {
  clearWatchdog();
  watchdog = setTimeout(() => {
    watchdog = null;
    notifyDecision("需要你的确认", "模型在等待权限批准，请回到终端处理");
  }, CONFIRM_TIMEOUT_MS);
  if (watchdog.unref) watchdog.unref();
}

// 决策类通知（需要确认/需要回复）：与完成通知分开冷却
function notifyDecision(title, body) {
  const now = Date.now();
  if (now - lastDecisionNotify < COOLDOWN_MS) { debug("skip: decision cooldown"); return; }
  lastDecisionNotify = now;
  debug(`dispatch: ${title} body="${body}"`);
  showToast(toastXml(title, [body]));
}

// 错误通知：不参与冷却——run_error 每次运行最多触发一次（出错即停），无刷屏风险，
// 而它恰恰是用户最不该错过的信号
function notifyError(body) {
  debug(`dispatch: 任务出错 body="${body}"`);
  showToast(toastXml("任务出错", [body]));
}

// 订阅事件桥：1.53.1 只转发生命周期事件，这里仅挂 model_request_end（已验证可达）
function subscribeEvents(ctx) {
  if (subscribed) return;
  const on = ctx && ctx.events && ctx.events.on;
  if (typeof on !== "function") return;
  try {
    on.call(ctx.events, "model_request_end", () => {
      try { debug("model_request_end → arm confirm watchdog"); armConfirmWatchdog(); } catch {}
    });
    subscribed = true;
    debug("events subscribed (model_request_end watchdog)");
  } catch (err) { debug("subscribe failed: " + (err && err.message)); }
}

function notify(e) {
  // Command Code 的 turn 粒度是单次模型请求：一个长任务内部会跑多个 turn，
  // 中间轮次（还有工具调用要继续）同样会触发 onTurnEnd。对齐 ZCode 的任务边界
  // 语义——只在最后一轮（无工具调用、纯文本回复）通知一次。
  if (e && e.hadToolCalls) { debug("skip: intermediate turn (hadToolCalls=true)"); return; }
  debug(`onTurnEnd fired (final turn), usage=${e && e.usage ? "yes" : "no"}`);
  const now = Date.now();
  if (now - lastNotify < COOLDOWN_MS) { debug("skip: cooldown"); return; }

  const state = e && e.state;
  const msgs = state && Array.isArray(state.messages) ? state.messages : [];
  const text = msgs.length ? excerpt(lastAssistantText(msgs)) : "";
  if (!text) { debug("skip: no assistant text (msgCount=" + msgs.length + ")"); return; } // 摘要拿不到（如 attach 时刻）就不打扰

  const facts = [];
  if (turnStart > 0) facts.push(`用时 ${fmtDuration(Math.max(1, Math.round((now - turnStart) / 1000)))}`);
  const out = e && e.usage && typeof e.usage.outputTokens === "number" ? e.usage.outputTokens : null;
  if (out !== null) facts.push(`输出 ${fmtTokens(out)} tok`);

  lastNotify = now;
  debug(`dispatch: excerpt="${text}" facts="${facts.join(" · ")}"`);
  showToast(toastXml("任务已完成", [text, facts.length ? facts.join(" · ") : null]));
}

export { buildScript };

export default async function (ctx) {
  debug("mod loaded, sound=" + (soundFile || "none"));
  try { ensureAumid(); } catch {}
  ctx.hooks({
    async onSessionStart(e) {
      try { subscribeEvents(ctx); } catch {}
      return e && e.state !== undefined ? e.state : undefined;
    },
    async onTurnStart(e) {
      // 任务起点 = 本次 agent 运行的第一个 turn；中间轮次不覆盖，
      // 这样最终通知里的「用时」是整个任务的实际耗时
      try { if (!turnStart) turnStart = Date.now(); } catch {}
      return e.state;
    },
    async beforeToolCall(e) {
      try {
        debug("beforeToolCall: " + (e && e.toolName));
        clearWatchdog();
        if (e && INTERACTIVE_TOOLS.has((e.toolName || "").toLowerCase())) {
          notifyDecision("需要你的回复", inputDetail(e.input, 60) || (e.toolName || ""));
        }
      } catch {}
      return undefined; // 不修改、不阻塞工具调用
    },
    async onTurnEnd(e) {
      try { notify(e); } catch (err) { debug("notify threw: " + (err && err.message)); }
      clearWatchdog(); // 回合已落定：纯文本轮直接结束，工具轮的确认也已在 beforeToolCall 清过
      // 纯文本回复 = agent 运行结束，下次任务从新的 turnStart 起算
      if (e && !e.hadToolCalls) turnStart = 0;
      return e && e.state !== undefined ? e.state : undefined;
    },
    async onRunEnd(e) {
      // 任何原因退出循环都会走到这里（自然结束 / 出错 / 中断）：
      // 统一重置计时与看门狗；异常停止则额外发「任务出错」
      try {
        debug("onRunEnd: stopReason=" + (e && e.result && e.result.stopReason));
        clearWatchdog();
        turnStart = 0;
        if (e && e.result && e.result.stopReason === "run_error") {
          notifyError("运行异常停止（run_error），可在 CLI 中输入 continue 重试");
        }
      } catch {}
      return undefined;
    },
  });
}
