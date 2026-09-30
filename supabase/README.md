# Supabase DB 스크립트

이 폴더에는 이 도구의 저장 데이터를 PostgreSQL(Supabase)로 옮길 때 쓰는 스키마가 들어 있습니다.
지금 도구(1단계)는 **계정 없이 브라우저 저장소만** 씁니다 — 여행·기록·경비·사진 정보는 localStorage, 사진 미리보기는 IndexedDB.
DB 에 연결하는 코드는 2단계(계정·기기 간 동기화·공동 여행 기록)에서 붙입니다.

## 왜 DB 가 필요한가

- **기기를 바꾸면 여행이 사라집니다.** 지금은 `data09-24.db` 한 칸이 이 브라우저에만 있습니다. 휴대폰에서 올린 사진·일기를 PC 에서 이어 보려면 계정과 DB 가 필요합니다.
- **공동 여행 기록일지**(원문) — 가족·친구가 같은 여행에 사진과 일기를 올리려면 서버에 저장하고 권한을 나눠야 합니다.
- **여행·기록·사진·지출이 서로 묶여 있습니다.** 여행을 지우면 그 안의 행도 지워야 하고, 기록을 지우면 사진은 남기고 연결만 풀어야 합니다. 여행당 사진 2,000장 같은 한도도 DB 가 한 번 더 지킵니다.

사진 파일 자체는 이 표에 넣지 않습니다. 2단계에서 Storage 를 쓰게 되면 **private 버킷**에 두고 `photo.storage_path` 에 경로만 적습니다(사진에는 얼굴·위치가 담겨 있어 공개 버킷을 쓰지 않습니다).

## 테이블

| 테이블 | 용도 | localStorage 대응 |
|---|---|---|
| `trip` | 여행 — 이름, 기간, 나라(Natural Earth 숫자 코드), 도시, 메모, 환율(직접 입력), AI 리포트 | `trips[]` |
| `entry` | 날짜별 기록 — 날짜, 시각, 장소, 키워드·메모, 본문, 좌표 | `trips[].entries[]` |
| `photo` | 사진 정보 — 파일 이름·크기, 찍은 시각(카메라 현지 시각), 시간대, 파일 날짜, 좌표, 붙은 기록 | `trips[].photos[]` |
| `expense` | 지출 — 날짜, 금액(원래 통화, 소수 둘째 자리), 통화, 분류, 메모 | `trips[].expenses[]` |
| `plan` | 여행 일정 — 종류, 이름, 날짜·시각(끝나는 날), 장소·좌표, 예약 번호, 메모, 연결한 지출, 확인 여부 (2026-09-30) | `trips[].plans[]` |

원 환산 합계·동선·방문 국가 목록은 입력에서 다시 계산되는 파생 데이터라 저장하지 않습니다.
필드 이름은 도구의 이름을 snake_case 로 옮겼습니다. `id` → `trip_id`·`entry_id`·`photo_id`·`expense_id`, `start`/`end` → `start_date`/`end_date`, `text` → `body` 만 바꿨습니다.

### 권한

- 모든 표에 RLS(행 수준 보안)를 켰고, 모든 행은 만든 사람만 보고 고칠 수 있습니다(`owner_id = auth.uid()`, 자동으로 채워짐). 공동 기록(2단계)은 이 위에 「함께 쓰는 사람」 표를 더해 넓힙니다.
- 기록·사진·지출은 `(owner_id, trip_id)` 로 여행을 가리킵니다. 남의 여행 id 를 알아내도 거기에 행을 붙일 수 없습니다. 사진이 붙는 기록도 `(owner_id, trip_id, entry_id)` 로 가리켜 다른 여행의 기록에 붙지 않습니다.
- 로그인하지 않은 사용자(anon)는 어떤 표도 읽거나 쓸 수 없습니다(정책 + 표 권한 회수, 두 겹). 사진 좌표는 집 위치가 될 수 있어 특히 중요합니다.
- 이 도구에는 기록성(이력·로그) 데이터가 없습니다.
- 앱에서 upsert 할 때는 `onConflict` 를 표의 UNIQUE 조합(`owner_id,trip_id` · `owner_id,entry_id` · `owner_id,photo_id` · `owner_id,expense_id` · `owner_id,plan_id`)으로 지정해야 합니다.

## 적용 방법

1. <https://supabase.com> 에 가입하고 이 도구 전용으로 새 프로젝트를 만듭니다(그래서 표 이름에 접두사가 없습니다).
2. 왼쪽 메뉴 **SQL Editor** 에 `supabase/schema.sql` 내용을 전부 붙여넣고 **Run** 을 누릅니다.

여러 번 실행해도 안전합니다. 이미 있는 표는 건너뛰고 정책·트리거는 지우고 다시 만듭니다.
`on delete set null (entry_id)`(열 지정) 문법 때문에 PostgreSQL 15 이상이 필요합니다(현재 Supabase 기본값).

## 확인 방법

1. **Table Editor** 에 위 5개 표가 있고, 표마다 RLS 가 켜져 있는지 봅니다.
2. **Authentication → Policies** 에서 표마다 SELECT·INSERT·UPDATE·DELETE 정책 4개(모두 20개)가 있는지 봅니다.
3. SQL Editor 에서 함수 권한에 `anon` 이 없는지 봅니다.

```sql
select proname, proacl from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public';
```

## 로컬 검증 방법

운영에서 처음 실행하지 않도록, 임시 로컬 PostgreSQL 에 실제로 적용해 검사하는 도구를 함께 두었습니다.

```sh
./scripts/sqltest/run.sh
```

PostgreSQL 16 이상이 필요합니다(macOS: `brew install postgresql@17`). 임시 DB 를 만들어 쓰고 끝나면 지웁니다.

- 스키마를 두 번 적용해도 오류가 없는가
- 사용자 A 의 여행·기록·사진·지출이 사용자 B 에게 보이지 않고, 고치거나 지울 수도 없는가
- 남의 여행·기록에 행을 붙일 수 없는가 · 로그인하지 않은 사용자는 아무것도 못 하는가
- 기간 역전·1년 초과·금액 0·통화 형식·분류·위도/경도 짝·(0, 0)·시간대 형식·사진 2,000장 한도를 막는가
- 기록을 지우면 사진은 남고 연결만 풀리는가 · 여행을 지우면 종속 행이 함께 지워지는가 · 함수 실행 권한에 PUBLIC·anon 이 남지 않았는가

검사용 SQL(`scripts/sqltest/*.local.sql`)은 로컬 전용이며, Supabase 운영 DB 에서 실행하면 스스로 멈춥니다.
