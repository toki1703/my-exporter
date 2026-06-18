// ChatGPT (chatgpt.com / chat.openai.com) collector
// Uses the internal /backend-api/conversation/{id} endpoint instead of DOM scraping
// to get the full conversation regardless of scroll position.

(function () {
  const { register } = window.__myExporter;
  // ChatGPT doesn't provide a conversation list API, but we can get the total
  // count by paginating through their conversations endpoint. The `total` field
  // returned by this endpoint is unreliable (it can under-report the real count),
  // so we count the actual `items` we paginate through instead.
  async function getChatGPTConversationCount() {
    const sessionResp = await fetch("/api/auth/session", { credentials: "include" });
    const session = sessionResp.ok ? await sessionResp.json() : {};
    const token = session?.accessToken;
    const headers = {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const limit = 100;
    let count = 0;
    let offset = 0;

    while (true) {
      const r = await fetch(
        `/backend-api/conversations?offset=${offset}&limit=${limit}&order=updated`,
        { credentials: "include", headers }
      );
      if (!r.ok) throw new Error(`ChatGPT: 会話リスト取得エラー: ${r.status}`);
      const page = await r.json();
      const items = page.items ?? [];
      count += items.length;
      if (items.length < limit) break;
      offset += limit;
      await sleep(300);
    }

    return count;
  }
  // --- Badge: total chat count on top page ---
  async function updateBadge() {
    if (location.pathname.match(/\/c\/[a-f0-9-]+/)) return;
    try {
      const count = await getChatGPTConversationCount();
      if (count > 0) {
        chrome.runtime.sendMessage({ type: "SET_BADGE", count, color: "#10a37f" });
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

  register("chatgpt", async () => {
    const conversationId = location.pathname.match(/\/c\/([a-f0-9-]+)/)?.[1];
    if (!conversationId) {
      throw new Error("会話が見つかりません。ChatGPT の会話ページ (/c/...) を開いてください。");
    }

    // ChatGPT requires a Bearer token in addition to cookies.
    // /api/auth/session returns it without any extra auth.
    const sessionResp = await fetch("/api/auth/session", { credentials: "include" });
    const session = sessionResp.ok ? await sessionResp.json() : {};
    const token = session?.accessToken;

    const resp = await fetch(`/backend-api/conversation/${conversationId}`, {
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`ChatGPT API エラー: ${resp.status}\n${body}`);
    }
    const json = await resp.json();

    const { title = "ChatGPT Export", mapping = {}, create_time } = json;

    // The conversation is a tree. Walk from root → last child to follow the main thread.
    const rootId = Object.keys(mapping).find((id) => mapping[id].parent === null);
    const messages = [];
    let currentId = rootId;

    while (currentId) {
      const node = mapping[currentId];
      const msg = node?.message;

      if (msg && msg.author?.role !== "system") {
        const parts = msg.content?.parts ?? [];
        const text = parts
          .filter((p) => typeof p === "string")
          .join("\n")
          .trim();

        if (text) {
          const role = msg.author.role === "user" ? "user" : "assistant";
          const timestamp = msg.create_time
            ? new Date(msg.create_time * 1000).toISOString()
            : undefined;
          messages.push({ role, content: text, timestamp });
        }
      }

      // Follow the last child to stay on the most recent branch
      const children = node?.children ?? [];
      currentId = children.length > 0 ? children[children.length - 1] : null;
    }

    if (messages.length === 0) {
      throw new Error("メッセージが見つかりません。");
    }

    return {
      service: "chatgpt",
      title: title || "ChatGPT Export",
      exportedAt: new Date().toISOString(),
      chatTime: create_time ? new Date(create_time * 1000).toISOString() : undefined,
      url: location.href,
      messages,
    };
  });
})();
