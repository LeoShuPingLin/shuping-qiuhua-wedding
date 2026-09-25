# Wedding Slideshow Generator

婚宴用的無縫照片輪播產生器。

版型：

- 上方：固定婚紗背景圖
- 中間：多張照片連續橫向滑動
- 下方：固定婚紗背景圖
- 輸出：1920×1080 MP4（預設 30fps）
- 中間照片保留原始長寬比，不會硬裁成同一尺寸
- 輪播可無縫循環

## 1. 準備圖片

把兩張婚紗背景放到：

```text
assets/background_top.jpg
assets/background_bottom.jpg
```

把要輪播的照片放到：

```text
photos/
  001.jpg
  002.jpg
  003.jpg
  ...
```

支援 JPG / JPEG / PNG / WEBP。

檔名會依自然排序讀取，所以建議用 `001.jpg`、`002.jpg` 這種方式控制順序。

## 2. 安裝

Windows 建議先安裝 Python 3.11 或 3.12。

在本資料夾執行：

```bash
python -m pip install -r requirements.txt
```

不需要另外手動安裝 FFmpeg，`imageio-ffmpeg` 會提供影片編碼器。

## 3. 先產生預覽圖

```bash
python generate.py --preview
```

會輸出：

```text
output/preview.png
```

先看預覽圖確認上下背景比例、照片大小與間距，比直接等整支影片快很多。

## 4. 產生 MP4

```bash
python generate.py
```

會輸出：

```text
output/wedding_slideshow.mp4
```

## 5. 可以調整的參數

全部集中在 `config.json`。

### 畫布

- `canvas.width` / `canvas.height`：影片解析度
- `canvas.fps`：FPS
- `canvas.duration_seconds`：輸出影片長度

### 上下背景

- `background.top_height`
- `background.bottom_height`
- `background.blur_radius`
- `background.brightness`

### 中間輪播

- `carousel.speed_px_per_second`：滑動速度，數字越大越快
- `carousel.direction`：`left` 或 `right`
- `carousel.photo_height`：照片高度
- `carousel.gap`：照片之間距離
- `carousel.vertical_offset`：中間整排上下微調
- `carousel.frame_padding`：白框厚度
- `carousel.corner_radius`：圓角
- `carousel.shadow_blur`：陰影柔化程度
- `carousel.shadow_offset_y`：陰影往下距離
- `carousel.shadow_opacity`：陰影透明度

### 輸出品質

- `output.crf`：H.264 畫質，數字越小品質越高、檔案越大；18 很適合婚宴播放
- `output.preset`：編碼速度／壓縮效率，預設 `medium`

## 建議調整順序

第一次調整建議只碰這五個：

1. `background.top_height`
2. `background.bottom_height`
3. `carousel.photo_height`
4. `carousel.gap`
5. `carousel.speed_px_per_second`

每次改完先跑 `python generate.py --preview`。

等版型確定後，再輸出完整 MP4。
