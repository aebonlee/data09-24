/*
 * JOURNAL — 지도 그리기 (SVG). 지도 타일·외부 서버를 쓰지 않고 vendor/world-110m.js 의 나라 모양만 그립니다.
 *   world 모드 : 세계 지도, 방문한 나라 칠하기(작은 나라는 점), 모든 여행의 사진 위치 점
 *   trip 모드  : 여행(또는 하루) 범위에 맞춰 확대, 날짜별 색으로 동선 선·번호 핀·사진 썸네일
 * 투영·경로 계산은 JLogic(순수 함수, 테스트 대상)에 있고 여기서는 SVG 글자만 만듭니다.
 */
(function (root) {
  'use strict';
  var L = root.JLogic;
  var DAY_COLORS = ['#d9480f', '#1c6fd1', '#2b8a3e', '#a33bc2', '#b35c00', '#0b7f8c', '#c2255c', '#5f3dc4'];
  var WORLD_BOX = [-170, -57, 190, 80];

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function dayColor(i) { return DAY_COLORS[i % DAY_COLORS.length]; }

  function countries(proj, visitedIds, clsVisited) {
    var out = [], set = {};
    (visitedIds || []).forEach(function (id) { set[id] = 1; });
    (root.JOURNAL_WORLD.countries || []).forEach(function (c) {
      var d = L.countryPath(c, proj);
      if (!d) return;
      out.push('<path class="' + (set[c.id] ? clsVisited : 'land') + '" d="' + d + '"><title>' + esc(L.countryName(c.id, c.en)) + '</title></path>');
    });
    // 지도에 모양이 없는 작은 나라는 방문했을 때만 점으로
    L.TINY.forEach(function (t) {
      if (!set[t.id]) return;
      out.push('<circle class="' + clsVisited + ' tiny" cx="' + proj.x(t.lng).toFixed(1) + '" cy="' + proj.y(t.lat).toFixed(1) + '" r="4"><title>' + esc(t.ko) + '</title></circle>');
    });
    return out.join('');
  }

  // 세계 방문 지도
  function world(opts) {
    var W = opts.width || 960;
    var proj = L.projection(WORLD_BOX, W, { pad: 0, minH: Math.round(W * 0.42), maxH: Math.round(W * 0.6) });
    var dots = (opts.points || []).filter(L.hasPos).map(function (p) {
      return '<circle class="dot" cx="' + proj.x(p.lng).toFixed(1) + '" cy="' + proj.y(p.lat).toFixed(1) + '" r="2.4"/>';
    }).join('');
    return '<svg class="map-svg world" viewBox="0 0 ' + W + ' ' + proj.H + '" role="img" aria-label="' + esc(opts.label || '방문한 나라 지도') + '">' +
      '<rect class="sea" width="' + W + '" height="' + proj.H + '"/>' + countries(proj, opts.visitedIds, 'visited') + dots + '</svg>';
  }

  // 여행 동선 지도. opts: { trip, routes(JLogic.tripRoutes), day('' = 전체), thumbs(bool), thumbUrl(photoId → url|''), width }
  // 반환: { svg, stops: [{ n, date, color, stop }] } — 핀 번호 순서대로
  function trip(opts) {
    var W = opts.width || 960, t = opts.trip;
    var routes = (opts.routes || []).filter(function (r) { return !opts.day || r.date === opts.day; });
    var pts = [];
    routes.forEach(function (r) { pts = pts.concat(r.stops); });
    var bbox = L.boundsOf(pts);
    if (!bbox) {
      // 위치 있는 사진이 없으면 적어 둔 나라들 범위, 그것도 없으면 세계
      (t.countries || []).forEach(function (id) {
        var c = (root.JOURNAL_WORLD.countries || []).filter(function (x) { return x.id === id; })[0];
        if (c) bbox = bbox ? [Math.min(bbox[0], c.bbox[0]), Math.min(bbox[1], c.bbox[1]), Math.max(bbox[2], c.bbox[2]), Math.max(bbox[3], c.bbox[3])] : c.bbox.slice();
      });
      if (!bbox) return { svg: world({ width: W, visitedIds: t.countries }), stops: [], empty: true };
    }
    var proj = L.projection(bbox, W, { pad: 0.2, minSpan: 0.06, minH: Math.round(W * 0.5), maxH: Math.round(W * 0.85) });
    var lines = [], pins = [], thumbs = [], list = [];
    var allDates = (opts.routes || []).map(function (r) { return r.date; });
    routes.forEach(function (r) {
      var color = dayColor(allDates.indexOf(r.date));
      if (r.stops.length > 1) {
        lines.push('<polyline class="route" stroke="' + color + '" points="' + r.stops.map(function (s) { return proj.x(s.lng).toFixed(1) + ',' + proj.y(s.lat).toFixed(1); }).join(' ') + '"/>');
      }
      r.stops.forEach(function (s, i) {
        var n = list.length, x = proj.x(s.lng), y = proj.y(s.lat);
        list.push({ n: n, date: r.date, dayNo: r.dayNo, order: i + 1, color: color, stop: s });
        var photoRef = s.refs.filter(function (ref) { return ref.indexOf('p:') === 0; })[0];
        var url = opts.thumbs && photoRef && opts.thumbUrl ? opts.thumbUrl(photoRef.slice(2)) : '';
        if (url) {
          thumbs.push('<g class="thumb" data-stop="' + n + '" transform="translate(' + (x + 6).toFixed(1) + ' ' + (y - 50).toFixed(1) + ')">' +
            '<rect width="40" height="40" rx="7" fill="#fff" stroke="' + color + '" stroke-width="2.5"/>' +
            '<image href="' + esc(url) + '" x="3" y="3" width="34" height="34" preserveAspectRatio="xMidYMid slice" clip-path="inset(0 round 5px)"/></g>');
        }
        pins.push('<g class="pin" data-stop="' + n + '" tabindex="0" role="button" aria-label="' + esc((r.dayNo ? r.dayNo + '일째 ' : '') + (i + 1) + '번째 장소') + '">' +
          '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="11" fill="' + color + '" stroke="#fff" stroke-width="2.5"/>' +
          '<text x="' + x.toFixed(1) + '" y="' + (y + 4.2).toFixed(1) + '" text-anchor="middle">' + (i + 1) + '</text></g>');
      });
    });
    var svg = '<svg class="map-svg trip" viewBox="0 0 ' + W + ' ' + proj.H + '" role="img" aria-label="여행 동선 지도">' +
      '<rect class="sea" width="' + W + '" height="' + proj.H + '"/>' + countries(proj, t.countries, 'visited-soft') +
      lines.join('') + thumbs.join('') + pins.join('') + scaleBar(proj, W) + '</svg>';
    return { svg: svg, stops: list, proj: proj };
  }

  // 축척 막대 — 보이는 폭의 약 1/5 을 1·2·5 단위 km 로
  function scaleBar(proj, W) {
    var kmPerUnit = 111.195 / proj.scale;          // 화면 1단위 = ? km (세로 기준)
    var target = kmPerUnit * W / 5, nice = [1, 2, 5], km = 1;
    var p = Math.pow(10, Math.floor(Math.log(target) / Math.LN10));
    for (var i = 0; i < nice.length; i++) if (nice[i] * p <= target) km = nice[i] * p;
    var len = km / kmPerUnit, y = proj.H - 16;
    return '<g class="scale"><rect x="12" y="' + (y - 14) + '" width="' + (len + 16).toFixed(1) + '" height="24" rx="4" fill="#fff" fill-opacity=".8"/>' +
      '<line x1="20" y1="' + y + '" x2="' + (20 + len).toFixed(1) + '" y2="' + y + '"/><text x="20" y="' + (y - 3) + '">' + (km < 1 ? km * 1000 + 'm' : km + 'km') + '</text></g>';
  }

  root.JMap = { world: world, trip: trip, dayColor: dayColor, DAY_COLORS: DAY_COLORS, WORLD_BOX: WORLD_BOX };
})(window);
