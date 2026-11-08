
const {
  getSupabaseClient,
  extractToken,
  preflight,
  ok,
  err,
} = require('./_supabase');

const RESOURCES = ['transactions', 'goals', 'essentials'];

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return preflight();

  const token = extractToken(event.headers);
  if (!token) {
    return err(401, '로그인이 필요합니다. Authorization 헤더를 확인해주세요.');
  }

  const params = event.queryStringParameters || {};
  const resource = params.resource;
  const action = params.action;

  if (!resource || !RESOURCES.includes(resource)) {
    return err(400, `resource 값이 올바르지 않습니다. 허용값: ${RESOURCES.join(' | ')}`);
  }

  if (!action) {
    return err(400, 'action 파라미터가 필요합니다. 허용값: list | add | delete | update');
  }

  let supabase;
  try {
    supabase = getSupabaseClient(token);
  } catch (e) {
    return err(500, e.message);
  }

  try {
    switch (action) {
      case 'list':
        return await handleList(supabase, resource);
      case 'add':
        return await handleAdd(supabase, resource, event);
      case 'delete':
        return await handleDelete(supabase, resource, event);
      case 'update':
        return await handleUpdate(supabase, resource, event);
      default:
        return err(400, `알 수 없는 action: ${action}`);
    }
  } catch (e) {
    console.error(`[api] ${resource}/${action} 오류:`, e);
    return err(500, '서버 내부 오류가 발생했습니다.');
  }
};

// 목록 조회
async function handleList(supabase, resource) {
  let query = supabase.from(resource).select('*');

  if (resource === 'transactions') {
    query = query.order('date', { ascending: false });
  } else {
    query = query.order('created_at', { ascending: true });
  }

  const { data, error } = await query;
  if (error) return err(500, error.message);
  return ok(data);
}

// 데이터 추가
async function handleAdd(supabase, resource, event) {
  if (event.httpMethod !== 'POST') {
    return err(405, 'POST 요청만 허용됩니다.');
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return err(400, '요청 본문이 올바른 JSON이 아닙니다.');
  }

  const validationError = validate(resource, body);
  if (validationError) return err(400, validationError);

  const userId = getUserIdFromToken(event.headers);
  if (!userId) {
    return err(401, '토큰에서 사용자 ID를 읽을 수 없습니다.');
  }

  const row = buildRow(resource, body, userId);

  const { data, error } = await supabase
    .from(resource)
    .insert(row)
    .select()
    .single();

  if (error) return err(500, error.message);
  return ok(data);
}

// 데이터 삭제
async function handleDelete(supabase, resource, event) {
  if (event.httpMethod !== 'POST') {
    return err(405, 'POST 요청만 허용됩니다.');
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return err(400, '요청 본문이 올바른 JSON이 아닙니다.');
  }

  const { id } = body;
  if (!id || typeof id !== 'string') {
    return err(400, 'id(UUID)가 필요합니다.');
  }

  const { error } = await supabase
    .from(resource)
    .delete()
    .eq('id', id);

  if (error) return err(500, error.message);
  return ok({ success: true, id });
}

// 데이터 수정
async function handleUpdate(supabase, resource, event) {
  if (event.httpMethod !== 'POST') {
    return err(405, 'POST 요청만 허용됩니다.');
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return err(400, '요청 본문이 올바른 JSON이 아닙니다.');
  }

  const { id } = body;
  if (!id || typeof id !== 'string') {
    return err(400, 'id(UUID)가 필요합니다.');
  }

  let patch;

  if (resource === 'goals') {
    const { current } = body;

    if (current === undefined || typeof current !== 'number' || current < 0) {
      return err(400, 'current는 0 이상의 숫자이어야 합니다.');
    }

    patch = { current };

  } else if (resource === 'essentials') {
    const { paid } = body;

    if (typeof paid !== 'boolean') {
      return err(400, 'paid는 true 또는 false이어야 합니다.');
    }

    patch = { paid };

  } else {
    return err(400, `${resource}는 update를 지원하지 않습니다.`);
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

// 입력값 검증
function validate(resource, body) {
  if (resource === 'transactions') {
    if (!body.type || !['income', 'expense'].includes(body.type))
      return 'type은 income 또는 expense이어야 합니다.';

    if (!body.category || typeof body.category !== 'string')
      return 'category가 필요합니다.';

    if (!body.amount || typeof body.amount !== 'number' || body.amount <= 0)
      return 'amount는 0보다 큰 숫자이어야 합니다.';
  }

  if (resource === 'goals') {
    if (!body.name || typeof body.name !== 'string')
      return 'name이 필요합니다.';

    if (!body.amount || typeof body.amount !== 'number' || body.amount <= 0)
      return 'amount는 0보다 큰 숫자이어야 합니다.';

    if (body.months !== undefined &&
        (typeof body.months !== 'number' || body.months < 1))
      return 'months는 1 이상의 숫자이어야 합니다.';
  }

  if (resource === 'essentials') {
    if (!body.name || typeof body.name !== 'string')
      return 'name이 필요합니다.';

    if (!body.cat || typeof body.cat !== 'string')
      return 'cat(카테고리)이 필요합니다.';

    if (!body.amount || typeof body.amount !== 'number' || body.amount <= 0)
      return 'amount는 0보다 큰 숫자이어야 합니다.';
  }

  return null;
}

// 데이터베이스 삽입용 데이터 생성
function buildRow(resource, body, userId) {
  if (resource === 'transactions') {
    return {
      user_id: userId,
      type: body.type,
      category: body.category,
      emoji: body.emoji || '📌',
      amount: body.amount,
      memo: body.memo || '',
      date: body.date || new Date().toISOString(),
    };
  }

  if (resource === 'goals') {
    return {
      user_id: userId,
      emoji: body.emoji || '🎯',
      name: body.name,
      amount: body.amount,
      current: Math.min(body.current || 0, body.amount),
      months: body.months || 1,
    };
  }

  if (resource === 'essentials') {
    return {
      user_id: userId,
      icon: body.icon || '📌',
      name: body.name,
      cat: body.cat,
      amount: body.amount,
      memo: body.memo || '',
      paid: false,
    };
  }
}

// JWT에서 사용자 ID 추출
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
