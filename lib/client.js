/**
 * dsh-read-aloud — browser half (hand-written bundle, no build step).
 *
 * Reads AI conversation content aloud with the browser's built-in Web Speech
 * API (`window.speechSynthesis`). Two surfaces are contributed through the
 * official slot system:
 *
 *  - `conversation.chat.assistant-actions` — a per-message read button on the
 *    finalized assistant reply, toggling between read / stop for that message.
 *  - `conversation.session.header.actions` — a session-level "read the whole
 *    conversation" button that reads every user message and its final assistant
 *    reply in order, toggling to stop while reading.
 *
 * Text is derived from the same conversation snapshot the chat view renders
 * from (`session.getSnapshot().chat`), so what is spoken is exactly what is on
 * screen. No network calls and no API key are involved; the voice and language
 * follow the operating system's / browser's speech-synthesis settings.
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
		const IconStop = primitives.IconStopFill16;
		const Tooltip = primitives.Tooltip;

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
			"empty": "没有可朗读的内容"
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
			"empty": "Nothing to read"
		};

		// ── text extraction ─────────────────────────────────────────────────────
		/** user/message content parts → plain text. */
		function partsText(parts) {
			if (!Array.isArray(parts)) return "";
			return parts
				.filter((part) => part && part.type === "text" && typeof part.text === "string")
				.map((part) => part.text)
				.join("\n");
		}

		/** assistant blocks (finalNode.blocks) → plain text. */
		function blocksText(blocks) {
			if (!Array.isArray(blocks)) return "";
			return blocks
				.filter((block) => block && block.kind === "text" && typeof block.text === "string")
				.map((block) => block.text)
				.join("\n");
		}

		/**
		 * Find the plain text of the finalized assistant message addressed by the
		 * `conversation.chat.assistant-actions` slot's `messageId` owner currency.
		 * @param snapshot - conversation snapshot.
		 * @param messageId - stable identity carried from the `assistant/message` event.
		 * @returns the joined text blocks, or "" when absent.
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

		/**
		 * Ordered read-aloud script for the whole conversation: each user/steering
		 * message, then each closed turn's final assistant reply. Rendered-only
		 * wrappers (`assistant-step`, `turn-tail`) are folded so a multi-step turn
		 * is read once as its final answer rather than as every intermediate step.
		 * @param snapshot - conversation snapshot.
		 * @returns an array of { key, text } in conversation order.
		 */
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

		// ── speech controller ───────────────────────────────────────────────────
		/**
		 * One speech-synthesis controller for the whole plugin. It serializes a
		 * queue of utterances so "read all" plays one message after another, and it
		 * uses a generation counter so a `cancel()` that races an in-flight
		 * utterance cannot advance a freshly started queue.
		 */
		function createSpeechController() {
			const supported =
				typeof window !== "undefined"
				&& "speechSynthesis" in window
				&& typeof window.SpeechSynthesisUtterance === "function";
			let listeners = [];
			let speaking = null; // { key } | null
			let queue = []; // [{ key, text }]
			let epoch = 0;

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

			function cancel() {
				epoch += 1;
				queue = [];
				if (supported) {
					try {
						window.speechSynthesis.cancel();
					} catch {
						// A cancel that throws leaves no queue to drain; ignore it.
					}
				}
				if (speaking !== null) {
					speaking = null;
					notify();
				}
			}

			function advance() {
				if (!supported) return;
				const myEpoch = epoch;
				const next = queue.shift();
				if (!next) {
					if (speaking !== null) {
						speaking = null;
						notify();
					}
					return;
				}
				const text = String(next.text == null ? "" : next.text).replace(/\s+/g, " ").trim();
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
				utterance.onend = () => {
					if (epoch === myEpoch) advance();
				};
				utterance.onerror = () => {
					if (epoch === myEpoch) advance();
				};
				speaking = { key: next.key };
				notify();
				try {
					window.speechSynthesis.speak(utterance);
				} catch {
					speaking = null;
					notify();
				}
			}

			function speak(key, text) {
				if (!supported) return;
				cancel();
				queue = [{ key, text }];
				advance();
			}

			function speakAll(items) {
				if (!supported || !Array.isArray(items) || items.length === 0) return;
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

			return { supported, subscribe, isSpeaking, isReading, speak, speakAll, toggle, cancel };
		}

		const speech = createSpeechController();

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
				'[data-read-aloud-all][data-active="true"]{color:var(--dsw-alias-state-business-primary,#4176e6)}';
			document.head.appendChild(tag);
		}

		/** Subscribe a component to the speech controller's state changes. */
		function useSpeechState() {
			const [, forceRender] = react.useReducer((x) => x + 1, 0);
			react.useEffect(() => speech.subscribe(forceRender), []);
		}

		// ── per-message read button ─────────────────────────────────────────────
		/**
		 * Read-aloud action in the assistant-message strip. It looks the message
		 * text up from the live conversation snapshot and toggles speech for that
		 * one message. Only finalized messages reach this slot, so `messageId` is
		 * always present.
		 */
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
		/**
		 * Session-header action that reads every user message and each closed
		 * turn's final assistant reply in order. It reads the snapshot only on
		 * click, so streaming does not re-render this control on every token.
		 */
		function ReadAllAction({ sessionId, t, sessions }) {
			useSpeechState();
			if (!speech.supported) {
				return react.createElement(
					Tooltip,
					{ label: t("unsupported"), side: "bottom" },
					react.createElement(
						"button",
						{
							type: "button",
							"data-read-aloud-all": true,
							disabled: true,
							"aria-label": t("unsupported"),
							style: { opacity: 0.5, cursor: "default" }
						},
						react.createElement(IconPlay, { size: 14 }),
						react.createElement("span", null, t("readAll"))
					)
				);
			}
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
		const inject = ["slots", "locale", "sessions"];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-read-aloud: dictionaries");
			const sessions = ctx.sessions;

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
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
