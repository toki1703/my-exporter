// Google Search — AI Mode collector
// AI Mode appears when the search result page shows an AI-generated summary block.

(function () {
  const { register, cleanText } = window.__myExporter;

  register("google_ai_mode", async () => {
    // The AI overview block lives inside a specific data-attrid attribute
    const aiBlock =
      document.querySelector('[data-attrid="wa:/description"]') ??
      document.querySelector(".aiob") ??  // fallback class (may change)
      document.querySelector("[jscontroller][data-async-context]"); // generic fallback

    if (!aiBlock) {
      throw new Error(
        "AI モードの回答が見つかりません。AI モードの検索結果ページを開いてください。"
      );
    }

    const query =
      document.querySelector("input[name='q']")?.value ??
      new URLSearchParams(location.search).get("q") ??
      "";

    const answer = cleanText(aiBlock);

    // Collect cited sources if present
    const sources = Array.from(
      document.querySelectorAll("[data-attrid='wa:/description'] a[href], .aiob a[href]")
    )
      .map((a) => ({ title: a.textContent.trim(), url: a.href }))
      .filter((s) => s.title && s.url);

    return {
      service: "google_ai_mode",
      title: query ? `Google AI: ${query}` : "Google AI Mode Export",
      exportedAt: new Date().toISOString(),
      url: location.href,
      messages: [
        { role: "user", content: query },
        { role: "assistant", content: answer },
      ],
      sources,
    };
  });
})();
