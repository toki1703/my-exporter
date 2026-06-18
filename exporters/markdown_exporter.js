const SERVICE_META = {
  chatgpt:       { base: "[[ChatGPT Chats.base]]",    user: "you asked", assistant: "chatgpt response" },
  gemini:        { base: "[[Gemini Chats.base]]",      user: "you asked", assistant: "gemini response" },
  claude:        { base: "[[Claude Chats.base]]",      user: "you asked", assistant: "claude response" },
  google_ai_mode:{ base: "[[Google AI Chats.base]]",   user: "you asked", assistant: "google ai response" },
  perplexity:    { base: "[[Perplexity Chats.base]]",  user: "you asked", assistant: "perplexity response" },
};

const pad = (n) => String(n).padStart(2, "0");

// ISO string → "YYYY-MM-DDTHH:MM:SS" in local time
function fmtIso(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
         `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ISO string → "YYYY-MM-DD HH:MM:SS" in local time
function fmtMsgTime(iso) {
  if (!iso) return "";
  return fmtIso(iso).replace("T", " ");
}

export function toMarkdown(data, _service) {
  const service = data.service || _service || "unknown";
  const meta = SERVICE_META[service] ?? { base: "", user: "you asked", assistant: "assistant response" };

  const { url = "", exportedAt = "", chatTime = "", messages = [] } = data;

  const lines = [];

  lines.push("---");
  lines.push(`base: "${meta.base}"`);
  lines.push(`URL: ${url}`);
  lines.push(`Archive: false`);
  lines.push(`Chat Time: ${fmtIso(chatTime || exportedAt)}`);
  lines.push(`Source: ${service}`);
  lines.push(`Created at: ${fmtIso(exportedAt)}`);
  lines.push(`Space Name: ""`);
  lines.push(`Tags: []`);
  lines.push(`Favorite: false`);
  lines.push("---");
  lines.push("");

  for (const msg of messages) {
    const roleLabel = msg.role === "user" ? meta.user : meta.assistant;

    lines.push(`# ${roleLabel}`);
    lines.push("");

    if (msg.timestamp) {
      lines.push(`message time: ${fmtMsgTime(msg.timestamp)}`);
      lines.push("");
    }

    lines.push(msg.content);
    lines.push("");
    lines.push("----");
    lines.push("");
  }

  return lines.join("\n");
}
