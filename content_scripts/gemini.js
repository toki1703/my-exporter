// Gemini (gemini.google.com) collector
// Uses the hNvQHb batchexecute RPC to fetch all conversation turns directly.
// Auth tokens (at, f.sid, bl) are read from window.WIZ_global_data — no scroll needed.

(function () {
  const { register } = window.__myExporter;

  register("gemini", async () => {
    // Conversation ID from URL: /app/CONV_ID or /u/N/app/CONV_ID
    const convId = location.pathname.match(/\/app\/([a-f0-9]+)/)?.[1];
    if (!convId) {
      throw new Error("会話ページを開いてください（URLに /app/ が含まれる必要があります）。");
    }

    // WIZ_global_data is assigned in an inline <script> tag on every Gemini page.
    // Content scripts can read script.textContent from the DOM directly —
    // no script injection needed (which would be blocked by the extension CSP).
    const wiz = readWizData();
    const at  = wiz?.SNlM0e;   // XSRF-like token
    const sid = wiz?.FdrFJe;   // f.sid
    const bl  = wiz?.cfb2h;    // build label

    if (!at || !bl) {
      throw new Error("認証トークンが見つかりません。ページをリロードしてから再試行してください。");
    }

    const messages = await fetchTurns(convId, at, sid, bl);

    if (messages.length === 0) {
      throw new Error("会話が見つかりません。Gemini の会話ページを開いてください。");
    }

    // document.title = "〇〇 - Gemini" → strip the suffix
    const title = document.title
      .replace(/\s*[-–|]\s*(Google\s+)?Gemini\s*$/i, "")
      .trim() || "Gemini Export";

    return {
      service: "gemini",
      title,
      exportedAt: new Date().toISOString(),
      // messages are chronological, so the first timestamp is the chat's start
      chatTime: messages.find(m => m.timestamp)?.timestamp,
      url: location.href,
      messages,
    };
  });

  // ── Read WIZ_global_data from inline <script> tags ───────────────────────
  // The object is assigned as plain JSON — no eval needed, just DOM text parsing.

  function readWizData() {
    for (const script of document.querySelectorAll("script:not([src])")) {
      const text = script.textContent;
      const idx = text.indexOf("WIZ_global_data");
      if (idx === -1) continue;
      const eqIdx = text.indexOf("=", idx);
      if (eqIdx === -1) continue;
      const braceIdx = text.indexOf("{", eqIdx);
      if (braceIdx === -1) continue;
      const jsonStr = sliceBalanced(text, braceIdx);
      if (!jsonStr) continue;
      try { return JSON.parse(jsonStr); } catch (_) { continue; }
    }
    return null;
  }

  // ── batchexecute / hNvQHb (fetched from the background service worker) ──────
  // A content-script fetch to this endpoint fails with "Failed to fetch": the
  // request is rejected before it reaches the network. The background service
  // worker has the gemini.google.com host permission, so it can fetch with the
  // user's cookies and without the CORS/context restrictions that block us here.
  // We just read the tokens from the page and pass them along.

  function fetchTurns(convId, at, sid, bl) {
    // Preserve the /u/N account prefix if present in the current URL
    const uPrefix = location.pathname.match(/^(\/u\/\d+)/)?.[1] ?? "";

    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        {
          type: "GEMINI_FETCH",
          convId,
          at,
          sid,
          bl,
          uPrefix,
          hl: navigator.language || "ja",
        },
        (resp) => {
          if (chrome.runtime.lastError) {
            reject(new Error(`拡張機能との通信に失敗しました。ページを再読み込みして再試行してください（${chrome.runtime.lastError.message}）`));
            return;
          }
          if (!resp?.ok) {
            reject(new Error(resp?.error || "Gemini API エラー"));
            return;
          }
          parseResponse(resp.text).then(resolve, reject);
        }
      );
    });
  }

  // ── Parse batchexecute response ───────────────────────────────────────────
  // Format:  )]}'\n\nSIZE\n[["wrb.fr","hNvQHb","<JSON>",...],...]\nSIZE\n[["e",...]]
  // The first "[" starts the envelope array we need.

  // Recursively collect googleusercontent image URLs from a proto subtree.
  // The turn arrays have unstable indices, so scanning strings is more robust
  // than hardcoding paths. Avatar URLs (…googleusercontent.com/a/…) are skipped.
  function collectImageUrls(node, out = new Set()) {
    if (typeof node === "string") {
      if (
        /^https:\/\/lh\d+\.googleusercontent\.com\//.test(node) &&
        !/googleusercontent\.com\/a[/-]/.test(node)
      ) {
        out.add(node);
      }
    } else if (Array.isArray(node)) {
      for (const child of node) collectImageUrls(child, out);
    }
    return out;
  }

  async function buildImageAttachments(urls) {
    const { fetchImageAsDataUrl } = window.__myExporter;
    const attachments = [];
    for (const url of urls) {
      const dataUrl = await fetchImageAsDataUrl(url);
      attachments.push({
        type: "image",
        filename: url.split("/").pop()?.split("=")[0] || "image",
        mimeType: dataUrl?.match(/^data:([^;,]+)[;,]/)?.[1] || null,
        url,
        dataUrl,
      });
    }
    return attachments;
  }

  async function parseResponse(text) {
    const start = text.indexOf("[");
    if (start === -1) throw new Error("API レスポンスのパースに失敗しました。");

    const envStr = sliceBalanced(text, start);
    if (!envStr) throw new Error("API レスポンスのパースに失敗しました。");

    let envelope;
    try { envelope = JSON.parse(envStr); }
    catch (_) { throw new Error("API レスポンスのパースに失敗しました。"); }

    const entry = envelope.find(e => Array.isArray(e) && e[0] === "wrb.fr" && e[1] === "hNvQHb");
    if (!entry) throw new Error("会話データが見つかりませんでした。");

    let data;
    try { data = JSON.parse(entry[2]); }
    catch (_) { throw new Error("会話データのパースに失敗しました。"); }

    // data[0] = array of turns. Gemini returns them NEWEST-FIRST, so we sort by
    // the per-turn timestamp (the turn's last element: [seconds, nanos]) to get
    // chronological order.
    //   turn[2][0][0]       = user message text
    //   turn[3][0][0][1]    = model response text parts array
    //   turn[3][0][0][37][0][0] = thinking content parts array (Gemini 2.0+ Flash Thinking)
    const rawTurns = data?.[0];
    if (!Array.isArray(rawTurns)) return [];

    const turns = rawTurns
      .map((turn) => {
        const tsArr = turn?.[turn.length - 1];
        const tsSec = Array.isArray(tsArr) && typeof tsArr[0] === "number" ? tsArr[0] : null;
        return { turn, tsSec };
      })
      .sort((a, b) => (a.tsSec ?? 0) - (b.tsSec ?? 0));

    const messages = [];
    for (const { turn, tsSec } of turns) {
      const timestamp = tsSec ? new Date(tsSec * 1000).toISOString() : undefined;
      const userText  = turn?.[2]?.[0]?.[0];
      const modelParts = turn?.[3]?.[0]?.[0]?.[1];
      const modelText = Array.isArray(modelParts)
        ? modelParts.filter(s => typeof s === "string").join("")
        : (typeof modelParts === "string" ? modelParts : null);

      // Thinking content (Gemini Flash Thinking / 2.0+ models)
      const thinkingParts = turn?.[3]?.[0]?.[0]?.[37]?.[0]?.[0];
      const thinkingText = Array.isArray(thinkingParts)
        ? thinkingParts.filter(s => typeof s === "string").join("").trim()
        : null;

      // Uploaded images live in the user subtree (turn[2]), generated images
      // in the model subtree (turn[3]). Skip user images from the model set.
      const userImageUrls = collectImageUrls(turn?.[2]);
      const modelImageUrls = [...collectImageUrls(turn?.[3])].filter(
        (u) => !userImageUrls.has(u)
      );
      const userAttachments = await buildImageAttachments([...userImageUrls]);
      const modelAttachments = await buildImageAttachments(modelImageUrls);

      if ((typeof userText === "string" && userText.trim()) || userAttachments.length > 0) {
        const entry = {
          role: "user",
          content: userText?.trim() || `[画像ファイル ${userAttachments.length} 件]`,
          timestamp,
        };
        if (userAttachments.length > 0) entry.attachments = userAttachments;
        messages.push(entry);
      }

      if (modelText?.trim() || modelAttachments.length > 0) {
        const cleaned = removeCitations(modelText?.trim() ?? "");
        const content = thinkingText
          ? `<details><summary>Thinking</summary>\n\n${thinkingText}\n\n</details>\n\n${cleaned}`
          : cleaned;
        const entry = {
          role: "assistant",
          content: content || `[画像ファイル ${modelAttachments.length} 件]`,
          timestamp,
        };
        if (modelAttachments.length > 0) entry.attachments = modelAttachments;
        messages.push(entry);
      }
    }

    return messages;
  }

  // Remove Gemini citation markers: [cite_start] and [cite: ...]
  function removeCitations(text) {
    if (!text.includes("[cite_start]") && !text.includes("[cite:")) return text;
    return text
      .replace(/\[cite_start\]/g, "")
      .replace(/\[cite:\s*[^\]]+\]/g, "");
  }

  // Slice a balanced JSON value (array or object) from text[pos].
  function sliceBalanced(text, pos) {
    const OPEN = text[pos];
    if (OPEN !== "[" && OPEN !== "{") return null;
    const CLOSE = OPEN === "[" ? "]" : "}";
    let depth = 0, inStr = false;
    for (let i = pos; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (c === "\\") i++;
        else if (c === '"') inStr = false;
      } else if (c === '"') {
        inStr = true;
      } else if (c === OPEN) {
        depth++;
      } else if (c === CLOSE && --depth === 0) {
        return text.slice(pos, i + 1);
      }
    }
    return null;
  }
})();
