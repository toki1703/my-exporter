# My Exporter

ChatGPT・Gemini・Claude・Perplexity などの AI チャットサービスの会話履歴を、Markdown または JSON 形式でエクスポートする Chrome 拡張機能です。

## 対応サービス

| サービス | アイコン | ホスト |
|---|---|---|
| ChatGPT | 💬 | chatgpt.com / chat.openai.com |
| Gemini | ✨ | gemini.google.com |
| Claude | 🤖 | claude.ai |
| Google AI Mode | 🔍 | google.com/search |
| Perplexity | 🔮 | perplexity.ai |

## 機能

- **現在の会話をエクスポート** — ポップアップから1クリックでエクスポート
- **一括エクスポート** — 過去の全会話をまとめてダウンロード（対応サービスのみ）
- **出力形式** — Markdown / JSON を選択可能
- **保存先** — ダウンロードフォルダ (`Downloads/my-exporter/`) または Obsidian vault
- **バッジ表示** — Claude のトップページでは会話総数をアイコンバッジに表示

## Markdown 出力フォーマット

Obsidian 向けの YAML フロントマターを含む形式で出力されます。

```markdown
---
base: "[[Claude Chats.base]]"
URL: https://claude.ai/chat/...
Archive: false
Chat Time: 2024-01-15T10:30:00
Source: claude
Created at: 2024-01-15T10:35:00
Space Name: ""
Tags: []
Favorite: false
---

# you asked

（ユーザーのメッセージ）

----

# claude response

（Claude の返答）

----
```

## インストール方法

1. このリポジトリをクローンまたはダウンロードします。
2. Chrome で `chrome://extensions/` を開きます。
3. 右上の「デベロッパーモード」を有効にします。
4. 「パッケージ化されていない拡張機能を読み込む」をクリックし、このフォルダを選択します。

## 使い方

### 現在の会話をエクスポート

1. 対応サービスの会話ページを開きます。
2. ツールバーの My Exporter アイコンをクリックします。
3. 「この会話をエクスポート」ボタンをクリックします。

### 設定の変更

ポップアップ下部の設定表示をクリックするか、歯車ボタンからオプションページを開きます。

| 設定項目 | 選択肢 |
|---|---|
| 出力形式 | Markdown / JSON |
| 保存先 | ファイル（ダウンロード） / Obsidian |

### Obsidian への保存

保存先に「Obsidian」を選択した場合、[Obsidian Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) プラグイン経由で Vault に直接保存します。オプションページで Vault のパスと API キーを設定してください。

## ファイル構成

```
my-exporter/
├── manifest.json              # 拡張機能の定義 (Manifest V3)
├── popup/
│   ├── popup.html             # ポップアップ UI
│   ├── popup.css
│   └── popup.js               # サービス検出・エクスポート制御
├── options/
│   ├── options.html           # 設定ページ
│   └── options.css
├── background/
│   └── service_worker.js      # バックグラウンド処理・Gemini API プロキシ
├── content_scripts/
│   ├── common.js              # 共通ユーティリティ・メッセージルーター
│   ├── chatgpt.js
│   ├── gemini.js
│   ├── claude.js
│   ├── google_ai_mode.js
│   └── perplexity.js
├── exporters/
│   ├── markdown_exporter.js   # Markdown 変換
│   └── json_exporter.js       # JSON 変換
├── styles/
│   └── material.css           # 共通スタイル
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## パーミッション

| パーミッション | 用途 |
|---|---|
| `activeTab` | 現在のタブの URL 取得 |
| `scripting` | コンテンツスクリプトの動的実行 |
| `downloads` | ファイルのダウンロード |
| `storage` | 設定の保存 |

## バージョン

0.1.0
