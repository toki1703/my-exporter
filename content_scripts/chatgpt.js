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

    function inferMimeType(value, fallback) {
      if (fallback && /^data:([^;,]+)[;,]/i.test(fallback)) {
        return fallback.match(/^data:([^;,]+)[;,]/i)?.[1] || fallback;
      }
      if (typeof value === "string" && /^data:([^;,]+)[;,]/i.test(value)) {
        return value.match(/^data:([^;,]+)[;,]/i)?.[1] || "application/octet-stream";
      }
      return fallback || "application/octet-stream";
    }

    async function fetchAttachmentData(url, mimeType) {
      if (!url) return null;
      if (url.startsWith("data:")) return url;

      try {
        const response = await fetch(url, { credentials: "include" });
        if (!response.ok) return null;
        const blob = await response.blob();
        const type = blob.type || mimeType || "application/octet-stream";
        const buffer = await blob.arrayBuffer();
        let binary = "";
        const bytes = new Uint8Array(buffer);
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
        }
        return `data:${type};base64,${btoa(binary)}`;
      } catch (_) {
        return null;
      }
    }

    function extractFileIdFromAssetPointer(assetPointer) {
      if (!assetPointer || typeof assetPointer !== "string") return null;
      const match = assetPointer.match(/(?:^|:)file_([a-zA-Z0-9]+)/);
      if (match) return `file_${match[1]}`;
      if (assetPointer.startsWith("sediment://file_")) {
        return assetPointer.replace(/^sediment:\/\//, "");
      }
      return assetPointer;
    }

    function buildFileIdCandidates(part, message) {
      const candidates = new Set();
      const messageAttachments = Array.isArray(message?.metadata?.attachments)
        ? message.metadata.attachments
        : [];

      for (const att of messageAttachments) {
        if (att?.id) candidates.add(att.id);
      }
      if (part?.asset_pointer) candidates.add(extractFileIdFromAssetPointer(part.asset_pointer));
      if (part?.assetPointer) candidates.add(extractFileIdFromAssetPointer(part.assetPointer));
      if (part?.file_id) candidates.add(part.file_id);
      if (part?.id) candidates.add(part.id);
      if (part?.name) candidates.add(part.name);
      return [...candidates].filter(Boolean);
    }

    async function fetchDownloadUrlForFileId(fileId) {
      if (!fileId) return null;

      const downloadEndpoints = [
        `/backend-api/files/download/${encodeURIComponent(fileId)}?post_id=&inline=false&download_intent=false`,
        `/backend-api/files/download/${encodeURIComponent(fileId)}?inline=false&download_intent=false`,
      ];

      for (const endpoint of downloadEndpoints) {
        try {
          const response = await fetch(endpoint, {
            credentials: "include",
            headers: {
              Accept: "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
          });
          if (!response.ok) continue;
          const payload = await response.json().catch(() => null);
          const downloadUrl =
            payload?.download_url ||
            payload?.url ||
            payload?.data?.download_url ||
            payload?.data?.url;
          if (downloadUrl) {
            return downloadUrl;
          }
        } catch (_) {}
      }
      return null;
    }

    async function fetchFileIdAsDataUrl(fileId, mimeType) {
      if (!fileId) return null;

      const directDownloadUrl = await fetchDownloadUrlForFileId(fileId);
      if (directDownloadUrl) {
        const dataUrl = await fetchAttachmentData(
          directDownloadUrl.startsWith("/")
            ? `${window.location.origin}${directDownloadUrl}`
            : directDownloadUrl,
          mimeType
        );
        if (dataUrl) return dataUrl;
      }

      return null;
    }

    async function extractAttachment(part, message) {
      if (!part || typeof part !== "object") return null;

      const messageAttachments = Array.isArray(message?.metadata?.attachments)
        ? message.metadata.attachments
        : [];
      const attachmentMeta =
        messageAttachments.find((a) => a?.id === extractFileIdFromAssetPointer(part?.asset_pointer)) ||
        messageAttachments.find((a) => a?.id === part?.asset_pointer) ||
        messageAttachments.find((a) => a?.name === part?.filename);

      const imageFile = part.image_file || part.file_data || part.image || part.file;
      const fileIdCandidates = buildFileIdCandidates(part, message);
      const rawData =
        imageFile?.file_data ||
        imageFile?.data ||
        imageFile?.url ||
        imageFile?.image_url ||
        part?.file_data ||
        part?.image_url ||
        part?.url ||
        part?.file_url;

      const assetPointer = part?.asset_pointer || part?.assetPointer;
      const fileId = extractFileIdFromAssetPointer(assetPointer) || fileIdCandidates[0] || null;
      const estuaryParams = new URLSearchParams({
        id: fileId || "",
        ts: String(Date.now()),
        p: "fs",
        cid: "1",
        v: "0",
      });
      const estuaryUrl = fileId
        ? `/backend-api/estuary/content?${estuaryParams.toString()}`
        : null;

      if (!rawData && !assetPointer && !part?.image_url && !part?.url && !part?.file_url && !estuaryUrl) {
        return null;
      }

      const mimeType =
        imageFile?.mime_type ||
        attachmentMeta?.mime_type ||
        part?.mime_type ||
        (typeof rawData === "string" ? inferMimeType(rawData) : null) ||
        (assetPointer ? "application/octet-stream" : null);

      const attachment = {
        type: part?.type || part?.content_type || (mimeType?.startsWith("image/") ? "image" : "file"),
        mimeType,
        filename:
          imageFile?.filename ||
          attachmentMeta?.name ||
          part?.filename ||
          part?.name ||
          (fileId || assetPointer || "attachment"),
        assetPointer: assetPointer || null,
        sizeBytes: imageFile?.size_bytes || attachmentMeta?.size || part?.size_bytes || null,
      };

      if (typeof rawData === "string") {
        if (rawData.startsWith("data:")) {
          attachment.dataUrl = rawData;
        } else if (/^(https?:|\/)/i.test(rawData)) {
          attachment.url = rawData;
          attachment.dataUrl = await fetchAttachmentData(rawData, mimeType);
        } else if (rawData) {
          attachment.dataUrl = `data:${mimeType};base64,${rawData}`;
        }
      } else if (part?.image_url || part?.url || part?.file_url) {
        const directUrl = part.image_url || part.url || part.file_url;
        attachment.url = directUrl;
        attachment.dataUrl = await fetchAttachmentData(directUrl, mimeType);
      } else if (estuaryUrl) {
        attachment.url = estuaryUrl;
        attachment.dataUrl = await fetchAttachmentData(estuaryUrl, mimeType);
      }

      if (!attachment.dataUrl && estuaryUrl) {
        attachment.dataUrl = await fetchAttachmentData(
          `${window.location.origin}${estuaryUrl}`,
          mimeType
        );
      }

      if (!attachment.dataUrl && fileIdCandidates.length > 0) {
        for (const candidate of fileIdCandidates) {
          const maybe = await fetchFileIdAsDataUrl(candidate, mimeType);
          if (maybe) {
            attachment.dataUrl = maybe;
            break;
          }
        }
      }

      if (attachment.dataUrl && /^data:/i.test(attachment.dataUrl)) {
        try {
          const uploadResponse = await fetch("https://toki1703.net/upload.php", {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            },
            body: new URLSearchParams({ image_base64: attachment.dataUrl }),
          });
          const uploadJson = await uploadResponse.json().catch(() => null);
          const uploadBody = uploadJson?.body || uploadJson;
          const assetId =
            uploadBody?.id ||
            uploadJson?.id ||
            uploadBody?.asset_id ||
            uploadJson?.asset_id ||
            null;
          if (assetId) {
            attachment.uploadAssetId = assetId;
            attachment.uploadImageUrl = `https://toki1703.net/image_get.php?asset_id=${encodeURIComponent(assetId)}`;
          }
        } catch (_) {}
      }

      if (part?.thumbnail_url) attachment.thumbnailUrl = part.thumbnail_url;
      return attachment;
    }

    async function extractTextAndAttachments(parts, message) {
      const texts = [];
      const attachments = [];

      for (const part of parts ?? []) {
        if (typeof part === "string") {
          if (part.trim()) texts.push(part.trim());
          continue;
        }
        if (part && typeof part === "object") {
          if (typeof part.text === "string" && part.text.trim()) {
            texts.push(part.text.trim());
          } else if (typeof part.content === "string" && part.content.trim()) {
            texts.push(part.content.trim());
          }
          const attachment = await extractAttachment(part, message);
          if (attachment) attachments.push(attachment);
        }
      }

      return {
        text: texts.join("\n").trim(),
        attachments,
      };
    }

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
        const { text, attachments } = await extractTextAndAttachments(parts, msg);

        if (text || attachments.length > 0) {
          const role = msg.author.role === "user" ? "user" : "assistant";
          const timestamp = msg.create_time
            ? new Date(msg.create_time * 1000).toISOString()
            : undefined;

          const entry = {
            role,
            content: text || (attachments.length > 0 ? `[画像ファイル ${attachments.length} 件]` : ""),
            timestamp,
          };

          if (attachments.length > 0) {
            entry.attachments = attachments;
          }

          messages.push(entry);
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
