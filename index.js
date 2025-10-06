// ALSOK 面接システム - Cloudflare Workers
// 仕様書 v1.0 準拠

import { createHash, createHmac } from 'crypto';

// CORS設定
const corsHeaders = {
  'Access-Control-Allow-Origin': undefined, // 実行時に設定
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key',
  'Access-Control-Max-Age': '86400',
};

// エラーレスポンス生成
function errorResponse(message, status = 400, headers = {}) {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

// 成功レスポンス生成
function successResponse(data, headers = {}) {
  return new Response(JSON.stringify({ ok: true, ...data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}

// CORS対応
function handleCORS(request, env) {
  corsHeaders['Access-Control-Allow-Origin'] = env.ALLOWED_ORIGIN || '*';
  
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  return corsHeaders;
}

// GAS APIコール
async function callGAS(endpoint, method = 'GET', data = null, env) {
  const url = `${env.GAS_WEBAPP_URL}${endpoint}`;
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' }
  };
  
  if (data) {
    if (method === 'POST') {
      options.body = JSON.stringify(data);
    } else {
      // GET パラメータ
      const params = new URLSearchParams();
      Object.entries(data).forEach(([key, value]) => {
        params.append(key, value);
      });
      url = `${url}?${params}`;
    }
  }
  
  const response = await fetch(url, options);
  const result = await response.json();
  
  if (!result.ok) {
    throw new Error(result.error || 'GAS API call failed');
  }
  
  return result;
}

// Twilio署名検証
function verifyTwilioSignature(body, signature, url, authToken) {
  const expectedSignature = createHmac('sha1', authToken)
    .update(url + body)
    .digest('base64');
  return `sha1=${expectedSignature}` === signature;
}

// Twilio SMS送信
async function sendSMS(to, body, env) {
  const accountSid = env.TWILIO_ACCOUNT_SID;
  const authToken = env.TWILIO_AUTH_TOKEN;
  const messagingServiceSid = env.TWILIO_MESSAGING_SERVICE_SID;
  const fromNumber = env.TWILIO_FROM_NUMBER;
  
  const auth = btoa(`${accountSid}:${authToken}`);
  
  const payload = new URLSearchParams({
    To: to,
    Body: body,
    ...(messagingServiceSid ? { MessagingServiceSid: messagingServiceSid } : { From: fromNumber })
  });
  
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: payload
  });
  
  const result = await response.json();
  
  if (!response.ok) {
    throw new Error(result.message || 'SMS send failed');
  }
  
  return {
    sid: result.sid,
    status: result.status
  };
}

// SMS Messagesログ保存
async function logMessage(applicantId, direction, content, channel = 'sms', operator = 'system', env) {
  const messageData = {
    type: 'Messages',
    token: env.GAS_AUTH_TOKEN,
    payload: {
      id: crypto.randomUUID(),
      applicant_id: applicantId,
      at: new Date().toISOString(),
      channel,
      direction,
      content,
      operator
    }
  };
  
  return await callGAS('', 'POST', messageData, env);
}

// ULID生成（簡易版）
function generateULID() {
  const timestamp = Date.now();
  const randomness = crypto.getRandomValues(new Uint8Array(10));
  return timestamp.toString(36) + Array.from(randomness).map(b => b.toString(36)).join('').substr(0, 16);
}

// メインハンドラー
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const corsHeadersForResponse = handleCORS(request, env);
    
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: corsHeadersForResponse });
    }
    
    try {
      // ルーティング
      if (url.pathname === '/api/applications' && request.method === 'POST') {
        return await handleApplications(request, env, corsHeadersForResponse);
      }
      
      if (url.pathname === '/api/second/next-slot' && request.method === 'POST') {
        return await handleNextSlot(request, env, corsHeadersForResponse);
      }
      
      if (url.pathname === '/api/sms/send' && request.method === 'POST') {
        return await handleSMSSend(request, env, corsHeadersForResponse);
      }
      
      if (url.pathname === '/twilio/inbound-sms' && request.method === 'POST') {
        return await handleTwilioInbound(request, env, corsHeadersForResponse);
      }
      
      if (url.pathname === '/api/interviewers' && request.method === 'GET') {
        return await handleGetInterviewers(request, env, corsHeadersForResponse);
      }
      
      if (url.pathname === '/api/interviewers' && request.method === 'POST') {
        return await handlePostInterviewers(request, env, corsHeadersForResponse);
      }
      
      if (url.pathname === '/api/decisions' && request.method === 'POST') {
        return await handleDecisions(request, env, corsHeadersForResponse);
      }
      
      return errorResponse('Not Found', 404, corsHeadersForResponse);
      
    } catch (error) {
      console.error('Worker error:', error);
      return errorResponse(error.message, 500, corsHeadersForResponse);
    }
  }
};

// 応募受付
async function handleApplications(request, env, corsHeaders) {
  const data = await request.json();
  const { name, phone, source, consent_flg, notes } = data;
  
  // バリデーション
  if (!phone || !consent_flg) {
    return errorResponse('phone and consent_flg are required', 400, corsHeaders);
  }
  
  // E.164形式チェック（簡易）
  if (!phone.startsWith('+') || phone.length < 10) {
    return errorResponse('Invalid phone format. Use E.164 format (+819012345678)', 400, corsHeaders);
  }
  
  // applicant_id生成
  const applicantId = generateULID();
  
  // Applicants シートに登録
  const applicantData = {
    type: 'Applicants',
    token: env.GAS_AUTH_TOKEN,
    payload: {
      applicant_id: applicantId,
      created_at: new Date().toISOString(),
      name: name || '',
      phone,
      source: source || 'Web',
      consent_flg,
      status: 'pending',
      owner: '',
      notes: notes || '',
      next_action_at: ''
    }
  };
  
  await callGAS('', 'POST', applicantData, env);
  
  // Messages ログ
  await logMessage(applicantId, 'sys', `Application received: ${JSON.stringify(data)}`, 'note', 'system', env);
  
  return successResponse({ applicant_id: applicantId }, corsHeaders);
}

// 次の空き1枠取得
async function handleNextSlot(request, env, corsHeaders) {
  const data = await request.json();
  const { interviewer_id } = data;
  
  if (!interviewer_id) {
    return errorResponse('interviewer_id is required', 400, corsHeaders);
  }
  
  // TODO: Interviewers シートから担当者情報取得
  // 現在は固定値で対応
  const freeBusyData = {
    calendarId: env.TEST_CALENDAR_ID || 'primary',
    horizonDays: 14,
    startHour: 9,
    endHour: 18,
    tz: env.DEFAULT_TZ || 'Asia/Tokyo'
  };
  
  const result = await callGAS('?path=/freebusy/next', 'POST', freeBusyData, env);
  
  return successResponse({ slotAt: result.slotAt }, corsHeaders);
}

// SMS送信
async function handleSMSSend(request, env, corsHeaders) {
  const data = await request.json();
  const { to, templateId, variables, body } = data;
  
  if (!to) {
    return errorResponse('to is required', 400, corsHeaders);
  }
  
  let smsBody = body;
  
  // テンプレート処理
  if (templateId && !body) {
    // TODO: Templates シートからテンプレート取得
    // 現在は固定テンプレートで対応
    const templates = {
      'app_received': '{NAME}様、ALSOK採用チームです。応募を受け付けました。受付番号：{APPLICANT_ID}。追ってご連絡いたします。',
      '2nd_schedule': '【二次面接のご案内】{NAME}様、{DATE_JP} {START}–{END} で予定いたします。よろしければ「1」と返信、変更は「2」と返信ください。',
      '2nd_confirmed': '{NAME}様、{DATE_JP} {START}–{END} で二次面接が確定しました。場所：ALSOK本社 3F会議室'
    };
    
    smsBody = templates[templateId] || 'テンプレートが見つかりません';
    
    // 変数置換
    if (variables) {
      Object.entries(variables).forEach(([key, value]) => {
        smsBody = smsBody.replace(new RegExp(`{${key}}`, 'g'), value);
      });
    }
  }
  
  if (!smsBody) {
    return errorResponse('body or templateId is required', 400, corsHeaders);
  }
  
  // SMS送信
  const smsResult = await sendSMS(to, smsBody, env);
  
  // ログ保存（applicant_id が分からない場合は phone をキーとして使用）
  const applicantId = data.applicant_id || `phone:${to}`;
  await logMessage(applicantId, 'out', smsBody, 'sms', 'system', env);
  
  return successResponse({
    sid: smsResult.sid,
    status: smsResult.status
  }, corsHeaders);
}

// Twilio受信Webhook
async function handleTwilioInbound(request, env, corsHeaders) {
  const body = await request.text();
  const signature = request.headers.get('X-Twilio-Signature');
  
  if (!signature) {
    return errorResponse('Missing Twilio signature', 401, corsHeaders);
  }
  
  // 署名検証
  const isValid = verifyTwilioSignature(body, signature, request.url, env.TWILIO_AUTH_TOKEN);
  if (!isValid) {
    return errorResponse('Invalid Twilio signature', 401, corsHeaders);
  }
  
  // URLエンコードデータをパース
  const formData = new URLSearchParams(body);
  const from = formData.get('From');
  const messageBody = formData.get('Body')?.trim();
  
  if (!from || !messageBody) {
    return errorResponse('Missing required fields', 400, corsHeaders);
  }
  
  // TODO: 電話番号からapplicant_idを特定
  const applicantId = `phone:${from}`; // 簡易実装
  
  // メッセージログ保存
  await logMessage(applicantId, 'in', messageBody, 'sms', '', env);
  
  // メッセージ内容による分岐
  const normalizedMessage = messageBody.toLowerCase();
  
  if (['1', 'ok', 'はい', 'はい。'].includes(normalizedMessage)) {
    // 承諾 → カレンダーイベント作成
    return await handleAcceptance(applicantId, from, env, corsHeaders);
  } else if (normalizedMessage === '2') {
    // 変更希望 → 次の空き枠で再提案
    return await handleReschedule(applicantId, from, env, corsHeaders);
  } else if (['stop', 'unstop', 'help'].includes(normalizedMessage)) {
    // オプトイン/アウト処理
    return await handleOptInOut(applicantId, from, normalizedMessage, env, corsHeaders);
  }
  
  // その他のメッセージはログのみ
  return new Response('', { status: 200 });
}

// 承諾処理
async function handleAcceptance(applicantId, phone, env, corsHeaders) {
  // TODO: 実際の実装では applicant 情報を取得してカレンダー作成
  const eventData = {
    calendarId: env.TEST_CALENDAR_ID || 'primary',
    slotAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 仮：明日
    title: 'ALSOK二次面接',
    description: `応募者: ${applicantId}\\n電話: ${phone}`,
    attendees: [env.TEST_CALENDAR_ID || 'primary'],
    mailTo: env.INTERVIEWER_EMAIL || ''
  };
  
  const eventResult = await callGAS('?path=/calendar/create-event', 'POST', eventData, env);
  
  // 確定SMS送信
  const confirmSMS = `面接が確定しました。詳細は後日メールでお送りします。イベントID: ${eventResult.eventId}`;
  await sendSMS(phone, confirmSMS, env);
  await logMessage(applicantId, 'out', confirmSMS, 'sms', 'system', env);
  
  // ステータス更新
  const statusUpdate = {
    type: 'Applicants',
    token: env.GAS_AUTH_TOKEN,
    payload: {
      applicant_id: applicantId,
      status: '2nd_booked',
      next_action_at: eventData.slotAt
    }
  };
  
  await callGAS('', 'POST', statusUpdate, env);
  
  return new Response('', { status: 200 });
}

// 変更希望処理
async function handleReschedule(applicantId, phone, env, corsHeaders) {
  // TODO: 変更回数制限チェック
  // 次の空き枠を取得して再送信
  const nextSlotData = {
    interviewer_id: 'default' // TODO: 実際の担当者ID
  };
  
  const slotResult = await handleNextSlot(
    { json: async () => nextSlotData },
    env,
    corsHeaders
  );
  
  if (slotResult.ok && slotResult.slotAt) {
    // 再提案SMS送信
    const rescheduleBody = `【変更対応】新しい面接候補時間: ${slotResult.slotAt}。よろしければ「1」と返信してください。`;
    await sendSMS(phone, rescheduleBody, env);
    await logMessage(applicantId, 'out', rescheduleBody, 'sms', 'system', env);
  } else {
    // 空きがない場合
    const noSlotBody = '申し訳ございません。現在空きがございません。人事担当より連絡いたします。';
    await sendSMS(phone, noSlotBody, env);
    await logMessage(applicantId, 'out', noSlotBody, 'sms', 'system', env);
  }
  
  return new Response('', { status: 200 });
}

// オプトイン/アウト処理
async function handleOptInOut(applicantId, phone, message, env, corsHeaders) {
  let responseBody = '';
  
  switch (message) {
    case 'stop':
      responseBody = 'ALSOK採用チーム: 配信を停止しました。再開は「UNSTOP」と返信してください。';
      // TODO: オプトアウトフラグ設定
      break;
    case 'unstop':
      responseBody = 'ALSOK採用チーム: 配信を再開しました。停止は「STOP」と返信してください。';
      // TODO: オプトインフラグ設定
      break;
    case 'help':
      responseBody = 'ALSOK採用チーム: 配信停止=「STOP」、再開=「UNSTOP」、このヘルプ=「HELP」と返信してください。';
      break;
  }
  
  if (responseBody) {
    await sendSMS(phone, responseBody, env);
    await logMessage(applicantId, 'out', responseBody, 'sms', 'system', env);
  }
  
  return new Response('', { status: 200 });
}

// 担当者一覧取得（Phase2）
async function handleGetInterviewers(request, env, corsHeaders) {
  // TODO: Interviewers シートから取得
  return successResponse({
    interviewers: [
      {
        interviewer_id: 'interviewer_001',
        name: '田中面接官',
        email: 'tanaka@alsok.jp',
        calendar_id: 'tanaka@gmail.com'
      }
    ]
  }, corsHeaders);
}

// 担当者更新（Phase2）
async function handlePostInterviewers(request, env, corsHeaders) {
  const data = await request.json();
  
  const interviewerData = {
    type: 'Interviewers',
    token: env.GAS_AUTH_TOKEN,
    payload: data
  };
  
  await callGAS('', 'POST', interviewerData, env);
  
  return successResponse({ updated: true }, corsHeaders);
}

// 採否決定（Phase2）
async function handleDecisions(request, env, corsHeaders) {
  const data = await request.json();
  const { applicant_id, decision, decided_by, memo } = data;
  
  if (!applicant_id || !decision || !decided_by) {
    return errorResponse('applicant_id, decision, decided_by are required', 400, corsHeaders);
  }
  
  // Decisions シート更新
  const decisionData = {
    type: 'Decisions',
    token: env.GAS_AUTH_TOKEN,
    payload: {
      applicant_id,
      decided_at: new Date().toISOString(),
      decision,
      decided_by,
      memo: memo || ''
    }
  };
  
  await callGAS('', 'POST', decisionData, env);
  
  // Applicants ステータス同期
  const statusMap = {
    'pass': 'pass',
    'hold': 'hold', 
    'fail': 'fail'
  };
  
  const applicantUpdate = {
    type: 'Applicants',
    token: env.GAS_AUTH_TOKEN,
    payload: {
      applicant_id,
      status: statusMap[decision] || decision
    }
  };
  
  await callGAS('', 'POST', applicantUpdate, env);
  
  return successResponse({ updated: true }, corsHeaders);
}