/**
 * dsh-read-aloud — browser half (hand-written bundle, no build step).
 *
 * Reads AI conversation content aloud. Speech comes from a switchable set of
 * backends:
 *
 *  - `browser` (default) — the browser's built-in Web Speech API, offline.
 *  - `system` — an example host backend: the host machine's own TTS, returned
 *    over the Connection RPC channel (`/read-aloud`) and played as audio. See
 *    lib/index.js and README.md for how to add your own backend.
 *
 * Three surfaces are contributed through the official slot system:
 *
 *  - `conversation.chat.assistant-actions` — a per-message read button.
 *  - `conversation.session.header.actions` — a "read the whole conversation"
 *    button.
 *  - `settings.plugin.item` — the configuration card (backend picker, rate,
 *    voice), persisted to localStorage.
 *
 * Text is derived from the same conversation snapshot the chat view renders
 * from (`session.getSnapshot().chat`), so what is spoken is exactly what is on
 * screen. API keys never enter the browser: backends you add read them from
 * the host process environment.
 *
 * ── How to add your own backend ─────────────────────────────────────────────
 * 1. lib/index.js: add a `case` in `synthesize()` returning `{ audioBase64, mimeType }`.
 * 2. Here: add a `{ id: "<id>", kind: "host" }` row to `BACKENDS`, add a
 *    `backendOptions` case, and add a `backend.<id>` label to zh/en.
 * 3. Restart dsh and refresh — the backend appears in the "Speech backend"
 *    picker and plays through the existing host-audio path automatically.
 */
window.__ModuleLoader__.load({
	id: "dsh-read-aloud",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		const react = require("react");
		const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		const IconPlay = primitives.IconPlayOutline16;
		const IconPause = primitives.IconPauseOutline16;
		const IconStop = primitives.IconStopFill16;
		const IconChevronDown = primitives.IconChevronDownOutline14;
		const IconChevronRight = primitives.IconChevronRightOutline14;
		const Tooltip = primitives.Tooltip;
		const extractMarkdownPlainText = primitives.extractMarkdownPlainText;

		// ── copy ────────────────────────────────────────────────────────────────
		const NS = "readAloud";
		const zh = {
			"read": "朗读",
			"stop": "停止",
			"readAll": "朗读全部",
			"readAll.stop": "停止朗读",
			"readAll.aria": "朗读整个对话",
			"read.aria": "朗读这条回复",
			"stop.aria": "停止朗读",
			"unsupported": "当前浏览器不支持语音朗读",
			"settings.title": "朗读设置（dsh-read-aloud）",
			"settings.subtitle": "由 dsh-read-aloud 插件提供；配置朗读来源、语速与音色（仅本浏览器生效）。",
			"settings.backend": "朗读来源",
			"settings.rate": "语速",
			"settings.voice": "音色",
			"settings.voice.default": "默认（跟随系统）",
			"settings.voice.hint": "留空使用默认音色。",
			"settings.error": "错误",
			"settings.key.hint.system": "离线，使用本机系统 TTS；声音从运行 DSH 的机器发出。",
			"backend.browser": "浏览器（默认）",
			"backend.system": "系统命令",
		};
		const en = {
			"read": "Read aloud",
			"stop": "Stop",
			"readAll": "Read conversation",
			"readAll.stop": "Stop reading",
			"readAll.aria": "Read the whole conversation aloud",
			"read.aria": "Read this reply aloud",
			"stop.aria": "Stop reading",
			"unsupported": "Speech synthesis is not supported by this browser",
			"settings.title": "Read-aloud settings (dsh-read-aloud)",
			"settings.subtitle": "Provided by the dsh-read-aloud plugin. Configure the speech backend, rate and voice (stored in this browser).",
			"settings.backend": "Speech backend",
			"settings.rate": "Speed",
			"settings.voice": "Voice",
			"settings.voice.default": "Default (system)",
			"settings.voice.hint": "Leave empty to use the default voice.",
			"settings.error": "Error",
			"settings.key.hint.system": "Offline, uses the host machine's TTS; audio plays from the machine running DSH.",
			"backend.browser": "Browser (default)",
			"backend.system": "System command",
		};

		// ── text extraction ─────────────────────────────────────────────────────
		/**
		 * Strip markdown markup so TTS reads the words, not the symbols.
		 * Uses the renderer's own GFM parser (extractMarkdownPlainText, already
		 * injected with ui-primitives — zero new dependencies), so what is spoken
		 * matches what is rendered: `**bold**` → bold, `[label](url)` → label,
		 * `# heading` → heading, fenced/inline code keeps its source text, list
		 * bullets and blockquote markers are dropped. Falls back to the raw text
		 * if the parser ever throws, so reading never breaks on an edge case.
		 */
		function cleanMarkdown(value) {
			if (typeof value !== "string" || value === "") return "";
			try {
				return extractMarkdownPlainText(value);
			} catch {
				return value;
			}
		}

		/** user/message content parts → plain text (markup stripped). */
		function partsText(parts) {
			if (!Array.isArray(parts)) return "";
			return parts
				.filter((part) => part && part.type === "text" && typeof part.text === "string")
				.map((part) => cleanMarkdown(part.text))
				.join("\n");
		}

		/** assistant blocks (finalNode.blocks) → plain text (markup stripped). */
		function blocksText(blocks) {
			if (!Array.isArray(blocks)) return "";
			return blocks
				.filter((block) => block && block.kind === "text" && typeof block.text === "string")
				.map((block) => cleanMarkdown(block.text))
				.join("\n");
		}

		/**
		 * Find the plain text of the finalized assistant message addressed by the
		 * `conversation.chat.assistant-actions` slot's `messageId` owner currency.
		 */
		function findAssistantText(snapshot, messageId) {
			const store = snapshot && snapshot.chat && snapshot.chat.nodes;
			if (!store || typeof store.values !== "function") return "";
			for (const node of store.values()) {
				const data = node && node.data;
				if (!data) continue;
				const finalNode = data.finalNode || (data.closing && data.closing.finalNode);
				if (finalNode && finalNode.messageId === messageId) return blocksText(finalNode.blocks);
			}
			return "";
		}

		/** Ordered read-aloud script for the whole conversation. */
		function conversationTexts(snapshot) {
			const items = [];
			const chat = snapshot && snapshot.chat;
			if (!chat || !chat.nodes || typeof chat.nodes.get !== "function") return items;
			const order = Array.isArray(chat.order) ? chat.order : [];
			for (const key of order) {
				const node = chat.nodes.get(key);
				if (!node || !node.data) continue;
				if (node.kind === "user" || node.kind === "steering") {
					const text = partsText(node.data.content);
					if (text.trim() !== "") items.push({ key, text });
				} else if (node.kind === "turn-tail") {
					const closing = node.data.closing;
					const finalNode = closing && closing.finalNode;
					if (finalNode) {
						const text = blocksText(finalNode.blocks);
						if (text.trim() !== "") items.push({ key, text });
					}
				}
			}
			return items;
		}

		function normalizeText(value) {
			return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
		}

		// ── backends & settings ────────────────────────────────────────────────
		const SETTINGS_KEY = "dsh-read-aloud.settings";
		const MIN_RATE = 0.5;
		const MAX_RATE = 2;
		const DEFAULT_RATE = 1;

		/**
		 * Selectable backends, in display order. `kind` picks the player path:
		 * `browser` uses Web Speech, `host` synthesizes through the Connection
		 * RPC channel. Add a `{ id, kind: "host" }` row here to expose your own
		 * backend — see the file header and README.md.
		 */
		const BACKENDS = [
			{ id: "browser", kind: "browser" },
			{ id: "system", kind: "host" },
		];

		function defaultSettings() {
			return {
				backend: "browser",
				rate: DEFAULT_RATE,
				browserVoice: "",
				systemVoice: "",
			};
		}

		function clampRate(value) {
			const n = Number(value);
			if (!Number.isFinite(n)) return DEFAULT_RATE;
			return Math.min(MAX_RATE, Math.max(MIN_RATE, n));
		}

		function isKnownBackend(id) {
			return BACKENDS.some((backend) => backend.id === id);
		}

		/** Load persisted settings, folding legacy `voiceURI` into `browserVoice`. */
		function readStoredSettings() {
			const base = defaultSettings();
			try {
				const raw = window.localStorage.getItem(SETTINGS_KEY);
				if (!raw) return base;
				const parsed = JSON.parse(raw);
				if (!parsed || typeof parsed !== "object") return base;
				const merged = { ...base };
				if (typeof parsed.backend === "string" && isKnownBackend(parsed.backend)) merged.backend = parsed.backend;
				if (parsed.rate !== undefined) merged.rate = clampRate(parsed.rate);
				if (typeof parsed.browserVoice === "string") merged.browserVoice = parsed.browserVoice;
				else if (typeof parsed.voiceURI === "string") merged.browserVoice = parsed.voiceURI; // legacy
				if (typeof parsed.systemVoice === "string") merged.systemVoice = parsed.systemVoice;
				return merged;
			} catch {
				return base;
			}
		}

		// ── speech controller ───────────────────────────────────────────────────
		/**
		 * One speech-synthesis controller for the whole plugin. It serializes a
		 * queue of utterances so "read all" plays one message after another, uses a
		 * generation counter so a `cancel()` racing an in-flight utterance or
		 * network synthesis cannot advance a freshly started queue, and applies the
		 * persisted backend / rate / voice to every unit.
		 *
		 * `connection` is the browser Connection RPC handle (ctx.connection); host
		 * backends synthesize through `connection.rpc.call('/read-aloud', ...)`.
		 */
		function createSpeechController({ connection }) {
			const browserSupported =
				typeof window !== "undefined"
				&& "speechSynthesis" in window
				&& typeof window.SpeechSynthesisUtterance === "function";
			let listeners = [];
			let speaking = null; // { key } | null
			let queue = []; // [{ key, text }]
			let epoch = 0;
			let audioEl = null; // current <audio> element for host backends
			let lastError = "";
			let settings = readStoredSettings();
			let voices = [];

			function persist() {
				try {
					window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
				} catch {
					// Privacy mode / blocked storage: keep the in-memory value only.
				}
			}
			function refreshVoices() {
				if (!browserSupported) return;
				voices = window.speechSynthesis.getVoices() || [];
			}
			if (browserSupported) {
				refreshVoices();
				if (typeof window.speechSynthesis.addEventListener === "function") {
					window.speechSynthesis.addEventListener("voiceschanged", () => {
						refreshVoices();
						notify();
					});
				}
			}

			function notify() {
				for (const fn of listeners.slice()) fn();
			}
			function subscribe(fn) {
				listeners.push(fn);
				return () => {
					listeners = listeners.filter((f) => f !== fn);
				};
			}
			function isSpeaking(key) {
				return speaking !== null && speaking.key === key;
			}
			function isReading() {
				return speaking !== null;
			}
			function getSettings() {
				return settings;
			}
			function getVoices() {
				return voices;
			}
			function getError() {
				return lastError;
			}
			function setSetting(key, value) {
				let next = value;
				if (key === "rate") next = clampRate(value);
				if (key === "backend" && !isKnownBackend(value)) return;
				if (settings[key] === next) return;
				settings = { ...settings, [key]: next };
				lastError = "";
				persist();
				notify();
			}

			function backendOptions() {
				const backend = settings.backend;
				const rate = settings.rate;
				switch (backend) {
					case "system": return { rate, voice: settings.systemVoice };
					default: return { rate };
				}
			}

			function stopAudio() {
				if (audioEl) {
					try { audioEl.pause(); } catch { /* ignore */ }
					audioEl = null;
				}
			}

			function cancel() {
				epoch += 1;
				queue = [];
				stopAudio();
				if (browserSupported) {
					try {
						window.speechSynthesis.cancel();
					} catch { /* ignore */ }
				}
				if (speaking !== null) {
					speaking = null;
					notify();
				}
			}

			function endQueue() {
				if (speaking !== null) {
					speaking = null;
					notify();
				}
			}

			/** Browser backend: enqueue SpeechSynthesisUtterance one by one. */
			function advanceBrowser() {
				if (!browserSupported) {
					lastError = "browser-unsupported";
					endQueue();
					return;
				}
				const myEpoch = epoch;
				const next = queue.shift();
				if (!next) {
					endQueue();
					return;
				}
				const text = normalizeText(next.text);
				if (text === "") {
					advance();
					return;
				}
				let utterance;
				try {
					utterance = new window.SpeechSynthesisUtterance(text);
				} catch {
					advance();
					return;
				}
				utterance.rate = settings.rate;
				if (settings.browserVoice) {
					const voice = voices.find((candidate) => candidate && candidate.voiceURI === settings.browserVoice);
					if (voice) utterance.voice = voice;
				}
				utterance.onend = () => { if (epoch === myEpoch) advance(); };
				utterance.onerror = () => { if (epoch === myEpoch) advance(); };
				speaking = { key: next.key };
				notify();
				try {
					window.speechSynthesis.speak(utterance);
				} catch {
					speaking = null;
					notify();
				}
			}

			/** Host backend: synthesize over RPC, then play the returned audio. */
			async function advanceHost() {
				const myEpoch = epoch;
				const next = queue.shift();
				if (!next) {
					endQueue();
					return;
				}
				const text = normalizeText(next.text);
				if (text === "") {
					advance();
					return;
				}
				speaking = { key: next.key };
				notify();
				let result;
				try {
					result = await connection.rpc.call("/read-aloud", "synthesize", {
						backend: settings.backend,
						text,
						options: backendOptions(),
					});
				} catch (error) {
					if (epoch === myEpoch) fail(error instanceof Error ? error.message : String(error));
					return;
				}
				if (epoch !== myEpoch) return; // cancelled during synthesis
				if (!result || result.ok !== true) {
					const message = result && result.error ? result.error.message : "TTS synthesis failed";
					fail(message);
					return;
				}
				const audio = result.value;
				if (!audio || !audio.audioBase64) {
					if (epoch === myEpoch) advance();
					return;
				}
				await playAudio(audio.audioBase64, audio.mimeType, myEpoch);
				if (epoch === myEpoch) advance();
			}

			function fail(message) {
				lastError = message;
				speaking = null;
				queue = [];
				notify();
			}

			/** Play a base64 audio blob; resolves when it ends, errors, or is cancelled. */
			function playAudio(base64, mimeType, myEpoch) {
				return new Promise((resolve) => {
					try {
						const bin = atob(base64);
						const bytes = new Uint8Array(bin.length);
						for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
						const blob = new Blob([bytes], { type: mimeType || "audio/mpeg" });
						const url = URL.createObjectURL(blob);
						const audio = new Audio(url);
						audioEl = audio;
						const cleanup = () => {
							try { URL.revokeObjectURL(url); } catch { /* ignore */ }
							if (audioEl === audio) audioEl = null;
						};
						audio.onended = () => { cleanup(); resolve(); };
						audio.onerror = () => { cleanup(); resolve(); };
						audio.play().catch(() => { cleanup(); resolve(); });
					} catch {
						resolve();
					}
				});
			}

			function advance() {
				if (settings.backend === "browser") {
					advanceBrowser();
					return;
				}
				void advanceHost();
			}

			function speak(key, text) {
				cancel();
				queue = [{ key, text }];
				advance();
			}

			function speakAll(items) {
				if (!Array.isArray(items) || items.length === 0) return;
				cancel();
				queue = items.slice();
				advance();
			}

			function toggle(key, text) {
				if (isSpeaking(key)) {
					cancel();
					return;
				}
				speak(key, text);
			}

			return {
				browserSupported,
				subscribe, isSpeaking, isReading, getSettings, getVoices, getError,
				setSetting, speak, speakAll, toggle, cancel,
			};
		}

		/** The live controller, installed by apply() before any component renders. */
		let speech = null;

		// ── styles ──────────────────────────────────────────────────────────────
		if (
			typeof document !== "undefined"
			&& document.querySelector('style[data-plugin-css="dsh-read-aloud"]') === null
		) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-read-aloud";
			tag.dataset.pluginCss = "dsh-read-aloud";
			tag.textContent =
				'[data-read-aloud-action]{display:inline-flex;align-items:center;justify-content:center;background:transparent;border:none;padding:4px;border-radius:6px;color:var(--dsw-alias-label-secondary,#666);cursor:pointer}' +
				'[data-read-aloud-action]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.1));color:var(--dsw-alias-label-primary,#111)}' +
				'[data-read-aloud-action][data-active="true"]{color:var(--dsw-alias-state-business-primary,#4176e6)}' +
				'[data-read-aloud-all]{display:inline-flex;align-items:center;gap:6px;background:transparent;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.2));padding:4px 10px;border-radius:8px;color:var(--dsw-alias-label-secondary,#666);cursor:pointer;font:inherit;font-size:13px;line-height:1}' +
				'[data-read-aloud-all]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.1));color:var(--dsw-alias-label-primary,#111)}' +
				'[data-read-aloud-all][data-active="true"]{color:var(--dsw-alias-state-business-primary,#4176e6)}' +
				'[data-read-aloud-card]{border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.2));border-radius:12px;background:var(--dsw-alias-bg-layer-3,rgba(128,128,128,.05));transition:border-color .16s,background .16s}' +
				'[data-read-aloud-card][data-open="true"]{background:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.1))}' +
				'[data-read-aloud-card-header]{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:none;border:0;border-radius:12px;display:flex;align-items:center;gap:12px;padding:14px 16px}' +
				'[data-read-aloud-card-rate]{width:100%;accent-color:var(--dsw-alias-state-business-primary,#4176e6)}' +
				'[data-read-aloud-field]{display:flex;flex-direction:column;gap:6px}' +
				'[data-read-aloud-field-label]{font-size:12px;color:var(--dsw-alias-label-secondary,#666)}' +
				'[data-read-aloud-field-hint]{font-size:11px;color:var(--dsw-alias-label-tertiary,rgba(127,127,127,.8));line-height:1.4}' +
				'[data-read-aloud-field-error]{font-size:12px;color:var(--dsw-alias-state-danger,#d93026);line-height:1.4}' +
				'[data-read-aloud-input]{width:100%;box-sizing:border-box;padding:6px 8px;border-radius:6px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.2));background:var(--dsw-alias-bg-base,#fff);color:inherit;font:inherit}';
			document.head.appendChild(tag);
		}

		/** Subscribe a component to the speech controller's state changes. */
		function useSpeechState() {
			const [, forceRender] = react.useReducer((x) => x + 1, 0);
			react.useEffect(() => {
				if (!speech) return undefined;
				return speech.subscribe(forceRender);
			}, []);
		}

		// ── settings card ───────────────────────────────────────────────────────
		const fieldStyle = { display: "flex", flexDirection: "column", gap: 6 };
		const fieldLabelStyle = { fontSize: 12, color: "var(--dsw-alias-label-secondary, #666)" };
		const inputStyle = {
			width: "100%",
			boxSizing: "border-box",
			padding: "6px 8px",
			borderRadius: 6,
			border: "1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.2))",
			background: "var(--dsw-alias-bg-base, #fff)",
			color: "inherit",
			font: "inherit",
		};

		function Field(props) {
			return react.createElement(
				"label",
				{ "data-read-aloud-field": true, style: props.style || fieldStyle },
				props.label ? react.createElement("span", { "data-read-aloud-field-label": true, style: fieldLabelStyle }, props.label) : null,
				props.children,
				props.hint ? react.createElement("span", { "data-read-aloud-field-hint": true }, props.hint) : null
			);
		}

		function TextInput(props) {
			return react.createElement("input", {
				type: "text",
				"data-read-aloud-input": true,
				style: inputStyle,
				value: props.value,
				placeholder: props.placeholder,
				onChange: (event) => props.onChange(event.target.value),
			});
		}

		function Select(props) {
			return react.createElement(
				"select",
				{ "data-read-aloud-input": true, style: inputStyle, value: props.value, onChange: (event) => props.onChange(event.target.value) },
				props.options.map((option) =>
					react.createElement(
						"option",
						{ key: option.value, value: option.value },
						option.label
					)
				)
			);
		}

		function keyHint(t, backend) {
			const map = {
				system: "settings.key.hint.system",
			};
			return map[backend] ? t(map[backend]) : null;
		}

		function ReadAloudSettingsCard({ t }) {
			useSpeechState();
			const [open, setOpen] = react.useState(false);
			const settings = speech.getSettings();
			const voices = speech.getVoices();
			const backend = settings.backend;
			const error = speech.getError();
			const hint = keyHint(t, backend);

			const backendOptions = BACKENDS.map((item) => ({
				value: item.id,
				label: t(`backend.${item.id}`),
			}));

			return react.createElement(
				"div",
				{ "data-read-aloud-card": true, "data-open": open ? "true" : undefined },
				react.createElement(
					"button",
					{
						type: "button",
						"data-read-aloud-card-header": true,
						"aria-expanded": open,
						onClick: () => setOpen((current) => !current),
					},
					react.createElement(
						"div",
						{ style: { flex: 1, minWidth: 0 } },
						react.createElement(
							"div",
							{ style: { fontSize: 14, fontWeight: 600 } },
							t("settings.title")
						),
						react.createElement(
							"div",
							{
								style: {
									color: "var(--dsw-alias-label-tertiary, rgba(127,127,127,.8))",
									fontSize: 13,
									lineHeight: 1.5,
								},
							},
							t("settings.subtitle")
						)
					),
					react.createElement(open ? IconChevronDown : IconChevronRight, { size: 14 })
				),
				open
					? react.createElement(
						"div",
						{ style: { display: "flex", flexDirection: "column", gap: 14, padding: "0 16px 16px" } },
						react.createElement(
							Field,
							{ label: t("settings.backend") },
							react.createElement(
								Select,
								{
									value: backend,
									options: backendOptions,
									onChange: (value) => speech.setSetting("backend", value),
								}
							)
						),
						react.createElement(
							Field,
							{ label: t("settings.rate") },
							react.createElement(
								"input",
								{
									type: "range",
									"data-read-aloud-card-rate": true,
									min: MIN_RATE,
									max: MAX_RATE,
									step: 0.1,
									value: settings.rate,
									onChange: (event) => speech.setSetting("rate", event.target.value),
								}
							),
							react.createElement("span", null, `${settings.rate.toFixed(1)}×`)
						),
						backend === "browser"
							? !speech.browserSupported
								? react.createElement("span", { "data-read-aloud-field-error": true }, t("unsupported"))
								: react.createElement(
									Field,
									{ label: t("settings.voice") },
									react.createElement(
										Select,
										{
											value: settings.browserVoice,
											options: [{ value: "", label: t("settings.voice.default") }].concat(
												voices.map((voice) => ({ value: voice.voiceURI, label: `${voice.name} (${voice.lang})` }))
											),
											onChange: (value) => speech.setSetting("browserVoice", value),
										}
									)
								)
							: null,
						backend === "system"
							? react.createElement(
								Field,
								{ label: t("settings.voice"), hint: t("settings.voice.hint") },
								react.createElement(
									TextInput,
									{
										value: settings.systemVoice,
										placeholder: "",
										onChange: (value) => speech.setSetting("systemVoice", value),
									}
								)
							)
							: null,
						hint ? react.createElement("span", { "data-read-aloud-field-hint": true }, hint) : null,
						error ? react.createElement("span", { "data-read-aloud-field-error": true }, `${t("settings.error")}: ${error}`) : null
					)
					: null
			);
		}

		// ── per-message read button ─────────────────────────────────────────────
		function ReadAloudAction({ messageId, sessionId, t, sessions }) {
			useSpeechState();
			const session = react.useMemo(
				() => (sessions.binding(sessionId) ? sessions.binding(sessionId).session : null),
				[sessions, sessionId]
			);
			const subscribe = react.useCallback(
				(listener) => (session ? session.subscribe(listener) : () => {}),
				[session]
			);
			const snapshot = react.useSyncExternalStore(
				subscribe,
				() => (session ? session.getSnapshot() : null)
			);
			const text = react.useMemo(
				() => (snapshot ? findAssistantText(snapshot, messageId) : ""),
				[snapshot, messageId]
			);
			if (text.trim() === "") return null;
			const speaking = speech.isSpeaking(messageId);
			const label = t(speaking ? "stop" : "read");
			return react.createElement(
				Tooltip,
				{ label, side: "bottom" },
				react.createElement(
					"button",
					{
						type: "button",
						"data-read-aloud-action": true,
						"data-active": speaking ? "true" : undefined,
						"aria-label": label,
						"aria-pressed": speaking || undefined,
						onClick: () => speech.toggle(messageId, text)
					},
					react.createElement(speaking ? IconStop : IconPlay, { size: 16 })
				)
			);
		}

		// ── read-whole-conversation button ──────────────────────────────────────
		function ReadAllAction({ sessionId, t, sessions }) {
			useSpeechState();
			const reading = speech.isReading();
			const label = t(reading ? "readAll.stop" : "readAll");
			return react.createElement(
				Tooltip,
				{ label, side: "bottom" },
				react.createElement(
					"button",
					{
						type: "button",
						"data-read-aloud-all": true,
						"data-active": reading ? "true" : undefined,
						"aria-label": label,
						onClick: () => {
							if (reading) {
								speech.cancel();
								return;
							}
							const session = sessions.binding(sessionId)
								? sessions.binding(sessionId).session
								: null;
							const snapshot = session ? session.getSnapshot() : null;
							speech.speakAll(conversationTexts(snapshot));
						}
					},
					react.createElement(reading ? IconStop : IconPlay, { size: 14 }),
					react.createElement("span", null, label)
				)
			);
		}

		// ── client plugin body ──────────────────────────────────────────────────
		const inject = ["slots", "locale", "sessions", "connection"];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-read-aloud: dictionaries");
			const sessions = ctx.sessions;
			speech = createSpeechController({ connection: ctx.connection });

			ctx.slots.inject("conversation.chat.assistant-actions", () =>
				ctx.slots.register(
					{
						name: "conversation.chat.assistant-actions",
						id: "read-aloud",
						order: 30,
						locale: NS,
						inject: () => ({ sessions, speech })
					},
					ReadAloudAction
				)
			);

			ctx.slots.inject("conversation.session.header.actions", () =>
				ctx.slots.register(
					{
						name: "conversation.session.header.actions",
						id: "read-aloud-all",
						order: 30,
						locale: NS,
						inject: () => ({ sessions, speech })
					},
					ReadAllAction
				)
			);

			ctx.slots.inject("settings.plugin.item", () =>
				ctx.slots.register(
					{
						name: "settings.plugin.item",
						id: "dsh-read-aloud",
						order: 30,
						locale: NS,
					},
					ReadAloudSettingsCard
				)
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
