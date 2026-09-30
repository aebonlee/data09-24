-- ============================================================================
-- data09-24 — JOURNAL (여행 기록일지)
-- Supabase(PostgreSQL) DB 스키마 + RLS
--
--  실행 위치 : 수강생 본인 Supabase 프로젝트의 SQL Editor 에서 실행
--              (Dashboard → SQL Editor → 이 파일 전체를 붙여넣고 Run)
--  재실행    : 안전합니다 (IF NOT EXISTS / CREATE OR REPLACE / DROP ... IF EXISTS 선행)
--
--  지금 도구(1단계)는 계정 없이 브라우저에만 저장합니다 — localStorage `data09-24.db` 에 여행 목록,
--  IndexedDB 에 사진 미리보기. 이 스키마는 2단계(계정·기기 간 동기화·함께 쓰는 여행)를 위한 준비입니다.
--  여행 하나가 trip 한 행이고, 그 안의 entries·photos·expenses 배열이 각각 entry·photo·expense 표가 됩니다.
--    각 레코드의 id → trip_id · entry_id · photo_id · expense_id
--    start/end → start_date/end_date, text → body, date → entry_date/spent_on
--    (2026-09-30) members → trip.members, paidBy → paid_by, split → split_among, place/placeDetail → photo.place/place_detail
--
--  표 목록
--    trip      여행 — 이름, 기간, 나라(Natural Earth 숫자 코드), 도시, 환율(직접 입력), AI 리포트
--    entry     날짜별 기록(일기) — 날짜, 시각, 장소, 키워드·메모, 본문, 좌표
--    photo     사진 정보 — 파일 이름·크기, 찍은 시각(카메라 현지 시각), 좌표. 사진 파일 자체는 저장하지 않음
--              (2단계에 private Storage 버킷을 쓰면 storage_path 에 경로를 적는다)
--    expense   지출 — 날짜, 금액(원래 통화, 소수 둘째 자리), 통화, 분류
--  원 환산 합계·동선·방문 국가 목록은 입력에서 다시 계산되는 파생 데이터라 저장하지 않습니다.
--
--  권한 원칙 : 모든 행은 만든 사람(owner_id = auth.uid())만 보고 고칩니다.
--              기록·사진·지출은 (owner_id, trip_id) 복합 외래키로 여행을 가리켜, 남의 여행에 행을 끼워 넣을 수 없게 합니다.
--              사진이 붙는 기록도 (owner_id, trip_id, entry_id) 로 가리켜 다른 여행의 기록에 붙지 않게 합니다.
--              여행을 지우면 종속 행도 함께 지우고, 기록을 지우면 사진은 남기고 연결만 풉니다.
--  한도      : 여행 200개, 여행 하나에 사진 2,000 · 기록 1,000 · 지출 2,000, 여행 기간 1년, 금액 1조 이하
--  이 스키마는 수강생 본인 프로젝트 전제라 테이블 이름에 접두사를 붙이지 않았습니다.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. 테이블
-- ----------------------------------------------------------------------------

create table if not exists public.trip (
  id             bigint generated always as identity primary key,
  owner_id       uuid not null default auth.uid(),
  trip_id        text not null,
  title          text not null check (length(trim(title)) > 0 and length(title) <= 60),
  start_date     date,
  end_date       date,
  countries      text[] not null default '{}',        -- Natural Earth ISO 숫자 코드('392' 등)
  cities         text[] not null default '{}',
  memo           text not null default '' check (length(memo) <= 500),
  home_currency  text not null default 'KRW' check (home_currency ~ '^[A-Z]{3}$'),
  rates          jsonb not null default '{}'::jsonb check (jsonb_typeof(rates) = 'object'),   -- {"JPY": 9.12}
  report         text not null default '' check (length(report) <= 8000),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- upsert onConflict = 'owner_id,trip_id'
  constraint trip_uniq unique (owner_id, trip_id),
  constraint trip_period check (
    (start_date is null or end_date is null)
    or (end_date >= start_date and end_date - start_date <= 365)),
  constraint trip_countries check (array_length(countries, 1) is null or array_length(countries, 1) <= 250),
  constraint trip_cities check (array_length(cities, 1) is null or array_length(cities, 1) <= 100)
);

create table if not exists public.entry (
  id           bigint generated always as identity primary key,
  owner_id     uuid not null default auth.uid(),
  trip_id      text not null,
  entry_id     text not null,
  entry_date   date not null,
  entry_time   time,
  place        text not null default '' check (length(place) <= 80),
  keywords     text not null default '' check (length(keywords) <= 600),
  body         text not null default '' check (length(body) <= 6000),
  lat          numeric(9, 6) check (lat between -90 and 90),
  lng          numeric(9, 6) check (lng between -180 and 180),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint entry_uniq unique (owner_id, entry_id),
  constraint entry_trip_uniq unique (owner_id, trip_id, entry_id),     -- photo 가 가리키는 키
  constraint entry_pos check ((lat is null) = (lng is null)),          -- 위도·경도는 둘 다 있거나 둘 다 없다
  constraint entry_trip_fk foreign key (owner_id, trip_id)
    references public.trip (owner_id, trip_id) on delete cascade on update cascade
);
create index if not exists entry_trip_idx on public.entry (owner_id, trip_id, entry_date);

create table if not exists public.photo (
  id            bigint generated always as identity primary key,
  owner_id      uuid not null default auth.uid(),
  trip_id       text not null,
  photo_id      text not null,
  entry_id      text,                                  -- 비우면 아직 기록에 안 붙은 사진
  file_name     text not null check (length(file_name) between 1 and 255),
  file_size     bigint not null default 0 check (file_size between 0 and 200000000),
  taken_at      timestamp,                             -- EXIF 의 카메라 현지 시각(시간대 없음)
  utc_offset    text not null default '' check (utc_offset = '' or utc_offset ~ '^[+-]\d{2}:\d{2}$'),
  file_time     timestamp,                             -- EXIF 날짜가 없을 때 파일 날짜 또는 사람이 정한 날짜
  date_source   text not null default 'exif' check (date_source in ('exif', 'file', 'manual', 'none')),
  lat           numeric(9, 6) check (lat between -90 and 90),
  lng           numeric(9, 6) check (lng between -180 and 180),
  storage_path  text check (storage_path is null or length(storage_path) <= 500),   -- 2단계: private 버킷 경로
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint photo_uniq unique (owner_id, photo_id),
  constraint photo_pos check ((lat is null) = (lng is null)),
  -- (0, 0) 은 GPS 를 못 잡은 카메라가 적는 값이라 위치로 받지 않는다(도구와 같은 규칙)
  constraint photo_not_null_island check (not (lat = 0 and lng = 0)),
  constraint photo_date check (
    (date_source = 'exif' and taken_at is not null)
    or (date_source in ('file', 'manual') and file_time is not null)
    or (date_source = 'none')),
  constraint photo_trip_fk foreign key (owner_id, trip_id)
    references public.trip (owner_id, trip_id) on delete cascade on update cascade,
  -- 기록을 지우면 사진은 남기고 entry_id 만 비운다 (PostgreSQL 15+ 의 열 지정 SET NULL)
  constraint photo_entry_fk foreign key (owner_id, trip_id, entry_id)
    references public.entry (owner_id, trip_id, entry_id) on delete set null (entry_id) on update cascade
);
create index if not exists photo_trip_idx on public.photo (owner_id, trip_id, taken_at);

create table if not exists public.expense (
  id           bigint generated always as identity primary key,
  owner_id     uuid not null default auth.uid(),
  trip_id      text not null,
  expense_id   text not null,
  spent_on     date not null,
  amount       numeric(16, 2) not null check (amount > 0 and amount <= 1000000000000),
  currency     text not null check (currency ~ '^[A-Z]{3}$'),
  category     text not null default '기타' check (category in ('숙박', '교통', '식비', '관광·입장', '쇼핑', '기타')),
  memo         text not null default '' check (length(memo) <= 80),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint expense_uniq unique (owner_id, expense_id),
  constraint expense_trip_fk foreign key (owner_id, trip_id)
    references public.trip (owner_id, trip_id) on delete cascade on update cascade
);
create index if not exists expense_trip_idx on public.expense (owner_id, trip_id, spent_on);

-- 2026-09-30 추가 — 정산(함께 간 사람 · 낸 사람 · 나눌 사람)과 외부 지도 API 로 받은 장소 이름.
-- 먼저 만든 표에도 붙도록 add column if not exists 로 둔다(이미 있으면 통째로 건너뛴다 — 재실행 안전).
--   trip.members      [{"id": "m-me", "name": "나"}, …] — 도구의 members 배열 그대로, 20명까지
--   expense.paid_by   낸 사람 id(비우면 첫 사람), split_among 나눌 사람 id 목록(비우면 모두)
--   photo.place       외부 지도 API 로 받은 장소 이름(비우면 도구가 GeoNames 로 가까운 도시를 붙임), place_detail 주소
alter table public.trip add column if not exists members jsonb not null default '[]'::jsonb
  constraint trip_members check (jsonb_typeof(members) = 'array' and jsonb_array_length(members) <= 20);
alter table public.expense add column if not exists paid_by text
  constraint expense_paid_by check (paid_by is null or length(paid_by) between 1 and 40);
alter table public.expense add column if not exists split_among text[] not null default '{}'
  constraint expense_split check (array_length(split_among, 1) is null or array_length(split_among, 1) <= 20);
alter table public.photo add column if not exists place text not null default ''
  constraint photo_place check (length(place) <= 60);
alter table public.photo add column if not exists place_detail text not null default ''
  constraint photo_place_detail check (length(place_detail) <= 120);

-- ----------------------------------------------------------------------------
-- 2. 함수 · 트리거
--
--  search_path 를 고정한다. 고정하지 않으면 호출자의 search_path 에 따라
--  엉뚱한 스키마의 객체를 잡을 수 있다.
-- ----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = public as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

-- 행 수 한도 — 여행 200(사용자당), 사진 2,000 · 기록 1,000 · 지출 2,000(여행당)
create or replace function public.check_row_limit()
returns trigger language plpgsql set search_path = public as $fn$
declare n int; lim int;
begin
  if tg_table_name = 'trip' then
    select count(*) into n from public.trip where owner_id = new.owner_id;
    lim := 200;
  else
    lim := case tg_table_name when 'photo' then 2000 when 'entry' then 1000 else 2000 end;
    execute format('select count(*) from public.%I where owner_id = $1 and trip_id = $2', tg_table_name)
      into n using new.owner_id, new.trip_id;
  end if;
  if n >= lim then
    raise exception '% 행은 %개까지입니다', tg_table_name, lim using errcode = '23514';
  end if;
  return new;
end;
$fn$;

do $trg$
declare t text;
begin
  foreach t in array array['trip', 'entry', 'photo', 'expense']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
                   t || '_updated_at', t);
    execute format('drop trigger if exists %I on public.%I', t || '_row_limit', t);
    execute format('create trigger %I before insert on public.%I for each row execute function public.check_row_limit()',
                   t || '_row_limit', t);
  end loop;
end;
$trg$;

-- ----------------------------------------------------------------------------
-- 3. RLS — 본인 행만
-- ----------------------------------------------------------------------------

do $rls$
declare t text;
begin
  foreach t in array array['trip', 'entry', 'photo', 'expense']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('create policy %I on public.%I for select to authenticated using (owner_id = auth.uid())',
                   t || '_select', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (owner_id = auth.uid())',
                   t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())',
                   t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (owner_id = auth.uid())',
                   t || '_delete', t);
  end loop;
end;
$rls$;

-- ----------------------------------------------------------------------------
-- 4. 표 권한 — Supabase 는 새 표마다 anon 에도 전 권한을 자동으로 붙인다.
--    정책이 anon 을 막지만, 권한 자체도 끊어 두 겹으로 막는다.
-- ----------------------------------------------------------------------------

revoke all on public.trip, public.entry, public.photo, public.expense from anon;
grant select, insert, update, delete on public.trip, public.entry, public.photo, public.expense to authenticated;

-- ----------------------------------------------------------------------------
-- 5. 함수 실행 권한
--
--  GRANT 만으로는 제한되지 않는다. 권한이 두 겹으로 미리 붙는다.
--    ① PostgreSQL 이 함수 생성 시 PUBLIC 에 EXECUTE 기본 부여
--    ② Supabase 가 ALTER DEFAULT PRIVILEGES 로 신규 함수마다 anon 에 자동 부여
--  PUBLIC 만 지우면 anon=X 가 남아 비로그인 호출이 그대로 뚫린다.
--  트리거 전용 함수는 authenticated 를 남긴다(직접 호출하면 "can only be called as trigger" 로 죽어 무해).
-- ----------------------------------------------------------------------------

revoke all on function public.set_updated_at()  from public, anon;
revoke all on function public.check_row_limit() from public, anon;
grant execute on function public.set_updated_at()  to authenticated;
grant execute on function public.check_row_limit() to authenticated;

-- ============================================================================
-- 끝.
-- ============================================================================
