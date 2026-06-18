// Perplexity (perplexity.ai) collector

(function () {
  const { register, cleanText } = window.__myExporter;

  register("perplexity", async () => {
    // Perplexity renders Q&A in pairs.
    // User questions are in .query or similar; answers in .prose or .answer containers.
    // NOTE: Selectors are brittle — Perplexity's class names are often hashed.
    // Using structural selectors as a fallback.

    // Try to find question/answer pairs via data attributes first
    const questionEls = Array.from(
      document.querySelectorAll('[data-testid="query"], .query-text')
    );
    const answerEls = Array.from(
      document.querySelectorAll('[data-testid="answer"], .prose')
    );

    if (questionEls.length === 0 && answerEls.length === 0) {
      throw new Error(
        "会話が見つかりません。Perplexity の質問ページを開いてください。"
      );
    }

    const length = Math.max(questionEls.length, answerEls.length);
    const messages = [];

    for (let i = 0; i < length; i++) {
      if (questionEls[i]) {
        messages.push({ role: "user", content: cleanText(questionEls[i]) });
      }
      if (answerEls[i]) {
        messages.push({ role: "assistant", content: cleanText(answerEls[i]) });
      }
    }

    // Collect sources / citations
    const sources = Array.from(document.querySelectorAll(".source-item a, [class*='source'] a"))
      .map((a) => ({ title: a.textContent.trim(), url: a.href }))
      .filter((s) => s.title && s.url);

    const titleEl = document.querySelector("h1, [class*='title']");
    const title = titleEl?.textContent?.trim() ?? "Perplexity Export";

    return {
      service: "perplexity",
      title,
      exportedAt: new Date().toISOString(),
      url: location.href,
      messages,
      sources,
    };
  });
})();
