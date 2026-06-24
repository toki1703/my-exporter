// Google Search — AI Mode collector
// Targets the dedicated AI Mode chat interface (?udm=50 or ?mtid=...).
//
// Key selectors aligned with reference extension (SaveAI 4.3.0):
//   [data-subtree="aimc"]          — assistant turn container (walk up to find turn root)
//   .iMqumd                        — user query element within a turn root
//   .CKgc1d                        — fallback turn root selector
//   [data-container-id="main-col"] — assistant response columns
//   ul.bTFeG li a[href]            — source links

(function () {
  const { register, cleanText } = window.__myExporter;

  register("google_ai_mode", async () => {
    const params = new URLSearchParams(location.search);
    const hasMtid = params.has("mtid");
    const hasUdm50 = params.get("udm") === "50";

    if (!hasMtid && !hasUdm50) {
      throw new Error(
        "Google AI Mode のページで使用してください（URL に udm=50 または mtid が含まれている必要があります）"
      );
    }

    const query = params.get("q")?.trim() ?? "";

    if (!query) {
      throw new Error("検索を実行してからエクスポートしてください");
    }

    const turnRoots = getTurnRoots();
    const turns = turnRoots.map((root) => ({
      userText: extractUserText(root),
      assistantText: extractAssistantText(root),
      sources: extractSources(root),
    })).filter((t) => t.userText || t.assistantText || t.sources.length);

    const messages = [];
    for (const turn of turns) {
      if (turn.userText) {
        messages.push({ role: "user", content: turn.userText });
      }
      if (turn.assistantText) {
        messages.push({ role: "assistant", content: turn.assistantText });
      }
    }

    if (messages.length === 0) {
      throw new Error(
        "回答が見つかりません。回答が完了してからエクスポートしてください。"
      );
    }

    if (messages[0]?.role !== "user") {
      messages.unshift({ role: "user", content: query });
    }

    // Fetch the thread's creation time from AimThreadsService/ListThreads.
    const chatTime = await fetchChatTime(query, params);

    // Collect sources across all turns, deduplicated.
    const seenUrls = new Set();
    const sources = turns.flatMap((t) => t.sources).filter((s) => {
      if (!s.url || seenUrls.has(s.url)) return false;
      seenUrls.add(s.url);
      return true;
    });

    const title = extractTitle() || `Google AI: ${query}`;

    return {
      service: "google_ai_mode",
      title,
      exportedAt: new Date().toISOString(),
      chatTime,
      url: location.href,
      messages,
      sources,
    };
  });

  function getTurnRoots() {
    // Primary: find [data-subtree="aimc"] containers, then walk up to the turn root
    // that contains a .iMqumd user query element.
    const assistantContainers = Array.from(
      document.querySelectorAll('[data-subtree="aimc"]')
    );
    if (assistantContainers.length > 0) {
      const roots = assistantContainers
        .map(findTurnRootFromAssistantContainer)
        .filter(Boolean);
      const unique = Array.from(new Set(roots));
      if (unique.length > 0) return unique;
    }
    // Fallback: direct turn root class
    return Array.from(document.querySelectorAll(".CKgc1d"));
  }

  function findTurnRootFromAssistantContainer(el) {
    let node = el;
    for (let i = 0; i < 10 && node; i++) {
      if (node.querySelector(".iMqumd")) return node;
      node = node.parentElement;
    }
    return null;
  }

  function extractUserText(root) {
    const queryEl = root.querySelector(".iMqumd");
    if (!queryEl) return "";
    const parent = queryEl.parentElement;
    if (!parent) return cleanText(queryEl);
    const clone = parent.cloneNode(true);
    clone.querySelector(".iMqumd")?.remove();
    removeNoiseElements(clone);
    return (clone.textContent ?? "").replace(/\s+/g, " ").trim();
  }

  function extractAssistantText(root) {
    const mainCols = Array.from(
      root.querySelectorAll('[data-container-id="main-col"]')
    );
    if (mainCols.length > 0) {
      return mainCols
        .map((col) => {
          const clone = col.cloneNode(true);
          removeNoiseElements(clone);
          return cleanText(clone);
        })
        .filter(Boolean)
        .join("\n\n");
    }
    // Fallback: get all text from the root minus the user query
    const userText = extractUserText(root);
    const fullText = cleanText(root);
    if (!userText) return fullText;
    return fullText.replace(userText, "").replace(/^\s+/, "");
  }

  function extractSources(root) {
    const links = Array.from(root.querySelectorAll("ul.bTFeG li a[href]"));
    const seen = new Map();
    links.forEach((a) => {
      const url = normalizeSourceUrl(a.getAttribute("href") || "");
      if (!url || seen.has(url)) return;
      seen.set(url, {
        title: extractSourceTitle(a),
        url,
        domain: extractSourceDomain(url),
      });
    });
    return Array.from(seen.values());
  }

  function removeNoiseElements(el) {
    const buttonParents = Array.from(el.querySelectorAll("button[aria-label]"))
      .map((b) => b.parentElement)
      .filter((p) => p && p !== el);
    Array.from(new Set(buttonParents)).forEach((p) => p.remove());
    el.querySelectorAll(
      "button, style, script, noscript, svg, [hidden], [style*='display:none'], [style*='display: none']"
    ).forEach((n) => n.remove());
  }

  function extractTitle() {
    const t = document.title.trim();
    if (!t) return "";
    const parts = t.split(" - ").map((p) => p.trim()).filter(Boolean);
    return parts.length <= 1 ? t : parts.slice(0, -1).join(" - ") || t;
  }

  function normalizeSourceUrl(href) {
    try {
      const u = new URL(href, window.location.origin);
      return (u.pathname === "/url" && u.searchParams.get("url")) || u.href;
    } catch {
      return "";
    }
  }

  function extractSourceTitle(a) {
    const label = (a.getAttribute("aria-label") || "")
      .replace(/\.?\s*Opens in a new tab\.?\s*$/i, "")
      .trim();
    return (label || a.textContent || a.href).replace(/\s+/g, " ").trim();
  }

  function extractSourceDomain(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return url;
    }
  }

  /**
   * Ask the service worker to call AimThreadsService/ListThreads and return
   * the ISO creation timestamp of the thread whose title matches `query`.
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
   */
  function parseListThreads(text) {
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
})();
