# dsh-read-aloud — DeepSeek Harness Plugin

[![topic: dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-blue)](https://github.com/topics/dsh-plugin)

Read AI conversation content aloud in the DeepSeek Harness Web GUI, using the browser's built-in speech synthesis — no API key, no network calls. It contributes two controls through the official slot system:

- A **per-message read button** in the assistant reply's action strip (between copy and branch), toggling between read / stop for that one reply.
- A **session-header "Read conversation" button** that reads every user message and each turn's final assistant reply in order, toggling to "Stop reading" while playing.
- A **"Read-aloud settings" card in Settings › Plugins** for the speech rate and voice.

What is spoken is exactly what is on screen: text is derived from the same conversation snapshot the chat view renders from, so streaming partials, tool rows, and intermediate steps are skipped and a multi-step turn is read once as its final answer.

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
- Open **Settings › Plugins › Read-aloud settings** to configure the speech rate and voice.

## Settings

The plugin contributes a **"Read-aloud settings"** card to the DSH Settings page's plugin section (the same place other installed plugins, such as modlens, expose their cards):

- **Speed (rate)** — a slider from 0.5× to 2×, applied to both the per-message and read-all buttons.
- **Voice** — pick any voice installed on the system, or "Default (system)" to keep the browser's own choice. Voice language follows the selected voice.
- Both choices persist across page reloads in `localStorage` (they are browser-local preferences, so no host config file or API key is involved).

## Voice and language

Speech is produced by the browser's Web Speech API (`window.speechSynthesis`), so the exact voice set comes from the operating system / browser. The plugin lets you pick among those voices and adjust the rate; anything beyond that (pitch, volume, installing new voices) is controlled by the OS TTS settings.

## Compatibility

Works with DSH `0.1.0-rc.6` and later. If you run into issues after a DSH upgrade, update the plugin.

## License

[MIT](./LICENSE)
