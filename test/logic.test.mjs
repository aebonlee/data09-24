// 실행: node test/logic.test.mjs   (의존성 없음)
// EXIF 읽기(합성 JPEG 10장) · 일자 묶기 · 동선 순서 · 경비 합계(환율 환산) · 나라 판정 · 프롬프트 · 백업 검사
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('../js/exif.js');
const L = require('../js/logic.js');
const S = require('../js/sample-data.js');
const W = require('../vendor/world-110m.js');
const M = JSON.parse(readFileSync(new URL('../samples/manifest.json', import.meta.url), 'utf8'));
const jpg = (f) => readFileSync(new URL('../samples/' + f, import.meta.url));

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { console.error('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1; }
}
const shuffle = (a) => a.slice().reverse();

console.log('EXIF 읽기 (samples/*.jpg — scripts/make-samples.mjs 가 쓴 가짜 EXIF)');
test('합성 사진 10장: 찍은 시각·시간대·위도·경도가 manifest 기대값과 같다', () => {
  assert.equal(M.samples.length, 10);
  for (const s of M.samples) {
    const r = E.parse(jpg(s.file));
    assert.ok(r, s.file + ' 은 JPEG');
    assert.equal(r.takenAt, s.takenAt, s.file + ' takenAt');
    assert.equal(r.offset, s.offset, s.file + ' offset');
    assert.equal(r.lat, s.lat, s.file + ' lat');
    assert.equal(r.lng, s.lng, s.file + ' lng');
  }
});
test('읽은 좌표가 의도한 명소 좌표와 0.0001도(약 10m) 안에서 같다', () => {
  for (const s of M.samples.filter((x) => x.intendedLat !== null)) {
    const r = E.parse(jpg(s.file));
    assert.ok(Math.abs(r.lat - s.intendedLat) < 1e-4 && Math.abs(r.lng - s.intendedLng) < 1e-4, s.file);
  }
});
test('리틀엔디언(II)·빅엔디언(MM) 파일을 둘 다 읽는다', () => {
  const orders = new Set(M.samples.map((s) => s.byteOrder).filter(Boolean));
  assert.deepEqual([...orders].sort(), ['II', 'MM']);
  const mm = M.samples.find((s) => s.byteOrder === 'MM' && s.lat !== null);
  assert.equal(E.parse(jpg(mm.file)).lat, mm.lat);
});
test('GPS 없는 사진 → 시각만, EXIF 없는 사진 → hasExif=false·빈 값', () => {
  const a = E.parse(jpg('kansai_09_nogps.jpg'));
  assert.equal(a.takenAt, '2026-04-06T14:05:00'); assert.equal(a.lat, null); assert.equal(a.lng, null);
  const b = E.parse(jpg('kansai_10_noexif.jpg'));
  assert.equal(b.hasExif, false); assert.equal(b.takenAt, ''); assert.equal(b.lat, null);
});
test('JPEG 가 아니면 null, 잘린 파일·깨진 값은 예외 없이 빈 값', () => {
  assert.equal(E.parse(new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0, 0, 0, 0])), null);
  const cut = E.parse(jpg('kansai_05_inari.jpg').subarray(0, 60));
  assert.ok(cut && cut.lat === null);
  assert.equal(E.exifDate('0000:00:00 00:00:00'), '');
  assert.equal(E.exifDate('2026:04:03 11:20:05'), '2026-04-03T11:20:05');
  assert.equal(E.dms([37, 30, 0], 'S'), -37.5);
  assert.equal(E.dms([1, 2, NaN], 'N'), null);
});
test('예시 여행의 사진 정보가 실제 파일 EXIF 와 같다 (화면 예시 = 파일)', () => {
  const t = S.kansai();
  for (const p of t.photos) {
    const r = E.parse(jpg(p.name));
    assert.equal(p.takenAt, r.takenAt, p.name); assert.equal(p.lat, r.lat, p.name); assert.equal(p.lng, r.lng, p.name);
    assert.equal(p.size, jpg(p.name).length, p.name + ' 크기');
  }
});

console.log('날짜 · 일자 묶기');
test('여행 기간 2026-04-03 ~ 04-06 → 3박 4일, 04-05 는 3일째, 기간 밖은 0', () => {
  const t = S.kansai();
  assert.equal(L.nightsDays(t).label, '3박 4일');
  assert.equal(L.dayNo(t, '2026-04-05'), 3);
  assert.equal(L.dayNo(t, '2026-04-07'), 0);
  assert.equal(L.dayNo(t, '2026-04-02'), 0);
  assert.equal(L.dateLabel('2026-04-03'), '4월 3일 (금)');
  assert.equal(L.isDate('2026-02-30'), false);
});
test('사진을 날짜별로 묶는다 — 4일 + 날짜 없음 1장(맨 뒤), 하루 안은 시각순', () => {
  const g = L.groupByDay(shuffle(S.kansai().photos));
  assert.deepEqual(g.map((x) => x.date), ['2026-04-03', '2026-04-04', '2026-04-05', '2026-04-06', '']);
  assert.deepEqual(g.map((x) => x.photos.length), [2, 2, 3, 2, 1]);
  assert.deepEqual(g[2].photos.map((p) => p.name), ['kansai_05_inari.jpg', 'kansai_06_kiyomizu.jpg', 'kansai_07_gion.jpg']);
});
test('EXIF 없는 사진은 파일 날짜(fileTime)로 묶고, 자정 직전·직후는 다른 날이다', () => {
  const ps = [
    { id: 'a', name: 'a', takenAt: '2026-04-03T23:59:59' },
    { id: 'b', name: 'b', takenAt: '2026-04-04T00:00:01' },
    { id: 'c', name: 'c', takenAt: '', fileTime: '2026-04-04T09:00:00' }
  ];
  const g = L.groupByDay(ps);
  assert.deepEqual(g.map((x) => [x.date, x.photos.map((p) => p.id).join('')]), [['2026-04-03', 'a'], ['2026-04-04', 'bc']]);
  assert.deepEqual(L.photoDateRange(ps), { start: '2026-04-03', end: '2026-04-04' });
});
test('파일 날짜로 짐작한 사진이 여행 기간 밖이면 「날짜 확인」으로 빼고 기록을 만들지 않는다', () => {
  const t = S.kansai(); t.entries = []; t.photos.forEach((p) => { p.entryId = ''; });
  const odd = t.photos.find((p) => p.name === 'kansai_10_noexif.jpg');
  odd.fileTime = '2026-09-29T08:00:00'; odd.dateSource = 'file';            // 메신저로 받은 날
  assert.equal(L.needsDate(t, odd), true);
  assert.equal(L.entriesFromPhotos(t, W), 4, '9월 29일 기록은 생기지 않는다');
  odd.fileTime = '2026-04-05T12:00:00';                                         // 여행 기간 안이면 그대로 믿는다
  assert.equal(L.needsDate(t, odd), false);
  assert.equal(L.needsDate(t, { name: 'x', takenAt: '' }), true);
});
test('사진으로 일자별 기록 만들기 — 4편, 장소는 사진 위치의 나라, 다시 눌러도 늘지 않는다', () => {
  const t = L.newTrip('테스트');
  t.photos = S.kansai().photos.map((p) => ({ ...p, entryId: '' }));
  assert.equal(L.entriesFromPhotos(t, W), 4);
  assert.deepEqual(t.entries.map((e) => e.date), ['2026-04-03', '2026-04-04', '2026-04-05', '2026-04-06']);
  assert.ok(t.entries.every((e) => e.place === '일본'));
  assert.equal(t.entries[0].time, '11:20');
  assert.equal(t.photos.filter((p) => !p.entryId).length, 1, '날짜 없는 사진만 남는다');
  assert.equal(L.entriesFromPhotos(t, W), 0);
  assert.deepEqual(L.addCountriesFromPhotos(t, W), ['일본']);
  assert.deepEqual(L.addCountriesFromPhotos(t, W), []);
});

console.log('동선');
test('여행 동선: 날짜별로 찍은 시각 순, 위치 없는 사진은 빠진다', () => {
  const t = S.kansai(); t.photos = shuffle(t.photos);
  const r = L.tripRoutes(t);
  assert.deepEqual(r.map((x) => [x.date, x.dayNo, x.stops.length]),
    [['2026-04-03', 1, 2], ['2026-04-04', 2, 2], ['2026-04-05', 3, 3], ['2026-04-06', 4, 1]]);
  assert.deepEqual(r[2].stops.map((s) => s.refs[0]), ['p:sp-5', 'p:sp-6', 'p:sp-7']);
  assert.ok(r[0].meters > 34000 && r[0].meters < 36000, '간사이 공항 → 도톤보리 약 35km: ' + r[0].meters);
  assert.equal(r[3].meters, 0);
});
test('30m 안에서 연달아 찍은 곳은 한 점, 시각 없는 점은 그날 끝', () => {
  const r = L.routeOf([
    { lat: 35.0, lng: 135.0, at: '2026-04-05T10:00:00', ref: 'b' },
    { lat: 35.0001, lng: 135.0001, at: '2026-04-05T10:05:00', ref: 'c' },   // 약 14m
    { lat: 35.01, lng: 135.0, at: '', ref: 'z' },
    { lat: 34.99, lng: 135.0, at: '2026-04-05T09:00:00', ref: 'a' }
  ]);
  assert.deepEqual(r.stops.map((s) => s.refs.join('+')), ['a', 'b+c', 'z']);
  assert.ok(Math.abs(r.meters - Math.round(L.haversine({ lat: 34.99, lng: 135 }, { lat: 35, lng: 135 }) + L.haversine({ lat: 35, lng: 135 }, { lat: 35.01, lng: 135 }))) <= 1);
});
test('사진 없이 좌표만 적은 기록도 동선에 들어간다(적은 시각 순)', () => {
  const t = L.newTrip('x'); t.start = '2026-05-01'; t.end = '2026-05-02';
  t.entries = [
    { ...L.newEntry('2026-05-01'), id: 'e2', time: '15:00', lat: 37.57, lng: 126.98 },
    { ...L.newEntry('2026-05-01'), id: 'e1', time: '09:00', lat: 37.55, lng: 126.99 }
  ];
  assert.deepEqual(L.tripRoutes(t)[0].stops.map((s) => s.refs[0]), ['e:e1', 'e:e2']);
});
test('거리 계산: 위도 1도 ≈ 111.2km', () => {
  assert.ok(Math.abs(L.haversine({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }) - 111195) < 5);
});

console.log('경비 (사용자가 적은 환율로 원 환산)');
test('간사이 예시: 합계 865,825원 = 원화 348,000 + 엔 54,880×9.12 항목별 반올림 500,506 + 12.5달러×1385.5 = 17,319', () => {
  const t = S.kansai(), x = L.expenseTotals(t.expenses, t.rates, t.home);
  assert.equal(x.total, 865825);
  assert.equal(x.count, 12);
  assert.equal(x.byCurrency.JPY, 54880);
  assert.deepEqual(x.missing, []);
});
test('날짜별·분류별 합계가 전체 합계와 같다', () => {
  const t = S.kansai(), x = L.expenseTotals(t.expenses, t.rates, t.home);
  assert.deepEqual(x.byDay, { '2026-04-03': 740616, '2026-04-04': 49704, '2026-04-05': 49066, '2026-04-06': 26439 });
  assert.deepEqual(x.byCategory, { '교통': 366514, '숙박': 350208, '식비': 64296, '관광·입장': 28272, '쇼핑': 56535 });
  const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
  assert.equal(sum(x.byDay), x.total); assert.equal(sum(x.byCategory), x.total);
});
test('항목마다 반올림: 580엔 × 9.12 = 5,289.6 → 5,290원, 12.5 × 1385.5 = 17,318.75 → 17,319원', () => {
  assert.deepEqual(L.toHome({ amount: 580, currency: 'JPY' }, { JPY: 9.12 }, 'KRW'), { value: 5290, ok: true });
  assert.deepEqual(L.toHome({ amount: 12.5, currency: 'USD' }, { USD: 1385.5 }, 'KRW'), { value: 17319, ok: true });
  assert.deepEqual(L.toHome({ amount: 0.1, currency: 'USD' }, { USD: 3 }, 'KRW'), { value: 0, ok: true });   // 0.3원
});
test('환율이 없는 통화는 합계에서 빼고 목록으로 알려 준다', () => {
  const t = S.kansai(), x = L.expenseTotals(t.expenses, { JPY: 9.12 }, 'KRW');
  assert.equal(x.total, 865825 - 17319);
  assert.deepEqual(x.missing, ['USD']);
  assert.equal(x.excluded, 1);
});
test('금액·환율 입력 읽기와 경비 검사', () => {
  assert.equal(L.parseAmount('1,500'), 1500); assert.equal(L.parseAmount('12.50'), 12.5); assert.equal(L.parseAmount('₩3,000'), 3000);
  assert.ok(Number.isNaN(L.parseAmount('12.345'))); assert.ok(Number.isNaN(L.parseAmount('-3'))); assert.ok(Number.isNaN(L.parseAmount('')));
  assert.equal(L.comma(12.5), '12.50'); assert.equal(L.comma(1234567), '1,234,567'); assert.equal(L.comma(1500.05), '1,500.05');
  assert.equal(L.parseRate('9.12'), 9.12); assert.ok(Number.isNaN(L.parseRate('0')));
  assert.ok(L.ok(L.validExpense({ amount: 1, currency: 'JPY', category: '식비', date: '2026-04-03' })));
  assert.ok(L.validExpense({ amount: 0, currency: 'JPY', category: '식비', date: '2026-04-03' }).amount);
  assert.ok(L.validExpense({ amount: 1, currency: 'jp', category: '밥', date: '' }).currency);
});

console.log('나라 판정 · 지도');
test('좌표 → 나라: 오사카·교토=일본, 서울=대한민국, 제주(해안선 밖)=대한민국, 싱가포르(작은 나라), 다낭=베트남, 망망대해=없음', () => {
  assert.equal(L.countryAt(34.6687, 135.5013, W).ko, '일본');
  assert.equal(L.countryAt(35.0037, 135.7788, W).ko, '일본');
  assert.equal(L.countryAt(37.56, 126.97, W).ko, '대한민국');
  assert.equal(L.countryAt(33.5, 126.53, W).ko, '대한민국');
  assert.equal(L.countryAt(1.29, 103.85, W).ko, '싱가포르');
  assert.equal(L.countryAt(16.05, 108.2, W).ko, '베트남');
  assert.equal(L.countryAt(0, -150, W), null);
  assert.equal(L.countryAt(66, -175, W).ko, '러시아', '날짜변경선 너머 추코트카');
});
test('방문 나라·도시 모으기 (여러 여행)', () => {
  const v = L.visited([S.kansai(), ...S.past()]);
  assert.deepEqual(v.countryIds, ['250', '336', '380', '392', '704']);
  assert.ok(v.cities.includes('교토') && v.cities.includes('호이안'));
});
test('투영: 범위 안 점은 화면 안, 가로·세로 축척 비율 = cos(가운데 위도)', () => {
  const pts = S.kansai().photos.filter(L.hasPos);
  const p = L.projection(L.boundsOf(pts), 800);
  for (const q of pts) { const x = p.x(q.lng), y = p.y(q.lat); assert.ok(x > 0 && x < 800 && y > 0 && y < p.H, q.name); }
  const dx = p.x(136) - p.x(135), dy = p.y(34) - p.y(35);
  assert.ok(Math.abs(dx / dy - Math.cos(34.72 * Math.PI / 180)) < 0.01);
  const japan = W.countries.find((c) => c.id === '392');
  assert.ok(L.countryPath(japan, p).startsWith('M'));
  const brazil = W.countries.find((c) => c.id === '076');
  assert.equal(L.countryPath(brazil, p), '', '보이는 범위 밖 나라는 그리지 않는다');
});

console.log('AI 도우미 · 백업');
test('일기 프롬프트: 날짜·일째·장소·사진 시간대·키워드·지어내지 말라는 조건이 들어간다', () => {
  const t = S.kansai(), e = t.entries[2];
  const txt = L.diaryPrompt({ trip: t, entry: e, photos: L.photosOf(t, e.id), otherPlaces: ['후시미 이나리'], meters: 4300, tone: 'blog', length: 'm' });
  for (const s of ['2026-04-05', '3일째', '교토', '사진] 3장', '08:50 ~ 16:30', '이른 아침 이나리', '지어내지 말고', '약 4.3km']) assert.ok(txt.includes(s), s);
  assert.ok(!/sk-/.test(txt));
});
test('답에서 제목 줄 떼기', () => {
  assert.deepEqual(L.splitTitle('제목: 붉은 문\n\n본문 첫 줄'), { title: '붉은 문', body: '본문 첫 줄' });
  assert.deepEqual(L.splitTitle('본문만'), { title: '', body: '본문만' });
});
test('여행 리포트 프롬프트: 기간·나라·경비 합계·날짜별 일기', () => {
  const txt = L.reportPrompt(S.kansai(), W);
  for (const s of ['3박 4일', '일본', '865,825원', '2026-04-03 · 오사카 · 도톤보리', '사진 10장']) assert.ok(txt.includes(s), s);
});
test('백업 검사: 예시는 통과, 판 번호·경비 형식이 틀리면 알려 준다', () => {
  const db = { schemaVersion: 1, trips: [S.kansai(), ...S.past()] };
  assert.deepEqual(L.checkDb(db), []);
  assert.ok(L.checkDb({ schemaVersion: 9, trips: [] })[0].includes('schemaVersion'));
  const bad = L.clone(db); bad.trips[0].expenses[0].currency = 'won';
  assert.ok(L.checkDb(bad).some((m) => m.includes('경비 1번')));
  const bad2 = L.clone(db); bad2.trips[0].end = '2026-04-01';
  assert.ok(L.checkDb(bad2).some((m) => m.includes('시작일보다 빠릅니다')));
});

console.log(`\n${passed}개 통과${process.exitCode ? ' — 실패 있음' : ''}`);
