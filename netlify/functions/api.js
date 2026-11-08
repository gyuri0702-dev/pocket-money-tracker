// netlify/functions/api.js
// ─────────────────────────────────────────────────────────────────
// 단일 엔드포인트 서버 함수
// URL 패턴: /.netlify/functions/api?resource=<테이블>&action=<동작>
//
// resource : transactions | goals | essentials
// action   : list | add | delete | update
//
// 모든 요청은 Authorization: Bearer <access_token> 헤더가 필요
// anon key + 사용자 JWT → RLS 가 본인 데이터만 허용
// ─────────────────────────────────────────────────────────────────
const { getSupabaseClient, extractToken, preflight, ok, err } = require('./_supabase');

// 허용된 resource 목록
const RESOURCES = ['transactions', 'goals', 'essentials'];

exports.handler = async (event) => {
  // ── CORS 프리플라이트 ──────────────────────────────────────────
  if (event.httpMethod === 'OPTIONS') return preflight();

  // ── access token 추출 ─────────────────────────────────────────
  const token = extractToken(event.headers);
  if (!token) return err(401, '로그인이 필요합니다. Authorization 헤더를 확인해주세요.');

  // ── 쿼리 파라미터 파싱 ────────────────────────────────────────
  const { resource, action } = event.queryStringParameters || {};

  if (!resource || !RESOURCES.includes(resource)) {
    return err(400, `resource 파라미터가 올바르지 않습니다. (${RESOURCES.join(' | ')})`);
  }
  if (!action) {
    return err(400, 'action 파라미터가 필요합니다. (list | add | delete | update)');
  }

  // ── Supabase 클라이언트 (anon key + 사용자 JWT) ───────────────
  let supabase;
  try {
    supabase = getSupabaseClient(token);
  } catch (e) {
    return err(500, e.message);
  }

  // ── 라우팅 ────────────────────────────────────────────────────
  try {
    switch (action) {
      case 'list':   return await handleList(supabase, resource);
      case 'add':    return await handleAdd(supabase, resource, event);
      case 'delete': return await handleDelete(supabase, resource, event);
      case 'update': return await handleUpdate(supabase, resource, event);
      default:       return err(400, `알 수 없는 action: ${action}`);
    }
  } catch (e) {
    console.error(`[api] ${resource}/${action} 오류:`, e);
    return err(500, '서버 내부 오류가 발생했습니다.');
  }
};

// ─────────────────────────────────────────────────────────────────
//  LIST  GET /.netlify/functions/api?resource=<table>&action=list
// ─────────────────────────────────────────────────────────────────
async function handleList(supabase, resource) {
  let query = supabase.from(resource).select('*');

  // 테이블별 정렬
  if (resource === 'transactions') {
    query = query.order('date', { ascending: false });
  } else {
    query = query.order('created_at', { ascending: true });
  }

  const { data, error } = await query;
  if (error) return err(500, error.message);
  return ok(data);
}

// ─────────────────────────────────────────────────────────────────
//  ADD   POST /.netlify/functions/api?resource=<table>&action=add
// ─────────────────────────────────────────────────────────────────
async function handleAdd(supabase, resource, event) {
  if (event.httpMethod !== 'POST') return err(405, 'POST 요청만 허용됩니다.');

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return err(400, '요청 본문이 올바른 JSON이 아닙니다.');
  }

  // ── 입력값 검증 ─────────────────────────────────────────────
  const validationError = validate(resource, body);
  if (validationError) return err(400, validationError);

  // ── user_id 는 RLS 가 auth.uid() 로 처리하므로 직접 넣지 않아도 됨
  //    하지만 NOT NULL 컬럼이므로 명시적으로 삽입
  // ── Supabase 서버측에서 auth.uid() 를 가져오려면 rpc를 써야 하므로
  //    클라이언트 JWT를 decode해서 sub 를 추출
  const userId = getUserIdFromToken(event.headers);
  if (!userId) return err(401, '토큰에서 사용자 ID를 읽을 수 없습니다.');

  const row = buildRow(resource, body, userId);

  const { data, error } = await supabase
    .from(resource)
    .insert(row)
    .select()
    .single();

  if (error) return err(500, error.message);
  return ok(data);
}

// ─────────────────────────────────────────────────────────────────
//  DELETE  POST /.netlify/functions/api?resource=<table>&action=delete
//  body: { id: "<uuid>" }
// ─────────────────────────────────────────────────────────────────
async function handleDelete(supabase, resource, event) {
  if (event.httpMethod !== 'POST') return err(405, 'POST 요청만 허용됩니다.');

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return err(400, '요청 본문이 올바른 JSON이 아닙니다.');
  }

  const { id } = body;
  if (!id || typeof id !== 'string') return err(400, 'id(UUID) 가 필요합니다.');

  const { error } = await supabase
    .from(resource)
    .delete()
    .eq('id', id);
  // RLS 정책이 user_id = auth.uid() 를 강제하므로 타인 데이터 삭제 불가

  if (error) return err(500, error.message);
  return ok({ success: true, id });
}

// ─────────────────────────────────────────────────────────────────
//  UPDATE  POST /.netlify/functions/api?resource=<table>&action=update
//
//  goals      → body: { id, current }          (적립)
//  essentials → body: { id, paid }             (납부 토글)
// ─────────────────────────────────────────────────────────────────
async function handleUpdate(supabase, resource, event) {
  if (event.httpMethod !== 'POST') return err(405, 'POST 요청만 허용됩니다.');

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return err(400, '요청 본문이 올바른 JSON이 아닙니다.');
  }

  const { id } = body;
  if (!id || typeof id !== 'string') return err(400, 'id(UUID) 가 필요합니다.');

  // 테이블별 업데이트 허용 필드
  let patch;

  if (resource === 'goals') {
    // doDeposit(): current 값 업데이트
    const { current } = body;
    if (current === undefined || typeof current !== 'number' || current < 0) {
      return err(400, 'current 값이 올바르지 않습니다. (0 이상의 숫자)');
    }
    patch = { current };

  } else if (resource === 'essentials') {
    // toggleEssential(): paid 상태 반전
    const { paid } = body;
    if (typeof paid !== 'boolean') {
      return err(400, 'paid 값이 올바르지 않습니다. (true | false)');
    }
    patch = { paid };

  } else {
    return err(400, `${resource} 는 update 를 지원하지 않습니다.`);
  }

  const { data, error } = await supabase
    .from(resource)
    .update(patch)
    .eq('id', id)
    .select()
    .single();

  if (error) return err(500, error.message);
  return ok(data);
}

// ─────────────────────────────────────────────────────────────────
//  헬퍼: 입력값 검증
// ─────────────────────────────────────────────────────────────────
function validate(resource, body) {
  if (resource === 'transactions') {
    if (!body.type || !['income', 'expense'].includes(body.type))
      return 'type 은 income 또는 expense 이어야 합니다.';
    if (!body.category || typeof body.category !== 'string')
      return 'category 가 필요합니다.';
    if (!body.amount || typeof body.amount !== 'number' || body.amount <= 0)
      return 'amount 는 0보다 큰 숫자이어야 합니다.';
  }

  if (resource === 'goals') {
    if (!body.name || typeof body.name !== 'string')
      return 'name 이 필요합니다.';
    if (!body.amount || typeof body.amount !== 'number' || body.amount <= 0)
      return 'amount 는 0보다 큰 숫자이어야 합니다.';
    if (body.months !== undefined && (typeof body.months !== 'number' || body.months < 1))
      return 'months 는 1 이상의 숫자이어야 합니다.';
  }

  if (resource === 'essentials') {
    if (!body.name || typeof body.name !== 'string')
      return 'name 이 필요합니다.';
    if (!body.cat || typeof body.cat !== 'string')
      return 'cat(카테고리) 이 필요합니다.';
    if (!body.amount || typeof body.amount !== 'number' || body.amount <= 0)
      return 'amount 는 0보다 큰 숫자이어야 합니다.';
  }

  return null; // 검증 통과
}

// ─────────────────────────────────────────────────────────────────
//  헬퍼: DB 삽입용 row 객체 생성
//        기존 appData 필드명을 DB 컬럼명과 1:1 매핑
// ─────────────────────────────────────────────────────────────────
function buildRow(resource, body, userId) {
  const now = new Date().toISOString();

  if (resource === 'transactions') {
    return {
      user_id:  userId,
      type:     body.type,
      category: body.category,
      emoji:    body.emoji    || '📌',
      amount:   body.amount,
      memo:     body.memo     || '',
      date:     body.date     || now,
    };
  }

  if (resource === 'goals') {
    return {
      user_id: userId,
      emoji:   body.emoji   || '🎯',
      name:    body.name,
      amount:  body.amount,
      current: Math.min(body.current || 0, body.amount), // amount 초과 방지
      months:  body.months  || 1,
    };
  }

  if (resource === 'essentials') {
    return {
      user_id: userId,
      icon:    body.icon || '📌',  // 기존 코드 필드명 'icon'
      name:    body.name,
      cat:     body.cat,           // 기존 코드 필드명 'cat'
      amount:  body.amount,
      memo:    body.memo || '',
      paid:    false,              // 새 항목은 항상 미납부로 시작
    };
  }
}

// ─────────────────────────────────────────────────────────────────
//  헬퍼: JWT payload 에서 user_id(sub) 추출
//        서명 검증은 Supabase RLS 가 담당하므로 여기서는 decode만
// ─────────────────────────────────────────────────────────────────
function getUserIdFromToken(headers) {
  try {
    const token = extractToken(headers);
    if (!token) return null;
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1], 'base64url').toString('utf8')
    );
    return payload.sub || null;
  } catch {
    return null;
  }
}
