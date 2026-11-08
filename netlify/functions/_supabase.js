// netlify/functions/_supabase.js
// ─────────────────────────────────────────────
// 모든 서버 함수가 공통으로 사용하는 Supabase 클라이언트 생성 헬퍼
// anon key + 요청자의 access token을 조합해 RLS가 적용된 클라이언트를 반환
// ─────────────────────────────────────────────
const { createClient } = require('@supabase/supabase-js');

/**
 * 로그인된 사용자의 access token을 주입한 Supabase 클라이언트를 반환합니다.
 * RLS 정책이 auth.uid() 기반으로 동작하므로 반드시 token을 전달해야 합니다.
 *
 * @param {string} accessToken  - Authorization 헤더에서 추출한 Bearer 토큰
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
function getSupabaseClient(accessToken) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('환경변수 SUPABASE_URL 또는 SUPABASE_ANON_KEY가 설정되지 않았습니다.');
  }

  return createClient(url, key, {
    global: {
      headers: {
        // 요청자의 JWT를 헤더에 포함 → Supabase가 auth.uid() 를 인식
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      // 서버 함수에서는 자동 세션 갱신이 필요 없음
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/**
 * Authorization 헤더에서 Bearer 토큰을 추출합니다.
 * 토큰이 없으면 null을 반환합니다.
 *
 * @param {Object} headers  - Netlify event.headers 객체
 * @returns {string|null}
 */
function extractToken(headers) {
  const auth = headers['authorization'] || headers['Authorization'] || '';
  if (!auth.startsWith('Bearer ')) return null;
  return auth.slice(7).trim();
}

/**
 * CORS 및 공통 응답 헤더
 */
const HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

/**
 * OPTIONS 프리플라이트 요청 처리용 응답
 */
function preflight() {
  return { statusCode: 204, headers: HEADERS, body: '' };
}

/**
 * 성공 응답 생성
 */
function ok(data) {
  return { statusCode: 200, headers: HEADERS, body: JSON.stringify(data) };
}

/**
 * 오류 응답 생성
 */
function err(statusCode, message) {
  return { statusCode, headers: HEADERS, body: JSON.stringify({ error: message }) };
}

module.exports = { getSupabaseClient, extractToken, preflight, ok, err, HEADERS };
