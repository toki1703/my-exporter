// Shared helpers injected before each service-specific content script

window.__myExporter = window.__myExporter || {};

/**
 * Register a collector function for a service.
 * The collector is called when the popup sends MY_EXPORTER_REQUEST.
 * It must return a plain object (serializable) or throw.
 *
 * @param {string} service
 * @param {() => Promise<object>} collector
 */
window.__myExporter.register = function register(service, collector) {
  window.addEventListener("message", async (event) => {
    if (event.source !== window) return;
    if (event.data?.type !== "MY_EXPORTER_REQUEST") return;
    if (event.data?.service !== service) return;

    try {
      const payload = await collector();
      window.postMessage({ type: "MY_EXPORTER_DATA", payload }, "*");
    } catch (err) {
      window.postMessage(
        { type: "MY_EXPORTER_DATA", payload: { error: err.message } },
        "*"
      );
    }
  });
};

/**
 * Wait for a DOM element matching selector to appear.
 */
window.__myExporter.waitForElement = function waitForElement(selector, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const el = document.querySelector(selector);
    if (el) return resolve(el);

    const observer = new MutationObserver(() => {
      const found = document.querySelector(selector);
      if (found) {
        observer.disconnect();
        resolve(found);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
      observer.disconnect();
      reject(new Error(`Timeout waiting for "${selector}"`));
    }, timeout);
  });
};

/**
 * Extract all text from a container, stripping extra whitespace.
 */
window.__myExporter.cleanText = function cleanText(el) {
  return el?.innerText?.replace(/\n{3,}/g, "\n\n").trim() ?? "";
};

/**
 * Fetch an image URL and convert it to a base64 data URL.
 * Tries a direct fetch first (same-origin and CORS-enabled hosts), then falls
 * back to the background service worker, whose host permissions cover image
 * CDNs (googleusercontent, cloudinary) that block content-script fetches.
 * Returns null when both fail.
 */
window.__myExporter.fetchImageAsDataUrl = async function fetchImageAsDataUrl(url) {
  if (!url) return null;
  if (url.startsWith("data:")) return url;
  const absolute = url.startsWith("/") ? `${location.origin}${url}` : url;

  async function blobToDataUrl(blob) {
    const type = blob.type || "image/png";
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return `data:${type};base64,${btoa(binary)}`;
  }

  try {
    const resp = await fetch(absolute, { credentials: "include" });
    if (resp.ok) return await blobToDataUrl(await resp.blob());
  } catch (_) {}

  try {
    const resp = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "FETCH_IMAGE", url: absolute }, (r) => {
        resolve(chrome.runtime.lastError ? null : r);
      });
    });
    if (resp?.ok && resp.dataUrl) return resp.dataUrl;
  } catch (_) {}

  return null;
};
