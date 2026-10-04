# 婚禮感謝小卡 AI Worker

此 Worker 只接受 `https://leoshupinglin.github.io` 的請求，並在後端保管 OpenAI API Key。

## 第一次部署

在 Repository 根目錄開啟終端機：

```bash
cd backend/cards
npx wrangler login
npx wrangler deploy
npx wrangler secret put OPENAI_API_KEY
npx wrangler secret put CARD_ACCESS_TOKEN
```

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

## 本機測試

```bash
node --test worker.test.mjs
```

請勿把 `.dev.vars`、API Key 或工具密碼提交到 GitHub。
