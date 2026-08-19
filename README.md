# dsh-read-aloud — DeepSeek Harness Plugin

[![topic: dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-blue)](https://github.com/topics/dsh-plugin)

Read AI conversation content aloud in the DeepSeek Harness Web GUI, using the browser's built-in speech synthesis — no API key, no network calls, nothing to configure. It contributes two controls through the official slot system:

- A **per-message read button** in the assistant reply's action strip (between copy and branch), toggling between read / stop for that one reply.
- A **session-header "Read conversation" button** that reads every user message and each turn's final assistant reply in order, toggling to "Stop reading" while playing.

What is spoken is exactly what is on screen: text is derived from the same conversation snapshot the chat view renders from, so streaming partials, tool rows, and intermediate steps are skipped and a multi-step turn is read once as its final answer.

## Installation

Via npm:

```sh
dsh plugin --profile web add dsh-read-aloud
```

Or from GitHub:

```sh
dsh plugin --profile web add github:buffruan/dsh-read-aloud
```

Then refresh the browser page. The package ships a `dsh.bundle` manifest, so installation activates it automatically.

## Usage

- Hover an assistant reply and click the speaker/play button to read that reply; click it again (it becomes a stop button) to stop.
- Click the **"Read conversation"** button in the session header to read the whole conversation from the top; click **"Stop reading"** to stop.

## Voice and language

Speech is produced by the browser's Web Speech API (`window.speechSynthesis`), so the voice, language, rate, and pitch follow the operating system's / browser's text-to-speech settings. To change the voice, configure the TTS voice in your OS (e.g. Windows Speech settings / macOS System Settings › Accessibility › Spoken Content) or your browser.

## Compatibility

Works with DSH `0.1.0-rc.6` and later. If you run into issues after a DSH upgrade, update the plugin.

## License

[MIT](./LICENSE)
