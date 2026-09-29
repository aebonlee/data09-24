/*
 * JOURNAL — 예시 여행 (전부 가상). 화면의 「예시 여행 불러오기」와 테스트가 같은 것을 씁니다.
 *  - 사진 10장은 samples/ 의 합성 이미지이고, 찍은 시각·위치는 그 파일의 EXIF 와 같습니다(테스트가 대조).
 *  - 환율은 계산을 보여 주기 위한 가정값입니다. 실제 환율이 아닙니다.
 *  - 사람 이름·연락처는 없습니다.
 */
(function (root) {
  'use strict';
  function photo(n, file, takenAt, lat, lng, offset, entryId, size) {
    return { id: 'sp-' + n, name: file, size: size, src: 'samples/' + file, takenAt: takenAt, fileTime: '',
      dateSource: takenAt ? 'exif' : 'none', lat: lat, lng: lng, offset: offset || '', entryId: entryId || '' };
  }
  function x(n, date, amount, currency, category, memo) {
    return { id: 'sx-' + n, date: date, amount: amount, currency: currency, category: category, memo: memo };
  }

  function kansai() {
    return {
      id: 'sample-kansai', sample: true,
      title: '간사이 3박 4일 (예시)', start: '2026-04-03', end: '2026-04-06',
      countries: ['392'], cities: ['오사카', '교토', '나라'],
      memo: '혼자 떠난 봄 여행. 가상 예시입니다.',
      home: 'KRW', rates: { JPY: 9.12, USD: 1385.5 },
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
      ]
    };
  }
  // 방문 지도를 보여 주기 위한 지난 여행 두 개(사진 없이 나라·도시만)
  function past() {
    return [
      { id: 'sample-danang', sample: true, title: '다낭 가족여행 (예시)', start: '2025-12-20', end: '2025-12-24',
        countries: ['704'], cities: ['다낭', '호이안'], memo: '', home: 'KRW', rates: { VND: 0.055 }, report: '',
        entries: [], photos: [],
        expenses: [x(21, '2025-12-21', 450000, 'VND', '식비', '해산물 저녁'), x(22, '2025-12-22', 1200000, 'VND', '관광·입장', '바나힐')] },
      { id: 'sample-europe', sample: true, title: '파리·로마 (예시)', start: '2024-05-10', end: '2024-05-18',
        countries: ['250', '380', '336'], cities: ['파리', '로마', '바티칸'], memo: '', home: 'KRW', rates: {}, report: '',
        entries: [], photos: [], expenses: [] }
    ];
  }

  var API = { kansai: kansai, past: past };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.JSamples = API;
})(typeof window !== 'undefined' ? window : this);
