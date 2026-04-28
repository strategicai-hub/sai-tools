#!/usr/bin/env node
// Monitora instâncias uazapi e envia alerta Telegram quando detecta desconexão.
// Roda em GitHub Actions (cron). Estado persistido em state/uazapi-state.json
// via actions/cache para evitar spam entre execuções.

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

const UAZAPI_URL = (process.env.UAZAPI_URL ?? "").replace(/\/$/, "");
const UAZAPI_ADMIN_TOKEN = process.env.UAZAPI_ADMIN_TOKEN ?? "";
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const TELEGRAM_CHAT_IDS = (process.env.TELEGRAM_CHAT_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const STATE_FILE = process.env.STATE_FILE ?? "state/uazapi-state.json";
const DEBUG = process.env.DEBUG === "1";

if (!UAZAPI_URL || !UAZAPI_ADMIN_TOKEN) {
  console.warn("UAZAPI_URL ou UAZAPI_ADMIN_TOKEN nao configurado — pulando execucao.");
  process.exit(0);
}
if (!TELEGRAM_BOT_TOKEN || TELEGRAM_CHAT_IDS.length === 0) {
  console.warn("TELEGRAM_BOT_TOKEN ou TELEGRAM_CHAT_IDS nao configurado — pulando execucao.");
  process.exit(0);
}

const CONNECTED_STATES = new Set(["connected", "open", "online"]);

function isConnected(status) {
  return CONNECTED_STATES.has(String(status ?? "").toLowerCase());
}

function pickStatus(instance) {
  return (
    instance.status ??
    instance.state ??
    instance.connection ??
    instance.connectionStatus ??
    instance.connected ??
    "unknown"
  );
}

function pickName(instance) {
  return (
    instance.name ??
    instance.instanceName ??
    instance.instance ??
    instance.id ??
    instance.token ??
    "?"
  );
}

async function fetchInstances() {
  const candidates = ["/instance/all", "/instance/list", "/instances"];
  let lastErr;
  for (const path of candidates) {
    const url = `${UAZAPI_URL}${path}`;
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { adminToken: UAZAPI_ADMIN_TOKEN, accept: "application/json" },
      });
      if (!res.ok) {
        lastErr = new Error(`${path} -> HTTP ${res.status}`);
        continue;
      }
      const json = await res.json();
      if (DEBUG) console.log(`[debug] ${path} payload:`, JSON.stringify(json).slice(0, 500));
      const list = Array.isArray(json)
        ? json
        : Array.isArray(json.instances)
          ? json.instances
          : Array.isArray(json.data)
            ? json.data
            : null;
      if (list) return list;
      lastErr = new Error(`${path} -> formato inesperado`);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error("Falha ao listar instâncias");
}

function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function sendTelegram(text) {
  const endpoint = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
  const results = await Promise.allSettled(
    TELEGRAM_CHAT_IDS.map((chatId) =>
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      }).then(async (r) => {
        if (!r.ok) throw new Error(`telegram ${r.status}: ${(await r.text()).slice(0, 200)}`);
      }),
    ),
  );
  results.forEach((r, i) => {
    if (r.status === "rejected") console.error(`Telegram chat ${TELEGRAM_CHAT_IDS[i]}:`, r.reason);
  });
}

async function loadState() {
  if (!existsSync(STATE_FILE)) return {};
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

async function saveState(state) {
  await mkdir(dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}

function nowSP() {
  return new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

async function main() {
  const instances = await fetchInstances();
  const state = await loadState();
  const next = {};
  const alerts = [];

  for (const inst of instances) {
    const name = pickName(inst);
    const status = pickStatus(inst);
    const connected = isConnected(status);
    const prev = state[name] ?? { alerted: false };

    if (!connected && !prev.alerted) {
      alerts.push({ kind: "down", name, status });
      next[name] = { status: String(status), alerted: true, since: nowSP() };
    } else if (connected && prev.alerted) {
      alerts.push({ kind: "up", name, status });
      next[name] = { status: String(status), alerted: false, since: nowSP() };
    } else {
      next[name] = { status: String(status), alerted: prev.alerted, since: prev.since ?? nowSP() };
    }
  }

  for (const a of alerts) {
    const text =
      a.kind === "down"
        ? `⚠️ <b>UAZAPI DESCONECTADA</b>\n\n` +
          `📱 <b>Instância:</b> ${escHtml(a.name)}\n` +
          `🔌 <b>Status:</b> ${escHtml(a.status)}\n` +
          `🕒 <b>Quando:</b> ${escHtml(nowSP())}\n\n` +
          `Reconecte no painel da uazapi.`
        : `✅ <b>UAZAPI RECONECTADA</b>\n\n` +
          `📱 <b>Instância:</b> ${escHtml(a.name)}\n` +
          `🔌 <b>Status:</b> ${escHtml(a.status)}\n` +
          `🕒 <b>Quando:</b> ${escHtml(nowSP())}`;
    console.log(`alert ${a.kind}: ${a.name} (${a.status})`);
    await sendTelegram(text);
  }

  await saveState(next);

  console.log(
    `checked=${instances.length} alerts=${alerts.length} (${alerts.filter((a) => a.kind === "down").length} down, ${alerts.filter((a) => a.kind === "up").length} up)`,
  );
}

main().catch((err) => {
  console.error("uazapi-monitor failed:", err);
  process.exit(1);
});
