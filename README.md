# Posture Motion Lab

診断をしない姿勢・動作測定Webアプリ。

アプリの役割は、MediaPipe Pose Landmarkerで取得したランドマークから、静止姿勢と動作テストの数値、測定品質、測定不能理由をmd/txt/jsonで書き出すこと。解釈は別のAIスキルやプロンプトで行う。

公開URL: https://ngmt4amtk-web.github.io/posture-motion-lab/

## MVP

- 正面静止10秒
- 側面静止10秒
- 背面静止10秒
- 5回立ち座り
- ゆっくりスクワット3回
- md/txt/jsonエクスポート

## 開発

```bash
npm install
npm run dev
```

## ビルド

```bash
npm run build
```

## デプロイ

GitHub Pagesの `gh-pages` ブランチに `dist` を直接配置する。
