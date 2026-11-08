# 📋 용돈플래너 — Netlify + Supabase 과제 구현 계획서

> 작성일: 2026-11-08  
> 기준 저장소: `pocket-money-tracker` (GitHub, main 브랜치)  
> 기준 파일: `index.html` (2,246줄)

---

## 1. 현재 저장소 구조

```
pocket-money-tracker/          ← GitHub 저장소 루트
├── .git/                      ← Git 관리 폴더 (자동, 건드리지 않음)
├── .gitignore                 ← 환경 변수·비밀 키 제외 설정 (완료)
├── index.html                 ← 앱 본체 (UI + 프론트엔드 로직 전부 포함)
├── README.md                  ← 저장소 설명 (현재 한 줄만 작성됨)
└── docs/
    └── feature-plan.md        ← 이 파일 (작업 계획서)
```

**앞으로 추가될 파일 (아직 만들지 않음)**

```
pocket-money-tracker/
├── netlify/
│   └── functions/
│       ├── get-transactions.js   ← GET 서버 함수
│       ├── add-transaction.js    ← POST 서버 함수
│       ├── get-goals.js
│       ├── add-goal.js
│       ├── get-essentials.js
│       └── add-essential.js
├── .env                          ← 로컬 전용, .gitignore에 이미 등록됨
└── package.json                  ← Netlify Functions 의존성 관리용
```

---

## 2. 기존 index.html의 appData 구조 분석

코드에서 직접 확인한 데이터 구조 (index.html 1502~1555번째 줄):

### 2-1. 최상위 구조

```javascript
let appData = {
  level: 5,          // 숫자 — 유저 레벨
  exp: 250,          // 숫자 — 경험치
  streak: 15,        // 숫자 — 연속 기록 일수
  transactions: [],  // 배열 — 수입/지출 내역
  goals: [],         // 배열 — 저축 목표
  essentials: [],    // 배열 — 필수지출 항목
  badges: []         // 배열 — 배지 목록
};
```

### 2-2. transactions 항목 구조

```javascript
{
  id:       1,           // 고유 번호 (현재는 순번, DB에서는 UUID로 대체)
  type:     'income',    // 'income' 또는 'expense'
  category: '용돈',      // 카테고리명 (문자열)
  emoji:    '💰',        // 카테고리 이모지 (문자열)
  amount:   200000,      // 금액 (정수, 원 단위)
  memo:     '이번 달 용돈', // 메모 (문자열)
  date:     new Date()   // 날짜 (Date 객체 → DB에서는 ISO 문자열)
}
```

### 2-3. goals 항목 구조

```javascript
{
  id:      1,          // 고유 번호
  emoji:   '🎮',       // 목표 이모지
  name:    '게임기 구매', // 목표 이름
  amount:  500000,     // 목표 금액
  current: 340000,     // 현재 모은 금액
  months:  3           // 목표 기간 (개월)
}
```

### 2-4. essentials 항목 구조

```javascript
{
  id:     1,
  icon:   '🏠',      // 카테고리 아이콘
  name:   '월세',    // 항목 이름
  cat:    '주거',    // 카테고리명
  amount: 350000,   // 금액
  memo:   '원룸 월세', // 메모
  paid:   true       // 납부 여부 (boolean)
}
```

### 2-5. badges 항목 구조

```javascript
{
  name:     '시작!',           // 배지 이름
  emoji:    '🚀',              // 배지 이모지
  desc:     '첫 거래 기록',    // 배지 설명
  unlocked: true               // 획득 여부 (boolean)
}
```

---

## 3. 실제로 저장해야 하는 데이터 항목

아래 기준으로 분류:
- **DB 저장 필요**: 사용자가 직접 입력하거나 변경하는 데이터 → 새로고침해도 유지돼야 함
- **DB 불필요**: 앱에 고정된 데이터 (코드에 하드코딩)

| 데이터 | DB 저장 필요 여부 | 이유 |
|--------|-----------------|------|
| transactions (수입/지출) | ✅ **필요** | 사용자가 직접 입력, 핵심 기능 |
| goals (저축 목표) | ✅ **필요** | 사용자가 직접 입력, 적립 기능 포함 |
| essentials (필수지출) | ✅ **필요** | 사용자가 직접 추가, paid 상태 변경 |
| badges (배지) | ⚠️ **부분 필요** | `unlocked` 상태만 저장하면 됨 (배지 정의는 코드에 고정) |
| level, exp, streak | ⚠️ **부분 필요** | 자동 계산 가능 → 1단계에서는 생략 가능 |
| compareItems (절약비교) | ❌ 불필요 | 코드에 고정된 참조 데이터 |
| policies (청년지원정책) | ❌ 불필요 | 코드에 고정된 참조 데이터 |

---

## 4. Supabase 테이블 구조 설계

> ⚠️ 아직 실제로 생성하지 않음 — 테이블 설계안만 작성

### 테이블 1: `transactions` (수입·지출 내역)

```sql
CREATE TABLE transactions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type       TEXT    NOT NULL CHECK (type IN ('income', 'expense')),
  category   TEXT    NOT NULL,
  emoji      TEXT    NOT NULL DEFAULT '📌',
  amount     INTEGER NOT NULL CHECK (amount > 0),
  memo       TEXT    DEFAULT '',
  date       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID | 자동 생성 고유 ID |
| type | TEXT | 'income' 또는 'expense' |
| category | TEXT | 음식, 교통, 용돈 등 |
| emoji | TEXT | 카테고리 이모지 |
| amount | INTEGER | 금액 (원) |
| memo | TEXT | 메모 |
| date | TIMESTAMPTZ | 거래 날짜 |
| created_at | TIMESTAMPTZ | 레코드 생성 시각 |

---

### 테이블 2: `goals` (저축 목표)

```sql
CREATE TABLE goals (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  emoji      TEXT    NOT NULL DEFAULT '🎯',
  name       TEXT    NOT NULL,
  amount     INTEGER NOT NULL CHECK (amount > 0),
  current    INTEGER NOT NULL DEFAULT 0 CHECK (current >= 0),
  months     INTEGER NOT NULL DEFAULT 1 CHECK (months >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID | 자동 생성 고유 ID |
| emoji | TEXT | 목표 이모지 |
| name | TEXT | 목표 이름 |
| amount | INTEGER | 목표 금액 |
| current | INTEGER | 현재 모은 금액 |
| months | INTEGER | 목표 기간 (개월) |

---

### 테이블 3: `essentials` (필수지출)

```sql
CREATE TABLE essentials (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  icon       TEXT    NOT NULL DEFAULT '📌',
  name       TEXT    NOT NULL,
  cat        TEXT    NOT NULL,
  amount     INTEGER NOT NULL CHECK (amount > 0),
  memo       TEXT    DEFAULT '',
  paid       BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

| 컬럼 | 타입 | 설명 |
|------|------|------|
| id | UUID | 자동 생성 고유 ID |
| icon | TEXT | 카테고리 아이콘 이모지 |
| name | TEXT | 항목 이름 |
| cat | TEXT | 카테고리 (주거, 통신, 교통 등) |
| amount | INTEGER | 금액 |
| memo | TEXT | 메모 |
| paid | BOOLEAN | 납부 완료 여부 |

---

## 5. 배포 플랫폼 선택

### ✅ Netlify 선택 (Vercel 대비 이유)

| 비교 항목 | Netlify | Vercel |
|----------|---------|--------|
| 단일 HTML 파일 배포 | ✅ 매우 간단 | ✅ 가능 |
| 서버 함수(Functions) | ✅ `netlify/functions/` 폴더만 만들면 됨 | `api/` 폴더 방식 |
| 무료 플랜 Functions 호출 수 | 125,000회/월 | 100GB 대역폭 기준 |
| 초보자 설정 난이도 | ⭐ 더 쉬움 | 보통 |
| GitHub 연동 | ✅ | ✅ |
| 환경 변수 UI | ✅ 직관적 | ✅ |
| `.gitignore`에 Netlify 설정 | ✅ 이미 포함되어 있음 | 별도 설정 필요 |

→ 현재 `.gitignore`에 `.netlify/` 가 이미 등록되어 있어서 Netlify 사용을 전제로 설계된 저장소임.

---

## 6. 서버 함수와 데이터베이스 연결 구조

### 전체 데이터 흐름

```
사용자 브라우저 (index.html)
        │
        │  fetch('/api/...')  HTTP 요청
        ▼
Netlify Functions (서버 함수)
  netlify/functions/get-transactions.js
  netlify/functions/add-transaction.js
        │
        │  supabase.from('transactions').select()
        │  Supabase URL + Service Key (환경 변수)
        ▼
Supabase 데이터베이스
  테이블: transactions / goals / essentials
```

### 서버 함수 목록 및 역할

| 파일명 | HTTP 메서드 | 역할 |
|--------|------------|------|
| `netlify/functions/get-transactions.js` | GET | 전체 거래 내역 조회 |
| `netlify/functions/add-transaction.js` | POST | 새 거래 추가 |
| `netlify/functions/delete-transaction.js` | POST | 거래 삭제 (id 전달) |
| `netlify/functions/get-goals.js` | GET | 전체 목표 조회 |
| `netlify/functions/add-goal.js` | POST | 새 목표 추가 |
| `netlify/functions/update-goal.js` | POST | 목표 적립 금액 수정 |
| `netlify/functions/delete-goal.js` | POST | 목표 삭제 |
| `netlify/functions/get-essentials.js` | GET | 필수지출 목록 조회 |
| `netlify/functions/add-essential.js` | POST | 필수지출 추가 |
| `netlify/functions/toggle-essential.js` | POST | 납부 상태 토글 |

### 환경 변수 목록 (본인이 직접 설정 필요)

| 변수명 | 설명 | 설정 위치 |
|--------|------|----------|
| `SUPABASE_URL` | Supabase 프로젝트 URL | Netlify 사이트 설정 > Environment Variables |
| `SUPABASE_SERVICE_KEY` | Supabase Service Role Key | Netlify 사이트 설정 > Environment Variables |

> ⚠️ `SUPABASE_SERVICE_KEY`는 절대 GitHub에 올리면 안 됩니다.  
> 로컬 테스트용 `.env` 파일은 `.gitignore`에 이미 등록되어 있어서 안전합니다.

### 서버 함수 코드 예시 (get-transactions.js)

```javascript
// netlify/functions/get-transactions.js
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event, context) => {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { data, error } = await supabase
    .from('transactions')
    .select('*')
    .order('date', { ascending: false });

  if (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  };
};
```

---

## 7. 기존 기능을 유지하면서 수정할 파일 목록

### 원칙: index.html의 UI는 절대 건드리지 않음

기존 7개 탭, 모든 버튼, 모달, 스타일은 그대로 유지.  
**수정 대상은 `<script>` 태그 안의 데이터 저장/불러오기 로직만**.

### 수정/추가 파일 전체 목록

| 파일 | 작업 유형 | 수정 범위 |
|------|----------|----------|
| `index.html` | 수정 (최소) | `<script>` 내 `addExpense`, `addIncome`, `addGoal`, `addEssential`, `deleteTx`, `deleteGoal`, `toggleEssential`, `doDeposit` 함수에 fetch 호출 추가. 초기화 시 DB에서 데이터 로드하도록 변경 |
| `netlify/functions/get-transactions.js` | 신규 생성 | GET 함수 |
| `netlify/functions/add-transaction.js` | 신규 생성 | POST 함수 |
| `netlify/functions/delete-transaction.js` | 신규 생성 | POST 함수 |
| `netlify/functions/get-goals.js` | 신규 생성 | GET 함수 |
| `netlify/functions/add-goal.js` | 신규 생성 | POST 함수 |
| `netlify/functions/update-goal.js` | 신규 생성 | POST 함수 |
| `netlify/functions/delete-goal.js` | 신규 생성 | POST 함수 |
| `netlify/functions/get-essentials.js` | 신규 생성 | GET 함수 |
| `netlify/functions/add-essential.js` | 신규 생성 | POST 함수 |
| `netlify/functions/toggle-essential.js` | 신규 생성 | POST 함수 |
| `package.json` | 신규 생성 | `@supabase/supabase-js` 의존성 등록 |
| `.env` | 신규 생성 | 로컬 환경 변수 (gitignore 처리됨) |
| `README.md` | 수정 | 배포 URL, 기능 설명 추가 |

### index.html 수정이 필요한 함수 위치

| 함수명 | 줄 번호 (대략) | 현재 → 변경 내용 |
|--------|--------------|----------------|
| `addExpense()` | ~2130 | `appData.transactions.unshift()` → fetch POST 후 결과로 배열 갱신 |
| `addIncome()` | ~2140 | 동일 |
| `deleteTx()` | ~1900 | `appData.transactions.filter()` → fetch DELETE 후 갱신 |
| `addGoal()` | ~2150 | `appData.goals.push()` → fetch POST 후 갱신 |
| `deleteGoal()` | ~1940 | fetch DELETE 후 갱신 |
| `doDeposit()` | ~1950 | `g.current += amt` → fetch POST(update-goal) 후 갱신 |
| `addEssential()` | ~2165 | `appData.essentials.push()` → fetch POST 후 갱신 |
| `toggleEssential()` | ~1980 | `e.paid = !e.paid` → fetch POST(toggle) 후 갱신 |
| `updateUI()` (초기 실행 부분) | ~2180 | 앱 시작 시 DB에서 데이터 불러오도록 변경 |

---

## 8. 과제 단계별 진행 상황

### ✅ 완료

| 단계 | 내용 | 근거 |
|------|------|------|
| **0단계** | 프로젝트 기획 및 아이디어 선정 | `index.html` 완성된 앱 UI 존재 |
| **1단계** | HTML/CSS/JS 기본 화면 구현 | 7개 탭, 모달, 반응형 완성 |
| **2단계** | GitHub 저장소 생성 및 코드 업로드 | `pocket-money-tracker` 저장소 존재, main 브랜치 확인 |

### ⚠️ 일부 완료

| 단계 | 내용 | 완료된 부분 | 미완료 부분 |
|------|------|------------|------------|
| **3단계** | Netlify 배포 | `.gitignore`에 Netlify 설정 포함 | 실제 Netlify 사이트 미생성, 배포 미완료 |

### ❌ 미완료

| 단계 | 내용 | 해야 할 작업 |
|------|------|------------|
| **4단계** | Supabase 프로젝트 생성 & 테이블 설계 | supabase.com 가입, 프로젝트 생성, 위의 테이블 3개 생성 |
| **5단계** | 서버 함수(API) 파일 생성 | `netlify/functions/` 폴더 및 함수 파일 작성 |
| **6단계** | GET 요청 구현 (데이터 불러오기) | `get-*.js` 함수 작성 + index.html에서 호출 |
| **7단계** | POST 요청 구현 (데이터 저장하기) | `add-*.js` 함수 작성 + index.html에서 호출 |
| **8단계** | 환경 변수 설정 | Netlify 사이트에 `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` 등록 |
| **9단계** | 프론트엔드 ↔ 서버 함수 연결 | index.html의 데이터 처리 함수에 fetch 코드 추가 |
| **10단계** | 최종 배포 및 동작 확인 | Netlify URL로 접속하여 전체 기능 테스트 |

---

## 9. 본인이 직접 해야 하는 계정/설정 작업

아래 작업은 계정 정보가 필요하므로 본인이 직접 진행해야 합니다.

### 🔐 Supabase 설정 (직접 진행)

1. [supabase.com](https://supabase.com) 접속 → 회원가입 또는 로그인
2. **New project** 클릭
3. 프로젝트 이름: `pocket-money-tracker` (또는 원하는 이름)
4. 데이터베이스 비밀번호 설정 (메모해두기)
5. 리전: `Northeast Asia (Seoul)` 선택
6. 프로젝트 생성 완료 후 **Settings > API** 메뉴에서 다음 2가지 복사:
   - `Project URL` → `SUPABASE_URL`로 사용
   - `service_role` Key → `SUPABASE_SERVICE_KEY`로 사용
7. **Table Editor**에서 `transactions`, `goals`, `essentials` 테이블 생성 (SQL은 위 4번 섹션 참조)

### 🌐 Netlify 설정 (직접 진행)

1. [netlify.com](https://netlify.com) 접속 → 회원가입 또는 로그인
2. **Add new site > Import an existing project** 클릭
3. GitHub 연결 → `pocket-money-tracker` 저장소 선택
4. Build settings는 모두 비워두기 (단순 HTML 파일이므로)
5. **Site settings > Environment variables** 에서 다음 2개 추가:
   - `SUPABASE_URL` = Supabase Project URL
   - `SUPABASE_SERVICE_KEY` = Supabase service_role Key
6. Deploy site 클릭

---

## 10. 다음 단계 작업 순서 (Kiro와 함께 진행)

```
[지금 즉시 — 본인 직접]
  1. Supabase 가입 → 프로젝트 생성 → 테이블 3개 생성
  2. Netlify 가입 → GitHub 저장소 연결 → 첫 배포
  3. 환경 변수 2개 Netlify에 등록

[다음 Kiro 작업 세션 — 코드 작성]
  4. package.json 생성
  5. netlify/functions/ 폴더 및 서버 함수 파일 작성
  6. index.html의 데이터 처리 함수에 fetch 연동 추가
  7. 로컬 .env 파일 생성 (테스트용)
  8. GitHub Desktop으로 커밋 & 푸시 → Netlify 자동 재배포
  9. 최종 동작 확인
```

---

*이 파일은 작업 계획서입니다. 실제 코드 수정은 다음 단계에서 진행합니다.*
