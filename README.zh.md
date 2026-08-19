# dsh-read-aloud — DeepSeek Harness 插件

[![topic: dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-blue)](https://github.com/topics/dsh-plugin)

[English](README.md) | 中文

在 DeepSeek Harness Web GUI 中朗读 AI 对话内容。插件默认使用浏览器内置的语音合成，另附一个示例 Host 后端，并留有一处小巧、有文档的接缝，方便接入你自己的 TTS。它通过官方 slot 体系贡献三类控件：

- **单条消息朗读按钮**——位于助手回复的操作条内（复制与分支之间），支持该条回复的**播放 / 暂停 / 继续 / 停止**四种状态。
- **会话头部"朗读全部"按钮**——按顺序朗读每条用户消息与每一轮的最终助手回复，同样支持**暂停 / 继续 / 停止**。
- **设置 › 插件中的"朗读设置"卡片**——配置朗读来源、语速与音色。

念出来的内容与屏幕上显示的内容完全一致：文本取自聊天视图渲染所用的同一份会话快照，因此流式中间结果、工具行与中间步骤都会被跳过，多步骤的一轮只会以最终答复朗读一次。朗读前会剥离 Markdown 标记——标题、加粗/斜体、链接、列表符号与代码围栏等符号通过渲染端自带的 GFM 解析器去除，让 TTS 念的是文字而不是符号（`**加粗**` → “加粗”，`[label](url)` → “label”）。长回复会按句子边界切成不超过 4000 字符的分块、逐块合成并播放，因此云端 TTS 的单次请求长度上限（OpenAI tts-1 约 4096 字符、ElevenLabs 约 5000）永远不会让整条回复朗读失败。

## 朗读来源（后端）

| 后端 | 离线 | 说明 |
| --- | :--: | --- |
| **浏览器（默认）** | 是 | `window.speechSynthesis`；音色来自操作系统/浏览器。 |
| **系统命令**（示例） | 是 | macOS `say`、Windows PowerShell `System.Speech` 或 Linux `espeak`；声音从 Host 机器发出。这是 Host 侧后端如何接入的内置示例。 |

云端后端（Edge TTS / OpenAI / Azure / ElevenLabs）刻意**不内置**——插件暴露一个两文件接缝，你可以按需自行添加任意一个。参见[添加你自己的朗读后端](#添加你自己的朗读后端)。

## 安装

通过 npm：

```sh
dsh plugin --profile web add dsh-read-aloud
```

或从 GitHub：

```sh
dsh plugin --profile web add github:nankotake/dsh-read-aloud
```

然后刷新浏览器页面即可。包内自带 `dsh.bundle` 清单，安装后会自动激活。

## 用法

- 将鼠标悬停在助手回复上，点击扬声器/播放按钮朗读该回复。朗读过程中按钮会变成**暂停**（点击暂停；再次点击变为**继续**），旁边还会出现**停止**按钮，用于从头取消。
- 点击会话头部的**"朗读全部"**按钮，从头朗读整段对话；播放过程中同样适用**暂停 / 继续 / 停止**控件。
- 打开**设置 › 插件 › 朗读设置**选择朗读来源，并配置语速与音色。

## 设置

插件在 DSH 设置页的插件分区贡献一张**"朗读设置"**卡片（其他已安装插件，如 modlens，也在同一位置展示各自的卡片）：

- **朗读来源**——浏览器（默认）或系统命令。
- **语速**——0.5× 到 2× 的滑杆，作用于所有后端。
- **音色**——浏览器的系统音色选择器，或系统后端的音色名称输入框。
- 所有选择都会在 `localStorage` 中跨页面刷新持久化（属于浏览器本地偏好，不涉及 Host 配置文件）。

## 添加你自己的朗读后端

非浏览器后端由插件的 **Host 半区**（`lib/index.js`）合成，并通过 DSH 的 Connection RPC 通道以 base64 音频返回浏览器。添加一个后端需要改动两个文件：

**1. Host 半区 — `lib/index.js`**

在 `synthesize()` 的 switch 中新增一个 `case`。它必须解析为 `{ audioBase64, mimeType }`（或抛出异常；错误会显示在设置卡片中）。下面是一个完整的云端后端示例：

```js
case "openai": {
  const key = process.env.OPENAI_API_KEY;                      // key 留在 Host 侧
  if (!key) throw new Error("OPENAI_API_KEY is not set in the host environment");
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "tts-1", voice: "alloy", input: text }),
    signal,
  });
  if (!response.ok) throw new Error(`TTS request failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  return { audioBase64: bytes.toString("base64"), mimeType: "audio/mpeg" };
}
```

同样的结构适用于 Edge TTS、Azure Speech 与 ElevenLabs——只是端点、请求头和请求体不同。

**2. 浏览器半区 — `lib/client.js`**

- 在 `BACKENDS` 中新增一行：`{ id: "openai", kind: "host" }`。
- 新增一个 `backendOptions()` 分支：`case "openai": return { rate, voice: settings.openaiVoice };`（如需单独的音色选择器，再把 `openaiVoice` 加进 `defaultSettings()` 和设置卡片）。
- 在 `zh` 和 `en` 词典中添加标签：`"backend.openai": "OpenAI"`。

**3. 重启并刷新**

重启 `dsh`（Host 半区在启动时加载）并刷新页面。新后端会出现在"朗读来源"选择器中，并通过现有的 Host 音频路径播放。

API key 从 Host 进程环境变量（`process.env`）读取，因此永远不会进入浏览器。

## 兼容性

兼容 DSH `0.1.0-rc.6` 及更高版本。若你自行添加云端后端，Host 半区需要 Node 18+。DSH 升级后遇到问题，请更新本插件。

## License

[MIT](./LICENSE)
