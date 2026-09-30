-- ============================================================================
-- 로컬 검증 전용 — data09-24 프로젝트별 검증 (운영 실행 금지, 가드 내장)
--
--  사용자 A·B 두 명과 비로그인(anon)을 번갈아 흉내 내어
--  ① 본인 행만 보이는가 ② 남의 여행에 기록·사진·지출을 끼워 넣을 수 없는가
--  ③ anon 은 아무것도 못 하는가 ④ CHECK·UNIQUE·외래키·행 수 한도가 걸리는가
--  ⑤ 기록을 지우면 사진은 남고 연결만 풀리는가 ⑥ 함수 권한에 PUBLIC·anon 이 남지 않았는가 를 잰다.
-- ============================================================================

do $guard$
begin
  if exists (select 1 from pg_roles where rolname in ('supabase_admin', 'authenticator'))
     or exists (select 1 from pg_namespace where nspname = 'graphql') then
    raise exception '이 파일은 로컬 검증 전용입니다. 운영 데이터베이스에서 실행할 수 없습니다.';
  end if;
end;
$guard$;

-- 지정한 SQLSTATE 로 실패해야 통과. 현재 역할(invoker)로 실행된다.
create or replace function public._assert_raises(p_sql text, p_state text, p_label text)
returns void language plpgsql set search_path = public as $fn$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlstate = p_state then raise notice '  OK   %', p_label; return; end if;
    raise exception 'FAIL  %  (기대 SQLSTATE %, 실제 % — %)', p_label, p_state, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL  %  (기대 SQLSTATE % 인데 성공했다)', p_label, p_state;
end;
$fn$;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@example.com'),
  ('22222222-2222-2222-2222-222222222222', 'b@example.com')
on conflict (id) do nothing;

do $t$ begin raise notice '[프로젝트] data09-24 — 소유자 격리 · 여행 소속 · anon 차단 · 제약 · 기록 삭제 시 사진 보존 · 함수 권한'; end $t$;

-- ----------------------------------------------------------------------------
-- 1. 사용자 A 가 예시 여행(간사이 3박 4일)을 저장한다
-- ----------------------------------------------------------------------------
begin;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local role authenticated;
do $t$
begin
  insert into public.trip (trip_id, title, start_date, end_date, countries, cities, rates)
  values ('t-kansai', '간사이 3박 4일', '2026-04-03', '2026-04-06', '{392}', '{오사카,교토,나라}', '{"JPY": 9.12, "USD": 1385.5}');
  insert into public.entry (trip_id, entry_id, entry_date, entry_time, place, lat, lng)
  values ('t-kansai', 'e-1', '2026-04-03', '11:20', '오사카 · 도톤보리', 34.4347, 135.244),
         ('t-kansai', 'e-3', '2026-04-05', '08:50', '교토', 34.9671, 135.7727);
  insert into public.photo (trip_id, photo_id, entry_id, file_name, file_size, taken_at, utc_offset, lat, lng)
  values ('t-kansai', 'p-1', 'e-1', 'kansai_01_airport.jpg', 10460, '2026-04-03 11:20:05', '+09:00', 34.4347, 135.244),
         ('t-kansai', 'p-5', 'e-3', 'kansai_05_inari.jpg', 13216, '2026-04-05 08:50:12', '+09:00', 34.9671, 135.7727);
  insert into public.photo (trip_id, photo_id, file_name, date_source)
  values ('t-kansai', 'p-10', 'kansai_10_noexif.jpg', 'none');
  insert into public.expense (trip_id, expense_id, spent_on, amount, currency, category, memo)
  values ('t-kansai', 'x-1', '2026-04-03', 348000, 'KRW', '교통', '왕복 항공권'),
         ('t-kansai', 'x-12', '2026-04-06', 12.50, 'USD', '쇼핑', '공항 면세점');

  perform public._assert_eq((select owner_id from public.photo where photo_id = 'p-1'),
    '11111111-1111-1111-1111-111111111111'::uuid, 'owner_id 기본값이 auth.uid() 로 채워진다');
  perform public._assert_eq((select count(*) from public.photo), 3::bigint, 'A 는 자기 사진 3장을 본다');
  perform public._assert_eq((select amount from public.expense where expense_id = 'x-12'), 12.50::numeric, '외화 금액은 소수 둘째 자리까지 그대로 저장된다');
end $t$;
commit;

begin;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local role authenticated;
do $t$
begin
  update public.entry set body = '제목: 네온 아래 첫날' where entry_id = 'e-1';
  perform public._assert((select updated_at > created_at from public.entry where entry_id = 'e-1'),
    'updated_at 트리거가 수정 시각을 갱신한다');
end $t$;
commit;

-- ----------------------------------------------------------------------------
-- 2. 사용자 B — A 의 행을 보지도, 고치지도, 지우지도, 대신 쓰지도 못한다
-- ----------------------------------------------------------------------------
begin;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
set local role authenticated;
do $t$
declare n bigint;
begin
  perform public._assert_eq(
    (select count(*) from public.trip) + (select count(*) from public.entry)
    + (select count(*) from public.photo) + (select count(*) from public.expense),
    0::bigint, 'B 에게는 A 의 행이 4개 표 어디에서도 보이지 않는다 (사진 좌표 포함)');

  update public.entry set body = '덮어쓰기' where entry_id = 'e-1';
  get diagnostics n = row_count;
  perform public._assert_eq(n, 0::bigint, 'B 의 UPDATE 는 A 의 일기에 닿지 않는다');

  delete from public.trip;
  get diagnostics n = row_count;
  perform public._assert_eq(n, 0::bigint, 'B 의 DELETE 는 A 의 여행에 닿지 않는다');

  perform public._assert_raises(
    $s$insert into public.trip (owner_id, trip_id, title) values ('11111111-1111-1111-1111-111111111111', 't-x', '끼워넣기')$s$,
    '42501', 'B 는 owner_id 를 A 로 적어 대신 쓸 수 없다');

  -- B 가 A 의 여행 id('t-kansai')를 알아냈다고 가정한다
  perform public._assert_raises(
    $s$insert into public.expense (trip_id, expense_id, spent_on, amount, currency) values ('t-kansai', 'x-x', '2026-04-03', 1, 'KRW')$s$,
    '23503', 'B 는 자기 owner_id 로라도 A 의 여행에 지출을 붙일 수 없다 (복합 외래키)');
  perform public._assert_raises(
    $s$insert into public.photo (trip_id, photo_id, file_name, date_source) values ('t-kansai', 'p-x', 'x.jpg', 'none')$s$,
    '23503', 'B 는 A 의 여행에 사진을 붙일 수 없다');

  -- 같은 id 라도 사용자가 다르면 따로 저장된다
  insert into public.trip (trip_id, title) values ('t-kansai', 'B 의 여행');
  perform public._assert_eq((select count(*) from public.trip), 1::bigint, '같은 여행 id 라도 사용자가 다르면 따로 저장된다');
  -- 자기 여행에 사진을 넣으면서 A 의 기록 id 를 적어도, (owner_id, trip_id, entry_id) 가 맞지 않아 막힌다
  perform public._assert_raises(
    $s$insert into public.photo (trip_id, photo_id, entry_id, file_name, date_source) values ('t-kansai', 'p-y', 'e-1', 'y.jpg', 'none')$s$,
    '23503', 'B 의 사진은 A 의 기록에 붙을 수 없다');

  perform public._assert_raises(
    $s$update public.trip set owner_id = '11111111-1111-1111-1111-111111111111'$s$,
    '42501', 'B 는 자기 행의 owner_id 를 A 로 넘길 수 없다 (with check)');
end $t$;
commit;

do $t$
begin
  perform public._assert_eq((select body from public.entry
      where owner_id = '11111111-1111-1111-1111-111111111111' and entry_id = 'e-1'),
    '제목: 네온 아래 첫날', 'B 의 시도 뒤에도 A 의 일기는 그대로다');
  perform public._assert_eq((select count(*) from public.trip
      where owner_id = '11111111-1111-1111-1111-111111111111'), 1::bigint, 'B 의 시도 뒤에도 A 의 여행은 그대로다');
end $t$;

-- ----------------------------------------------------------------------------
-- 3. 비로그인(anon) — 읽기도 쓰기도 막힌다
-- ----------------------------------------------------------------------------
begin;
set local request.jwt.claim.sub = '';
set local role anon;
do $t$
declare t text;
begin
  foreach t in array array['trip','entry','photo','expense','plan']
  loop
    perform public._assert_raises(format('select * from public.%I', t), '42501', 'anon 은 ' || t || ' 를 읽을 수 없다');
  end loop;
  perform public._assert_raises(
    $s$insert into public.trip (trip_id, title) values ('t-anon', 'x')$s$, '42501', 'anon 은 여행을 만들 수 없다');
end $t$;
commit;

-- ----------------------------------------------------------------------------
-- 4. 정책 구조
-- ----------------------------------------------------------------------------
do $t$
declare v_bad text;
begin
  select string_agg(p.polname, ', ') into v_bad
    from pg_policy p join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and coalesce(pg_get_expr(p.polqual, p.polrelid), '') || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
         not like '%owner_id = auth.uid()%';
  perform public._assert(v_bad is null,
    '모든 정책이 owner_id = auth.uid() 로 묶여 있다' || coalesce(' (발견: ' || v_bad || ')', ''));
  perform public._assert_eq((select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
     join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'),
    20::bigint, '정책 수가 20개다 (5개 표 × 4, 재실행해도 늘지 않는다)');
end $t$;

-- ----------------------------------------------------------------------------
-- 5. CHECK · UNIQUE · 외래키
-- ----------------------------------------------------------------------------
begin;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local role authenticated;
do $t$
begin
  perform public._assert_raises($s$insert into public.trip (trip_id, title) values ('t-2', '   ')$s$,
    '23514', '여행 이름은 비워 둘 수 없다');
  perform public._assert_raises($s$insert into public.trip (trip_id, title, start_date, end_date) values ('t-2', '역전', '2026-04-06', '2026-04-03')$s$,
    '23514', '마지막 날이 첫날보다 빠르면 막는다');
  perform public._assert_raises($s$insert into public.trip (trip_id, title, start_date, end_date) values ('t-2', '너무 김', '2026-01-01', '2027-01-03')$s$,
    '23514', '여행 기간은 1년까지다');
  perform public._assert_raises($s$insert into public.trip (trip_id, title) values ('t-kansai', '중복')$s$,
    '23505', '같은 여행 id 는 두 번 넣을 수 없다');
  perform public._assert_raises($s$insert into public.trip (trip_id, title, rates) values ('t-2', 'x', '[1,2]')$s$,
    '23514', '환율은 {통화: 값} 객체만 받는다');

  perform public._assert_raises($s$insert into public.expense (trip_id, expense_id, spent_on, amount, currency) values ('t-kansai', 'x-2', '2026-04-03', 0, 'JPY')$s$,
    '23514', '지출 금액은 0보다 커야 한다');
  perform public._assert_raises($s$insert into public.expense (trip_id, expense_id, spent_on, amount, currency) values ('t-kansai', 'x-2', '2026-04-03', 100, 'yen')$s$,
    '23514', '통화는 영문 대문자 3자리(ISO 4217 형식)만 받는다');
  perform public._assert_raises($s$insert into public.expense (trip_id, expense_id, spent_on, amount, currency, category) values ('t-kansai', 'x-2', '2026-04-03', 100, 'JPY', '투자')$s$,
    '23514', '지출 분류는 도구의 6가지만 받는다');
  perform public._assert_raises($s$insert into public.expense (trip_id, expense_id, spent_on, amount, currency) values ('t-none', 'x-2', '2026-04-03', 100, 'JPY')$s$,
    '23503', '없는 여행에는 지출을 붙일 수 없다');

  -- 2026-09-30 정산·장소 이름 칸
  update public.trip set members = '[{"id":"m-me","name":"나"},{"id":"m-a","name":"친구A"}]' where trip_id = 't-kansai';
  insert into public.expense (trip_id, expense_id, spent_on, amount, currency, paid_by, split_among)
  values ('t-kansai', 'x-s1', '2026-04-04', 3000, 'JPY', 'm-a', '{m-me,m-a}');
  perform public._assert_eq((select split_among from public.expense where expense_id = 'x-s1'), '{m-me,m-a}'::text[], '나눌 사람 목록을 저장한다');
  perform public._assert_eq((select split_among from public.expense where expense_id = 'x-1'), '{}'::text[], '나눌 사람을 안 적으면 빈 목록(= 모두)');
  perform public._assert_eq((select jsonb_array_length(members) from public.trip where trip_id = 't-kansai'), 2, '함께 간 사람 2명');
  update public.photo set place = '도톤보리', place_detail = '오사카시 주오구' where photo_id = 'p-1';
  perform public._assert_eq((select place from public.photo where photo_id = 'p-1'), '도톤보리'::text, '장소 이름을 저장한다');
  delete from public.expense where expense_id = 'x-s1';
  perform public._assert_raises($s$update public.trip set members = '{"id":"m-me"}' where trip_id = 't-kansai'$s$,
    '23514', '함께 간 사람은 배열만 받는다');
  perform public._assert_raises($s$update public.expense set split_among = (select array_agg('m' || g) from generate_series(1, 21) g) where expense_id = 'x-1'$s$,
    '23514', '나눌 사람은 20명까지');
  perform public._assert_raises($s$update public.expense set paid_by = '' where expense_id = 'x-1'$s$,
    '23514', '낸 사람 id 는 빈 글자가 아니어야 한다');
  perform public._assert_raises($s$update public.photo set place = repeat('가', 61) where photo_id = 'p-1'$s$,
    '23514', '장소 이름은 60자까지');

  perform public._assert_raises($s$insert into public.photo (trip_id, photo_id, file_name, lat) values ('t-kansai', 'p-2', 'a.jpg', 34.6)$s$,
    '23514', '위도만 있고 경도가 없으면 막는다');
  perform public._assert_raises($s$insert into public.photo (trip_id, photo_id, file_name, taken_at, lat, lng) values ('t-kansai', 'p-2', 'a.jpg', '2026-04-03 10:00', 91, 135)$s$,
    '23514', '위도 91도는 막는다');
  perform public._assert_raises($s$insert into public.photo (trip_id, photo_id, file_name, taken_at, lat, lng) values ('t-kansai', 'p-2', 'a.jpg', '2026-04-03 10:00', 0, 0)$s$,
    '23514', '(0, 0) 은 위치로 받지 않는다');
  perform public._assert_raises($s$insert into public.photo (trip_id, photo_id, file_name, date_source) values ('t-kansai', 'p-2', 'a.jpg', 'exif')$s$,
    '23514', 'EXIF 날짜라면서 찍은 시각이 없으면 막는다');
  perform public._assert_raises($s$insert into public.photo (trip_id, photo_id, file_name, taken_at, utc_offset) values ('t-kansai', 'p-2', 'a.jpg', '2026-04-03 10:00', '9시간')$s$,
    '23514', '시간대는 +09:00 형식만 받는다');
  perform public._assert_raises($s$insert into public.photo (trip_id, photo_id, entry_id, file_name, date_source) values ('t-kansai', 'p-2', 'e-없음', 'a.jpg', 'none')$s$,
    '23503', '없는 기록에는 사진을 붙일 수 없다');
  perform public._assert_raises($s$insert into public.entry (trip_id, entry_id, entry_date, lat) values ('t-kansai', 'e-9', '2026-04-04', 34.6)$s$,
    '23514', '기록 좌표도 위도·경도가 짝이어야 한다');
end $t$;
commit;

-- 2026-09-30 여행 일정(plan)
begin;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local role authenticated;
do $t$
begin
  insert into public.plan (trip_id, plan_id, plan_type, title, plan_date, start_time, end_date, end_time, place, lat, lng, booking_ref, expense_id, done)
  values ('t-kansai', 'pl-1', '숙소', '난바 호텔 3박', '2026-04-03', '15:00', '2026-04-06', '11:00', '오사카 · 난바', 34.6655, 135.501, 'EX-HTL-5521', 'x-1', true),
         ('t-kansai', 'pl-2', '항공', '밤 비행기', '2026-04-05', '23:10', '2026-04-06', '01:20', '', null, null, '', null, false),
         ('t-kansai', 'pl-3', '맛집', '타코야키', '2026-04-03', '19:00', null, '20:00', '도톤보리', null, null, '', null, false);
  perform public._assert_eq((select count(*) from public.plan), 3::bigint, '일정 3개를 저장한다(여러 날 숙소·다음 날 도착 비행 포함)');
  update public.plan set done = true where plan_id = 'pl-3';
  perform public._assert((select done from public.plan where plan_id = 'pl-3'), '확인 표시를 고친다');
  perform public._assert_raises($s$insert into public.plan (trip_id, plan_id, plan_type, title, plan_date) values ('t-kansai', 'pl-x', '쇼핑', 'x', '2026-04-03')$s$,
    '23514', '일정 종류는 6가지만 받는다');
  perform public._assert_raises($s$insert into public.plan (trip_id, plan_id, title, plan_date) values ('t-kansai', 'pl-x', ' ', '2026-04-03')$s$,
    '23514', '일정 이름은 비워 둘 수 없다');
  perform public._assert_raises($s$insert into public.plan (trip_id, plan_id, title, plan_date, start_time, end_time) values ('t-kansai', 'pl-x', 'x', '2026-04-03', '11:00', '09:00')$s$,
    '23514', '같은 날 끝 시각이 시작보다 빠르면 막는다');
  perform public._assert_raises($s$insert into public.plan (trip_id, plan_id, title, plan_date, end_date) values ('t-kansai', 'pl-x', 'x', '2026-04-03', '2026-04-02')$s$,
    '23514', '끝나는 날이 시작하는 날보다 빠르면 막는다');
  perform public._assert_raises($s$insert into public.plan (trip_id, plan_id, title, plan_date, end_date) values ('t-kansai', 'pl-x', 'x', '2026-04-03', '2026-05-10')$s$,
    '23514', '한 일정은 31일까지');
  perform public._assert_raises($s$insert into public.plan (trip_id, plan_id, title, plan_date, lat) values ('t-kansai', 'pl-x', 'x', '2026-04-03', 34.6)$s$,
    '23514', '일정 좌표도 위도·경도가 짝이어야 한다');
  perform public._assert_raises($s$insert into public.plan (trip_id, plan_id, title, plan_date, expense_id) values ('t-kansai', 'pl-x', 'x', '2026-04-03', 'x-없음')$s$,
    '23503', '없는 지출에는 일정을 연결할 수 없다');
  perform public._assert_raises($s$insert into public.plan (trip_id, plan_id, title, plan_date) values ('t-none', 'pl-x', 'x', '2026-04-03')$s$,
    '23503', '없는 여행에는 일정을 붙일 수 없다');
end $t$;
commit;

begin;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
set local role authenticated;
do $t$
declare n bigint;
begin
  perform public._assert_eq((select count(*) from public.plan), 0::bigint, 'B 에게는 A 의 일정(예약 번호 포함)이 보이지 않는다');
  update public.plan set done = false;
  get diagnostics n = row_count;
  perform public._assert_eq(n, 0::bigint, 'B 의 UPDATE 는 A 의 일정에 닿지 않는다');
  -- B 의 여행('t-kansai', 위에서 만든 B 의 것)에 A 의 지출 id 를 연결하려 해도 (owner_id, trip_id, expense_id) 가 맞지 않아 막힌다
  perform public._assert_raises($s$insert into public.plan (trip_id, plan_id, title, plan_date, expense_id) values ('t-kansai', 'pl-b', 'x', '2026-04-03', 'x-1')$s$,
    '23503', 'B 의 일정은 A 의 지출에 연결할 수 없다');
end $t$;
commit;

begin;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local role authenticated;
do $t$
begin
  delete from public.expense where expense_id = 'x-1';
  perform public._assert((select expense_id is null and trip_id = 't-kansai' from public.plan where plan_id = 'pl-1'),
    '지출을 지우면 일정은 남고 연결(expense_id)만 풀린다');
end $t$;
commit;

-- 기록을 지우면 사진은 남고 연결(entry_id)만 풀린다
begin;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local role authenticated;
do $t$
begin
  delete from public.entry where entry_id = 'e-3';
  perform public._assert_eq((select count(*) from public.photo where photo_id = 'p-5'), 1::bigint, '기록을 지워도 사진은 남는다');
  perform public._assert((select entry_id is null and trip_id = 't-kansai' from public.photo where photo_id = 'p-5'),
    '지운 기록의 사진은 entry_id 만 비고 여행 소속은 그대로다');
end $t$;
commit;

-- 사진 한도 2,000장 (여행당)
begin;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local role authenticated;
do $t$
declare have int;
begin
  select count(*) into have from public.photo where trip_id = 't-kansai';
  insert into public.photo (trip_id, photo_id, file_name, date_source)
  select 't-kansai', 'lim-' || g, 'lim.jpg', 'none' from generate_series(1, 2000 - have) g;
  perform public._assert_eq((select count(*) from public.photo where trip_id = 't-kansai'), 2000::bigint, '여행 하나에 사진 2,000장까지는 들어간다');
  perform public._assert_raises($s$insert into public.photo (trip_id, photo_id, file_name, date_source) values ('t-kansai', 'lim-x', 'x.jpg', 'none')$s$,
    '23514', '2,001번째 사진은 막는다');
end $t$;
commit;

-- 여행을 지우면 종속 행도 함께 지워진다
begin;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set local role authenticated;
do $t$
begin
  delete from public.trip where trip_id = 't-kansai';
  perform public._assert_eq(
    (select count(*) from public.entry) + (select count(*) from public.photo) + (select count(*) from public.expense) + (select count(*) from public.plan),
    0::bigint, '여행을 지우면 기록·사진·지출·일정도 함께 지워진다');
end $t$;
commit;

-- ----------------------------------------------------------------------------
-- 6. 함수 권한 · search_path · 표 권한
-- ----------------------------------------------------------------------------
do $t$
declare v_bad text;
begin
  -- proacl 이 NULL 이면 "기본값 = PUBLIC 에 EXECUTE" 라는 뜻이다. NULL 도 실패로 본다.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname not like '\_assert%'
     and (p.proacl is null
          or exists (select 1 from aclexplode(p.proacl) a
                      where a.privilege_type = 'EXECUTE'
                        and (a.grantee = 0 or a.grantee = 'anon'::regrole::oid)));
  perform public._assert(v_bad is null,
    'proacl 에 PUBLIC·anon EXECUTE 가 없다' || coalesce(' (발견: ' || v_bad || ')', ''));

  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname not like '\_assert%'
     and not coalesce('search_path=public' = any(p.proconfig), false);
  perform public._assert(v_bad is null,
    '모든 함수에 search_path = public 이 고정돼 있다' || coalesce(' (발견: ' || v_bad || ')', ''));

  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('anon', c.oid, 'INSERT')
          or has_table_privilege('anon', c.oid, 'UPDATE') or has_table_privilege('anon', c.oid, 'DELETE'));
  perform public._assert(v_bad is null,
    'anon 에 표 권한이 남지 않았다 (Supabase 자동 부여를 끊었다)' || coalesce(' (발견: ' || v_bad || ')', ''));
end $t$;

-- 정리
delete from public.trip;
delete from auth.users where email in ('a@example.com', 'b@example.com');

do $t$ begin raise notice ''; raise notice '전부 통과했습니다.'; end $t$;
