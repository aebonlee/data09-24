/*
 * JOURNAL — 예시 여행 (전부 가상). 화면의 「예시 여행 불러오기」와 테스트가 같은 것을 씁니다.
 *  - 사진 10장은 samples/ 의 합성 이미지이고, 찍은 시각·위치는 그 파일의 EXIF 와 같습니다(테스트가 대조).
 *  - 환율은 계산을 보여 주기 위한 가정값입니다. 실제 환율이 아닙니다.
 *  - 사람 이름·연락처는 없습니다(정산 예시의 「가족A·가족B」는 가명).
 */
(function (root) {
  'use strict';
  function photo(n, file, takenAt, lat, lng, offset, entryId, size) {
    return { id: 'sp-' + n, name: file, size: size, src: 'samples/' + file, takenAt: takenAt, fileTime: '',
      dateSource: takenAt ? 'exif' : 'none', lat: lat, lng: lng, offset: offset || '', entryId: entryId || '' };
  }
  function plan(n, type, title, date, start, endDate, end, place, lat, lng, booking, memo, expenseId, done) {
    return { id: 'spl-' + n, type: type, title: title, date: date, start: start, endDate: endDate, end: end, place: place,
      lat: lat, lng: lng, booking: booking, memo: memo, expenseId: expenseId, done: !!done };
  }
  function x(n, date, amount, currency, category, memo, paidBy, split) {
    var o = { id: 'sx-' + n, date: date, amount: amount, currency: currency, category: category, memo: memo };
    if (paidBy) o.paidBy = paidBy;
    if (split) o.split = split;
    return o;
  }

  function kansai() {
    return {
      id: 'sample-kansai', sample: true,
      title: '간사이 3박 4일 (예시)', start: '2026-04-03', end: '2026-04-06',
      countries: ['392'], cities: ['오사카', '교토', '나라'],
      memo: '혼자 떠난 봄 여행. 가상 예시입니다.',
      home: 'KRW', rates: { JPY: 9.12, USD: 1385.5, EUR: 1480 }, members: [],
      report: '',
      entries: [
        { id: 'se-1', date: '2026-04-03', time: '11:20', place: '오사카 · 도톤보리', lat: 34.4347, lng: 135.244,
          keywords: '공항 도착, 열차로 난바, 강가 네온, 타코야키',
          text: '제목: 네온 아래 첫날\n\n공항에 내려 열차를 타고 난바로 들어왔다. 짐을 풀고 저녁에 도톤보리 강가를 걸었다.\n간판 불빛이 물에 비쳐 흔들리는 게 오래 기억날 것 같다.' },
        { id: 'se-2', date: '2026-04-04', time: '09:31', place: '오사카성 · 우메다', lat: 34.6873, lng: 135.5262,
          keywords: '오사카성 공원 산책, 벚꽃 조금 남음, 해질녘 전망대', text: '' },
        { id: 'se-3', date: '2026-04-05', time: '08:50', place: '교토', lat: 34.9671, lng: 135.7727,
          keywords: '이른 아침 이나리 붉은 문, 기요미즈데라 언덕, 기온 골목 저녁', text: '' },
        { id: 'se-4', date: '2026-04-06', time: '10:02', place: '나라 공원', lat: 34.6851, lng: 135.843,
          keywords: '사슴 과자, 오후 열차로 공항', text: '' }
      ],
      photos: [
        photo(1, 'kansai_01_airport.jpg', '2026-04-03T11:20:05', 34.4347, 135.244, '+09:00', 'se-1', 10460),
        photo(2, 'kansai_02_dotonbori.jpg', '2026-04-03T18:42:10', 34.6687, 135.5013, '+09:00', 'se-1', 12297),
        photo(3, 'kansai_03_castle.jpg', '2026-04-04T09:31:00', 34.6873, 135.5262, '', 'se-2', 9465),
        photo(4, 'kansai_04_umeda.jpg', '2026-04-04T17:55:30', 34.7053, 135.4906, '+09:00', 'se-2', 10622),
        photo(5, 'kansai_05_inari.jpg', '2026-04-05T08:50:12', 34.9671, 135.7727, '+09:00', 'se-3', 13216),
        photo(6, 'kansai_06_kiyomizu.jpg', '2026-04-05T13:10:44', 34.9949, 135.785, '+09:00', 'se-3', 11034),
        photo(7, 'kansai_07_gion.jpg', '2026-04-05T16:30:00', 35.0037, 135.7788, '', 'se-3', 11730),
        photo(8, 'kansai_08_nara.jpg', '2026-04-06T10:02:18', 34.6851, 135.843, '+09:00', 'se-4', 11358),
        photo(9, 'kansai_09_nogps.jpg', '2026-04-06T14:05:00', null, null, '', 'se-4', 12378),
        photo(10, 'kansai_10_noexif.jpg', '', null, null, '', '', 10682)
      ],
      expenses: [
        x(1, '2026-04-03', 348000, 'KRW', '교통', '왕복 항공권'),
        x(2, '2026-04-03', 1450, 'JPY', '교통', '공항 → 난바 열차'),
        x(3, '2026-04-03', 38400, 'JPY', '숙박', '호텔 3박'),
        x(4, '2026-04-03', 3200, 'JPY', '식비', '저녁'),
        x(5, '2026-04-04', 600, 'JPY', '관광·입장', '천수각'),
        x(6, '2026-04-04', 2000, 'JPY', '관광·입장', '전망대'),
        x(7, '2026-04-04', 2850, 'JPY', '식비', '점심·저녁'),
        x(8, '2026-04-05', 580, 'JPY', '교통', '교토 열차'),
        x(9, '2026-04-05', 500, 'JPY', '관광·입장', '기요미즈데라'),
        x(10, '2026-04-05', 4300, 'JPY', '쇼핑', '기념품'),
        x(11, '2026-04-06', 1000, 'JPY', '식비', '점심'),
        x(12, '2026-04-06', 12.5, 'USD', '쇼핑', '공항 면세점')
      ],
      // 여행 일정(계획) — 예약 번호는 모두 가짜(EX-…). 구로몬 시장은 계획만 하고 사진이 없는 곳(지도에서 계획과 실제가 갈리는 예)
      plans: [
        plan(1, '항공', '인천 → 간사이 (가는 편)', '2026-04-03', '09:00', '', '11:05', '간사이 국제공항', 34.4347, 135.244, 'EX-FLT-0403', '모바일 탑승권, 수하물 15kg', 'sx-1', true),
        plan(2, '숙소', '난바 호텔 3박', '2026-04-03', '15:00', '2026-04-06', '11:00', '오사카 · 난바', 34.6655, 135.501, 'EX-HTL-5521', '체크인 15시 · 체크아웃 11시', 'sx-3', true),
        plan(3, '맛집', '도톤보리 타코야키', '2026-04-03', '19:00', '', '20:00', '오사카 · 도톤보리', 34.6687, 135.5013, '', '', '', true),
        plan(4, '관광', '오사카성 천수각', '2026-04-04', '09:30', '', '11:30', '오사카성 공원', 34.6873, 135.5262, '', '', 'sx-5', true),
        plan(5, '맛집', '구로몬 시장 점심', '2026-04-04', '12:30', '', '14:00', '오사카 · 구로몬 시장', 34.6656, 135.5067, '', '비 오면 우메다 지하상가로', '', false),
        plan(6, '관광', '우메다 공중정원 전망대', '2026-04-04', '17:30', '', '19:00', '오사카 · 우메다', 34.7053, 135.4906, 'EX-TKT-0404', '해질녘 입장', 'sx-6', true),
        plan(7, '투어', '후시미 이나리 아침 걷기', '2026-04-05', '08:30', '', '10:00', '교토 · 후시미 이나리', 34.9671, 135.7727, '', '사람 적은 아침에', '', true),
        plan(8, '관광', '기요미즈데라', '2026-04-05', '13:00', '', '14:30', '교토 · 기요미즈데라', 34.9949, 135.785, '', '', 'sx-9', true),
        plan(9, '맛집', '기온 골목 저녁', '2026-04-05', '18:00', '', '19:30', '교토 · 기온', 35.0037, 135.7788, 'EX-RST-7788', '2명 예약', '', false),
        plan(10, '관광', '나라 공원 사슴', '2026-04-06', '10:00', '', '12:00', '나라 공원', 34.6851, 135.843, '', '', '', true),
        plan(11, '항공', '간사이 → 인천 (오는 편)', '2026-04-06', '16:40', '', '18:45', '간사이 국제공항', 34.4347, 135.244, 'EX-FLT-0403', '출발 2시간 전 도착', 'sx-1', false)
      ]
    };
  }
  // 방문 지도를 보여 주기 위한 지난 여행 두 개(사진 없이 나라·도시만)
  function past() {
    return [
      // 정산 예시: 세 사람이 나눠 낸 여행 (가족A·가족B 는 가명)
      { id: 'sample-danang', sample: true, title: '다낭 가족여행 (예시)', start: '2025-12-20', end: '2025-12-24',
        countries: ['704'], cities: ['다낭', '호이안'], memo: '세 사람이 나눠 낸 여행 — 「정산」 화면 예시', home: 'KRW',
        rates: { VND: 0.055, USD: 1385.5, JPY: 9.12, EUR: 1480 }, report: '',
        members: [{ id: 'm-me', name: '나' }, { id: 'm-a', name: '가족A' }, { id: 'm-b', name: '가족B' }],
        entries: [], photos: [], plans: [],
        expenses: [
          x(21, '2025-12-21', 450000, 'VND', '식비', '해산물 저녁', 'm-me'),
          x(22, '2025-12-22', 1200000, 'VND', '관광·입장', '바나힐', 'm-a'),
          x(23, '2025-12-20', 1500000, 'KRW', '숙박', '리조트 4박', 'm-b'),
          x(24, '2025-12-23', 320000, 'VND', '식비', '카페 (둘이서)', 'm-me', ['m-me', 'm-a'])
        ] },
      { id: 'sample-europe', sample: true, title: '파리·로마 (예시)', start: '2024-05-10', end: '2024-05-18',
        countries: ['250', '380', '336'], cities: ['파리', '로마', '바티칸'], memo: '', home: 'KRW', rates: {}, members: [], report: '',
        entries: [], photos: [], expenses: [], plans: [] }
    ];
  }

  var API = { kansai: kansai, past: past };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.JSamples = API;
})(typeof window !== 'undefined' ? window : this);
