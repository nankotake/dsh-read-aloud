/**
 * dsh-read-aloud — host half.
 *
 * Owns the RPC channel the browser half uses to synthesize speech outside the
 * browser, plus ONE example backend:
 *
 *  - `system` — the host machine's own TTS (macOS `say`, Windows PowerShell
 *    `System.Speech`, Linux `espeak`). Offline, no API key.
 *
 * The browser half calls this through the official Connection RPC channel:
 * `ctx.connection.rpc.handle('/read-aloud', ...)` on this side and
 * `ctx.connection.rpc.call('/read-aloud', 'synthesize', ...)` on the browser
 * side. Synthesized audio is returned as `{ audioBase64, mimeType }` because
 * the RPC carrier is JSON-only. API keys (for backends you add yourself) are
 * read from the HOST process environment, so they never enter the browser.
 *
 * ── How to add your own backend ─────────────────────────────────────────────
 * 1. Add a `case` in `synthesize()` below that returns `{ audioBase64, mimeType }`.
 * 2. In lib/client.js: add the id to `BACKENDS`, add a `backendOptions` case,
 *    and add a `backend.<id>` label to the zh/en dictionaries.
 * 3. Restart dsh and refresh the page — the new backend shows up in the
 *    "Speech backend" picker automatically.
 *
 * Cloud backends (Edge TTS / OpenAI / Azure / ElevenLabs) all follow one shape:
 * fetch audio bytes over HTTPS, then return them base64-encoded. A complete,
 * copy-paste example is in README.md.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

export const name = "dsh-read-aloud";

/** Host services this plugin consumes. `connection` is the host RPC registry. */
export const inject = ["connection"];

const MIN_RATE = 0.5;
const MAX_RATE = 2;

function clampRate(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_RATE, Math.max(MIN_RATE, n));
}

function badRequest(message) {
  return { ok: false, error: { code: "bad-request", message, details: { issues: [] } } };
}

function internalError(error) {
  return {
    ok: false,
    error: {
      code: "internal",
      message: error instanceof Error ? error.message : String(error),
      details: {},
    },
  };
}

// ── example backend: system TTS (offline, host machine) ─────────────────────
async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), "dsh-read-aloud-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function systemTts(text, options) {
  if (process.platform === "win32") return systemTtsWindows(text, options);
  if (process.platform === "darwin") return systemTtsDarwin(text, options);
  return systemTtsEspeak(text, options);
}

/**
 * Windows: PowerShell + System.Speech renders a WAV file. The text travels
 * through a temp file (never through a shell string), and the rate/voice ride
 * environment variables, so a message's content cannot inject commands.
 */
async function systemTtsWindows(text, options) {
  return withTempDir(async (dir) => {
    const input = join(dir, "input.txt");
    const output = join(dir, "output.wav");
    await writeFile(input, text, "utf8");
    // System.Speech Rate is an integer in [-10, 10]; 1× maps to 0.
    const rate = Math.round((clampRate(options && options.rate) - 1) * 10);
    const script = [
      "$ErrorActionPreference = 'Stop'",
      "Add-Type -AssemblyName System.Speech",
      "$text = [System.IO.File]::ReadAllText($env:DRA_INPUT)",
      "$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer",
      "try { $synth.Rate = [int]$env:DRA_RATE } catch {}",
      "if ($env:DRA_VOICE) { try { $synth.SelectVoice($env:DRA_VOICE) } catch {} }",
      "$synth.SetOutputToWaveFile($env:DRA_OUTPUT)",
      "$synth.Speak($text)",
      "$synth.Dispose()",
    ].join("; ");
    await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      {
        env: {
          ...process.env,
          DRA_INPUT: input,
          DRA_OUTPUT: output,
          DRA_RATE: String(rate),
          DRA_VOICE: typeof options === "object" && typeof options.voice === "string" ? options.voice : "",
        },
        windowsHide: true,
      },
    );
    const bytes = await readFile(output);
    return { audioBase64: bytes.toString("base64"), mimeType: "audio/wav" };
  });
}

/** macOS: `say` renders an AIFF file (`-r` is words per minute, default ~175). */
async function systemTtsDarwin(text, options) {
  return withTempDir(async (dir) => {
    const input = join(dir, "input.txt");
    const output = join(dir, "output.aiff");
    await writeFile(input, text, "utf8");
    const args = ["-o", output, "-f", input];
    if (options && typeof options.voice === "string" && options.voice) {
      args.push("-v", options.voice);
    }
    args.push("-r", String(Math.round(175 * clampRate(options && options.rate))));
    await execFileAsync("say", args);
    const bytes = await readFile(output);
    return { audioBase64: bytes.toString("base64"), mimeType: "audio/aiff" };
  });
}

/** Linux: `espeak` renders a WAV file (`-s` is words per minute). */
async function systemTtsEspeak(text, options) {
  return withTempDir(async (dir) => {
    const input = join(dir, "input.txt");
    const output = join(dir, "output.wav");
    await writeFile(input, text, "utf8");
    const args = ["-w", output, "-f", input];
    if (options && typeof options.voice === "string" && options.voice) {
      args.push("-v", options.voice);
    }
    args.push("-s", String(Math.round(175 * clampRate(options && options.rate))));
    await execFileAsync("espeak", args);
    const bytes = await readFile(output);
    return { audioBase64: bytes.toString("base64"), mimeType: "audio/wav" };
  });
}

// ── backend dispatch ────────────────────────────────────────────────────────
async function synthesize(backend, text, options, signal) {
  switch (backend) {
    case "system":
      return systemTts(text, options);

    // Add your own backend as a new `case` here. Return `{ audioBase64, mimeType }`.
    // Example (OpenAI, needs OPENAI_API_KEY in the host environment):
    //
    // case "openai": {
    //   const key = process.env.OPENAI_API_KEY;
    //   if (!key) throw new Error("OPENAI_API_KEY is not set in the host environment");
    //   const response = await fetch("https://api.openai.com/v1/audio/speech", {
    //     method: "POST",
    //     headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    //     body: JSON.stringify({ model: "tts-1", voice: "alloy", input: text }),
    //     signal,
    //   });
    //   if (!response.ok) throw new Error(`TTS request failed: HTTP ${response.status}`);
    //   const bytes = Buffer.from(await response.arrayBuffer());
    //   return { audioBase64: bytes.toString("base64"), mimeType: "audio/mpeg" };
    // }

    default:
      throw new Error(`unknown backend ${JSON.stringify(backend)}`);
  }
}

// ── plugin body ─────────────────────────────────────────────────────────────
export function apply(ctx) {
  ctx.effect(() => ctx.connection.rpc.handle(
    "/read-aloud",
    async (endpoint, payload, signal) => {
      if (endpoint !== "synthesize") {
        return badRequest(`unknown endpoint ${JSON.stringify(endpoint)}`);
      }
      const input = payload;
      const backend = input && typeof input === "object" ? input.backend : undefined;
      const text = input && typeof input === "object" ? input.text : undefined;
      const options = input && typeof input === "object" ? input.options : undefined;
      if (typeof backend !== "string" || typeof text !== "string") {
        return badRequest("payload must be { backend: string, text: string, options?: object }");
      }
      if (text.trim() === "") {
        return { ok: true, value: { audioBase64: "", mimeType: "" } };
      }
      try {
        const value = await synthesize(backend, text, options || {}, signal);
        return { ok: true, value };
      } catch (error) {
        return internalError(error);
      }
    },
    { authority: "loopback" },
  ), "dsh-read-aloud: /read-aloud rpc channel");
}
