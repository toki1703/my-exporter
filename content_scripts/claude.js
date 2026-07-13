// Claude (claude.ai) collector

(function () {
  const { register } = window.__myExporter;
  // Claude doesn't provide a conversation list API, but we can get the total count by paginating through their chat_conversations_v2 endpoint.
  async function getClaudeConversationCount() {
    const orgMatch = document.cookie.match(/lastActiveOrg=([0-9a-f-]+)/i);
    if (!orgMatch) throw new Error("Claude: 組織IDが取得できません");
    const orgId = orgMatch[1];

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let count = 0;
    let offset = 0;
    const limit = 50;

    while (true) {
      const r = await fetch(
        `/api/organizations/${orgId}/chat_conversations_v2?limit=${limit}&offset=${offset}&consistency=eventual`,
        { headers: { "content-type": "application/json" } }
      );
      if (!r.ok) throw new Error(`Claude: 会話リスト取得エラー: ${r.status}`);
      const data = await r.json();
      count += (data.data ?? []).length;
      if (!data.has_more) break;
      offset += limit;
      await sleep(300);
    }

    return count;
  }
  // --- Badge: total chat count on top page ---
  async function updateBadge() {
    if (location.pathname.match(/\/chat\/[0-9a-f-]+/i)) return;
    try {
      const count = await getClaudeConversationCount();
      if (count > 0) {
        chrome.runtime.sendMessage({ type: "SET_BADGE", count, color: "#cc7a5a" });
      }
    } catch (_) {}
  }

  updateBadge();
  let _lastPathname = location.pathname;
  new MutationObserver(() => {
    if (location.pathname !== _lastPathname) {
      _lastPathname = location.pathname;
      updateBadge();
    }
  }).observe(document.body, { subtree: true, childList: true });
  // ---

  register("claude", async () => {
    // Extract conversation ID from URL: /chat/{uuid}
    const conversationMatch = location.pathname.match(/\/chat\/([0-9a-f-]+)/i);
    if (!conversationMatch) {
      throw new Error("会話が見つかりません。Claude の会話ページを開いてください。");
    }
    const conversationId = conversationMatch[1];

    // Get org ID from cookie set by claude.ai
    const orgMatch = document.cookie.match(/lastActiveOrg=([0-9a-f-]+)/i);
    if (!orgMatch) {
      throw new Error("組織IDが取得できません。Claude にログインしていることを確認してください。");
    }
    const orgId = orgMatch[1];

    // Fetch conversation via the internal API used by claude.ai
    const apiUrl = `/api/organizations/${orgId}/chat_conversations/${conversationId}?tree=True&rendering_mode=messages&render_all_tools=true&consistency=strong`;
    const response = await fetch(apiUrl, {
      headers: { "content-type": "application/json" },
    });

    if (!response.ok) {
      throw new Error(`API エラー: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Extract text from a content block array
    function extractText(contentBlocks) {
      if (!Array.isArray(contentBlocks)) return "";
      return contentBlocks
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("\n")
        .trim();
    }

    // Image files attached to a message live in files_v2 (newer) / files
    // (older). Their preview/thumbnail URLs are relative /api/... paths served
    // same-origin, so a credentialed fetch converts them to base64.
    const { fetchImageAsDataUrl } = window.__myExporter;
    async function extractImageAttachments(msg) {
      const files = [...(msg.files_v2 ?? []), ...(msg.files ?? [])];
      const seen = new Set();
      const attachments = [];

      for (const file of files) {
        if (!file || (file.file_kind && file.file_kind !== "image")) continue;
        const id = file.file_uuid || file.uuid || file.file_name;
        if (!id || seen.has(id)) continue;
        seen.add(id);

        const rawUrl =
          file.preview_asset?.url ||
          file.preview_url ||
          file.thumbnail_asset?.url ||
          file.thumbnail_url;
        if (!rawUrl) continue;

        const url = rawUrl.startsWith("/") ? `${location.origin}${rawUrl}` : rawUrl;
        const dataUrl = await fetchImageAsDataUrl(url);
        attachments.push({
          type: "image",
          filename: file.file_name || id,
          mimeType: dataUrl?.match(/^data:([^;,]+)[;,]/)?.[1] || null,
          url,
          dataUrl,
        });
      }

      return attachments;
    }

    const messages = [];
    for (const msg of data.chat_messages ?? []) {
      const role = msg.sender === "human" ? "user" : "assistant";
      const content = extractText(msg.content);
      const attachments = await extractImageAttachments(msg);
      if (content || attachments.length > 0) {
        const entry = {
          role,
          content: content || `[画像ファイル ${attachments.length} 件]`,
        };
        if (attachments.length > 0) entry.attachments = attachments;
        messages.push(entry);
      }
    }

    if (messages.length === 0) {
      throw new Error("メッセージが見つかりません。");
    }

    const title =
      data.name?.trim() ||
      document.title.replace(/\s*[-–]\s*Claude\s*$/, "").trim() ||
      "Claude Export";

    return {
      service: "claude",
      title,
      exportedAt: new Date().toISOString(),
      url: location.href,
      messages,
    };
  });
})();
