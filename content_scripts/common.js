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
