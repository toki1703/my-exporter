// Google Search — AI Mode collector
// Targets the dedicated AI Mode chat interface (?udm=50), NOT the AI Overview
// block that can appear in regular search results.
//
// Key selectors discovered from HAR analysis (2026-06):
//   [data-xid="aim-zsv2-turns-container"]  — completed conversation turns (ul > li)
//   [data-xid="aim-mars-turn-root"]        — active/streaming turn root

(function () {
  const { register, cleanText } = window.__myExporter;

  register("google_ai_mode", async () => {
    const params = new URLSearchParams(location.search);

    if (params.get("udm") !== "50") {
      throw new Error(
        "Google AI Mode のページで使用してください（URL に udm=50 が含まれている必要があります）"
      );
    }

    const query = params.get("q")?.trim() ?? "";

    if (!query) {
      throw new Error("検索を実行してからエクスポートしてください");
    }

    const turnsContainer = document.querySelector('[data-xid="aim-zsv2-turns-container"]');
    const messages = extractMessages(turnsContainer, query);

    if (messages.length === 0) {
      // Fall back to the active/streaming turn root.
      const activeTurn = document.querySelector('[data-xid="aim-mars-turn-root"]');
      const text = activeTurn ? cleanText(activeTurn) : "";
      if (!text) {
        throw new Error(
          "回答が見つかりません。回答が完了してからエクスポートしてください。"
        );
      }
      messages.push({ role: "user", content: query });
      messages.push({ role: "assistant", content: text });
    }

    if (messages[0]?.role !== "user") {
      messages.unshift({ role: "user", content: query });
    }

    const seenUrls = new Set();
    const sources = Array.from(
      (turnsContainer ?? document).querySelectorAll('a[href^="http"]')
    )
      .filter((a) => {
        const url = a.href;
        if (!url || seenUrls.has(url)) return false;
        if (/google\.com\/(search|url|imgres)/.test(url)) return false;
        const title = a.textContent.trim();
        if (!title) return false;
        seenUrls.add(url);
        return true;
      })
      .map((a) => ({ title: a.textContent.trim(), url: a.href }));

    return {
      service: "google_ai_mode",
      title: `Google AI: ${query}`,
      exportedAt: new Date().toISOString(),
      url: location.href,
      messages,
      sources,
    };
  });

  function extractMessages(container, latestQuery) {
    const messages = [];
    if (!container) return messages;

    const items = container.querySelectorAll("ul > li");
    if (items.length === 0) return messages;

    for (const item of items) {
      const fullText = cleanText(item);
      if (!fullText) continue;

      const queryEl =
        item.querySelector("h1, h2, h3") ??
        item.querySelector('[role="heading"]') ??
        item.querySelector('[data-xid*="query"], [data-xid*="user-query"]');

      if (queryEl) {
        const userText = cleanText(queryEl);
        const responseText = fullText.replace(userText, "").replace(/^\s+/, "");
        messages.push({ role: "user", content: userText });
        if (responseText) {
          messages.push({ role: "assistant", content: responseText });
        }
      } else {
        if (messages.length === 0) {
          messages.push({ role: "user", content: latestQuery });
        }
        messages.push({ role: "assistant", content: fullText });
      }
    }

    return messages;
  }
})();
