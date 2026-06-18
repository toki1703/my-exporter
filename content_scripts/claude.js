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

    const messages = [];
    for (const msg of data.chat_messages ?? []) {
      const role = msg.sender === "human" ? "user" : "assistant";
      const content = extractText(msg.content);
      if (content) {
        messages.push({ role, content });
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
