// 실행: node test/logic.test.mjs   (의존성 없음)
// EXIF 읽기(합성 JPEG 10장 · HEIC 3장) · 일자 묶기 · 동선 순서 · 경비 합계(환율 환산) · 나라 판정 · 도시 이름 · 표시 통화 · 정산 · 지도 API 답 읽기 · 프롬프트 · 백업 검사
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const E = require('../js/exif.js');
const L = require('../js/logic.js');
const S = require('../js/sample-data.js');
const W = require('../vendor/world-110m.js');
const C = require('../vendor/cities15000.js');
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
test('사진으로 일자별 기록 만들기 — 도시 자료가 있으면 장소 칸에 그날 들른 도시들(들른 순서)', () => {
  const t = L.newTrip('테스트');
  t.photos = S.kansai().photos.map((p) => ({ ...p, entryId: '' }));
  assert.equal(L.entriesFromPhotos(t, W, C), 4);
  assert.deepEqual(t.entries.map((e) => e.place), ['Izumisano · 오사카', '오사카', '교토', '나라']);
  const t2 = L.newTrip('api'); t2.photos = S.kansai().photos.map((p) => ({ ...p, entryId: '' }));
  t2.photos[1].place = '도톤보리';                                   // 외부 지도 API 로 받아 둔 이름이 먼저
  L.entriesFromPhotos(t2, W, C);
  assert.equal(t2.entries[0].place, 'Izumisano · 도톤보리');
});
test('사진으로 일자별 기록 만들기 — 4편, 도시 자료가 없으면 장소는 사진 위치의 나라, 다시 눌러도 늘지 않는다', () => {
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

console.log('아이폰 HEIC (samples/heic — macOS sips 로 JPEG 예시를 HEIC 로 바꾼 것, 애플 인코더가 쓴 실제 HEIC 구조)');
const heic = (f) => readFileSync(new URL('../samples/heic/' + f, import.meta.url));
test('HEIC 3장: 찍은 시각·시간대·위경도가 같은 JPEG 예시와 같다, GPS 없는 사진은 위치 없음', () => {
  for (const f of ['kansai_02_dotonbori', 'kansai_07_gion', 'kansai_09_nogps']) {
    const h = E.parse(heic(f + '.heic')), j = E.parse(jpg(f + '.jpg'));
    assert.equal(h.format, 'heic'); assert.equal(j.format, 'jpeg');
    assert.equal(h.hasExif, true, f);
    for (const k of ['takenAt', 'offset', 'lat', 'lng']) assert.equal(h[k], j[k], f + ' ' + k);
  }
  assert.equal(E.parse(heic('kansai_09_nogps.heic')).lat, null);
});
test('HEIC 가 아니면 null(mp4 ftyp·PNG), 잘린 HEIC 는 예외 없이 빈 값', () => {
  const mp4 = new Uint8Array([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 0x6d, 0x70, 0x34, 0x31, 0, 0, 0, 8]);
  assert.equal(E.isHeif(mp4), false); assert.equal(E.parse(mp4), null);
  const full = heic('kansai_02_dotonbori.heic');
  for (const n of [40, 200, 400, full.length - 10]) {
    const r = E.parse(full.subarray(0, n));
    assert.ok(r && r.format === 'heic', '잘린 길이 ' + n);
    if (n < 400) assert.equal(r.lat, null);
  }
});
// 판 2 iloc(idat 안 위치 · 조각 두 개 · 4바이트 항목 번호) + 판 3 infe(4바이트 항목 번호)로 직접 만든 HEIF — 애플 파일과 다른 갈래를 확인
function box(type, ...parts) {
  const body = Buffer.concat(parts.map((p) => Buffer.from(p)));
  const h = Buffer.alloc(8); h.writeUInt32BE(8 + body.length); h.write(type, 4, 'latin1');
  return Buffer.concat([h, body]);
}
function u(n, v) { const b = Buffer.alloc(n); if (n === 2) b.writeUInt16BE(v); else b.writeUInt32BE(v); return b; }
function makeHeif(tiff) {
  const payload = Buffer.concat([u(4, 6), Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const cut = 17;                                                   // 두 조각으로 나눈다
  const idat = box('idat', payload);
  const infe = (id, type) => box('infe', [3, 0, 0, 0], u(4, id), u(2, 0), Buffer.from(type, 'latin1'), [0]);
  const iinf = box('iinf', [0, 0, 0, 0], u(2, 2), infe(1, 'hvc1'), infe(70000, 'Exif'));
  // iloc 판 2: offset 4바이트, length 4바이트, base 0, index 0, 항목 1개(번호 70000 은 2바이트에 못 담아 4바이트 판 2)
  const iloc = box('iloc', [2, 0, 0, 0], [0x44, 0x00], u(4, 1),
    u(4, 70000), u(2, 1), u(2, 0), u(2, 2), u(4, 0), u(4, cut), u(4, cut), u(4, payload.length - cut));
  const meta = box('meta', [0, 0, 0, 0], box('hdlr', [0, 0, 0, 0], u(4, 0), Buffer.from('pict', 'latin1'), Buffer.alloc(13)), iinf, iloc, idat);
  const ftyp = box('ftyp', Buffer.from('heic', 'latin1'), u(4, 0), Buffer.from('mif1heic', 'latin1'));
  return new Uint8Array(Buffer.concat([ftyp, meta]));
}
test('직접 만든 HEIF(iloc 판 2 · idat 안 위치 · 두 조각 · infe 판 3)도 읽는다', () => {
  const j = jpg('kansai_05_inari.jpg'), seg = E.findExifSegment(j);
  const h = E.parse(makeHeif(Buffer.from(j.subarray(seg.start, seg.end))));
  const r = E.parse(j);
  assert.equal(h.format, 'heic');
  assert.equal(h.takenAt, r.takenAt); assert.equal(h.lat, r.lat); assert.equal(h.lng, r.lng);
});

console.log('도시 이름 (GeoNames cities15000 — 오프라인)');
test('좌표 → 가까운 도시: 오사카·교토(기요미즈데라·기온·이나리)·나라·서울·제주·다낭·파리, 망망대해는 없음', () => {
  const at = (a, b) => (L.cityAt(a, b, C) || {}).name;
  assert.equal(at(34.6687, 135.5013), '오사카');       // 도톤보리
  assert.equal(at(34.7053, 135.4906), '오사카');       // 우메다
  assert.equal(at(34.9671, 135.7727), '교토');         // 후시미 이나리 — 큰 도시 가장자리
  assert.equal(at(34.9949, 135.785), '교토');
  assert.equal(at(35.0037, 135.7788), '교토');
  assert.equal(at(34.6851, 135.843), '나라');
  assert.equal(at(37.5663, 126.9779), '서울');
  assert.equal(at(33.5, 126.53), '제주');
  assert.equal(at(16.05, 108.2), '다낭');
  assert.equal(at(48.8584, 2.2945), '파리');
  assert.equal(L.cityAt(0, -150, C), null);
  assert.equal(L.cityAt(34.6687, 135.5013, null), null, '자료가 아직 안 왔으면 없음');
  assert.ok(C.count > 30000 && /GeoNames/.test(C.source));
});
test('사진 위치의 도시를 여행 도시 목록에 더한다(찍은 순서, 이미 있으면 건너뜀)', () => {
  const t = S.kansai(); t.cities = ['오사카'];
  assert.deepEqual(L.addCitiesFromPhotos(t, C), ['Izumisano', '교토', '나라']);
  assert.deepEqual(L.addCitiesFromPhotos(t, C), []);
  assert.equal(L.placeName({ lat: 34.6687, lng: 135.5013, place: '도톤보리' }, C), '도톤보리');
  assert.equal(L.placeName({ lat: null, lng: null }, C), '');
});

console.log('표시 통화 (원 기준 → USD·JPY·EUR, 사용자가 적은 환율)');
test('간사이 합계 865,825원 ≈ $624.92 · ¥94,937 · €585.02 (1 USD = 1385.5원 · 1 JPY = 9.12원 · 1 EUR = 1480원)', () => {
  const t = S.kansai(), won = L.expenseTotals(t.expenses, t.rates, t.home).total;
  assert.deepEqual(L.equivalents(won, t.rates).map((e) => e.text), ['$624.92', '¥94,937', '€585.02']);
  assert.equal(L.fromHome(won, 'USD', t.rates), 624.92);
  assert.equal(L.money(won, 'KRW', t.rates), '₩865,825');
  assert.equal(L.money(-1500, 'KRW', {}), '-₩1,500');
  assert.equal(L.money(1000, 'THB', { THB: 40 }), '25.00 THB');
});
test('환율이 없는 표시 통화는 null · 빈 글자(지어내지 않는다)', () => {
  assert.equal(L.fromHome(10000, 'EUR', { USD: 1385.5 }), null);
  assert.equal(L.money(10000, 'EUR', {}), '');
  assert.deepEqual(L.equivalents(10000, { USD: 1000 }).map((e) => e.value), [10, null, null]);
});

console.log('정산 (낸 사람 · 나눌 사람 · 최소 송금)');
test('원 단위로 나누기: 나머지는 앞사람부터 1원씩, 합은 정확히 같다', () => {
  assert.deepEqual(L.splitWon(10000, ['a', 'b', 'c']), { a: 3334, b: 3333, c: 3333 });
  assert.deepEqual(L.splitWon(10001, ['a', 'b', 'c']), { a: 3334, b: 3334, c: 3333 });
  assert.deepEqual(L.splitWon(-5, ['a', 'b']), { a: -3, b: -2 });
  for (let n = 1; n <= 7; n++) for (const v of [1, 99, 17319, 865825]) {
    const ids = Array.from({ length: n }, (_, i) => 'p' + i);
    assert.equal(Object.values(L.splitWon(v, ids)).reduce((a, b) => a + b, 0), v);
  }
});
test('다낭 예시(세 사람): 사람별 낸 돈·부담·차액과 송금 2번', () => {
  const st = L.settle(S.past()[0]);
  assert.deepEqual(st.paid, { 'm-me': 42350, 'm-a': 66000, 'm-b': 1500000 });
  assert.deepEqual(st.owed, { 'm-me': 539050, 'm-a': 539050, 'm-b': 530250 });
  assert.deepEqual(st.net, { 'm-me': -496700, 'm-a': -473050, 'm-b': 969750 });
  assert.deepEqual(st.transfers, [{ from: 'm-me', to: 'm-b', won: 496700 }, { from: 'm-a', to: 'm-b', won: 473050 }]);
  assert.equal(st.total, 1608350);
  const cafe = st.items.find((i) => i.id === 'sx-24');
  assert.deepEqual(cafe.sharers, ['m-me', 'm-a'], '둘이서 나눈 카페');
  for (const it of st.items) assert.equal(Object.values(it.shares).reduce((a, b) => a + b, 0), it.won, it.id);
});
test('혼자 간 여행은 「나」 한 사람 — 주고받을 돈 없음, 환율 없는 지출은 정산에서 빠진다', () => {
  const st = L.settle(S.kansai());
  assert.equal(st.members.length, 1); assert.deepEqual(st.transfers, []);
  assert.equal(st.net['m-me'], 0); assert.equal(st.total, 865825);
  const t = S.past()[0]; delete t.rates.VND;
  const st2 = L.settle(t);
  assert.deepEqual(st2.excluded, ['sx-21', 'sx-22', 'sx-24']); assert.equal(st2.total, 1500000);
});
test('없는 사람이 낸 사람·나눌 사람으로 남아 있으면 첫 사람 · 모두로 되돌린다', () => {
  const ms = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  assert.equal(L.payerOf({ paidBy: 'z' }, ms), 'a');
  assert.deepEqual(L.sharersOf({ split: ['z'] }, ms), ['a', 'b']);
  assert.deepEqual(L.sharersOf({ split: ['b', 'z'] }, ms), ['b']);
});
test('최소 송금: 앞에서부터 이어 주는 방법이면 4번인 경우를 3번에 끝낸다', () => {
  const net = { p0: 3000, p1: -2000, p2: 0, p3: -2000, p4: -3000, p5: 4000 };
  const tr = L.minTransfers(net);
  assert.equal(tr.length, 3);
  const bal = { ...net }; tr.forEach((x) => { bal[x.from] += x.won; bal[x.to] -= x.won; assert.ok(x.won > 0); });
  assert.ok(Object.values(bal).every((v) => v === 0));
  assert.equal(L.minTransfers({ a: 1, b: 1 }), null, '합이 0 이 아니면 null');
});
// 따로 만든 완전 탐색(백트래킹)으로 최소 횟수를 구해 대조한다
function bruteMin(vals) {
  const v = vals.filter((x) => x);
  function go(i) {
    while (i < v.length && v[i] === 0) i++;
    if (i === v.length) return 0;
    let best = Infinity;
    for (let j = i + 1; j < v.length; j++) if (v[i] * v[j] < 0) { v[j] += v[i]; best = Math.min(best, 1 + go(i + 1)); v[j] -= v[i]; }
    return best;
  }
  return go(0);
}
test('최소 송금: 무작위 300가지(2~7명)에서 완전 탐색과 횟수가 같고 모두 0 으로 끝난다', () => {
  let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let k = 0; k < 300; k++) {
    const n = 2 + Math.floor(rnd() * 6), v = [];
    for (let i = 0; i < n - 1; i++) v.push((Math.floor(rnd() * 11) - 5) * 1000);
    v.push(-v.reduce((a, b) => a + b, 0));
    const net = {}; v.forEach((x, i) => { net['p' + i] = x; });
    const tr = L.minTransfers(net), bal = { ...net };
    tr.forEach((x) => { bal[x.from] += x.won; bal[x.to] -= x.won; });
    assert.ok(Object.values(bal).every((x) => x === 0), JSON.stringify(net));
    assert.equal(tr.length, bruteMin(v), JSON.stringify(net));
  }
});

console.log('외부 지도 API (선택 — 요청 주소 만들기 · 답 읽기, 실제 호출은 하지 않음)');
test('요청 주소: Google 은 key·language=ko, 카카오는 x=경도·y=위도 + KakaoAK 머리글', () => {
  const g = L.geoRequest('google', 34.6687, 135.5013, 'AIzaTEST');
  assert.ok(g.url.startsWith('https://maps.googleapis.com/maps/api/geocode/json?latlng=34.668700,135.501300&language=ko&key=AIzaTEST'));
  const k = L.geoRequest('kakao', 37.5663, 126.9779, 'abc');
  assert.equal(k.url, 'https://dapi.kakao.com/v2/local/geo/coord2address.json?x=126.977900&y=37.566300');
  assert.equal(k.headers.Authorization, 'KakaoAK abc');
  assert.equal(L.geoRequest('none', 1, 2, 'k'), null);
});
test('답 읽기: Google 명소 이름 우선 · 없으면 도시+동네, 카카오 건물 이름 · 없으면 구+동, 오류는 error', () => {
  const g = {
    status: 'OK', results: [
      { formatted_address: '일본 〒542-0071 오사카부 오사카시 주오구 도톤보리 1', types: ['street_address'],
        address_components: [{ long_name: '1', types: ['premise_number'] }, { long_name: '도톤보리', types: ['sublocality_level_2', 'sublocality', 'political'] },
          { long_name: '주오구', types: ['sublocality_level_1', 'sublocality', 'political'] }, { long_name: '오사카시', types: ['locality', 'political'] }] },
      { formatted_address: '도톤보리 글리코 간판', types: ['tourist_attraction', 'point_of_interest', 'establishment'],
        address_components: [{ long_name: '글리코 간판', types: ['point_of_interest', 'establishment'] }] }]
  };
  assert.deepEqual(L.geoParse('google', g), { name: '글리코 간판', detail: '일본 〒542-0071 오사카부 오사카시 주오구 도톤보리 1' });
  g.results.pop();
  assert.equal(L.geoParse('google', g).name, '오사카시 주오구');
  assert.deepEqual(L.geoParse('google', { status: 'ZERO_RESULTS', results: [] }), { name: '', detail: '' });
  assert.ok(L.geoParse('google', { status: 'REQUEST_DENIED', error_message: 'The provided API key is invalid.' }).error.includes('REQUEST_DENIED'));
  const k = { documents: [{ road_address: { address_name: '서울 중구 세종대로 110', building_name: '서울특별시청' }, address: { region_2depth_name: '중구', region_3depth_name: '태평로1가' } }] };
  assert.equal(L.geoParse('kakao', k).name, '서울특별시청');
  k.documents[0].road_address = null;
  assert.equal(L.geoParse('kakao', k).name, '중구 태평로1가');
  assert.ok(L.geoParse('kakao', { errorType: 'AccessDeniedError', message: 'wrong appKey' }).error.includes('wrong appKey'));
  assert.ok(L.geoParse('google', null).error);
});

console.log('백업 (2026-09-30 칸)');
test('함께 간 사람·낸 사람·나눌 사람이 든 백업은 통과, 형식이 틀리면 알려 준다', () => {
  const db = { schemaVersion: 1, trips: [S.kansai(), ...S.past()] };
  assert.deepEqual(L.checkDb(db), []);
  const bad = L.clone(db); bad.trips[1].members = [{ id: 'm-me', name: ' ' }];
  assert.ok(L.checkDb(bad).some((m) => m.includes('members')));
  const bad2 = L.clone(db); bad2.trips[1].expenses[0].split = 'm-me';
  assert.ok(L.checkDb(bad2).some((m) => m.includes('나눌 사람')));
  const old = L.clone(db); old.trips.forEach((t) => { delete t.members; });   // 예전 백업(칸 없음)도 받는다
  assert.deepEqual(L.checkDb(old), []);
});

console.log(`\n${passed}개 통과${process.exitCode ? ' — 실패 있음' : ''}`);
