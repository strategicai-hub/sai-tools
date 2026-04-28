#!/usr/bin/env node
// Dispara um alerta de DESCONEXAO SIMULADA no Telegram para testar
// o pipeline (secrets + bot + chat IDs) sem precisar realmente
// derrubar uma instancia uazapi.

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? "";
const TELEGRAM_CHAT_IDS = (process.env.TELEGRAM_CHAT_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

if (!TELEGRAM_BOT_TOKEN || TELEGRAM_CHAT_IDS.length === 0) {
  console.error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_IDS");
  process.exit(1);
}

const when = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
const text =
  `🧪 <b>TESTE — UAZAPI DESCONECTADA (SIMULADO)</b>\n\n` +
  `📱 <b>Instância:</b> teste-e2e\n` +
  `🔌 <b>Status:</b> disconnected\n` +
  `🕒 <b>Quando:</b> ${when}\n\n` +
  `Esta é uma mensagem de teste do pipeline de monitoramento.\n` +
  `Se você está vendo isto, os secrets e o bot estão configurados corretamente.`;

const endpoint = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
const results = await Promise.allSettled(
  TELEGRAM_CHAT_IDS.map(async (chatId) => {
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });
    if (!r.ok) throw new Error(`telegram ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return chatId;
  }),
);

let ok = 0;
results.forEach((r, i) => {
  const id = TELEGRAM_CHAT_IDS[i];
  if (r.status === "fulfilled") {
    console.log(`✓ enviado para ${id}`);
    ok++;
  } else {
    console.error(`✗ falhou para ${id}:`, r.reason?.message ?? r.reason);
  }
});

if (ok === 0) process.exit(1);
console.log(`\n${ok}/${TELEGRAM_CHAT_IDS.length} mensagens enviadas.`);
