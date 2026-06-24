// =============================================================
// Popup — detect the current service and export the open chat.
// All settings live on the options page.
// =============================================================

const SERVICES = {
  chatgpt:        { name: "ChatGPT",        icon: `<img src="../images/OpenAI-black-monoblossom.svg" alt="ChatGPT">`,       hosts: ["chatgpt.com", "chat.openai.com"] },
  gemini:         { name: "Gemini",         icon: `<img src="../images/Google_Gemini_icon_2025.svg" alt="Gemini">`,         hosts: ["gemini.google.com"] },
  claude:         { name: "Claude",         icon: `<img src="../images/Claude_AI_symbol.svg" alt="Claude">`,               hosts: ["claude.ai"] },
  google_ai_mode: { name: "Google AI Mode", icon: `<img src="../images/Google_Gemini_icon_2025.svg" alt="Google AI Mode">`, hosts: ["www.google.com"], pathPrefix: "/search", searchParams: { udm: "50" } },
  perplexity:     { name: "Perplexity",     icon: `<img src="../images/perplexity.svg" alt="Perplexity">`,           hosts: ["perplexity.ai", "www.perplexity.ai"] },
};

const FORMAT_LABELS = { markdown: "Markdown", json: "JSON" };
const DEST_LABELS = { download: "ファイル", obsidian: "Obsidian" };

let detectedService = null;
let settings = { exportFormat: "markdown", exportDest: "download" };

// --- Detect service from a URL ---

function detectService(url) {
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  const host = parsed.hostname;

  for (const [key, meta] of Object.entries(SERVICES)) {
    const hostMatch = meta.hosts.some((h) => host === h || host.endsWith(`.${h}`));
    if (!hostMatch) continue;
    if (meta.pathPrefix && !parsed.pathname.startsWith(meta.pathPrefix)) continue;
    if (meta.searchParams) {
      const urlParams = new URLSearchParams(parsed.search);
      const matches = Object.entries(meta.searchParams).every(([k, v]) => urlParams.get(k) === v);
      if (!matches) continue;
    }
    return key;
  }
  return null;
}

// --- Startup ---

(async () => {
  const stored = await chrome.storage.local.get(["exportFormat", "exportDest"]);
  settings.exportFormat = stored.exportFormat || "markdown";
  settings.exportDest = stored.exportDest || "download";
  renderSummary();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  detectedService = tab?.url ? detectService(tab.url) : null;
  renderServiceCard();
})();

function renderSummary() {
  const fmt = settings.exportDest === "obsidian"
    ? "Markdown"
    : (FORMAT_LABELS[settings.exportFormat] || settings.exportFormat);
  const dest = DEST_LABELS[settings.exportDest] || settings.exportDest;
  document.getElementById("summary-text").textContent = `${fmt} · ${dest}`;
}

function renderServiceCard() {
  const card = document.getElementById("service-card");
  const icon = document.getElementById("service-icon");
  const name = document.getElementById("service-name");
  const sub  = document.getElementById("service-sub");
  const btn  = document.getElementById("btn-export");

  if (detectedService) {
    const meta = SERVICES[detectedService];
    icon.innerHTML = meta.icon;
    name.textContent = meta.name;
    sub.textContent = "現在の会話をエクスポートできます";
    card.classList.remove("service-card--unsupported");
    btn.disabled = false;
  } else {
    icon.textContent = "🌐";
    name.textContent = "対応サービスを開いてください";
    sub.textContent = "ChatGPT · Gemini · Claude · Perplexity ほか";
    card.classList.add("service-card--unsupported");
    btn.disabled = true;
  }
}

// --- UI helpers ---

function showMessage(text, type = "info") {
  const el = document.getElementById("message");
  el.textContent = text;
  el.className = `message ${type}`;
}

function hideMessage() {
  document.getElementById("message").className = "message hidden";
}

// --- Open options ---

document.getElementById("btn-options").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
document.getElementById("settings-summary").addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

// --- Export current conversation ---

document.getElementById("btn-export").addEventListener("click", async () => {
  const btn = document.getElementById("btn-export");
  if (btn.disabled || !detectedService) return;

  const service = detectedService;
  btn.disabled = true;
  btn.textContent = "エクスポート中…";
  hideMessage();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: triggerExport,
      args: [service],
    });

    const data = results?.[0]?.result;
    if (!data || data.error) throw new Error(data?.error ?? "データを取得できませんでした");

    const result = await chrome.runtime.sendMessage({
      type: "EXPORT",
      service,
      format: settings.exportFormat,
      dest: settings.exportDest,
      data,
    });

    if (!result?.ok) throw new Error(result?.error ?? "エクスポートに失敗しました");

    const destNote = settings.exportDest === "obsidian"
      ? "Obsidian に保存しました"
      : "Downloads/my-exporter/ に保存しました";
    showMessage(`エクスポート完了！ ${destNote}`, "success");
  } catch (err) {
    showMessage(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "この会話をエクスポート";
  }
});

// =============================================================
// Injected into the page via executeScript (no closure access)
// =============================================================

function triggerExport(service) {
  return new Promise((resolve) => {
    const handler = (event) => {
      if (event.source !== window) return;
      if (event.data?.type !== "MY_EXPORTER_DATA") return;
      window.removeEventListener("message", handler);
      resolve(event.data.payload);
    };
    window.addEventListener("message", handler);
    window.postMessage({ type: "MY_EXPORTER_REQUEST", service }, "*");

    setTimeout(() => {
      window.removeEventListener("message", handler);
      resolve({ error: "タイムアウト: コンテンツスクリプトが応答しませんでした" });
    }, 10000);
  });
}
