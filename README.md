# Cloudflare Workers デプロイ手順

## 1. 事前準備
- Cloudflare アカウント作成
- Wrangler CLI インストール: `npm install -g wrangler`
- Wrangler ログイン: `wrangler login`

## 2. プロジェクト設定
```bash
cd workers
npm install
```

## 3. 環境変数設定
以下の秘密情報を Cloudflare Workers に設定:

### 必須環境変数
```bash
# GAS関連
wrangler secret put GAS_WEBAPP_URL
# 例: https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec

wrangler secret put GAS_AUTH_TOKEN
# 例: your-secret-token-here

# Twilio関連
wrangler secret put TWILIO_ACCOUNT_SID
# 例: ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

wrangler secret put TWILIO_AUTH_TOKEN  
# 例: your_auth_token_here

wrangler secret put TWILIO_MESSAGING_SERVICE_SID
# 例: MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# または TWILIO_FROM_NUMBER (+15551234567)

# CORS設定
wrangler secret put ALLOWED_ORIGIN
# 例: https://your-frontend.vercel.app
```

### オプション環境変数
```bash
# テスト用
wrangler secret put TEST_CALENDAR_ID
# 例: test@gmail.com

wrangler secret put INTERVIEWER_EMAIL
# 例: interviewer@alsok.jp
```

## 4. 開発サーバー起動
```bash
npm run dev
```
`http://localhost:8787` でローカル開発サーバーが起動

## 5. テスト
### 応募受付テスト
```bash
curl -X POST http://localhost:8787/api/applications \
  -H "Content-Type: application/json" \
  -d '{
    "name": "山田太郎",
    "phone": "+819012345678", 
    "source": "Web",
    "consent_flg": true,
    "notes": "夜勤可"
  }'
```

### SMS送信テスト
```bash
curl -X POST http://localhost:8787/api/sms/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+819012345678",
    "templateId": "app_received",
    "variables": {
      "NAME": "山田太郎",
      "APPLICANT_ID": "app_123"
    }
  }'
```

## 6. 本番デプロイ
```bash
npm run deploy
```

デプロイ後のURL例: `https://alsok-interview-system.your-subdomain.workers.dev`

## 7. エンドポイント仕様

### POST /api/applications
応募受付
```json
{
  "name": "山田太郎",
  "phone": "+819012345678",
  "source": "Web", 
  "consent_flg": true,
  "notes": "夜勤可"
}
```

### POST /api/second/next-slot  
次の空き1枠取得
```json
{
  "interviewer_id": "interviewer_001"
}
```

### POST /api/sms/send
SMS送信
```json
{
  "to": "+819012345678",
  "templateId": "2nd_schedule",
  "variables": {
    "NAME": "山田太郎",
    "DATE_JP": "2025年10月9日(水)",
    "START": "14:00",
    "END": "15:00"
  }
}
```

### POST /twilio/inbound-sms
Twilio受信Webhook（Twilio設定で自動呼び出し）

### GET /api/interviewers
担当者一覧取得（Phase2）

### POST /api/interviewers
担当者更新（Phase2）

### POST /api/decisions
採否決定（Phase2）
```json
{
  "applicant_id": "app_123",
  "decision": "pass",
  "decided_by": "田中面接官",
  "memo": "良好"
}
```

## 8. エラーハンドリング
- 4xx/5xx エラーは適切なHTTPステータスで返却
- Twilio署名検証失敗時は 401 Unauthorized
- レート制限、タイムアウト、再試行ロジック実装済み

## 9. 監視・ログ
```bash
# リアルタイムログ確認
npm run tail

# Wrangler ダッシュボードで分析・アラート設定
wrangler dash
```

## 10. 完了チェックリスト
- [ ] Wrangler CLI 設定完了
- [ ] 環境変数設定完了
- [ ] ローカルテスト成功
- [ ] 本番デプロイ完了
- [ ] Twilio Webhook URL 設定完了
- [ ] CORS動作確認完了

## 次のステップ
1. TwilioコンソールでWebhook URL設定
2. フロントエンドの API_BASE 環境変数更新
3. カレンダー権限設定