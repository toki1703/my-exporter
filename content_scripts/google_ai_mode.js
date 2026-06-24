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

    // Fetch the thread's creation time from AimThreadsService/ListThreads.
    // Failures are silently ignored — chatTime stays undefined and the markdown
    // exporter falls back to exportedAt.
    const chatTime = await fetchChatTime(query, params);

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
      chatTime,
      url: location.href,
      messages,
      sources,
    };
  });

  /**
   * Ask the service worker to call AimThreadsService/ListThreads and return
   * the ISO creation timestamp of the thread whose title matches `query`.
   * Returns undefined on any failure so the caller can fall back gracefully.
   */
  function fetchChatTime(query, urlParams) {
    return new Promise((resolve) => {
      const msg = {
        type: "AIM_LIST_THREADS",
        rlz: urlParams.get("rlz") ?? undefined,
        aep: urlParams.get("aep") ?? "42",
        amc: urlParams.get("amc") ?? "1",
        opi: urlParams.get("opi") ?? undefined,
      };

      chrome.runtime.sendMessage(msg, (resp) => {
        if (chrome.runtime.lastError || !resp?.ok) return resolve(undefined);
        try {
          const threads = parseListThreads(resp.text);
          const lq = query.toLowerCase();
          const match = threads.find((t) => t.title.toLowerCase() === lq);
          resolve(match?.createdAt ?? undefined);
        } catch (_) {
          resolve(undefined);
        }
      });
    });
  }

  /**
   * Parse AimThreadsService/ListThreads response text.
   *
   * Response format (after stripping the XSSI prefix )]}'\\n):
   *   [[[thread_entry, ...], ...]]
   *
   * Each thread_entry:
   *   [0]  ["thread_id", "session_id"]
   *   [1]  "title"  (the user's original query)
   *   [5]  [seconds, nanos]  — creation timestamp
   *   [6]  [seconds, nanos]  — last-modified timestamp
   */
  function parseListThreads(text) {
    // Strip XSSI prefix: )]}'<newline>
    const jsonStart = text.indexOf("[");
    if (jsonStart === -1) return [];
    let data;
    try { data = JSON.parse(text.slice(jsonStart)); } catch (_) { return []; }

    const entries = data?.[0];
    if (!Array.isArray(entries)) return [];

    return entries.map((e) => {
      const tsArr = e?.[5];
      const tsSec = Array.isArray(tsArr) && typeof tsArr[0] === "number" ? tsArr[0] : null;
      return {
        title: typeof e?.[1] === "string" ? e[1] : "",
        createdAt: tsSec ? new Date(tsSec * 1000).toISOString() : undefined,
      };
    });
  }

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
