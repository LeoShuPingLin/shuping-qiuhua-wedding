# 書平＆秋華電子喜帖

這是一個不需要安裝套件、不需要資料庫的靜態網站，可直接發布到 GitHub Pages。

網站內容包括：

- 婚禮日期倒數
- 佛前結婚儀式與幸福晚宴資訊
- Google Maps 導航
- `.ics` 行事曆下載
- 八年故事時間軸
- 拍拍印婚禮 LINE、桌次查詢與照片功能入口示意
- 手機、平板及電腦響應式版面

## 一、發布前先修改拍拍印 LINE 網址

開啟 `assets/app.js`，找到檔案最上方：

```js
const WEDDING_CONFIG = { lineFriendUrl: '' };
```

把拍拍印提供的「新人專屬 LINE 加好友網址」貼進去：

```js
const WEDDING_CONFIG = { lineFriendUrl: 'https://lin.ee/你的代碼' };
```

請確認使用的是你們婚禮專屬帳號，不是拍拍印客服帳號。設定完成後，網頁上的「回覆出席」按鈕就會直接開啟 LINE，POC 提示文字也會自動隱藏。

## 二、建立 GitHub Repository

1. 登入 [GitHub](https://github.com/)。
2. 右上角選擇 `New repository`。
3. Repository name 建議輸入：

   ```text
   shuping-qiuhua-wedding
   ```

4. 使用 GitHub Free 時請選擇 `Public`。
5. 不要勾選新增 README、`.gitignore` 或 License，保持空白Repository。
6. 按下 `Create repository`。

## 三、使用 Git 指令上傳

先將下載的 ZIP 解壓縮，再於終端機切換到解壓縮後的資料夾。

Windows PowerShell範例：

```powershell
cd "C:\Users\你的帳號\Downloads\shuping-qiuhua-wedding-github"
```

依序執行：

```bash
git init
git add .
git commit -m "Create wedding invitation website"
git branch -M main
git remote add origin https://github.com/你的GitHub帳號/shuping-qiuhua-wedding.git
git push -u origin main
```

請把指令中的 `你的GitHub帳號` 換成實際帳號。如果 GitHub 要求登入，依畫面使用瀏覽器授權或 Personal Access Token；GitHub 不接受帳號密碼作為 Git push 密碼。

## 四、開啟 GitHub Pages

1. 進入剛才建立的Repository。
2. 點擊 `Settings`。
3. 左側選擇 `Pages`。
4. 在 `Build and deployment` 的 `Source` 選擇 `Deploy from a branch`。
5. Branch選擇 `main`。
6. Folder選擇 `/(root)`。
7. 按下 `Save`。

網站通常會在幾分鐘內發布，網址格式為：

```text
https://你的GitHub帳號.github.io/shuping-qiuhua-wedding/
```

GitHub官方說明網站更新最久可能需要約10分鐘。發布完成後，可以回到 `Settings → Pages` 點擊 `Visit site`。

## 五、之後修改網站

完成文字、照片或連結修改後，執行：

```bash
git add .
git commit -m "Update wedding invitation"
git push
```

GitHub Pages會自動更新，不必再次設定Pages。

## 六、替換封面圖片

目前封面檔案為：

```text
assets/hero-watercolor.webp
```

最簡單的方法，是將新照片轉成WebP格式並使用相同檔名覆蓋。建議尺寸至少1600×1000，檔案盡量控制在500KB以內。

如果使用其他檔名，請同步修改 `assets/style.css` 中的：

```css
background-image: url("hero-watercolor.webp");
```

## 七、發布前檢查

- 日期是否為2026年10月9日
- 佛前儀式與晚宴的時間、地址是否正確
- 兩個Google Maps導航是否到正確地點
- 拍拍印LINE按鈕是否開啟你們的專屬帳號
- 手機版文字是否清楚、按鈕是否容易點擊
- 兩個「加入行事曆」按鈕是否能正常下載

## 隱私提醒

GitHub Pages發布後屬於公開網站，即使Repository使用私人設定，只要方案允許Pages，網站本身仍可能讓任何取得網址的人開啟。

請勿把賓客電話、完整桌次名單或其他個人資料直接寫入程式。桌次查詢、出席回覆及照片上傳交由拍拍印婚禮LINE處理即可。

目前首頁包含：

```html
<meta name="robots" content="noindex, nofollow" />
```

這能降低搜尋引擎收錄機率，但不是密碼保護。知道網址的人仍然可以開啟網站。

## 常見問題

### 網站顯示404

確認 `Settings → Pages` 已選擇 `main` 及 `/(root)`，並確認Repository根目錄直接看得到 `index.html`。

### 圖片或樣式沒有更新

先等待幾分鐘，再使用 `Ctrl + F5` 強制重新整理；手機可關閉分頁後重新開啟。

### LINE按鈕仍顯示示意畫面

確認 `assets/app.js` 裡的 `lineFriendUrl` 已填入完整的 `https://lin.ee/...` 網址，並完成 `git add`、`git commit`、`git push`。

## 官方參考資料

- [建立GitHub Pages網站](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)
- [設定GitHub Pages發布來源](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
