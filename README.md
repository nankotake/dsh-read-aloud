# dsh-read-aloud — DeepSeek Harness Plugin

[![topic: dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-blue)](https://github.com/topics/dsh-plugin)

Read AI conversation content aloud in the DeepSeek Harness Web GUI. It ships with the browser's built-in speech synthesis as the default backend, plus an example host backend, and leaves a small, documented seam for wiring in your own TTS. It contributes two controls through the official slot system:

- A **per-message read button** in the assistant reply's action strip (between copy and branch), toggling between read / stop for that one reply.
- A **session-header "Read conversation" button** that reads every user message and each turn's final assistant reply in order, toggling to "Stop reading" while playing.
- A **"Read-aloud settings" card in Settings › Plugins** for the speech backend, rate, and voice.

What is spoken is exactly what is on screen: text is derived from the same conversation snapshot the chat view renders from, so streaming partials, tool rows, and intermediate steps are skipped and a multi-step turn is read once as its final answer. Markdown markup is stripped before speaking — headings, bold/italic, links, list markers, and code-fence symbols are removed with the renderer's own GFM parser, so TTS reads the words, not the symbols (`**加粗**` → “加粗”, `[label](url)` → “label”).

## Speech backends

| Backend | Offline | Notes |
| --- | :--: | --- |
| **Browser (default)** | yes | `window.speechSynthesis`; voices come from the OS/browser. |
| **System command** (example) | yes | macOS `say`, Windows PowerShell `System.Speech`, or Linux `espeak`; audio plays from the host machine. This is the built-in example of how a host-side backend plugs in. |

Cloud backends (Edge TTS / OpenAI / Azure / ElevenLabs) are deliberately **not** bundled — instead the plugin exposes a two-file seam so you can add whichever one you want. See [Adding your own speech backend](#adding-your-own-speech-backend).

## Installation

Via npm:

```sh
dsh plugin --profile web add dsh-read-aloud
```

Or from GitHub:

```sh
dsh plugin --profile web add github:nankotake/dsh-read-aloud
```

Then refresh the browser page. The package ships a `dsh.bundle` manifest, so installation activates it automatically.

## Usage

- Hover an assistant reply and click the speaker/play button to read that reply; click it again (it becomes a stop button) to stop.
- Click the **"Read conversation"** button in the session header to read the whole conversation from the top; click **"Stop reading"** to stop.
- Open **Settings › Plugins › Read-aloud settings** to pick the speech backend and configure its rate and voice.

## Settings

The plugin contributes a **"Read-aloud settings"** card to the DSH Settings page's plugin section (the same place other installed plugins, such as modlens, expose their cards):

- **Speech backend** — Browser (default) or System command.
- **Speed (rate)** — a slider from 0.5× to 2×, applied to every backend.
- **Voice** — a system-voice picker for the browser, or a voice-name field for the system backend.
- All choices persist across page reloads in `localStorage` (they are browser-local preferences, so no host config file is involved).

## Adding your own speech backend

Non-browser backends are synthesized by the plugin's **host half** (`lib/index.js`) and returned to the browser over DSH's Connection RPC channel as base64 audio. Adding a backend touches two files:

**1. Host half — `lib/index.js`**

Add a `case` to the `synthesize()` switch. It must resolve to `{ audioBase64, mimeType }` (or throw; the error surfaces in the settings card). Here is a complete cloud-backend example:

```js
case "openai": {
  const key = process.env.OPENAI_API_KEY;                      // key stays on the host
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

The same shape covers Edge TTS, Azure Speech, and ElevenLabs — only the endpoint, headers, and request body differ.

**2. Browser half — `lib/client.js`**

- Add a row to `BACKENDS`: `{ id: "openai", kind: "host" }`.
- Add a `backendOptions()` case: `case "openai": return { rate, voice: settings.openaiVoice };` (add `openaiVoice` to `defaultSettings()` and the settings card if you want a per-voice picker).
- Add a label to the `zh` and `en` dictionaries: `"backend.openai": "OpenAI"`.

**3. Restart and refresh**

Restart `dsh` (the host half loads at startup) and refresh the page. The new backend shows up in the "Speech backend" picker and plays through the existing host-audio path.

API keys are read from the host process environment (`process.env`) so they never enter the browser.

## Compatibility

Works with DSH `0.1.0-rc.6` and later. The host half needs Node 18+ for cloud backends you add. If you run into issues after a DSH upgrade, update the plugin.

## License

[MIT](./LICENSE)
