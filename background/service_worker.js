import { toJson } from "../exporters/json_exporter.js";
import { toMarkdown } from "../exporters/markdown_exporter.js";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type !== "SET_BADGE") return false;

  const count = message.count ?? 0;
  const text = count > 0 ? String(count) : "";
  const tabId = sender.tab?.id;
  const opts = tabId !== undefined ? { tabId } : {};

  chrome.action.setBadgeText({ text, ...opts });
  if (text) {
    chrome.action.setBadgeBackgroundColor({ color: message.color || "#666666", ...opts });
  }
  sendResponse({ ok: true });
  return false;
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "EXPORT") return false;

  handleExport(message).then(sendResponse).catch((err) => {
    sendResponse({ ok: false, error: err.message });
  });

  return true;
});

// Gemini's batchexecute endpoint must be fetched here (not from the content
// script, where it fails with "Failed to fetch"). We have the gemini.google.com
// host permission, so this request carries the user's cookies and bypasses the
// CORS/context restrictions that block the content script.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "GEMINI_FETCH") return false;

  fetchGeminiTurns(message).then(sendResponse).catch((err) => {
    sendResponse({ ok: false, error: err.message });
  });

  return true;
});

async function fetchGeminiTurns({ convId, at, sid, bl, uPrefix, hl }) {
  const prefix = uPrefix || "";

  const params = new URLSearchParams({
    rpcids: "hNvQHb",
    "source-path": `${prefix}/app/${convId}`,
    bl,
    "f.sid": sid || "",
    hl: hl || "ja",
    rt: "c",
  });

  // Payload: ["c_CONV_ID", numTurns, null, 1, [0], [4], null, 1]
  // numTurns=1000 requests the full history in one call.
  const fReq = JSON.stringify([[
    ["hNvQHb", JSON.stringify([`c_${convId}`, 1000, null, 1, [0], [4], null, 1]), null, "generic"],
  ]]);

  const body = new URLSearchParams({ "f.req": fReq, at });

  const resp = await fetch(
    `https://gemini.google.com${prefix}/_/BardChatUi/data/batchexecute?${params}`,
    {
      method: "POST",
      credentials: "include",
      headers: {
        "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        "x-same-domain": "1",
      },
      body: body.toString(),
    }
  );

  if (!resp.ok) {
    return { ok: false, error: `Gemini API エラー: ${resp.status}` };
  }

  return { ok: true, text: await resp.text() };
}

function sanitizeFilename(str) {
  return str
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 80)
    .replace(/^_|_$/g, "");
}

async function handleExport({ format, data, folder, dest }) {
  if (dest === "obsidian") {
    return exportToObsidian(format, data);
  }
  return exportToFile(format, data, folder);
}

// --- File download ---

async function exportToFile(format, data, folder) {
  const filename = sanitizeFilename(data?.title || data?.service || "export");
  const subfolder = folder ? `${sanitizeFilename(folder)}/` : "";

  let content, mimeType, ext;
  if (format === "markdown") {
    content = toMarkdown(data, data.service);
    mimeType = "text/markdown";
    ext = "md";
  } else {
    content = toJson(data, data.service);
    mimeType = "application/json";
    ext = "json";
  }

  const dataUrl = `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;
  await chrome.downloads.download({
    url: dataUrl,
    filename: `my-exporter/${subfolder}${filename}.${ext}`,
    saveAs: false,
  });

  return { ok: true };
}

// --- Obsidian Local REST API ---

async function exportToObsidian(format, data) {
  const s = await chrome.storage.local.get(["obsidianApiKey", "obsidianVaultPath", "obsidianBaseUrl"]);

  if (!s.obsidianApiKey) {
    throw new Error("Obsidian API キーが設定されていません（ポップアップの Obsidian 設定から入力してください）");
  }

  const baseUrl = (s.obsidianBaseUrl || "http://127.0.0.1:27123").replace(/\/$/, "");
  const vaultFolder = s.obsidianVaultPath || "";

  // Always write as Markdown to Obsidian regardless of format toggle
  const content = toMarkdown(data, data.service);
  const filename = sanitizeFilename(data?.title || data?.service || "export");

  const pathSegments = [
    ...vaultFolder.split("/").filter(Boolean),
    `${filename}.md`,
  ].map(encodeURIComponent);

  const url = `${baseUrl}/vault/${pathSegments.join("/")}`;

  const resp = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "text/markdown",
      "Authorization": `Bearer ${s.obsidianApiKey}`,
    },
    body: content,
  });

  if (!resp.ok && resp.status !== 204) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Obsidian API エラー: ${resp.status} ${body}`);
  }

  return { ok: true };
}
