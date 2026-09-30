/*
 * JOURNAL — 순수 로직 모듈 (화면·저장소와 무관)
 * 브라우저에서는 window.JLogic, Node(테스트)에서는 module.exports 로 씁니다.
 * ES module 이 아닌 이유: index.html 을 로컬 파일(file://)로 열었을 때 브라우저가 module 스크립트를 막기 때문입니다.
 *
 *   날짜      'YYYY-MM-DD', 사진 시각 'YYYY-MM-DDTHH:MM:SS'(카메라의 현지 시각 그대로 — 시간대 변환 없음)
 *   일자 묶기 사진의 찍은 날짜(없으면 파일 날짜, 그것도 없으면 「날짜 없음」)로 하루씩 묶는다
 *   동선      하루 안에서 위치 있는 사진을 찍은 시각 순으로 잇고, 30m 안에서 연달아 찍은 곳은 한 점으로 본다
 *   경비      항목마다 「금액 × 사용자가 적은 환율」을 원 단위로 반올림한 뒤 더한다(합계를 나중에 반올림하지 않음)
 *   지도      정거원통도법(경도 × cos(가운데 위도)) — 여행 범위가 좁아 이 정도로 충분하다
 *   도시 이름 좌표 → GeoNames 1만 5천 명 이상 도시 중 「도시 반경을 뺀 거리」가 가장 가까운 곳(오프라인, 2026-09-30)
 *   표시 통화 원 합계를 USD·JPY·EUR 로 — 사용자가 적은 「1 X = ?원」 환율로 나눈다
 *   정산      항목마다 원 환산액을 나눌 사람 수로 원 단위로 나누고(나머지 1원씩은 앞사람부터), 사람별 낸 돈 − 부담액으로
 *             주고받을 금액을 정한 뒤, 송금 횟수가 가장 적은 방법을 찾는다(16명까지 정확히, 그 이상은 근사)
 */
(function (root) {
  'use strict';

  var SCHEMA_VERSION = 1;
  var LIMITS = { trips: 200, photosPerTrip: 2000, entriesPerTrip: 1000, expensesPerTrip: 2000, amountMax: 1e12, members: 20, plansPerTrip: 500 };
  var SAME_SPOT_M = 30;          // 이 거리 안에서 연달아 찍은 사진은 같은 곳
  var NEAR_COUNTRY_DEG = 1.0;    // 해안선이 거친(1:110m) 지도라 바닷가 좌표가 나라 밖으로 빠질 때 가까운 나라로 본다

  var EXPENSE_CATEGORIES = ['숙박', '교통', '식비', '관광·입장', '쇼핑', '기타'];
  var CURRENCIES = [
    ['KRW', '원'], ['JPY', '엔'], ['USD', '미국 달러'], ['EUR', '유로'], ['CNY', '위안'], ['TWD', '대만 달러'],
    ['HKD', '홍콩 달러'], ['VND', '동'], ['THB', '바트'], ['PHP', '페소'], ['SGD', '싱가포르 달러'], ['GBP', '파운드'],
    ['AUD', '호주 달러'], ['CAD', '캐나다 달러'], ['CHF', '스위스 프랑']
  ];
  var TONES = {
    blog: '블로그 글처럼 — 소제목 없이 문단 3~5개, 읽는 사람에게 말하듯 편안하게',
    diary: '담백한 일기 — 1인칭, 그날 느낀 점 위주, 과장 없이',
    short: '짧은 한 줄 기록 — 3~4문장, SNS 캡션처럼'
  };

  // 한국어 나라 이름 (Natural Earth 의 ISO 숫자 코드 기준). 없는 나라는 영어 이름을 그대로 씁니다.
  var COUNTRY_KO = {
    '410': '대한민국', '392': '일본', '156': '중국', '158': '대만', '704': '베트남', '764': '태국', '608': '필리핀',
    '360': '인도네시아', '458': '말레이시아', '116': '캄보디아', '418': '라오스', '104': '미얀마', '496': '몽골',
    '356': '인도', '524': '네팔', '144': '스리랑카', '050': '방글라데시', '586': '파키스탄', '408': '북한', '096': '브루나이',
    '840': '미국', '124': '캐나다', '484': '멕시코', '192': '쿠바', '076': '브라질', '032': '아르헨티나', '152': '칠레',
    '604': '페루', '170': '콜롬비아', '068': '볼리비아', '218': '에콰도르', '630': '푸에르토리코',
    '826': '영국', '250': '프랑스', '276': '독일', '380': '이탈리아', '724': '스페인', '620': '포르투갈', '756': '스위스',
    '040': '오스트리아', '203': '체코', '528': '네덜란드', '056': '벨기에', '442': '룩셈부르크', '300': '그리스',
    '792': '튀르키예', '348': '헝가리', '191': '크로아티아', '705': '슬로베니아', '616': '폴란드', '703': '슬로바키아',
    '208': '덴마크', '578': '노르웨이', '752': '스웨덴', '246': '핀란드', '352': '아이슬란드', '372': '아일랜드',
    '233': '에스토니아', '428': '라트비아', '440': '리투아니아', '642': '루마니아', '100': '불가리아', '688': '세르비아',
    '499': '몬테네그로', '070': '보스니아 헤르체고비나', '008': '알바니아', '807': '북마케도니아', '804': '우크라이나',
    '643': '러시아', '268': '조지아', '051': '아르메니아', '031': '아제르바이잔', '196': '키프로스',
    '398': '카자흐스탄', '860': '우즈베키스탄', '417': '키르기스스탄',
    '036': '호주', '554': '뉴질랜드', '242': '피지', '598': '파푸아뉴기니', '540': '뉴칼레도니아',
    '784': '아랍에미리트', '634': '카타르', '682': '사우디아라비아', '512': '오만', '400': '요르단', '376': '이스라엘',
    '818': '이집트', '504': '모로코', '788': '튀니지', '710': '남아프리카공화국', '404': '케냐', '834': '탄자니아',
    '231': '에티오피아', '450': '마다가스카르', '364': '이란'
  };
  // 1:110m 지도에 모양이 없는 작은 나라·지역 — 가운데 점과 반경(도)으로 먼저 판정한다
  var TINY = [
    { id: '702', ko: '싱가포르', en: 'Singapore', lat: 1.35, lng: 103.82, r: 0.3 },
    { id: '344', ko: '홍콩', en: 'Hong Kong', lat: 22.32, lng: 114.17, r: 0.25 },
    { id: '446', ko: '마카오', en: 'Macau', lat: 22.17, lng: 113.55, r: 0.08 },
    { id: '462', ko: '몰디브', en: 'Maldives', lat: 3.2, lng: 73.22, r: 1.2 },
    { id: '470', ko: '몰타', en: 'Malta', lat: 35.9, lng: 14.45, r: 0.25 },
    { id: '492', ko: '모나코', en: 'Monaco', lat: 43.74, lng: 7.42, r: 0.03 },
    { id: '336', ko: '바티칸', en: 'Vatican', lat: 41.903, lng: 12.453, r: 0.006 },
    { id: '316', ko: '괌', en: 'Guam', lat: 13.44, lng: 144.79, r: 0.35 },
    { id: '580', ko: '사이판(북마리아나)', en: 'Northern Mariana Is.', lat: 15.19, lng: 145.75, r: 0.35 },
    { id: '585', ko: '팔라우', en: 'Palau', lat: 7.5, lng: 134.58, r: 0.6 },
    { id: '048', ko: '바레인', en: 'Bahrain', lat: 26.07, lng: 50.55, r: 0.25 },
    { id: '480', ko: '모리셔스', en: 'Mauritius', lat: -20.25, lng: 57.55, r: 0.4 }
  ];

  // ------------------------------------------------------------------ 공통
  function uid(prefix) { return (prefix || 'x') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  // 정수는 그대로, 소수(외화 12.50 등)는 둘째 자리까지 — 반올림해 「13 USD」로 보이지 않게
  function comma(n) {
    var neg = n < 0, a = Math.abs(n), cents = Math.round(a * 100), int = Math.floor(cents / 100), frac = cents % 100;
    return (neg ? '-' : '') + String(int).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac ? '.' + (frac < 10 ? '0' : '') + frac : '');
  }
  function won(n) { return comma(n) + '원'; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  // ------------------------------------------------------------------ 날짜
  function isDate(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return false;
    var d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }
  function dayNum(s) { var p = s.split('-'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); }
  function fromDayNum(n) { var d = new Date(n * 86400000); return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()); }
  function addDays(s, k) { return fromDayNum(dayNum(s) + k); }
  function daysBetween(a, b) { return dayNum(b) - dayNum(a); }
  function dateOf(takenAt) { var s = String(takenAt || '').slice(0, 10); return isDate(s) ? s : ''; }
  function timeOf(takenAt) { var m = /T(\d{2}:\d{2})/.exec(String(takenAt || '')); return m ? m[1] : ''; }
  var WEEK = ['일', '월', '화', '수', '목', '금', '토'];
  function dateLabel(s) {
    if (!isDate(s)) return '날짜 없음';
    var p = s.split('-'), w = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay();
    return (+p[1]) + '월 ' + (+p[2]) + '일 (' + WEEK[w] + ')';
  }
  // 로컬 시각의 Date → 'YYYY-MM-DDTHH:MM:SS' (EXIF 없는 사진의 파일 날짜용)
  function localStamp(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + 'T' +
      pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  // 여행 기간 → 날짜 목록, 몇 박 며칠
  function tripDates(trip) {
    if (!isDate(trip.start) || !isDate(trip.end) || trip.end < trip.start) return [];
    var n = daysBetween(trip.start, trip.end), out = [];
    for (var i = 0; i <= n && i < 366; i++) out.push(addDays(trip.start, i));
    return out;
  }
  function nightsDays(trip) {
    var d = tripDates(trip).length;
    return d ? { nights: d - 1, days: d, label: (d - 1) + '박 ' + d + '일' } : { nights: 0, days: 0, label: '기간 미정' };
  }
  function dayNo(trip, date) {
    if (!isDate(trip.start) || !isDate(date)) return 0;
    var k = daysBetween(trip.start, date);
    return k >= 0 && (!isDate(trip.end) || date <= trip.end) ? k + 1 : 0;   // 0 = 여행 기간 밖
  }

  // ------------------------------------------------------------------ 사진 → 일자
  // 사진이 쓰는 시각: EXIF 가 있으면 그것, 없으면 파일 날짜(dateSource = 'file')
  function photoStamp(p) { return p.takenAt || p.fileTime || ''; }
  function photoDate(p) { return dateOf(photoStamp(p)); }

  function byTime(a, b) {
    var ta = photoStamp(a), tb = photoStamp(b);
    if (ta !== tb) return ta < tb ? -1 : 1;
    return String(a.name || '').localeCompare(String(b.name || ''));
  }

  // 사진 목록 → [{ date, photos(시각순) }] 날짜순, 날짜 없는 사진은 맨 뒤 date = ''
  function groupByDay(photos) {
    var map = {}, keys = [];
    (photos || []).forEach(function (p) {
      var d = photoDate(p);
      if (!map[d]) { map[d] = []; keys.push(d); }
      map[d].push(p);
    });
    keys.sort(function (a, b) { if (!a) return 1; if (!b) return -1; return a < b ? -1 : a > b ? 1 : 0; });
    return keys.map(function (d) { return { date: d, photos: map[d].slice().sort(byTime) }; });
  }

  // 사진들이 차지하는 날짜 범위 — 여행 기간이 비어 있을 때 채워 주기용
  function photoDateRange(photos) {
    var ds = (photos || []).map(photoDate).filter(Boolean).sort();
    return ds.length ? { start: ds[0], end: ds[ds.length - 1] } : null;
  }

  // 날짜를 사람이 확인해야 하는 사진 — 날짜가 없거나, 파일 날짜로 짐작했는데 여행 기간 밖인 사진
  // (메신저로 받은 사진은 파일 날짜가 「받은 날」이라 여행과 무관한 날짜가 되기 쉽다)
  function needsDate(trip, p) {
    var d = photoDate(p);
    if (!d) return true;
    return p.dateSource === 'file' && isDate(trip.start) && dayNo(trip, d) === 0;
  }

  // 같은 사진을 두 번 넣지 않도록 — 파일 이름·크기·찍은 시각이 같으면 같은 사진
  function photoKey(p) { return [p.name || '', p.size || 0, p.takenAt || ''].join('|'); }

  // ------------------------------------------------------------------ 거리·동선
  function haversine(a, b) {
    var R = 6371008.8, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function hasPos(p) { return p && typeof p.lat === 'number' && typeof p.lng === 'number' && isFinite(p.lat) && isFinite(p.lng); }

  // 하루치 점(사진 + 좌표를 적은 기록) → 시각순으로 이은 동선
  // 점: { lat, lng, at('YYYY-MM-DDTHH:MM:SS' 또는 ''), ref }  반환: { stops:[{lat,lng,at,refs[]}], meters }
  function routeOf(points) {
    var pts = (points || []).filter(hasPos).slice().sort(function (a, b) {
      var ta = a.at || '', tb = b.at || '';
      if (ta !== tb) { if (!ta) return 1; if (!tb) return -1; return ta < tb ? -1 : 1; }   // 시각 없는 점은 그날 끝
      return String(a.ref || '').localeCompare(String(b.ref || ''));
    });
    var stops = [], meters = 0;
    pts.forEach(function (p) {
      var last = stops[stops.length - 1];
      if (last && haversine(last, p) <= SAME_SPOT_M) { last.refs.push(p.ref); return; }
      if (last) meters += haversine(last, p);
      stops.push({ lat: p.lat, lng: p.lng, at: p.at || '', refs: [p.ref] });
    });
    return { stops: stops, meters: Math.round(meters) };
  }

  // 여행 → 날짜별 동선 [{ date, dayNo, stops, meters }] (위치 있는 점이 있는 날만)
  function tripRoutes(trip) {
    var byDate = {};
    function add(d, p) { if (!d) return; (byDate[d] = byDate[d] || []).push(p); }
    (trip.photos || []).forEach(function (p) {
      if (hasPos(p)) add(photoDate(p), { lat: p.lat, lng: p.lng, at: photoStamp(p), ref: 'p:' + p.id });
    });
    (trip.entries || []).forEach(function (e) {
      // 사진이 붙은 기록은 사진이 이미 점이 되므로, 좌표만 적고 사진이 없는 기록만 더한다
      var hasPhoto = (trip.photos || []).some(function (p) { return p.entryId === e.id && hasPos(p); });
      if (!hasPhoto && hasPos(e) && isDate(e.date)) add(e.date, { lat: e.lat, lng: e.lng, at: e.time ? e.date + 'T' + e.time + ':00' : '', ref: 'e:' + e.id });
    });
    return Object.keys(byDate).sort().map(function (d) {
      var r = routeOf(byDate[d]);
      return { date: d, dayNo: dayNo(trip, d), stops: r.stops, meters: r.meters };
    }).filter(function (r) { return r.stops.length; });
  }

  // ------------------------------------------------------------------ 나라 판정 (방문 국가 자동 표시)
  function inRing(lng, lat, ring) {        // ring = [x0,y0,x1,y1,…] (짝수 교차 규칙)
    var inside = false, n = ring.length;
    for (var i = 0, j = n - 2; i < n; j = i, i += 2) {
      var xi = ring[i], yi = ring[i + 1], xj = ring[j], yj = ring[j + 1];
      if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function inPolys(lng, lat, polys) {
    for (var k = 0; k < polys.length; k++) {
      var rings = polys[k];
      if (!inRing(lng, lat, rings[0])) continue;
      var hole = false;
      for (var h = 1; h < rings.length; h++) if (inRing(lng, lat, rings[h])) { hole = true; break; }
      if (!hole) return true;
    }
    return false;
  }
  function segDist2(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, t = dx || dy ? ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy) : 0;
    t = Math.max(0, Math.min(1, t));
    var x = ax + t * dx - px, y = ay + t * dy - py;
    return x * x + y * y;
  }
  // 좌표 → 나라 { id, ko, en, how('tiny'|'inside'|'near') } 또는 null
  function countryAt(lat, lng, world) {
    if (!isFinite(lat) || !isFinite(lng)) return null;
    var i;
    for (i = 0; i < TINY.length; i++) {
      var t = TINY[i];
      if (Math.abs(lat - t.lat) <= t.r && Math.abs(lng - t.lng) <= t.r) return { id: t.id, ko: t.ko, en: t.en, how: 'tiny' };
    }
    var cs = (world && world.countries) || [], best = null, bestD = NEAR_COUNTRY_DEG * NEAR_COUNTRY_DEG;
    for (i = 0; i < cs.length; i++) {
      var c = cs[i], b = c.bbox;
      // 날짜변경선을 넘겨 이어 붙인 나라(경도 > 180)를 위해 경도를 한 바퀴 돌려서도 본다
      var lngs = [lng, lng + 360];
      for (var q = 0; q < lngs.length; q++) {
        var x = lngs[q];
        if (x < b[0] - NEAR_COUNTRY_DEG || x > b[2] + NEAR_COUNTRY_DEG || lat < b[1] - NEAR_COUNTRY_DEG || lat > b[3] + NEAR_COUNTRY_DEG) continue;
        if (inPolys(x, lat, c.polys)) return { id: c.id, ko: countryName(c.id, c.en), en: c.en, how: 'inside' };
        c.polys.forEach(function (rings) {
          var r = rings[0];
          for (var k = 0; k + 3 < r.length; k += 2) {
            var d2 = segDist2(x, lat, r[k], r[k + 1], r[k + 2], r[k + 3]);
            if (d2 < bestD) { bestD = d2; best = c; }
          }
        });
      }
    }
    return best ? { id: best.id, ko: countryName(best.id, best.en), en: best.en, how: 'near' } : null;
  }
  function countryName(id, en) {
    if (COUNTRY_KO[id]) return COUNTRY_KO[id];
    for (var i = 0; i < TINY.length; i++) if (TINY[i].id === id) return TINY[i].ko;
    return en || id;
  }
  // 고르기 목록: [{ id, name }] 한국어 이름 가나다순
  function countryOptions(world) {
    var seen = {}, out = [];
    ((world && world.countries) || []).forEach(function (c) { seen[c.id] = 1; out.push({ id: c.id, name: countryName(c.id, c.en) }); });
    TINY.forEach(function (t) { if (!seen[t.id]) out.push({ id: t.id, name: t.ko }); });
    return out.sort(function (a, b) { return a.name.localeCompare(b.name, 'ko'); });
  }

  // 모든 여행에서 방문한 나라·도시 (적은 것 + 사진 위치에서 찾은 것)
  function visited(trips) {
    var countries = {}, cities = {};
    (trips || []).forEach(function (t) {
      (t.countries || []).forEach(function (id) { countries[id] = (countries[id] || 0) + 1; });
      (t.cities || []).forEach(function (c) { var k = String(c).trim(); if (k) cities[k] = (cities[k] || 0) + 1; });
    });
    return { countryIds: Object.keys(countries).sort(), cities: Object.keys(cities).sort(function (a, b) { return a.localeCompare(b, 'ko'); }) };
  }

  // ------------------------------------------------------------------ 지도 투영
  // 점들 → 범위 [서, 남, 동, 북]
  function boundsOf(points) {
    var b = null;
    (points || []).filter(hasPos).forEach(function (p) {
      if (!b) b = [p.lng, p.lat, p.lng, p.lat];
      else b = [Math.min(b[0], p.lng), Math.min(b[1], p.lat), Math.max(b[2], p.lng), Math.max(b[3], p.lat)];
    });
    return b;
  }
  // 범위를 너비 W 에 맞춘 투영. 여백 pad(비율), 최소 폭 minSpan(도). 높이는 범위 모양에 맞춰 [minH, maxH] 안에서 정한다.
  function projection(bbox, W, opts) {
    opts = opts || {};
    var pad = opts.pad == null ? 0.18 : opts.pad, minSpan = opts.minSpan || 0.05;
    var minH = opts.minH || Math.round(W * 0.45), maxH = opts.maxH || Math.round(W * 0.9);
    var w = bbox[0], s = bbox[1], e = bbox[2], n = bbox[3];
    var cx = (w + e) / 2, cy = (s + n) / 2;
    var k = Math.cos(Math.max(-80, Math.min(80, cy)) * Math.PI / 180);
    var spanX = Math.max((e - w) * k, minSpan), spanY = Math.max(n - s, minSpan);
    spanX *= 1 + 2 * pad; spanY *= 1 + 2 * pad;
    var H = Math.round(Math.max(minH, Math.min(maxH, W * spanY / spanX)));
    var scale = Math.min(W / spanX, H / spanY);            // 화면 단위 / 도
    function x(lng) { return (lng - cx) * k * scale + W / 2; }
    function y(lat) { return H / 2 - (lat - cy) * scale; }
    var viewW = W / scale / k, viewH = H / scale;            // 보이는 범위(도)
    return { W: W, H: H, x: x, y: y, scale: scale, k: k,
      view: [cx - viewW / 2, cy - viewH / 2, cx + viewW / 2, cy + viewH / 2] };
  }
  function bboxOverlap(a, b) { return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]; }
  // 나라 모양 → SVG path d (보이는 범위와 겹치는 것만)
  function countryPath(c, proj) {
    if (!bboxOverlap(c.bbox, proj.view)) return '';
    var d = [];
    c.polys.forEach(function (rings) {
      rings.forEach(function (r) {
        var s = 'M';
        for (var i = 0; i < r.length; i += 2) s += (i ? 'L' : '') + proj.x(r[i]).toFixed(1) + ' ' + proj.y(r[i + 1]).toFixed(1);
        d.push(s + 'Z');
      });
    });
    return d.join('');
  }

  // ------------------------------------------------------------------ 경비
  // "1,500" "12.50" "₩3,000" → 숫자(소수 둘째 자리까지), 아니면 NaN
  function parseAmount(s) {
    var t = String(s == null ? '' : s).replace(/[,\s₩$€¥원]/g, '');
    if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN;
    return +t;
  }
  function parseRate(s) {
    var t = String(s == null ? '' : s).replace(/[,\s]/g, '');
    if (!/^\d+(\.\d{1,6})?$/.test(t)) return NaN;
    var v = +t;
    return v > 0 ? v : NaN;
  }
  // 한 항목을 기준 통화(원)로 — { value, ok }. 환율이 없으면 ok = false
  function toHome(exp, rates, home) {
    home = home || 'KRW';
    if (exp.currency === home) return { value: Math.round(exp.amount), ok: true };
    var r = rates && rates[exp.currency];
    if (!(r > 0)) return { value: 0, ok: false };
    // 부동소수 오차(예: 12.5 × 1385.5)를 줄이려고 소수 둘째 자리 금액을 정수로 바꿔 곱한다
    return { value: Math.round(Math.round(exp.amount * 100) * r / 100), ok: true };
  }
  // 경비 합계 — 여행 전체·날짜별·분류별·통화별(원래 금액), 환율이 없어 빠진 통화 목록
  function expenseTotals(expenses, rates, home) {
    var out = { total: 0, count: 0, byDay: {}, byCategory: {}, byCurrency: {}, missing: [], excluded: 0 };
    (expenses || []).forEach(function (x) {
      out.byCurrency[x.currency] = Math.round(((out.byCurrency[x.currency] || 0) + x.amount) * 100) / 100;
      var h = toHome(x, rates, home);
      if (!h.ok) { if (out.missing.indexOf(x.currency) < 0) out.missing.push(x.currency); out.excluded++; return; }
      out.total += h.value; out.count++;
      var d = isDate(x.date) ? x.date : '';
      out.byDay[d] = (out.byDay[d] || 0) + h.value;
      out.byCategory[x.category] = (out.byCategory[x.category] || 0) + h.value;
    });
    out.missing.sort();
    return out;
  }
  function validExpense(x) {
    var e = {};
    if (!(x.amount > 0) || x.amount > LIMITS.amountMax) e.amount = '금액을 0보다 크게 적어 주세요(소수 둘째 자리까지).';
    if (!/^[A-Z]{3}$/.test(x.currency || '')) e.currency = '통화를 골라 주세요.';
    if (EXPENSE_CATEGORIES.indexOf(x.category) < 0) e.category = '분류를 골라 주세요.';
    if (!isDate(x.date)) e.date = '날짜를 골라 주세요.';
    if (x.paidBy != null && typeof x.paidBy !== 'string') e.paidBy = '낸 사람 형식이 맞지 않습니다.';
    if (x.split != null && (!Array.isArray(x.split) || x.split.some(function (id) { return typeof id !== 'string'; }))) e.split = '나눌 사람 형식이 맞지 않습니다.';
    return e;
  }

  // ------------------------------------------------------------------ 표시 통화 (원 → USD·JPY·EUR)
  var VIEW_CURRENCIES = ['USD', 'JPY', 'EUR'];
  var CUR_SIGN = { KRW: '₩', USD: '$', JPY: '¥', EUR: '€' };
  var CUR_DIGITS = { KRW: 0, JPY: 0, VND: 0, TWD: 0 };          // 소수 없이 쓰는 통화
  function curDigits(c) { return CUR_DIGITS[c] == null ? 2 : CUR_DIGITS[c]; }
  // 원 금액 → 그 통화 금액(사용자 환율 「1 cur = rate 원」). 환율이 없으면 null
  function fromHome(wonValue, cur, rates, home) {
    home = home || 'KRW';
    if (cur === home) return Math.round(wonValue);
    var r = rates && rates[cur];
    if (!(r > 0)) return null;
    var k = Math.pow(10, curDigits(cur));
    return Math.round(wonValue / r * k) / k;
  }
  // 표시 글자: '₩865,825' · '$624.92' · '¥94,937' — 환율이 없으면 ''
  function money(wonValue, cur, rates, home) {
    var v = fromHome(wonValue, cur, rates, home);
    if (v === null) return '';
    var parts = Math.abs(v).toFixed(curDigits(cur)).split('.');
    var txt = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (parts[1] ? '.' + parts[1] : '');
    var sign = CUR_SIGN[cur];
    return (v < 0 ? '-' : '') + (sign ? sign + txt : txt + ' ' + cur);
  }
  // 원 금액의 USD·JPY·EUR 환산 목록 [{ cur, value(null = 환율 없음), text }]
  function equivalents(wonValue, rates, home) {
    return VIEW_CURRENCIES.map(function (c) { return { cur: c, value: fromHome(wonValue, c, rates, home), text: money(wonValue, c, rates, home) }; });
  }

  // ------------------------------------------------------------------ 정산 (함께 간 사람끼리 나눠 내기)
  // trip.members = [{ id, name }], 지출 x.paidBy = 낸 사람 id, x.split = 나눌 사람 id 목록(비우면 모두)
  var ME = { id: 'm-me', name: '나' };
  function members(trip) { return (trip.members && trip.members.length) ? trip.members : [ME]; }
  // 원 금액을 ids 에 원 단위로 나눈다 — 나머지는 앞사람부터 1원씩(합이 정확히 같다)
  function splitWon(total, ids) {
    var out = {}, n = ids.length;
    if (!n) return out;
    var sign = total < 0 ? -1 : 1, a = Math.abs(Math.round(total)), base = Math.floor(a / n), rest = a - base * n;
    ids.forEach(function (id, i) { out[id] = sign * (base + (i < rest ? 1 : 0)); });
    return out;
  }
  // 지출 하나의 낸 사람·나눌 사람(없는 사람은 걸러 내고, 비었으면 기본값)
  function payerOf(x, ms) {
    return ms.some(function (m) { return m.id === x.paidBy; }) ? x.paidBy : ms[0].id;
  }
  function sharersOf(x, ms) {
    var ids = ms.map(function (m) { return m.id; });
    var sel = (x.split || []).filter(function (id) { return ids.indexOf(id) >= 0; });
    return sel.length ? ids.filter(function (id) { return sel.indexOf(id) >= 0; }) : ids;   // 사람 목록 순서로
  }
  function settle(trip) {
    var ms = members(trip), paid = {}, owed = {}, net = {};
    ms.forEach(function (m) { paid[m.id] = 0; owed[m.id] = 0; });
    var items = [], excluded = [], defaulted = 0;
    (trip.expenses || []).forEach(function (x) {
      var h = toHome(x, trip.rates, trip.home);
      if (!h.ok) { excluded.push(x.id); return; }
      var payer = payerOf(x, ms), who = sharersOf(x, ms), shares = splitWon(h.value, who);
      if (payer !== x.paidBy) defaulted++;
      paid[payer] += h.value;
      who.forEach(function (id) { owed[id] += shares[id]; });
      items.push({ id: x.id, won: h.value, payer: payer, sharers: who, shares: shares, each: who.length ? Math.round(h.value / who.length) : 0 });
    });
    ms.forEach(function (m) { net[m.id] = paid[m.id] - owed[m.id]; });
    return { members: ms, items: items, paid: paid, owed: owed, net: net, excluded: excluded, defaulted: defaulted,
      total: items.reduce(function (a, it) { return a + it.won; }, 0), transfers: minTransfers(net, ms.map(function (m) { return m.id; })) };
  }
  // 주고받을 돈 { id: +받을 / -낼 } → 송금 목록 [{ from, to, won }]. 합이 0 이 아니면 null.
  // 송금 횟수의 최솟값 = (0 아닌 사람 수) − (합이 0 인 무리로 가장 많이 나눈 수). 16명까지는 부분집합 DP 로 정확히 찾고,
  // 각 무리 안에서는 가장 많이 낼 사람 → 가장 많이 받을 사람 순서로 이어 무리 크기 − 1 번에 끝낸다.
  function minTransfers(net, order) {
    var ids = (order || Object.keys(net)).filter(function (id) { return net[id]; });
    var sum = ids.reduce(function (a, id) { return a + net[id]; }, 0);
    if (sum !== 0) return null;
    var groups;
    if (ids.length <= 16) {
      var n = ids.length, full = (1 << n) - 1, total = new Array(full + 1), dp = new Array(full + 1);
      total[0] = 0; dp[0] = 0;
      for (var mask = 1; mask <= full; mask++) {
        var low = mask & -mask, bit = 31 - Math.clz32(low);
        total[mask] = total[mask ^ low] + net[ids[bit]];
        var best = -1;
        for (var i = 0; i < n; i++) if (mask & (1 << i)) best = Math.max(best, dp[mask ^ (1 << i)]);
        dp[mask] = best + (total[mask] === 0 ? 1 : 0);
      }
      // 되짚기: 하나씩 빼며 합이 0 이 되는 지점마다 무리를 끊는다
      groups = []; var cur = [], m2 = full;
      while (m2) {
        for (var j = 0; j < n; j++) {
          if (!(m2 & (1 << j))) continue;
          var next = m2 ^ (1 << j);
          if (dp[next] === dp[m2] - (total[m2] === 0 ? 1 : 0)) {
            cur.push(ids[j]); m2 = next;
            if (total[m2] === 0) { groups.push(cur); cur = []; }
            break;
          }
        }
      }
    } else groups = [ids];
    var out = [];
    groups.forEach(function (g) {
      var bal = {}; g.forEach(function (id) { bal[id] = net[id]; });
      for (var guard = 0; guard < g.length * 2; guard++) {
        var debt = g.filter(function (id) { return bal[id] < 0; }).sort(function (a, b) { return bal[a] - bal[b]; })[0];
        var cred = g.filter(function (id) { return bal[id] > 0; }).sort(function (a, b) { return bal[b] - bal[a]; })[0];
        if (!debt || !cred) break;
        var amt = Math.min(-bal[debt], bal[cred]);
        out.push({ from: debt, to: cred, won: amt });
        bal[debt] += amt; bal[cred] -= amt;
      }
    });
    return out;
  }

  // ------------------------------------------------------------------ 도시 이름 (오프라인 역지오코딩 — GeoNames cities15000)
  // cities = vendor/cities15000.js 의 { text } — 한 줄 「이름|위도×100|경도×100|나라|인구(천 명)」
  var CITY_MAX_KM = 60;           // 이보다 멀면 「도시 없음」(바다 한가운데·오지)
  function cityIndex(cities) {
    if (!cities || !cities.text) return null;
    if (cities._idx) return cities._idx;
    var rows = cities.text.split('\n'), grid = {}, list = [];
    rows.forEach(function (line) {
      var f = line.split('|');
      if (f.length < 5) return;
      var c = { name: f[0], lat: +f[1] / 100, lng: +f[2] / 100, cc: f[3], popK: +f[4] || 0 };
      c.r = Math.min(25, 0.3 * Math.sqrt(c.popK));          // 도시 반경 짐작(km) — 인구 270만 오사카 ≈ 16km
      var k = Math.floor(c.lat) + ',' + Math.floor(c.lng);
      (grid[k] = grid[k] || []).push(list.length);
      list.push(c);
    });
    cities._idx = { list: list, grid: grid };
    return cities._idx;
  }
  // 좌표 → { name, cc, km(도시 중심까지), pop } 또는 null. 「도시 반경을 뺀 거리」가 가장 짧은 도시.
  // 큰 도시 가장자리에서 옆 소도시 이름이 나오지 않게 하려는 것이다(교토 기요미즈데라 → 교토).
  function cityAt(lat, lng, cities) {
    var idx = cityIndex(cities);
    if (!idx || !isFinite(lat) || !isFinite(lng)) return null;
    var la = Math.floor(lat), lo = Math.floor(lng), best = null, bestS = Infinity;
    for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
      var x = lo + dx; if (x < -180) x += 360; if (x >= 180) x -= 360;
      var cell = idx.grid[(la + dy) + ',' + x];
      if (!cell) continue;
      for (var i = 0; i < cell.length; i++) {
        var c = idx.list[cell[i]], km = haversine({ lat: lat, lng: lng }, c) / 1000;
        if (km > CITY_MAX_KM) continue;
        var score = km - c.r;
        if (score < bestS) { bestS = score; best = { name: c.name, cc: c.cc, km: Math.round(km * 10) / 10, pop: c.popK * 1000 }; }
      }
    }
    return best;
  }
  // 사진·장소 점의 이름 — 외부 지도 API 로 받아 둔 이름(p.place)이 있으면 그것, 없으면 가까운 도시
  function placeName(p, cities) {
    if (p && p.place) return p.place;
    if (!hasPos(p)) return '';
    var c = cityAt(p.lat, p.lng, cities);
    return c ? c.name : '';
  }
  // 사진 위치에서 찾은 도시를 여행의 도시 목록에 더한다. 반환: 새로 더한 도시들
  function addCitiesFromPhotos(trip, cities) {
    var added = [];
    (trip.photos || []).slice().sort(byTime).forEach(function (p) {
      if (!hasPos(p)) return;
      var c = cityAt(p.lat, p.lng, cities);
      if (c && trip.cities.indexOf(c.name) < 0 && trip.cities.length < 100) { trip.cities.push(c.name); added.push(c.name); }
    });
    return added;
  }

  // ------------------------------------------------------------------ 외부 지도 API (선택 — 사용자 본인 키, 기본 꺼짐)
  // 좌표만 보낸다(사진은 보내지 않음). 요청 주소 만들기와 답 읽기는 순수 함수라 테스트한다.
  var GEO_PROVIDERS = {
    google: { label: 'Google Geocoding API (세계)', keyHint: 'AIza...' },
    kakao: { label: '카카오 로컬 API (국내만)', keyHint: 'REST API 키' }
  };
  function geoRequest(provider, lat, lng, key) {
    var la = (+lat).toFixed(6), ln = (+lng).toFixed(6);
    if (provider === 'google') {
      return { url: 'https://maps.googleapis.com/maps/api/geocode/json?latlng=' + la + ',' + ln + '&language=ko&key=' + encodeURIComponent(key), headers: {} };
    }
    if (provider === 'kakao') {
      return { url: 'https://dapi.kakao.com/v2/local/geo/coord2address.json?x=' + ln + '&y=' + la, headers: { Authorization: 'KakaoAK ' + key } };
    }
    return null;
  }
  var GOOGLE_POI = ['tourist_attraction', 'point_of_interest', 'establishment', 'park', 'natural_feature', 'airport', 'train_station', 'transit_station', 'premise'];
  // 답(JSON) → { name, detail } 또는 { error }
  function geoParse(provider, j) {
    if (!j || typeof j !== 'object') return { error: '답을 읽지 못했어요.' };
    if (provider === 'google') {
      if (j.status === 'ZERO_RESULTS') return { name: '', detail: '' };
      if (j.status !== 'OK') return { error: 'Google: ' + (j.status || '오류') + (j.error_message ? ' — ' + j.error_message : '') };
      var rs = j.results || [];
      if (!rs.length) return { name: '', detail: '' };
      var poi = rs.filter(function (r) { return (r.types || []).some(function (t) { return GOOGLE_POI.indexOf(t) >= 0; }); })[0];
      var comp = function (r, type) { var c = (r.address_components || []).filter(function (a) { return (a.types || []).indexOf(type) >= 0; })[0]; return c ? c.long_name : ''; };
      var r0 = rs[0];
      var area = [comp(r0, 'locality') || comp(r0, 'administrative_area_level_2') || comp(r0, 'administrative_area_level_1'),
        comp(r0, 'sublocality_level_1') || comp(r0, 'neighborhood')].filter(Boolean);
      area = area.filter(function (x, i) { return area.indexOf(x) === i; });
      var name = poi && poi.address_components && poi.address_components[0] ? poi.address_components[0].long_name : area.join(' ');
      return { name: String(name || '').slice(0, 60), detail: String(r0.formatted_address || '').slice(0, 120) };
    }
    if (provider === 'kakao') {
      if (j.errorType || j.code) return { error: '카카오: ' + (j.message || j.errorType || j.code) };
      var d = (j.documents || [])[0];
      if (!d) return { name: '', detail: '' };
      var road = d.road_address || {}, addr = d.address || {};
      var nm = road.building_name || [addr.region_2depth_name, addr.region_3depth_name].filter(Boolean).join(' ');
      return { name: String(nm || '').slice(0, 60), detail: String(road.address_name || addr.address_name || '').slice(0, 120) };
    }
    return { error: '지원하지 않는 지도 API 예요.' };
  }

  // ------------------------------------------------------------------ 여행·기록
  function newTrip(title) {
    return { id: uid('t'), title: title || '새 여행', start: '', end: '', countries: [], cities: [], memo: '',
      home: 'KRW', rates: {}, members: [], entries: [], photos: [], expenses: [], plans: [], report: '' };
  }
  function newEntry(date) { return { id: uid('e'), date: date || '', time: '', place: '', text: '', keywords: '', lat: null, lng: null }; }
  function validTrip(t) {
    var e = {};
    if (!String(t.title || '').trim()) e.title = '여행 이름을 적어 주세요.';
    if (t.start && !isDate(t.start)) e.start = '시작일 형식이 맞지 않습니다.';
    if (t.end && !isDate(t.end)) e.end = '마지막 날 형식이 맞지 않습니다.';
    if (isDate(t.start) && isDate(t.end) && t.end < t.start) e.end = '마지막 날이 시작일보다 빠릅니다.';
    if (isDate(t.start) && isDate(t.end) && daysBetween(t.start, t.end) > 365) e.end = '여행 기간은 1년까지만 적을 수 있어요.';
    return e;
  }
  function ok(errs) { return !Object.keys(errs).length; }
  function entriesOn(trip, date) { return (trip.entries || []).filter(function (e) { return e.date === date; }); }
  function photosOf(trip, entryId) { return (trip.photos || []).filter(function (p) { return p.entryId === entryId; }).sort(byTime); }

  // 사진이 있는 날 중 아직 기록이 없는 날마다 기록을 하나 만들고 그날 사진(기록에 안 붙은 것)을 붙인다.
  // 장소 칸은 그날 사진 위치의 도시 이름들(들른 순서, 「오사카 · 교토」)로, 도시를 못 찾으면 나라 이름으로 미리 채운다.
  // 반환: 새로 만든 기록 수
  function entriesFromPhotos(trip, world, cities) {
    var made = 0;
    groupByDay((trip.photos || []).filter(function (p) { return !p.entryId && !needsDate(trip, p); })).forEach(function (g) {
      if (!g.date) return;
      var e = entriesOn(trip, g.date)[0];
      if (!e) {
        e = newEntry(g.date);
        var first = g.photos.filter(hasPos)[0];
        if (first) {
          e.lat = first.lat; e.lng = first.lng;
          var names = [];
          g.photos.filter(hasPos).forEach(function (p) { var nm = placeName(p, cities); if (nm && names.indexOf(nm) < 0) names.push(nm); });
          var c = countryAt(first.lat, first.lng, world);
          e.place = names.length ? names.slice(0, 4).join(' · ') : (c ? c.ko : '');
        }
        e.time = timeOf(photoStamp(g.photos[0]));
        trip.entries.push(e); made++;
      }
      g.photos.forEach(function (p) { p.entryId = e.id; });
    });
    trip.entries.sort(function (a, b) { return (a.date + a.time) < (b.date + b.time) ? -1 : 1; });
    return made;
  }

  // 사진 위치에서 찾은 나라를 여행의 나라 목록에 더한다. 반환: 새로 더한 나라 이름들
  function addCountriesFromPhotos(trip, world) {
    var added = [];
    (trip.photos || []).forEach(function (p) {
      if (!hasPos(p)) return;
      var c = countryAt(p.lat, p.lng, world);
      if (c && trip.countries.indexOf(c.id) < 0) { trip.countries.push(c.id); added.push(c.ko); }
    });
    return added;
  }

  function tripStats(trip) {
    var routes = tripRoutes(trip);
    var nd = nightsDays(trip);
    var ex = expenseTotals(trip.expenses, trip.rates, trip.home);
    return {
      nights: nd.nights, days: nd.days, periodLabel: nd.label,
      countries: (trip.countries || []).length, cities: (trip.cities || []).length,
      photos: (trip.photos || []).length, located: (trip.photos || []).filter(hasPos).length,
      entries: (trip.entries || []).length, written: (trip.entries || []).filter(function (e) { return String(e.text || '').trim(); }).length,
      km: Math.round(routes.reduce(function (a, r) { return a + r.meters; }, 0) / 100) / 10,
      stops: routes.reduce(function (a, r) { return a + r.stops.length; }, 0),
      expense: ex
    };
  }

  // ------------------------------------------------------------------ AI 도우미 (반자동 프롬프트)
  function diaryPrompt(o) {
    var trip = o.trip, e = o.entry, photos = o.photos || [];
    var times = photos.map(photoStamp).filter(Boolean).map(timeOf).filter(Boolean);
    var lines = [];
    lines.push('아래 메모로 여행 일기를 한국어로 써 줘.');
    lines.push('');
    lines.push('[여행] ' + (trip.title || '여행') + (isDate(trip.start) ? ' (' + trip.start + (isDate(trip.end) ? ' ~ ' + trip.end : '') + ')' : ''));
    var dn = dayNo(trip, e.date);
    lines.push('[날짜] ' + (isDate(e.date) ? e.date + ' ' + dateLabel(e.date).replace(/^.*\(/, '(') : '미정') + (dn ? ' · 여행 ' + dn + '일째' : ''));
    if (e.place) lines.push('[장소] ' + e.place);
    if (o.otherPlaces && o.otherPlaces.length) lines.push('[이날 들른 곳] ' + o.otherPlaces.join(', '));
    if (photos.length) lines.push('[사진] ' + photos.length + '장' + (times.length ? ' · ' + times[0] + (times.length > 1 ? ' ~ ' + times[times.length - 1] : '') + ' 사이에 찍음' : ''));
    if (o.meters) lines.push('[이동] 사진 위치로 잰 직선거리 합 약 ' + (Math.round(o.meters / 100) / 10) + 'km');
    lines.push('[키워드·메모] ' + (String(e.keywords || '').trim() || '(없음)'));
    if (String(e.text || '').trim()) { lines.push('[지금까지 적은 글]'); lines.push(String(e.text).trim()); }
    lines.push('');
    lines.push('조건');
    lines.push('- 형식: ' + (TONES[o.tone] || TONES.blog));
    lines.push('- 분량: ' + ({ s: '200자 안팎', m: '500자 안팎', l: '900자 안팎' }[o.length || 'm']));
    lines.push('- 메모에 없는 사실(가게 이름, 가격, 날씨, 함께 간 사람)은 지어내지 말고, 모르는 부분은 느낌으로만 적어 줘.');
    lines.push('- 제목 한 줄을 맨 위에 「제목: 」으로 붙이고, 그 아래에 본문만 적어 줘.');
    return lines.join('\n');
  }
  // 답에서 「제목: 」 줄을 떼어 { title, body }
  function splitTitle(text) {
    var t = String(text || '').replace(/\r/g, '').trim();
    var m = /^(?:#+\s*)?제목\s*[:：]\s*(.+)\n+/.exec(t);
    return m ? { title: m[1].trim(), body: t.slice(m[0].length).trim() } : { title: '', body: t };
  }
  function reportPrompt(trip, world) {
    var s = tripStats(trip), lines = [];
    lines.push('아래 여행 기록으로 「여행 리포트」를 한국어로 써 줘.');
    lines.push('');
    lines.push('[여행] ' + (trip.title || '여행') + ' · ' + s.periodLabel + (isDate(trip.start) ? ' (' + trip.start + ' ~ ' + trip.end + ')' : ''));
    var cn = (trip.countries || []).map(function (id) { return countryName(id, id); });
    if (cn.length) lines.push('[나라] ' + cn.join(', '));
    if ((trip.cities || []).length) lines.push('[도시] ' + trip.cities.join(', '));
    lines.push('[기록] 사진 ' + s.photos + '장 · 일기 ' + s.written + '편 · 사진 위치로 잰 이동 약 ' + s.km + 'km');
    if (s.expense.count) {
      var cats = Object.keys(s.expense.byCategory).sort(function (a, b) { return s.expense.byCategory[b] - s.expense.byCategory[a]; });
      lines.push('[경비] 합계 ' + won(s.expense.total) + ' (' + cats.map(function (c) { return c + ' ' + won(s.expense.byCategory[c]); }).join(', ') + ')' +
        (s.expense.missing.length ? ' · 환율 미입력으로 뺀 통화: ' + s.expense.missing.join(', ') : ''));
    }
    lines.push('[날짜별 일기]');
    (trip.entries || []).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (e) {
      var body = String(e.text || e.keywords || '').replace(/\s+/g, ' ').trim();
      lines.push('- ' + (e.date || '날짜 없음') + (e.place ? ' · ' + e.place : '') + ': ' + (body ? body.slice(0, 400) : '(글 없음)'));
    });
    lines.push('');
    lines.push('조건');
    lines.push('- 구성: ① 한 줄 요약 ② 가장 기억에 남는 순간 3가지 ③ 이번 여행의 스타일(예: 걷기 많음, 먹거리 위주) ④ 경비 한 줄 평 ⑤ 다음 여행에 참고할 점');
    lines.push('- 위 기록에 없는 사실은 지어내지 말아 줘. 700자 안팎.');
    return lines.join('\n');
  }


  // ------------------------------------------------------------------ 여행 일정 (2026-09-30 수강생 추가 요청)
  // trip.plans = [{ id, type, title, date, start('HH:MM'|''), endDate(''=같은 날), end('HH:MM'|''),
  //                 place, lat, lng, booking, memo, expenseId(''=연결 안 함), done }]
  // 계획은 사진 동선(실제로 다닌 곳)과 따로 둔다 — 지도에는 점선·네모 핀으로 겹쳐 그려 비교한다.
  var PLAN_TYPES = ['항공', '숙소', '관광', '맛집', '투어', '기타'];
  var PLAN_TO_CATEGORY = { '항공': '교통', '숙소': '숙박', '관광': '관광·입장', '맛집': '식비', '투어': '관광·입장', '기타': '기타' };
  function isTime(s) { return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || '')); }
  function newPlan(date) {
    return { id: uid('pl'), type: '관광', title: '', date: date || '', start: '', endDate: '', end: '',
      place: '', lat: null, lng: null, booking: '', memo: '', expenseId: '', done: false };
  }
  function validPlan(p) {
    var e = {};
    if (PLAN_TYPES.indexOf(p.type) < 0) e.type = '종류를 골라 주세요.';
    if (!String(p.title || '').trim()) e.title = '일정 이름을 적어 주세요.';
    else if (String(p.title).length > 60) e.title = '일정 이름은 60자까지예요.';
    if (!isDate(p.date)) e.date = '날짜를 골라 주세요.';
    if (p.start && !isTime(p.start)) e.start = '시각은 00:00 ~ 23:59 로 적어 주세요.';
    if (p.end && !isTime(p.end)) e.end = '시각은 00:00 ~ 23:59 로 적어 주세요.';
    if (p.endDate && !isDate(p.endDate)) e.endDate = '끝나는 날 형식이 맞지 않습니다.';
    else if (isDate(p.date) && p.endDate) {
      if (p.endDate < p.date) e.endDate = '끝나는 날이 시작하는 날보다 빠릅니다.';
      else if (daysBetween(p.date, p.endDate) > 31) e.endDate = '한 일정은 31일까지만 이어질 수 있어요.';
    }
    if (!e.start && !e.end && !e.endDate && isTime(p.start) && isTime(p.end) && (!p.endDate || p.endDate === p.date) && p.end < p.start)
      e.end = '끝나는 시각이 시작 시각보다 빠릅니다(다음 날이면 「끝나는 날」을 골라 주세요).';
    var hasLat = p.lat != null, hasLng = p.lng != null;
    if (hasLat !== hasLng || (hasLat && !(hasPos(p) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180))) e.pos = '좌표는 위도·경도를 함께 적어 주세요.';
    if (String(p.place || '').length > 80) e.place = '장소는 80자까지예요.';
    if (String(p.booking || '').length > 60) e.booking = '예약 번호는 60자까지예요.';
    if (String(p.memo || '').length > 300) e.memo = '메모는 300자까지예요.';
    if (p.expenseId != null && typeof p.expenseId !== 'string') e.expenseId = '연결한 지출 형식이 맞지 않습니다.';
    return e;
  }
  // 「34.6687, 135.5013」(구글 지도에서 복사한 모양) · 「34.6687 135.5013」 → { lat, lng } 또는 null
  function parseLatLng(s) {
    var m = /^\s*\(?\s*(-?\d{1,2}(?:\.\d+)?)\s*(?:,|\s)\s*(-?\d{1,3}(?:\.\d+)?)\s*\)?\s*$/.exec(String(s || ''));
    if (!m) return null;
    var la = +m[1], ln = +m[2];
    if (Math.abs(la) > 90 || Math.abs(ln) > 180 || (la === 0 && ln === 0)) return null;
    return { lat: Math.round(la * 1e6) / 1e6, lng: Math.round(ln * 1e6) / 1e6 };
  }
  // 도시 이름 → 도시 목록(GeoNames, 오프라인)에서 찾기. 이름이 같으면 → 앞이 같으면 → 들어 있으면, 그 안에서는 인구 많은 순.
  function citySearch(q, cities, limit) {
    var idx = cityIndex(cities), key = String(q || '').replace(/\s+/g, '').toLowerCase();
    if (!idx || !key) return [];
    var hits = [];
    idx.list.forEach(function (c) {
      var n = c.name.replace(/\s+/g, '').toLowerCase(), at = n.indexOf(key);
      if (at >= 0) hits.push({ rank: n === key ? 0 : at === 0 ? 1 : 2, c: c });
    });
    hits.sort(function (a, b) { return a.rank - b.rank || b.c.popK - a.c.popK; });
    return hits.slice(0, limit || 6).map(function (h) { return { name: h.c.name, cc: h.c.cc, lat: h.c.lat, lng: h.c.lng, pop: h.c.popK * 1000 }; });
  }
  function planKey(p) { return (p.date || '') + 'T' + (p.start || '99:99') + '|' + (p.title || ''); }   // 시각 없는 일정은 그날 끝
  function sortPlans(plans) { return (plans || []).slice().sort(function (a, b) { var x = planKey(a), y = planKey(b); return x < y ? -1 : x > y ? 1 : 0; }); }
  // 같은 날 시각이 겹치는 일정 id 목록 (시작·끝 시각이 다 있는 일정끼리, 여러 날 이어지는 숙소는 뺌)
  function planOverlaps(plans) {
    var out = {}, byDay = {};
    (plans || []).forEach(function (p) {
      if (!isTime(p.start) || !isTime(p.end) || (p.endDate && p.endDate !== p.date) || p.end <= p.start) return;
      (byDay[p.date] = byDay[p.date] || []).push(p);
    });
    Object.keys(byDay).forEach(function (d) {
      var a = byDay[d];
      for (var i = 0; i < a.length; i++) for (var j = i + 1; j < a.length; j++) {
        if (a[i].start < a[j].end && a[j].start < a[i].end) { out[a[i].id] = 1; out[a[j].id] = 1; }
      }
    });
    return Object.keys(out);
  }
  // 날짜별 일정 [{ date, dayNo, plans }] — 여행 기간의 날은 일정이 없어도 넣는다(빈 날이 보이게)
  function plansByDay(trip) {
    var set = {};
    tripDates(trip).forEach(function (d) { set[d] = []; });
    sortPlans(trip.plans).forEach(function (p) { if (isDate(p.date)) (set[p.date] = set[p.date] || []).push(p); });
    return Object.keys(set).sort().map(function (d) { return { date: d, dayNo: dayNo(trip, d), plans: set[d] }; });
  }
  function planProgress(trip) {
    var ps = trip.plans || [];
    return { total: ps.length, done: ps.filter(function (p) { return p.done; }).length };
  }
  // 지도에 그릴 계획 동선 [{ date, dayNo, stops:[{ lat, lng, plan }] }] — 좌표 있는 일정만, 시각순
  function planRoutes(trip) {
    return plansByDay(trip).map(function (g) {
      return { date: g.date, dayNo: g.dayNo, stops: g.plans.filter(hasPos).map(function (p) { return { lat: p.lat, lng: p.lng, plan: p }; }) };
    }).filter(function (r) { return r.stops.length; });
  }
  // 일정에 연결한 지출 → { expense, won(원 환산, 환율 없으면 null) } 또는 null(연결 없음·지워진 지출)
  function planCost(trip, p) {
    if (!p.expenseId) return null;
    var x = (trip.expenses || []).filter(function (y) { return y.id === p.expenseId; })[0];
    if (!x) return null;
    var h = toHome(x, trip.rates || {}, trip.home || 'KRW');
    return { expense: x, won: h.ok ? h.value : null };
  }
  // 일정 → 새 지출 (예약하며 낸 돈을 경비에 바로 적기). 분류는 종류에서 짐작
  function expenseFromPlan(p, amount, currency) {
    return { id: uid('x'), date: p.date, amount: amount, currency: currency, category: PLAN_TO_CATEGORY[p.type] || '기타',
      memo: String((p.type === '기타' ? '' : p.type + ' · ') + (p.title || '')).slice(0, 80) };
  }

  // ------------------------------------------------------------------ 저장 자료 검사 (가져오기)
  function checkDb(o) {
    var errs = [];
    if (!o || typeof o !== 'object') return ['JSON 파일이 아닙니다.'];
    if (o.schemaVersion !== SCHEMA_VERSION) errs.push('이 도구의 백업 파일이 아닙니다(schemaVersion ' + SCHEMA_VERSION + ' 필요).');
    if (!Array.isArray(o.trips)) { errs.push('여행 목록(trips)이 없습니다.'); return errs; }
    if (o.trips.length > LIMITS.trips) errs.push('여행은 ' + LIMITS.trips + '개까지입니다.');
    o.trips.forEach(function (t, i) {
      var n = (i + 1) + '번 여행';
      if (!t || typeof t !== 'object' || !t.id) { errs.push(n + ': 형식이 맞지 않습니다.'); return; }
      ['countries', 'cities', 'entries', 'photos', 'expenses'].forEach(function (k) { if (!Array.isArray(t[k])) errs.push(n + ': ' + k + ' 목록이 없습니다.'); });
      if (!ok(validTrip(t))) errs.push(n + ': ' + validTrip(t)[Object.keys(validTrip(t))[0]]);
      (t.expenses || []).forEach(function (x, j) { var er = validExpense(x); if (!ok(er)) errs.push(n + ' 경비 ' + (j + 1) + '번: ' + er[Object.keys(er)[0]]); });
      if (t.members != null && (!Array.isArray(t.members) || t.members.length > LIMITS.members ||
          t.members.some(function (m) { return !m || typeof m.id !== 'string' || !String(m.name || '').trim(); }))) errs.push(n + ': 함께 간 사람(members) 형식이 맞지 않습니다.');
      if ((t.photos || []).length > LIMITS.photosPerTrip) errs.push(n + ': 사진은 ' + LIMITS.photosPerTrip + '장까지입니다.');
      if (t.plans != null && !Array.isArray(t.plans)) errs.push(n + ': 일정(plans) 목록 형식이 맞지 않습니다.');
      else if ((t.plans || []).length > LIMITS.plansPerTrip) errs.push(n + ': 일정은 ' + LIMITS.plansPerTrip + '개까지입니다.');
      else (t.plans || []).forEach(function (p, j) {
        var er = p && typeof p === 'object' && typeof p.id === 'string' ? validPlan(p) : { id: '형식이 맞지 않습니다.' };
        if (!ok(er)) errs.push(n + ' 일정 ' + (j + 1) + '번: ' + er[Object.keys(er)[0]]);
      });
    });
    return errs.filter(function (x, i, a) { return a.indexOf(x) === i; }).slice(0, 12);
  }

  var API = {
    SCHEMA_VERSION: SCHEMA_VERSION, LIMITS: LIMITS, SAME_SPOT_M: SAME_SPOT_M, EXPENSE_CATEGORIES: EXPENSE_CATEGORIES,
    CURRENCIES: CURRENCIES, TONES: TONES, COUNTRY_KO: COUNTRY_KO, TINY: TINY,
    uid: uid, clone: clone, comma: comma, won: won,
    isDate: isDate, addDays: addDays, daysBetween: daysBetween, dateOf: dateOf, timeOf: timeOf, dateLabel: dateLabel, localStamp: localStamp,
    tripDates: tripDates, nightsDays: nightsDays, dayNo: dayNo,
    photoStamp: photoStamp, photoDate: photoDate, groupByDay: groupByDay, photoDateRange: photoDateRange, photoKey: photoKey, needsDate: needsDate,
    haversine: haversine, hasPos: hasPos, routeOf: routeOf, tripRoutes: tripRoutes,
    inRing: inRing, countryAt: countryAt, countryName: countryName, countryOptions: countryOptions, visited: visited,
    boundsOf: boundsOf, projection: projection, countryPath: countryPath,
    parseAmount: parseAmount, parseRate: parseRate, toHome: toHome, expenseTotals: expenseTotals, validExpense: validExpense,
    newTrip: newTrip, newEntry: newEntry, validTrip: validTrip, ok: ok, entriesOn: entriesOn, photosOf: photosOf,
    entriesFromPhotos: entriesFromPhotos, addCountriesFromPhotos: addCountriesFromPhotos, tripStats: tripStats,
    diaryPrompt: diaryPrompt, splitTitle: splitTitle, reportPrompt: reportPrompt, checkDb: checkDb,
    VIEW_CURRENCIES: VIEW_CURRENCIES, fromHome: fromHome, money: money, equivalents: equivalents,
    ME: ME, members: members, splitWon: splitWon, payerOf: payerOf, sharersOf: sharersOf, settle: settle, minTransfers: minTransfers,
    cityIndex: cityIndex, cityAt: cityAt, placeName: placeName, addCitiesFromPhotos: addCitiesFromPhotos,
    GEO_PROVIDERS: GEO_PROVIDERS, geoRequest: geoRequest, geoParse: geoParse,
    PLAN_TYPES: PLAN_TYPES, PLAN_TO_CATEGORY: PLAN_TO_CATEGORY, isTime: isTime, newPlan: newPlan, validPlan: validPlan, parseLatLng: parseLatLng,
    citySearch: citySearch, sortPlans: sortPlans, planOverlaps: planOverlaps, plansByDay: plansByDay, planProgress: planProgress,
    planRoutes: planRoutes, planCost: planCost, expenseFromPlan: expenseFromPlan
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.JLogic = API;
})(typeof window !== 'undefined' ? window : this);
