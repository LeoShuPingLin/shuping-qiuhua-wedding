# 婚禮感謝小卡 AI Worker

此 Worker 只接受 `https://leoshupinglin.github.io` 的請求，並在後端保管 OpenAI API Key。

前端可選兩種模型：

- `GPT-6 Astra`：精緻寫作，預設選項。
- `GPT-6.1 Sol`：平衡省費。

每次按下「產生」或「修改」最多只會送出 **1 次** OpenAI API 請求，不會在背景自動重試。一次產生兩個版本仍只算一次。

後端另有婚宴禮貌防護：如果模型原稿提到「彼此不熟、互動不多、以後再慢慢熟悉」或只把收卡者寫成某人的伴侶，系統會直接改用溫暖公版，不會把失禮內容顯示出來，也不會為此多呼叫一次 API。

## 第一次部署

在 Repository 根目錄開啟終端機：

```bash
cd backend/cards
npx wrangler login
npx wrangler deploy
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put CARD_ACCESS_TOKEN
```

第一次部署也會自動建立一個 SQLite Durable Object，用來保存無法因換電腦、重整頁面而歸零的付費呼叫次數。

- `OPENAI_API_KEY`：從 OpenAI Platform 建立的 Project API Key。
- `CARD_ACCESS_TOKEN`：自訂一組至少 20 字元、只有書平與秋華知道的工具密碼；不要使用 OpenAI API Key。
- 輸入 secret 時終端機不會顯示內容，屬正常現象。

設定完成後不必再次部署。Wrangler 顯示的 Worker 網址後面加上 `/generate`，填入小卡前端的「後端 HTTPS 網址」。

例如：

```text
https://wedding-thank-you-cards.你的帳號.workers.dev/generate
```

## 更新 Worker

```bash
cd backend/cards
npx wrangler deploy
```

## 付費呼叫硬上限

`wrangler.json` 預設：

- 總上限：500 次。
- 每日上限：500 次（以台灣日期計算）。

達到任一上限時，Worker 會先擋住請求，不會呼叫 OpenAI。若確定要調整，可修改 `CARD_TOTAL_LIMIT` 或 `CARD_DAILY_LIMIT`，再重新部署；已使用次數不會因重新部署而歸零。

## 本機測試

```bash
node --test worker.test.mjs
```

請勿把 `.dev.vars`、API Key 或工具密碼提交到 GitHub。
