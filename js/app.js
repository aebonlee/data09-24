/*
 * JOURNAL — 화면. 계산은 JLogic(js/logic.js), EXIF 는 JournalExif(js/exif.js), 지도 그림은 JMap(js/map.js).
 * 저장: 여행·기록·경비·사진 정보 = localStorage, 사진 미리보기 = IndexedDB (js/store.js).
 */
(function () {
  'use strict';
  var L = window.JLogic, X = window.JournalExif, St = window.JStore, M = window.JMap, WORLD = window.JOURNAL_WORLD;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  var db = null;                      // { schemaVersion, trips, currentId }
  var thumbs = {};                    // 사진 id → 미리보기 URL (IndexedDB 에서 읽어 둔 것)
  var ui = { tab: 'trip', entryId: null, expenseId: null, mapDay: '', pin: null, lastCur: 'KRW', lastDate: '' };

  // ------------------------------------------------------------ 저장
  function fresh() { return { schemaVersion: L.SCHEMA_VERSION, trips: [], currentId: '' }; }
  function save() {
    var msg = St.save(db), el = $('saveState');
    if (msg) { el.textContent = msg; el.className = 'save-state bad'; }
    else { var d = new Date(); el.textContent = '저장됨 ' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); el.className = 'save-state'; }
  }
  function cur() {
    if (!db.trips.length) return null;
    return db.trips.filter(function (t) { return t.id === db.currentId; })[0] || db.trips[0];
  }
  function thumbUrl(p) { return p ? (p.src || thumbs[p.id] || '') : ''; }
  function photoById(t, id) { return t.photos.filter(function (p) { return p.id === id; })[0]; }

  // IndexedDB 에서 이 여행의 미리보기를 읽어 온 뒤 한 번 다시 그린다
  function loadThumbs(t) {
    var need = (t.photos || []).filter(function (p) { return !p.src && !thumbs[p.id]; });
    if (!need.length) return;
    Promise.all(need.map(function (p) { return St.getThumb(p.id).then(function (u) { if (u) thumbs[p.id] = u; }); }))
      .then(function () { renderTab(); });
  }

  // ------------------------------------------------------------ 알림
  var toastTimer = null;
  function toast(msg, undo) {
    $('toastMsg').textContent = msg; $('toast').hidden = false;
    var b = $('toastAct'); b.hidden = !undo;
    b.onclick = function () { $('toast').hidden = true; if (undo) undo(); };
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { $('toast').hidden = true; }, undo ? 7000 : 3500);
  }
  function copyText(text, ta) {
    function fallback() {
      try { ta.removeAttribute('readonly'); ta.select(); document.execCommand('copy'); ta.setAttribute('readonly', ''); return Promise.resolve(true); }
      catch (e) { return Promise.resolve(false); }
    }
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(function () { return true; }, fallback);
    return fallback();
  }
  function download(name, blobOrUrl) {
    var a = document.createElement('a');
    a.href = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(function () { if (typeof blobOrUrl !== 'string') URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ------------------------------------------------------------ 머리 · 탭
  function renderHeader() {
    var t = cur(), sel = $('tripSel');
    sel.innerHTML = db.trips.map(function (x) {
      return '<option value="' + esc(x.id) + '"' + (t && x.id === t.id ? ' selected' : '') + '>' + esc(x.title || '이름 없는 여행') + '</option>';
    }).join('') || '<option value="">여행 없음</option>';
    sel.disabled = !db.trips.length;
    $('empty').hidden = !!t;
    document.querySelector('.tabs').hidden = !t;
  }
  function setTab(name) {
    ui.tab = name;
    document.querySelectorAll('.tabs [role=tab]').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === name)); });
    document.querySelectorAll('.tab').forEach(function (s) { s.hidden = !cur() || s.id !== 'tab-' + name; });
    renderTab();
  }
  function renderTab() {
    renderHeader();
    var t = cur();
    document.querySelectorAll('.tab').forEach(function (s) { s.hidden = !t || s.id !== 'tab-' + ui.tab; });
    if (!t) return;
    ({ trip: renderTrip, log: renderLog, map: renderMap, money: renderMoney, export: renderExport })[ui.tab](t);
  }
  function switchTrip(id) {
    db.currentId = id; ui.entryId = null; ui.expenseId = null; ui.mapDay = ''; ui.pin = null;
    save(); fillTripForm(); closeEntry(); resetExpenseForm(); loadThumbs(cur()); renderTab();
  }

  // ------------------------------------------------------------ 1. 여행
  function fillTripForm() {
    var t = cur(); if (!t) return;
    $('tTitle').value = t.title || ''; $('tStart').value = t.start || ''; $('tEnd').value = t.end || ''; $('tMemo').value = t.memo || '';
    $('rText').value = t.report || '';
  }
  function tripErrors(t) {
    var e = L.validTrip(t);
    $('tTitleErr').textContent = e.title || ''; $('tEndErr').textContent = e.end || e.start || '';
  }
  function renderTrip(t) {
    tripErrors(t);
    var nd = L.nightsDays(t);
    $('tPeriod').textContent = nd.days ? nd.label + ' · ' + L.dateLabel(t.start) + ' ~ ' + L.dateLabel(t.end) : '날짜를 비워 두면 사진의 찍은 날짜로 채워 드려요.';
    var opts = L.countryOptions(WORLD).filter(function (o) { return t.countries.indexOf(o.id) < 0; });
    $('tCountryAdd').innerHTML = '<option value="">나라 고르기</option>' + opts.map(function (o) { return '<option value="' + o.id + '">' + esc(o.name) + '</option>'; }).join('');
    $('tCountries').innerHTML = t.countries.map(function (id) {
      return '<span class="chip">' + esc(L.countryName(id, id)) + '<button type="button" data-del-country="' + id + '" aria-label="' + esc(L.countryName(id, id)) + ' 빼기">빼기</button></span>';
    }).join('') || '<span class="hint">아직 없어요</span>';
    $('tCities').innerHTML = t.cities.map(function (c, i) {
      return '<span class="chip">' + esc(c) + '<button type="button" data-del-city="' + i + '" aria-label="' + esc(c) + ' 빼기">빼기</button></span>';
    }).join('') || '<span class="hint">아직 없어요</span>';
    renderStats(t);
    // 방문 지도 (모든 여행)
    var v = L.visited(db.trips), pts = [];
    db.trips.forEach(function (x) { pts = pts.concat(x.photos.filter(L.hasPos)); });
    $('worldMap').innerHTML = M.world({ width: 960, visitedIds: v.countryIds, points: pts });
    $('visitedSummary').innerHTML =
      '<p><b>방문한 나라 ' + v.countryIds.length + '곳</b> · 도시 ' + v.cities.length + '곳 · 여행 ' + db.trips.length + '번</p>' +
      '<div class="chips">' + v.countryIds.map(function (id) { return '<span class="chip plain">' + esc(L.countryName(id, id)) + '</span>'; }).join('') + '</div>' +
      (v.cities.length ? '<p class="small" style="margin-top:8px">도시: ' + v.cities.map(esc).join(', ') + '</p>' : '');
    $('tripList').innerHTML = db.trips.slice().sort(function (a, b) { return (b.start || '') < (a.start || '') ? -1 : 1; }).map(function (x) {
      var s = L.nightsDays(x);
      return '<button type="button" class="trip-card" data-trip="' + esc(x.id) + '"' + (x.id === t.id ? ' aria-current="true"' : '') + '><b>' + esc(x.title || '이름 없는 여행') + '</b>' +
        '<span>' + (x.start ? esc(x.start) + ' · ' + s.label : '기간 미정') + ' · ' + x.countries.map(function (id) { return esc(L.countryName(id, id)); }).join(', ') + ' · 사진 ' + x.photos.length + '장</span></button>';
    }).join('');
  }
  function renderStats(t) {
    var s = L.tripStats(t);
    var items = [
      [s.periodLabel, '기간'], [s.countries + '곳', '나라'], [s.cities + '곳', '도시'],
      [s.photos + '장', '사진 (위치 ' + s.located + ')'], [s.written + ' / ' + s.entries + '편', '일기 / 기록'],
      [s.km + 'km', '사진으로 잰 이동'], [L.won(s.expense.total), '경비' + (s.expense.missing.length ? ' (환율 없는 ' + s.expense.missing.join('·') + ' 제외)' : '')]
    ];
    $('tripStats').innerHTML = items.map(function (i) { return '<div class="stat"><b>' + esc(i[0]) + '</b><span>' + esc(i[1]) + '</span></div>'; }).join('');
  }
  function onTripInput() {
    var t = cur(); if (!t) return;
    t.title = $('tTitle').value; t.start = $('tStart').value; t.end = $('tEnd').value; t.memo = $('tMemo').value;
    tripErrors(t); save(); renderHeader(); renderStats(t);
    var nd = L.nightsDays(t);
    $('tPeriod').textContent = nd.days ? nd.label + ' · ' + L.dateLabel(t.start) + ' ~ ' + L.dateLabel(t.end) : '날짜를 비워 두면 사진의 찍은 날짜로 채워 드려요.';
  }

  // ------------------------------------------------------------ 2. 기록·사진
  function dayDates(t) {
    var set = {};
    L.tripDates(t).forEach(function (d) { set[d] = 1; });
    t.entries.forEach(function (e) { if (L.isDate(e.date)) set[e.date] = 1; });
    t.photos.forEach(function (p) { var d = L.photoDate(p); if (d && !L.needsDate(t, p)) set[d] = 1; });
    return Object.keys(set).sort();
  }
  function photoFigure(p) {
    var url = thumbUrl(p), time = L.timeOf(L.photoStamp(p));
    return '<figure class="ph">' + (url ? '<img src="' + esc(url) + '" alt="' + esc(p.name) + '" loading="lazy">' : '<span class="noimg">' + esc(p.name) + '<br>(미리보기 없음)</span>') +
      (L.hasPos(p) ? '' : '<span class="nopos">위치 없음</span>') +
      '<button type="button" class="del" data-del-photo="' + esc(p.id) + '" aria-label="사진 ' + esc(p.name) + ' 지우기">지우기</button>' +
      '<figcaption>' + esc(time || (p.dateSource === 'file' ? '파일 날짜' : '')) + (p.dateSource === 'file' ? ' · 파일 날짜' : '') + '</figcaption></figure>';
  }
  function renderLog(t) {
    var groups = {};
    L.groupByDay(t.photos.filter(function (p) { return !L.needsDate(t, p); })).forEach(function (g) { groups[g.date] = g.photos; });
    groups[''] = t.photos.filter(function (p) { return L.needsDate(t, p); });
    var html = dayDates(t).map(function (d) {
      var n = L.dayNo(t, d), entries = L.entriesOn(t, d).sort(function (a, b) { return (a.time || '') < (b.time || '') ? -1 : 1; });
      var ps = groups[d] || [];
      return '<div class="day"><div class="day-head">' + (n ? '<span class="day-no">Day ' + n + '</span>' : '<span class="tag">여행 기간 밖</span>') +
        '<h3>' + esc(L.dateLabel(d)) + '</h3><span class="small">사진 ' + ps.length + '장</span>' +
        '<button type="button" class="btn tiny" data-new-entry="' + d + '">이날 기록 쓰기</button></div>' +
        entries.map(function (e) {
          var sp = L.splitTitle(e.text);
          return '<div class="entry"><div class="entry-head"><span class="entry-title">' + esc(sp.title || e.place || '기록') + '</span>' +
            '<span class="small">' + esc([e.time, sp.title ? e.place : ''].filter(Boolean).join(' · ')) + '</span></div>' +
            (sp.body ? '<p class="entry-body">' + esc(sp.body) + '</p>' : '<p class="entry-kw">아직 일기가 없어요' + (e.keywords ? ' · 키워드: ' + esc(e.keywords) : '') + '</p>') +
            '<div class="actions"><button type="button" class="btn small" data-edit-entry="' + esc(e.id) + '">고치기</button>' +
            '<button type="button" class="btn small" data-help-entry="' + esc(e.id) + '">일기 도우미</button></div></div>';
        }).join('') +
        (ps.length ? '<div class="album">' + ps.map(photoFigure).join('') + '</div>' : '') + '</div>';
    }).join('');
    var undated = groups[''] || [];
    if (undated.length) {
      html += '<div class="day undated"><div class="day-head"><h3>날짜를 확인할 사진</h3><span class="small">' + undated.length + '장 — 찍은 날짜가 없거나, 파일 날짜가 여행 기간 밖이에요. 날짜를 정하면 그날로 옮겨요</span></div>' +
        undated.map(function (p) {
          return '<div class="undated-row"><span>' + esc(p.name) + (p.fileTime && p.dateSource === 'file' ? ' (파일 날짜 ' + esc(p.fileTime.slice(0, 10)) + ')' : '') + '</span><input type="date" data-date-photo="' + esc(p.id) + '" aria-label="' + esc(p.name) + ' 날짜" value="' + esc(t.start || '') + '">' +
            '<button type="button" class="btn tiny" data-set-date="' + esc(p.id) + '">날짜 정하기</button></div>';
        }).join('') + '<div class="album">' + undated.map(photoFigure).join('') + '</div></div>';
    }
    $('dayList').innerHTML = html || '<p class="hint">아직 기록이 없어요. 사진을 불러오거나 「기록 직접 쓰기」를 눌러 주세요.</p>';
    $('dAuto').hidden = !St.getKey();
  }

  // 사진 불러오기 — 파일마다 EXIF 읽기 → 미리보기 만들기 → 여행에 더하기
  function makeThumb(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        try {
          var max = 480, k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
          var c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', 0.78));
        } catch (e) { resolve(''); }
        URL.revokeObjectURL(url);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(''); };
      img.src = url;
    });
  }
  function importPhotos(files) {
    var t = cur(); if (!t || !files.length) return;
    var box = $('importResult'); box.hidden = false; box.className = 'note';
    var have = {}; t.photos.forEach(function (p) { have[L.photoKey(p)] = 1; });
    var res = { added: 0, dated: 0, located: 0, fileDated: 0, dup: 0, notJpeg: 0, over: 0 };
    var list = Array.prototype.slice.call(files), i = 0;
    function next() {
      if (i >= list.length) return finish();
      var f = list[i++];
      box.textContent = '사진 읽는 중… ' + i + ' / ' + list.length;
      if (t.photos.length >= L.LIMITS.photosPerTrip) { res.over++; return next(); }
      f.arrayBuffer().then(function (buf) {
        var ex = X.parse(buf);
        if (!ex) res.notJpeg++;
        var p = { id: L.uid('p'), name: f.name, size: f.size, takenAt: ex ? ex.takenAt : '', fileTime: '', dateSource: 'exif',
          lat: ex ? ex.lat : null, lng: ex ? ex.lng : null, offset: ex ? ex.offset : '', entryId: '' };
        if (!p.takenAt) {
          // EXIF 날짜가 없으면 파일의 마지막 수정 시각으로 짐작한다(메신저로 받은 사진은 받은 날일 수 있음)
          if (f.lastModified) { p.fileTime = L.localStamp(new Date(f.lastModified)); p.dateSource = 'file'; res.fileDated++; }
          else p.dateSource = 'none';
        } else res.dated++;
        if (have[L.photoKey(p)]) { res.dup++; return next(); }
        have[L.photoKey(p)] = 1;
        if (L.hasPos(p)) res.located++;
        return makeThumb(f).then(function (u) {
          if (u) { thumbs[p.id] = u; St.putThumb(p.id, u); }
          t.photos.push(p); res.added++;
          next();
        });
      }, function () { res.notJpeg++; next(); });
    }
    function finish() {
      var range = L.photoDateRange(t.photos.filter(function (p) { return p.dateSource === 'exif'; }));
      var filled = false;
      if (range && !t.start && !t.end) { t.start = range.start; t.end = range.end; filled = true; fillTripForm(); }
      var added = L.addCountriesFromPhotos(t, WORLD);
      save();
      var days = L.groupByDay(t.photos.filter(function (p) { return !L.needsDate(t, p); })).filter(function (g) { return g.date; }).length;
      var check = t.photos.filter(function (p) { return L.needsDate(t, p); }).length;
      box.innerHTML = '사진 <b>' + res.added + '장</b>을 더했어요 — 찍은 날짜 ' + res.dated + '장, 위치 ' + res.located + '장' +
        (res.fileDated ? ', 날짜를 파일에서 짐작 ' + res.fileDated + '장' : '') + '. 모두 ' + days + '일로 묶였어요.' + (check ? ' 날짜를 확인할 사진이 ' + check + '장 있어요.' : '') +
        (res.dup ? '<br>이미 있는 사진 ' + res.dup + '장은 건너뛰었어요.' : '') +
        (res.notJpeg ? '<br>JPEG 가 아니어서 날짜·위치를 읽지 못한 파일 ' + res.notJpeg + '개(HEIC 등).' : '') +
        (res.over ? '<br>한 여행의 사진 한도(' + L.LIMITS.photosPerTrip + '장)를 넘은 ' + res.over + '장은 넣지 않았어요.' : '') +
        (filled ? '<br>여행 기간을 사진 날짜(' + range.start + ' ~ ' + range.end + ')로 채웠어요.' : '') +
        (added.length ? '<br>사진 위치에서 찾은 나라를 더했어요: ' + added.map(esc).join(', ') : '') +
        '<br>「사진으로 날짜별 기록 만들기」를 누르면 날마다 기록이 생겨요.';
      $('photoInput').value = '';
      renderTab();
    }
    next();
  }

  // 기록 편집
  function openEntry(e, focusHelper) {
    ui.entryId = e.id;
    $('entryPanel').hidden = false;
    $('entryTitle').textContent = cur().entries.some(function (x) { return x.id === e.id; }) ? '기록 고치기' : '기록 쓰기';
    $('eDate').value = e.date || ''; $('eTime').value = e.time || ''; $('ePlace').value = e.place || '';
    $('eKeywords').value = e.keywords || ''; $('eText').value = e.text || '';
    $('eDate').dataset.lat = e.lat == null ? '' : e.lat; $('eDate').dataset.lng = e.lng == null ? '' : e.lng;
    showPos(); $('eDateErr').textContent = ''; $('eDelete').hidden = !cur().entries.some(function (x) { return x.id === e.id; });
    $('dPrompt').value = ''; $('dAnswer').value = ''; $('dMsg').textContent = '';
    $('diaryHelper').open = !!focusHelper;
    $('dAuto').hidden = !St.getKey();
    $('entryPanel').scrollIntoView({ block: 'start', behavior: 'smooth' });
    (focusHelper ? $('dMake') : $('ePlace')).focus({ preventScroll: true });
  }
  function showPos() {
    var la = $('eDate').dataset.lat, ln = $('eDate').dataset.lng;
    if (la !== '' && ln !== '') {
      var c = L.countryAt(+la, +ln, WORLD);
      $('ePos').textContent = '위치: ' + (+la).toFixed(4) + ', ' + (+ln).toFixed(4) + (c ? ' (' + c.ko + ')' : '') + ' — 사진에서 가져왔어요.';
      $('eClearPos').hidden = false;
    } else { $('ePos').textContent = '위치: 없음 (사진으로 만든 기록은 첫 사진 위치를 씁니다)'; $('eClearPos').hidden = true; }
  }
  function closeEntry() { ui.entryId = null; $('entryPanel').hidden = true; }
  function entryFromForm() {
    var la = $('eDate').dataset.lat, ln = $('eDate').dataset.lng;
    return { id: ui.entryId, date: $('eDate').value, time: $('eTime').value, place: $('ePlace').value.trim(),
      keywords: $('eKeywords').value, text: $('eText').value, lat: la === '' ? null : +la, lng: ln === '' ? null : +ln };
  }
  function saveEntry() {
    var t = cur(), e = entryFromForm();
    if (!L.isDate(e.date)) { $('eDateErr').textContent = '날짜를 골라 주세요.'; return; }
    var i = t.entries.findIndex(function (x) { return x.id === e.id; });
    if (i < 0) {
      if (t.entries.length >= L.LIMITS.entriesPerTrip) { toast('한 여행의 기록은 ' + L.LIMITS.entriesPerTrip + '편까지예요.'); return; }
      t.entries.push(e);
    } else t.entries[i] = e;
    save(); toast('기록을 저장했어요.'); closeEntry(); renderTab();
  }
  function dayContext(t, e) {
    var photos = t.photos.filter(function (p) { return L.photoDate(p) === e.date; });
    var others = t.entries.filter(function (x) { return x.date === e.date && x.id !== e.id && x.place; }).map(function (x) { return x.place; });
    var r = L.tripRoutes(t).filter(function (x) { return x.date === e.date; })[0];
    return { trip: t, entry: e, photos: photos.sort(function (a, b) { return L.photoStamp(a) < L.photoStamp(b) ? -1 : 1; }), otherPlaces: others, meters: r ? r.meters : 0,
      tone: $('dTone').value, length: $('dLen').value };
  }

  // ------------------------------------------------------------ 3. 동선 지도
  function renderMap(t) {
    var routes = L.tripRoutes(t);
    var sel = $('mDay');
    sel.innerHTML = '<option value="">여행 전체</option>' + routes.map(function (r) {
      return '<option value="' + r.date + '"' + (ui.mapDay === r.date ? ' selected' : '') + '>' + (r.dayNo ? 'Day ' + r.dayNo + ' · ' : '') + esc(L.dateLabel(r.date)) + '</option>';
    }).join('');
    if (ui.mapDay && !routes.some(function (r) { return r.date === ui.mapDay; })) ui.mapDay = '';
    sel.value = ui.mapDay;
    // 지도 폭 = 화면에 보이는 폭 — 휴대폰에서 핀·글자가 작아지지 않게(viewBox 를 줄여 그림)
    var boxW = Math.round($('tripMap').clientWidth || 960), mapW = Math.max(300, Math.min(1200, boxW));
    var out = M.trip({ trip: t, routes: routes, day: ui.mapDay, thumbs: $('mThumbs').checked, width: mapW,
      thumbUrl: function (id) { return thumbUrl(photoById(t, id)); } });
    ui.stops = out.stops;
    $('tripMap').innerHTML = out.svg;
    $('mLegend').innerHTML = out.empty ? '<span>위치가 있는 사진이 아직 없어요. 사진을 불러오면 동선이 그려져요.</span>' :
      routes.filter(function (r) { return !ui.mapDay || r.date === ui.mapDay; }).map(function (r, i) {
        return '<span><span class="sw" style="background:' + M.dayColor(routes.indexOf(r)) + '"></span>' + (r.dayNo ? 'Day ' + r.dayNo + ' ' : '') + esc(L.dateLabel(r.date)) + '</span>';
      }).join('');
    if (ui.pin != null && ui.stops[ui.pin]) showPin(ui.pin); else $('pinInfo').innerHTML = '';
    $('routeList').innerHTML = routes.length ? routes.map(function (r, i) {
      return '<div class="route-row"><span class="dotc" style="background:' + M.dayColor(i) + '"></span><b>' + (r.dayNo ? 'Day ' + r.dayNo : '기간 밖') + ' · ' + esc(L.dateLabel(r.date)) + '</b>' +
        '<span>장소 ' + r.stops.length + '곳 · 직선거리 ' + (Math.round(r.meters / 100) / 10) + 'km</span>' +
        '<span class="stop-btns">' + r.stops.map(function (s, k) {
          // 핀이 겹쳐 누르기 어려운 곳도 여기서 고를 수 있게 — 지도에 그려진 순서(ui.stops)의 번호를 찾아 둔다
          var n = ui.stops.findIndex(function (x) { return x.stop === s; });
          return n < 0 ? esc(L.timeOf(s.at) || '시각 없음') : '<button type="button" class="btn tiny" data-stop-btn="' + n + '">' + (k + 1) + '. ' + esc(L.timeOf(s.at) || '시각 없음') + '</button>';
        }).join(' ') + '</span></div>';
    }).join('') : '<p class="hint">위치가 있는 사진이나 좌표가 있는 기록이 없어요.</p>';
  }
  function showPin(n) {
    var t = cur(), s = ui.stops[n]; if (!s) return;
    ui.pin = n;
    document.querySelectorAll('#tripMap .pin').forEach(function (g) { g.classList.toggle('on', +g.dataset.stop === n); });
    var ps = s.stop.refs.filter(function (r) { return r.indexOf('p:') === 0; }).map(function (r) { return photoById(t, r.slice(2)); }).filter(Boolean);
    var es = s.stop.refs.filter(function (r) { return r.indexOf('e:') === 0; }).map(function (r) { return t.entries.filter(function (e) { return e.id === r.slice(2); })[0]; }).filter(Boolean);
    var entry = es[0] || (ps[0] && t.entries.filter(function (e) { return e.id === ps[0].entryId; })[0]);
    var c = L.countryAt(s.stop.lat, s.stop.lng, WORLD);
    var img = ps.map(function (p) { return thumbUrl(p) ? '<img src="' + esc(thumbUrl(p)) + '" alt="' + esc(p.name) + '">' : ''; }).join('');
    $('pinInfo').innerHTML = '<div class="pin-card">' + img + '<div class="txt"><b>' + (s.dayNo ? 'Day ' + s.dayNo + ' · ' : '') + s.order + '번째 장소</b>' +
      '<p class="small">' + esc(L.dateLabel(s.date)) + (L.timeOf(s.stop.at) ? ' ' + L.timeOf(s.stop.at) : '') + ' · ' + s.stop.lat.toFixed(4) + ', ' + s.stop.lng.toFixed(4) + (c ? ' (' + esc(c.ko) + ')' : '') + '</p>' +
      (ps.length ? '<p class="small">사진 ' + ps.length + '장: ' + ps.map(function (p) { return esc(p.name); }).join(', ') + '</p>' : '') +
      (entry ? '<p>' + esc(entry.place || '') + '</p><button type="button" class="btn small" data-goto-entry="' + esc(entry.id) + '">이날 기록 보기</button>' : '') + '</div></div>';
  }

  // ------------------------------------------------------------ 4. 경비
  function resetExpenseForm() {
    ui.expenseId = null; var t = cur();
    $('xAmount').value = ''; $('xMemo').value = ''; $('xAmountErr').textContent = ''; $('xDateErr').textContent = '';
    $('xDate').value = ui.lastDate || (t && t.start) || new Date().toISOString().slice(0, 10);
    $('xSubmit').textContent = '추가'; $('xCancel').hidden = true; xPreview();
  }
  function xPreview() {
    var t = cur(); if (!t) return;
    var a = L.parseAmount($('xAmount').value), c = $('xCur').value;
    if (!(a > 0)) { $('xPreview').textContent = ''; return; }
    var h = L.toHome({ amount: a, currency: c }, t.rates, t.home);
    $('xPreview').textContent = c === t.home ? '' : (h.ok ? '= ' + L.won(h.value) + ' (1 ' + c + ' = ' + t.rates[c] + '원)' : c + ' 환율을 아래 「환율」에 적으면 원으로 환산해요.');
  }
  function renderMoney(t) {
    if (!$('xCat').options.length) {
      $('xCat').innerHTML = L.EXPENSE_CATEGORIES.map(function (c) { return '<option>' + c + '</option>'; }).join('');
      $('xCur').innerHTML = L.CURRENCIES.map(function (c) { return '<option value="' + c[0] + '">' + c[0] + ' · ' + c[1] + '</option>'; }).join('');
      $('xCur').value = ui.lastCur;
    }
    var tot = L.expenseTotals(t.expenses, t.rates, t.home);
    // 환율: 이 여행에서 쓴 외화 + 지금 고른 통화
    var curs = {};
    t.expenses.forEach(function (x) { if (x.currency !== t.home) curs[x.currency] = 1; });
    Object.keys(t.rates).forEach(function (c) { curs[c] = 1; });
    if ($('xCur').value !== t.home) curs[$('xCur').value] = 1;
    $('rateList').innerHTML = Object.keys(curs).sort().map(function (c) {
      var miss = tot.missing.indexOf(c) >= 0;
      return '<div class="rate-row"><label class="inline-label" for="rate-' + c + '">1 ' + c + ' =</label>' +
        '<input id="rate-' + c + '" type="text" inputmode="decimal" data-rate="' + c + '" value="' + (t.rates[c] || '') + '" placeholder="예: 9.12"><span>원</span>' +
        (miss ? '<span class="missing">환율이 없어 합계에서 빠졌어요</span>' : '') + '</div>';
    }).join('') || '<p class="hint">외화 지출을 적으면 여기에 환율 칸이 생겨요.</p>';
    var cats = Object.keys(tot.byCategory).sort(function (a, b) { return tot.byCategory[b] - tot.byCategory[a]; });
    var max = cats.length ? tot.byCategory[cats[0]] : 1;
    var days = Object.keys(tot.byDay).sort();
    $('xTotals').innerHTML = '<p class="total-big">' + L.won(tot.total) + '</p><p class="small">지출 ' + tot.count + '건' +
      (tot.missing.length ? ' · <b style="color:var(--neg)">환율 없는 ' + tot.missing.join('·') + ' ' + tot.excluded + '건 제외</b>' : '') +
      ' · 원래 통화: ' + Object.keys(tot.byCurrency).map(function (c) { return L.comma(tot.byCurrency[c]) + ' ' + c; }).join(', ') + '</p>' +
      (cats.length ? '<h3>분류별</h3><div class="bars">' + cats.map(function (c) {
        return '<div class="bar-row"><span>' + esc(c) + '</span><span class="bar"><i style="width:' + Math.max(2, Math.round(tot.byCategory[c] / max * 100)) + '%"></i></span><span>' + L.won(tot.byCategory[c]) + '</span></div>';
      }).join('') + '</div>' : '') +
      (days.length ? '<h3>날짜별</h3><div class="table-wrap"><table><thead><tr><th>날짜</th><th class="num">합계</th></tr></thead><tbody>' + days.map(function (d) {
        var n = L.dayNo(t, d);
        return '<tr><td>' + (d ? (n ? 'Day ' + n + ' · ' : '') + esc(L.dateLabel(d)) : '날짜 없음') + '</td><td class="num">' + L.won(tot.byDay[d]) + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '');
    var rows = t.expenses.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    $('xList').innerHTML = rows.length ? '<div class="table-wrap"><table><thead><tr><th>날짜</th><th>내용</th><th class="num">금액</th><th class="num">원 환산</th><th></th></tr></thead><tbody>' +
      rows.map(function (x) {
        var h = L.toHome(x, t.rates, t.home);
        return '<tr class="x-row"><td class="num">' + esc(x.date.slice(5)) + '</td><td>' + esc(x.category) + (x.memo ? '<br><span class="small">' + esc(x.memo) + '</span>' : '') + '</td>' +
          '<td class="num">' + L.comma(x.amount) + ' ' + x.currency + '</td><td class="num">' + (h.ok ? L.won(h.value) : '환율 없음') + '</td>' +
          '<td class="num"><button type="button" class="btn tiny" data-edit-x="' + esc(x.id) + '">고치기</button><button type="button" class="btn tiny" data-del-x="' + esc(x.id) + '">지우기</button></td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="hint">아직 지출이 없어요.</p>';
  }
  function submitExpense() {
    var t = cur();
    var x = { id: ui.expenseId || L.uid('x'), date: $('xDate').value, amount: L.parseAmount($('xAmount').value),
      currency: $('xCur').value, category: $('xCat').value, memo: $('xMemo').value.trim() };
    var e = L.validExpense(x);
    $('xAmountErr').textContent = e.amount || ''; $('xDateErr').textContent = e.date || '';
    if (!L.ok(e)) return;
    var i = t.expenses.findIndex(function (y) { return y.id === x.id; });
    if (i >= 0) t.expenses[i] = x;
    else {
      if (t.expenses.length >= L.LIMITS.expensesPerTrip) { toast('한 여행의 지출은 ' + L.LIMITS.expensesPerTrip + '건까지예요.'); return; }
      t.expenses.push(x);
    }
    ui.lastCur = x.currency; ui.lastDate = x.date;
    save(); toast(i >= 0 ? '지출을 고쳤어요.' : '지출을 추가했어요.'); resetExpenseForm(); renderTab();
    $('xAmount').focus();
  }

  // ------------------------------------------------------------ 5. 요약·내보내기
  function renderExport(t) {
    $('rAuto').hidden = !St.getKey(); $('dAuto').hidden = !St.getKey();
    if (document.activeElement !== $('rText')) $('rText').value = t.report || '';
    drawCard(t);
  }
  function drawCard(t) {
    var cv = $('cardCanvas'), g = cv.getContext('2d'), S = 1080, s = L.tripStats(t);
    var F = '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';
    g.fillStyle = '#f7f3ea'; g.fillRect(0, 0, S, S);
    g.fillStyle = '#1f5f6b'; g.fillRect(0, 0, S, 14);
    g.fillStyle = '#1f5f6b'; g.font = '800 30px ' + F; g.fillText('J O U R N A L', 64, 86);
    g.fillStyle = '#17262a'; g.font = '800 60px ' + F;
    fitText(g, t.title || '나의 여행', 64, 168, S - 128);
    g.font = '500 30px ' + F; g.fillStyle = '#4f6166';
    g.fillText((t.start ? t.start.replace(/-/g, '.') + ' – ' + (t.end || '').replace(/-/g, '.').slice(5) + ' · ' : '') + s.periodLabel, 64, 218);
    var names = t.countries.map(function (id) { return L.countryName(id, id); }).join(' · ');
    g.fillStyle = '#17262a'; g.font = '600 30px ' + F;
    fitText(g, [names, t.cities.join(', ')].filter(Boolean).join('  |  ') || '나라·도시를 적어 주세요', 64, 266, S - 128);
    // 지도
    var mx = 64, my = 300, mw = S - 128, mh = 470;
    g.save(); roundRect(g, mx, my, mw, mh, 22); g.clip();
    g.fillStyle = '#e3eef3'; g.fillRect(mx, my, mw, mh);
    var routes = L.tripRoutes(t), pts = [];
    routes.forEach(function (r) { pts = pts.concat(r.stops); });
    var bbox = L.boundsOf(pts);
    if (!bbox) t.countries.forEach(function (id) {
      var c = WORLD.countries.filter(function (x) { return x.id === id; })[0];
      if (c) bbox = bbox ? [Math.min(bbox[0], c.bbox[0]), Math.min(bbox[1], c.bbox[1]), Math.max(bbox[2], c.bbox[2]), Math.max(bbox[3], c.bbox[3])] : c.bbox.slice();
    });
    if (!bbox) bbox = M.WORLD_BOX;
    var proj = L.projection(bbox, mw, { pad: 0.22, minSpan: 0.06, minH: mh, maxH: mh });
    g.translate(mx, my + (mh - proj.H) / 2);
    WORLD.countries.forEach(function (c) {
      var d = L.countryPath(c, proj); if (!d) return;
      var p = new Path2D(d);
      g.fillStyle = t.countries.indexOf(c.id) >= 0 ? '#cfe7e2' : '#f3efe6'; g.fill(p, 'evenodd');
      g.strokeStyle = '#c9c2b2'; g.lineWidth = 1.2; g.stroke(p);
    });
    routes.forEach(function (r, i) {
      g.strokeStyle = M.dayColor(i); g.lineWidth = 6; g.lineJoin = g.lineCap = 'round';
      g.beginPath(); r.stops.forEach(function (st, k) { var x = proj.x(st.lng), y = proj.y(st.lat); if (k) g.lineTo(x, y); else g.moveTo(x, y); }); g.stroke();
      r.stops.forEach(function (st) { g.beginPath(); g.arc(proj.x(st.lng), proj.y(st.lat), 11, 0, Math.PI * 2); g.fillStyle = M.dayColor(i); g.fill(); g.lineWidth = 4; g.strokeStyle = '#fff'; g.stroke(); });
    });
    g.restore();
    // 숫자
    var money = $('cMoney').checked;
    var boxes = [[s.photos + '장', '사진'], [s.written + '편', '일기'], [s.km + 'km', '사진으로 잰 이동']];
    if (money) boxes.push([shortWon(s.expense.total), '경비']); else boxes.push([s.countries + '곳', '나라']);
    var bw = (S - 128 - 3 * 20) / 4;
    boxes.forEach(function (b, i) {
      var x = 64 + i * (bw + 20), y = 800;
      g.fillStyle = '#ffffff'; roundRect(g, x, y, bw, 150, 18); g.fill();
      g.fillStyle = '#1f5f6b'; g.font = '800 44px ' + F; fitText(g, b[0], x + 22, y + 72, bw - 44);
      g.fillStyle = '#4f6166'; g.font = '500 26px ' + F; fitText(g, b[1], x + 22, y + 118, bw - 44);
    });
    g.fillStyle = '#4f6166'; g.font = '500 24px ' + F;
    g.fillText('JOURNAL · 여행 기록일지 · 지도 Natural Earth', 64, S - 56);
  }
  function shortWon(n) {
    if (n >= 1e8) return (Math.round(n / 1e7) / 10) + '억원';
    if (n >= 1e4) return L.comma(Math.round(n / 1e4)) + '만원';
    return L.won(n);
  }
  function fitText(g, text, x, y, maxW) {
    var t = String(text);
    while (t.length > 1 && g.measureText(t).width > maxW) t = t.slice(0, -2) + '…';
    g.fillText(t, x, y);
  }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }
  function buildPrint(t) {
    var s = L.tripStats(t), tot = s.expense;
    var routes = L.tripRoutes(t);
    var map = M.trip({ trip: t, routes: routes, day: '', thumbs: false, width: 960 }).svg;
    var groups = {}; L.groupByDay(t.photos.filter(function (p) { return !L.needsDate(t, p); })).forEach(function (g) { groups[g.date] = g.photos; });
    var days = dayDates(t).map(function (d) {
      var n = L.dayNo(t, d);
      var es = L.entriesOn(t, d);
      var ps = groups[d] || [];
      if (!es.length && !ps.length) return '';
      return '<section class="p-day"><h2>' + (n ? 'Day ' + n + ' · ' : '') + esc(L.dateLabel(d)) + '</h2>' +
        es.map(function (e) {
          var sp = L.splitTitle(e.text);
          return '<h3>' + esc(sp.title || e.place || '기록') + (e.time ? ' <small>' + esc(e.time) + '</small>' : '') + '</h3>' +
            (sp.title && e.place ? '<p class="p-meta">' + esc(e.place) + '</p>' : '') +
            '<p class="p-text">' + esc(sp.body || e.keywords || '') + '</p>';
        }).join('') +
        (ps.length ? '<div class="p-photos">' + ps.map(function (p) { return thumbUrl(p) ? '<img src="' + esc(thumbUrl(p)) + '" alt="">' : ''; }).join('') + '</div>' : '') + '</section>';
    }).join('');
    var cats = Object.keys(tot.byCategory);
    $('printView').innerHTML = '<h1>' + esc(t.title) + '</h1><p class="p-meta">' + esc(s.periodLabel) + (t.start ? ' · ' + esc(t.start) + ' ~ ' + esc(t.end) : '') +
      ' · ' + t.countries.map(function (id) { return esc(L.countryName(id, id)); }).join(', ') + (t.cities.length ? ' · ' + t.cities.map(esc).join(', ') : '') + '</p>' +
      '<p class="p-meta">사진 ' + s.photos + '장 · 일기 ' + s.written + '편 · 사진으로 잰 이동 ' + s.km + 'km · 경비 ' + L.won(tot.total) + '</p>' +
      (t.report ? '<h2>여행 리포트</h2><div class="p-report">' + esc(t.report) + '</div>' : '') +
      '<h2>동선</h2>' + map + days +
      (cats.length ? '<h2>경비</h2><table><thead><tr><th>분류</th><th class="num">원 환산</th></tr></thead><tbody>' +
        cats.map(function (c) { return '<tr><td>' + esc(c) + '</td><td class="num">' + L.won(tot.byCategory[c]) + '</td></tr>'; }).join('') +
        '<tr><th>합계</th><th class="num">' + L.won(tot.total) + '</th></tr></tbody></table>' +
        '<p class="p-meta">환율(직접 입력): ' + Object.keys(t.rates).map(function (c) { return '1 ' + c + ' = ' + t.rates[c] + '원'; }).join(', ') + (tot.missing.length ? ' · 환율 없는 ' + tot.missing.join(', ') + ' 제외' : '') + '</p>' : '');
  }

  // 백업
  function exportJson() {
    var out = { schemaVersion: L.SCHEMA_VERSION, exportedAt: new Date().toISOString(), trips: db.trips };
    var p = Promise.resolve();
    if ($('bThumbs').checked) {
      out.thumbs = {};
      var ids = []; db.trips.forEach(function (t) { t.photos.forEach(function (ph) { if (!ph.src) ids.push(ph.id); }); });
      p = Promise.all(ids.map(function (id) { return St.getThumb(id).then(function (u) { if (u) out.thumbs[id] = u; }); }));
    }
    p.then(function () {
      download('journal-backup-' + new Date().toISOString().slice(0, 10) + '.json', new Blob([JSON.stringify(out)], { type: 'application/json' }));
    });
  }
  function importJson(file) {
    file.text().then(function (txt) {
      var o; try { o = JSON.parse(txt); } catch (e) { toast('JSON 파일을 읽지 못했어요.'); return; }
      var errs = L.checkDb(o);
      if (errs.length) { toast('가져오지 못했어요: ' + errs[0]); return; }
      if (!confirm('지금 있는 여행 ' + db.trips.length + '개를 백업 파일의 여행 ' + o.trips.length + '개로 바꿀까요?')) return;
      var jobs = Object.keys(o.thumbs || {}).map(function (id) { thumbs[id] = o.thumbs[id]; return St.putThumb(id, o.thumbs[id]); });
      Promise.all(jobs).then(function () {
        db = { schemaVersion: L.SCHEMA_VERSION, trips: o.trips, currentId: (o.trips[0] || {}).id || '' };
        save(); fillTripForm(); toast('여행 ' + o.trips.length + '개를 가져왔어요.'); renderTab();
      });
    });
  }

  // ------------------------------------------------------------ 이벤트
  function bind() {
    document.querySelector('.tabs').addEventListener('click', function (ev) { var b = ev.target.closest('[role=tab]'); if (b) setTab(b.dataset.tab); });
    $('tripSel').addEventListener('change', function () { switchTrip(this.value); });
    function newTrip() {
      if (db.trips.length >= L.LIMITS.trips) { toast('여행은 ' + L.LIMITS.trips + '개까지예요.'); return; }
      var t = L.newTrip('새 여행'); db.trips.push(t); switchTrip(t.id); setTab('trip'); $('tTitle').select(); $('tTitle').focus();
    }
    function sample() {
      var k = window.JSamples.kansai();
      var had = db.trips.some(function (t) { return t.id === k.id; });
      if (had && !confirm('예시 여행을 처음 상태로 다시 불러올까요? (예시 여행에서 고친 내용은 사라져요)')) return;
      db.trips = db.trips.filter(function (t) { return !t.sample; });
      db.trips = [k].concat(window.JSamples.past(), db.trips);
      switchTrip(k.id); toast('예시 여행을 불러왔어요. 사진·위치·환율은 모두 가상입니다.');
    }
    $('btnNewTrip').onclick = newTrip; $('btnNewTrip2').onclick = newTrip;
    $('btnSample').onclick = sample; $('btnSample2').onclick = sample;
    ['tTitle', 'tStart', 'tEnd', 'tMemo'].forEach(function (id) { $(id).addEventListener('input', onTripInput); });
    $('btnCountryAdd').onclick = function () {
      var id = $('tCountryAdd').value, t = cur(); if (!id) { $('tCountryAdd').focus(); return; }
      if (t.countries.indexOf(id) < 0) t.countries.push(id); save(); renderTab();
    };
    function addCities() {
      var t = cur(), n = 0;
      $('tCityAdd').value.split(/[,，、]/).map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (c) { if (t.cities.indexOf(c) < 0 && t.cities.length < 100) { t.cities.push(c); n++; } });
      $('tCityAdd').value = ''; if (n) { save(); renderTab(); }
    }
    $('btnCityAdd').onclick = addCities;
    $('tCityAdd').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addCities(); } });
    $('btnDelTrip').onclick = function () {
      var t = cur(); if (!t) return;
      var i = db.trips.indexOf(t), copy = L.clone(t);
      db.trips.splice(i, 1); db.currentId = (db.trips[0] || {}).id || ''; save(); fillTripForm(); renderTab();
      toast('「' + (t.title || '여행') + '」을 지웠어요.', function () { db.trips.splice(i, 0, copy); db.currentId = copy.id; save(); fillTripForm(); renderTab(); });
    };

    document.body.addEventListener('click', function (ev) {
      var el = ev.target.closest('[data-del-country],[data-del-city],[data-trip],[data-new-entry],[data-edit-entry],[data-help-entry],[data-del-photo],[data-set-date],[data-edit-x],[data-del-x],[data-goto-entry],[data-stop-btn],#tripMap [data-stop]');
      if (!el) return;
      var t = cur(), d = el.dataset;
      if (d.delCountry) { t.countries = t.countries.filter(function (x) { return x !== d.delCountry; }); save(); renderTab(); }
      else if (d.delCity) { t.cities.splice(+d.delCity, 1); save(); renderTab(); }
      else if (d.trip) switchTrip(d.trip);
      else if (d.newEntry) openEntry(L.newEntry(d.newEntry));
      else if (d.editEntry) openEntry(t.entries.filter(function (e) { return e.id === d.editEntry; })[0]);
      else if (d.helpEntry) openEntry(t.entries.filter(function (e) { return e.id === d.helpEntry; })[0], true);
      else if (d.gotoEntry) { setTab('log'); openEntry(t.entries.filter(function (e) { return e.id === d.gotoEntry; })[0]); }
      else if (d.delPhoto) {
        var i = t.photos.findIndex(function (p) { return p.id === d.delPhoto; }); if (i < 0) return;
        var p = t.photos[i], url = thumbs[p.id];
        t.photos.splice(i, 1); if (!p.src) St.delThumbs([p.id]); save(); renderTab();
        toast('사진 ' + p.name + ' 을 뺐어요.', function () { t.photos.splice(i, 0, p); if (url) { thumbs[p.id] = url; St.putThumb(p.id, url); } save(); renderTab(); });
      } else if (d.setDate) {
        var inp = document.querySelector('[data-date-photo="' + d.setDate + '"]'), ph = photoById(t, d.setDate);
        if (!L.isDate(inp.value)) { inp.focus(); return; }
        ph.fileTime = inp.value + 'T12:00:00'; ph.dateSource = 'manual'; save(); renderTab();
      } else if (d.editX) {
        var x = t.expenses.filter(function (y) { return y.id === d.editX; })[0]; if (!x) return;
        ui.expenseId = x.id; $('xDate').value = x.date; $('xAmount').value = x.amount; $('xCur').value = x.currency; $('xCat').value = x.category; $('xMemo').value = x.memo || '';
        $('xSubmit').textContent = '고친 내용 저장'; $('xCancel').hidden = false; xPreview(); $('xAmount').focus();
      } else if (d.delX) {
        var k = t.expenses.findIndex(function (y) { return y.id === d.delX; }), old = t.expenses[k];
        t.expenses.splice(k, 1); save(); renderTab();
        toast('지출을 지웠어요.', function () { t.expenses.splice(k, 0, old); save(); renderTab(); });
      } else if (d.stopBtn != null) { showPin(+d.stopBtn); $('tripMap').scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      else if (d.stop != null) showPin(+d.stop);
    });
    $('tripMap').addEventListener('keydown', function (ev) { var g = ev.target.closest('[data-stop]'); if (g && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); showPin(+g.dataset.stop); } });

    // 사진
    $('photoInput').addEventListener('change', function () { importPhotos(this.files); });
    $('btnMakeEntries').onclick = function () {
      var t = cur(), n = L.entriesFromPhotos(t, WORLD);
      save(); renderTab();
      toast(n ? '기록 ' + n + '편을 만들었어요. 「고치기」로 장소 이름과 일기를 적어 주세요.' : '새로 만들 날이 없어요(사진이 없거나 이미 기록이 있어요).');
    };
    $('btnNewEntry').onclick = function () { var t = cur(); openEntry(L.newEntry(t.start || '')); };
    $('entryForm').addEventListener('submit', function (e) { e.preventDefault(); saveEntry(); });
    $('eCancel').onclick = closeEntry;
    $('eClearPos').onclick = function () { $('eDate').dataset.lat = ''; $('eDate').dataset.lng = ''; showPos(); };
    $('eDelete').onclick = function () {
      var t = cur(), i = t.entries.findIndex(function (x) { return x.id === ui.entryId; }); if (i < 0) return;
      var e = t.entries[i], linked = t.photos.filter(function (p) { return p.entryId === e.id; });
      t.entries.splice(i, 1); linked.forEach(function (p) { p.entryId = ''; }); save(); closeEntry(); renderTab();
      toast('기록을 지웠어요(사진은 남아 있어요).', function () { t.entries.splice(i, 0, e); linked.forEach(function (p) { p.entryId = e.id; }); save(); renderTab(); });
    };
    $('dMake').onclick = function () {
      var t = cur(), e = entryFromForm();
      if (!L.isDate(e.date)) { $('dMsg').textContent = '먼저 날짜를 골라 주세요.'; $('eDate').focus(); return; }
      var text = L.diaryPrompt(dayContext(t, e));
      $('dPrompt').value = text;
      copyText(text, $('dPrompt')).then(function (ok) { $('dMsg').textContent = ok ? '요청문을 복사했어요. ChatGPT·Copilot 에 붙여 넣고, 받은 답을 아래 칸에 붙여 넣어 주세요.' : '복사가 막혔어요. 요청문 칸을 길게 눌러 직접 복사해 주세요.'; });
    };
    $('dAuto').onclick = function () {
      var t = cur(), e = entryFromForm();
      if (!L.isDate(e.date)) { $('dMsg').textContent = '먼저 날짜를 골라 주세요.'; return; }
      var text = L.diaryPrompt(dayContext(t, e)); $('dPrompt').value = text;
      $('dMsg').textContent = 'OpenAI 에 요청하는 중…'; $('dAuto').disabled = true;
      window.JAI.write({ key: St.getKey(), prompt: text }).then(function (a) { $('dAnswer').value = a; $('dMsg').textContent = '답을 받았어요. 읽어 보고 「일기 칸에 넣기」를 눌러 주세요.'; },
        function (err) { $('dMsg').textContent = err.message; }).then(function () { $('dAuto').disabled = false; });
    };
    $('dApply').onclick = function () {
      var sp = L.splitTitle($('dAnswer').value);
      if (!sp.body) { $('dMsg').textContent = '붙여 넣은 답이 없어요.'; $('dAnswer').focus(); return; }
      $('eText').value = (sp.title ? '제목: ' + sp.title + '\n\n' : '') + sp.body;
      $('dMsg').textContent = '일기 칸에 넣었어요. 고칠 곳을 고친 뒤 「저장」을 눌러 주세요.';
      $('eText').focus();
    };

    // 지도
    $('mDay').addEventListener('change', function () { ui.mapDay = this.value; ui.pin = null; renderTab(); });
    $('mThumbs').addEventListener('change', function () { renderTab(); });

    // 경비
    $('xForm').addEventListener('submit', function (e) { e.preventDefault(); submitExpense(); });
    $('xCancel').onclick = function () { resetExpenseForm(); };
    $('xAmount').addEventListener('input', xPreview);
    $('xCur').addEventListener('change', function () { ui.lastCur = this.value; xPreview(); renderTab(); });
    $('rateList').addEventListener('input', function (ev) {
      var c = ev.target.dataset.rate; if (!c) return;
      var t = cur(), v = L.parseRate(ev.target.value);
      if (v > 0) t.rates[c] = v; else delete t.rates[c];
      save(); xPreview();
      clearTimeout(ui.rateTimer); ui.rateTimer = setTimeout(function () { var f = document.activeElement && document.activeElement.id; renderTab(); if (f && $(f)) { $(f).focus(); var n = $(f).value.length; try { $(f).setSelectionRange(n, n); } catch (e) { /* 무시 */ } } }, 600);
    });

    // 내보내기
    $('cMoney').addEventListener('change', function () { drawCard(cur()); });
    $('btnCardPng').onclick = function () {
      var t = cur(); drawCard(t);
      $('cardCanvas').toBlob(function (b) { if (b) download('journal-card-' + (t.start || 'trip') + '.png', b); else toast('이미지를 만들지 못했어요.'); }, 'image/png');
    };
    $('btnPrint').onclick = function () { buildPrint(cur()); setTimeout(function () { window.print(); }, 50); };
    $('rMake').onclick = function () {
      var text = L.reportPrompt(cur(), WORLD); $('rPrompt').value = text;
      copyText(text, $('rPrompt')).then(function (ok) { $('rMsg').textContent = ok ? '요청문을 복사했어요. 받은 답을 「여행 리포트」 칸에 붙여 넣어 주세요.' : '복사가 막혔어요. 요청문 칸에서 직접 복사해 주세요.'; });
    };
    $('rAuto').onclick = function () {
      var text = L.reportPrompt(cur(), WORLD); $('rPrompt').value = text;
      $('rMsg').textContent = 'OpenAI 에 요청하는 중…'; $('rAuto').disabled = true;
      window.JAI.write({ key: St.getKey(), prompt: text }).then(function (a) { $('rText').value = a; cur().report = a; save(); $('rMsg').textContent = '리포트를 넣었어요. 고칠 곳은 바로 고치면 저장돼요.'; },
        function (err) { $('rMsg').textContent = err.message; }).then(function () { $('rAuto').disabled = false; });
    };
    $('rText').addEventListener('input', function () { cur().report = this.value; save(); });
    $('btnExport').onclick = exportJson;
    $('importInput').addEventListener('change', function () { if (this.files[0]) importJson(this.files[0]); this.value = ''; });
    $('btnKeySave').onclick = function () {
      var k = $('aiKey').value.trim();
      if (!/^sk-[A-Za-z0-9_\-]{10,}$/.test(k)) { $('keyMsg').textContent = '키 형식이 맞지 않아요(sk- 로 시작).'; return; }
      $('keyMsg').textContent = St.setKey(k) ? '키를 이 브라우저에 저장했어요.' : '저장하지 못했어요.'; $('aiKey').value = ''; renderTab();
    };
    $('btnKeyDel').onclick = function () { St.setKey(''); $('keyMsg').textContent = '키를 지웠어요.'; renderTab(); };
    $('btnReset').onclick = function () {
      if (!confirm('모든 여행과 사진 미리보기를 이 브라우저에서 지울까요? (백업을 먼저 내려받아 두세요)')) return;
      var ids = []; db.trips.forEach(function (t) { t.photos.forEach(function (p) { ids.push(p.id); }); });
      St.delThumbs(ids); db = fresh(); save(); closeEntry(); renderTab(); toast('모두 지웠어요.');
    };
    window.addEventListener('beforeprint', function () { if (cur()) buildPrint(cur()); });
  }

  // ------------------------------------------------------------ 시작
  function start() {
    var saved = St.load();
    db = saved && saved.schemaVersion === L.SCHEMA_VERSION && Array.isArray(saved.trips) ? saved : fresh();
    bind();
    if (cur()) { db.currentId = cur().id; fillTripForm(); loadThumbs(cur()); }
    resetExpenseForm();
    setTab('trip');
    St.persistent().then(function (ok) { if (!ok) toast('이 브라우저에서는 사진 미리보기를 이번 창에서만 보관해요(사생활 보호 모드 등).'); });
  }
  start();
})();
