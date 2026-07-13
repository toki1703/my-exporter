// Perplexity (perplexity.ai) collector — REST API based
// Fetches from /rest/thread/{id} instead of DOM scraping.

(function () {
  const { register } = window.__myExporter;

  register("perplexity", async () => {
    // Conversation ID from URL: /search/{id}
    const convId = location.pathname.match(/\/search\/([^/?#]+)/)?.[1];
    if (!convId) {
      throw new Error(
        "会話が見つかりません。Perplexity の検索ページを開いてください（URLに /search/ が含まれる必要があります）。"
      );
    }

    const data = await fetchThread(convId);

    if (!Array.isArray(data?.entries) || data.entries.length === 0) {
      throw new Error("会話データが見つかりませんでした。");
    }

    const messages = [];
    for (const entry of data.entries) {
      const ts = entry.entry_updated_datetime || entry.updated_datetime || undefined;

      if (entry.query_str?.trim()) {
        messages.push({ role: "user", content: entry.query_str.trim(), timestamp: ts });
      }

      const { content, imageUrls } = extractAssistantContent(entry.blocks ?? []);
      if (content || imageUrls.length > 0) {
        const attachments = await buildImageAttachments(imageUrls);
        const msg = {
          role: "assistant",
          content: content || `[画像ファイル ${attachments.length} 件]`,
          timestamp: ts,
        };
        if (attachments.length > 0) msg.attachments = attachments;
        messages.push(msg);
      }
    }

    if (messages.length === 0) {
      throw new Error("会話が見つかりません。Perplexity の質問ページを開いてください。");
    }

    // Collect cited sources (deduplicated)
    const sources = [];
    const seenUrls = new Set();
    for (const entry of data.entries) {
      for (const block of entry.blocks ?? []) {
        if (block.intended_usage === "web_results") {
          for (const r of block.web_result_block?.web_results ?? []) {
            if (r.url && !seenUrls.has(r.url)) {
              seenUrls.add(r.url);
              sources.push({ title: r.name || r.url, url: r.url });
            }
          }
        }
      }
    }

    const title =
      data.entries.find((e) => e.thread_title)?.thread_title ||
      document.title.replace(/\s*[-–|]\s*Perplexity\s*$/i, "").trim() ||
      "Perplexity Export";

    return {
      service: "perplexity",
      title,
      exportedAt: new Date().toISOString(),
      chatTime: messages.find((m) => m.timestamp)?.timestamp,
      url: location.href,
      messages,
      sources,
    };
  });

  // ── Fetch /rest/thread/{id} ─────────────────────────────────────────────────
  // Content script runs on perplexity.ai, so this is same-origin. cookies sent.

  async function fetchThread(convId) {
    const BLOCK_TYPES = [
      "answer_modes", "media_items", "knowledge_cards", "inline_entity_cards",
      "place_widgets", "finance_widgets", "sports_widgets", "flight_status_widgets",
      "shopping_widgets", "jobs_widgets", "search_result_widgets",
      "clarification_responses", "inline_images", "inline_assets",
      "placeholder_cards", "diff_blocks", "inline_knowledge_cards",
      "entity_group_v2", "refinement_filters", "canvas_mode", "maps_preview",
      "answer_tabs", "price_comparison_widgets",
    ];

    const params = new URLSearchParams({
      with_parent_info: "true",
      with_schematized_response: "true",
      version: "2.18",
      source: "default",
      limit: "10",
      offset: "0",
      from_first: "true",
    });
    BLOCK_TYPES.forEach((t) => params.append("supported_block_use_cases", t));

    const resp = await fetch(
      `https://www.perplexity.ai/rest/thread/${convId}?${params}`,
      {
        method: "GET",
        credentials: "include",
        headers: {
          Accept: "*/*",
          "Content-Type": "application/json",
          "x-app-apiclient": "default",
          "x-app-apiversion": "2.18",
        },
      }
    );

    if (!resp.ok) {
      throw new Error(`Perplexity API エラー: ${resp.status}`);
    }
    return resp.json();
  }

  // ── Convert image URLs to base64 attachments ───────────────────────────────

  async function buildImageAttachments(urls) {
    const { fetchImageAsDataUrl } = window.__myExporter;
    const attachments = [];
    for (const url of urls) {
      const dataUrl = await fetchImageAsDataUrl(url);
      let filename = "image";
      try {
        filename = new URL(url).pathname.split("/").pop() || "image";
      } catch (_) {}
      attachments.push({
        type: "image",
        filename,
        mimeType: dataUrl?.match(/^data:([^;,]+)[;,]/)?.[1] || null,
        url,
        dataUrl,
      });
    }
    return attachments;
  }

  // ── Extract assistant text content from entry blocks ───────────────────────
  // Returns { content, imageUrls } — images become base64 attachments upstream.

  function extractAssistantContent(blocks) {
    // Build web_results list for citation replacement
    const webResults = [];
    for (const block of blocks) {
      if (block.intended_usage === "web_results") {
        webResults.push(...(block.web_result_block?.web_results ?? []));
      }
    }

    // Replace [n] citation markers with markdown links
    const replaceCitations = (text) =>
      text.replace(/\[(\d+)\]/g, (match, num) => {
        const r = webResults[parseInt(num, 10) - 1];
        if (!r?.url) return match;
        let domain = r.meta_data?.citation_domain_name || r.meta_data?.domain_name;
        if (!domain) {
          try {
            domain = new URL(r.url).hostname.replace(/^www\./, "").split(".")[0];
          } catch (_) {}
        }
        return domain ? `[[${parseInt(num, 10) - 1}]](${r.url})` : match;
      });

    const parts = [];
    const imageUrls = [];
    const addImage = (url) => {
      if (url && !imageUrls.includes(url)) imageUrls.push(url);
    };

    for (const block of blocks) {
      if (block.intended_usage === "media_items") {
        for (const item of block.media_block?.media_items ?? []) {
          if (item.medium === "image" && item.image) addImage(item.image);
        }
      } else if (block.intended_usage === "ask_text") {
        const answer = block.markdown_block?.answer;
        if (answer?.trim()) parts.push(replaceCitations(answer.trim()));
        for (const item of block.markdown_block?.media_items ?? []) {
          if (item.medium === "image" && item.image) addImage(item.image);
        }
      }
    }

    return { content: parts.join("\n\n"), imageUrls };
  }
})();
