# ALSOK面接システム - Cloudflare Workers

ALSOK面接システムのバックエンドAPIゲートウェイです。

## 🚀 自動デプロイ状況

[![Deploy ALSOK Workers](https://github.com/youshi-kanda/alsok-workers/actions/workflows/deploy.yml/badge.svg)](https://github.com/youshi-kanda/alsok-workers/actions/workflows/deploy.yml)

## 🎯 デプロイ環境

- **本番環境**: https://alsok-interview-system.your-subdomain.workers.dev
- **プレビュー環境**: https://alsok-interview-system-preview.your-subdomain.workers.dev
- **開発環境**: ローカルテスト用

## 📋 GitHub Secrets 設定必要項目

### 必須（デプロイに必要）
```
CLOUDFLARE_API_TOKEN = [Cloudflare API Token]
CLOUDFLARE_ACCOUNT_ID = [Account ID]
```

### オプション（機能追加時）  
```
GAS_WEBAPP_URL = https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec
GAS_AUTH_TOKEN = [強固なランダム文字列]
TWILIO_ACCOUNT_SID = ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN = [Twilio Auth Token]
TWILIO_MESSAGING_SERVICE_SID = MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
ALLOWED_ORIGIN = https://alsok-interview-system.pages.dev
```

## 🔄 デプロイフロー

- **main ブランチプッシュ** → 本番環境自動デプロイ
- **Pull Request作成** → プレビュー環境自動作成
- **デプロイ履歴** → GitHub Actions で追跡可能

## 📊 API エンドポイント

### 現在実装済み
- `POST /api/applications` - 応募受付
- `POST /api/sms/send` - SMS送信
- `POST /api/second/next-slot` - 次の面接枠取得
- `POST /twilio/inbound-sms` - Twilio受信Webhook
- `GET /api/interviewers` - 担当者一覧取得
- `POST /api/decisions` - 採否決定

### 動作確認
```bash
# ヘルスチェック
curl https://alsok-interview-system.your-subdomain.workers.dev/api/test

# 応募テスト
curl -X POST https://alsok-interview-system.your-subdomain.workers.dev/api/applications \
  -H "Content-Type: application/json" \
  -d '{"name":"テスト太郎","phone":"+819012345678","consent_flg":true}'
```

## 🔧 ローカル開発

```bash
# 依存関係インストール
npm install

# ローカル開発サーバー
npm run dev

# 本番デプロイ（手動）
npm run deploy
```

## 📈 統合システム

このWorkers は以下のコンポーネントと連携:
- **フロントエンド**: Cloudflare Pages (React + TypeScript)
- **データ管理**: Google Apps Script + Google Sheets
- **SMS送信**: Twilio Programmable Messaging
- **カレンダー**: Google Calendar API

## 🎉 デプロイ成功確認

GitHub Actions が正常完了すると、ALSOK面接システムのバックエンドが稼働開始します！# Deployment trigger
# Force redeploy with updated secrets
