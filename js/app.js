/*
 * JOURNAL — 화면. 계산은 JLogic(js/logic.js), EXIF 는 JournalExif(js/exif.js), 지도 그림은 JMap(js/map.js).
 * 저장: 여행·기록·경비·사진 정보 = localStorage, 사진 미리보기 = IndexedDB (js/store.js).
 * 도시 이름 자료(vendor/cities15000.js, 약 0.9MB)는 async 로 불러와, 다 오면 화면을 한 번 다시 그린다.
 * HEIC 변환기(vendor/heic2any.min.js, 약 1.3MB)는 브라우저가 HEIC 를 못 열 때만 처음 한 번 불러온다.
 */
(function () {
  'use strict';
  var L = window.JLogic, X = window.JournalExif, St = window.JStore, M = window.JMap, WORLD = window.JOURNAL_WORLD;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  var db = null;                      // { schemaVersion, trips, currentId }
  var thumbs = {};                    // 사진 id → 미리보기 URL (IndexedDB 에서 읽어 둔 것)
  var ui = { tab: 'trip', entryId: null, expenseId: null, mapDay: '', pin: null, lastCur: 'KRW', lastDate: '',
    logView: 'diary', viewCur: 'KRW', lbList: [], lbIndex: 0, lbFrom: null, geoBusy: false, planId: null, planPos: null, planPin: null };
  function CITIES() { return window.JOURNAL_CITIES || null; }     // 아직 안 왔으면 null — 도시 이름 없이 그린다
  function placeOf(p) { return L.placeName(p, CITIES()); }

  // 일반 스크립트를 한 번만 불러온다(file:// 에서도 되는 방식)
  var scriptJobs = {};
  function loadScript(src) {
    if (!scriptJobs[src]) scriptJobs[src] = new Promise(function (resolve, reject) {
      var el = document.createElement('script');
      el.src = src; el.onload = function () { resolve(); };
      el.onerror = function () { delete scriptJobs[src]; reject(new Error(src + ' 를 불러오지 못했어요.')); };
      document.head.appendChild(el);
    });
    return scriptJobs[src];
  }

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
    ({ trip: renderTrip, plan: renderPlan, log: renderLog, map: renderMap, money: renderMoney, settle: renderSettle, export: renderExport })[ui.tab](t);
  }
  function switchTrip(id) {
    db.currentId = id; ui.entryId = null; ui.expenseId = null; ui.mapDay = ''; ui.pin = null;
    ui.planPin = null; save(); fillTripForm(); closeEntry(); resetExpenseForm(); resetPlanForm(); loadThumbs(cur()); renderTab();
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


  // ------------------------------------------------------------ 1-2. 여행 일정 (2026-09-30)
  function plansOf(t) { if (!Array.isArray(t.plans)) t.plans = []; return t.plans; }
  function planById(t, id) { return plansOf(t).filter(function (p) { return p.id === id; })[0]; }
  function planTime(p) {
    var a = p.start || '', b = p.end || '', multi = p.endDate && p.endDate !== p.date;
    if (multi) return (a || '') + ' → ' + L.dateLabel(p.endDate).replace(/ \(.\)$/, '') + (b ? ' ' + b : '');
    return a && b ? a + ' ~ ' + b : a || (b ? '~ ' + b : '시각 미정');
  }
  function expenseLabel(t, x) {
    return x.date.slice(5).replace('-', '/') + ' · ' + x.category + (x.memo ? ' · ' + x.memo : '') + ' · ' + L.comma(x.amount) + ' ' + x.currency;
  }
  function fillPlanSelects(t, sel) {
    if (!$('pType').options.length) {
      $('pType').innerHTML = L.PLAN_TYPES.map(function (c) { return '<option>' + c + '</option>'; }).join('');
      $('pCur').innerHTML = L.CURRENCIES.map(function (c) { return '<option value="' + c[0] + '">' + c[0] + ' · ' + c[1] + '</option>'; }).join('');
    }
    var xs = t.expenses.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    $('pExpense').innerHTML = '<option value="">연결 안 함</option><option value="__new">새 지출로 적기(아래 금액)</option>' +
      xs.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(expenseLabel(t, x)) + '</option>'; }).join('');
    $('pExpense').value = sel === '__new' || (sel && xs.some(function (x) { return x.id === sel; })) ? sel : '';
    $('pNewCost').hidden = $('pExpense').value !== '__new';
  }
  function showPlanPos() {
    var pos = ui.planPos;
    $('pClearPos').hidden = !pos; $('pPosErr').textContent = '';
    if (!pos) { $('pPosNote').textContent = '위치를 넣으면 「동선 지도」에 계획 핀이 생겨요.'; return; }
    var c = L.countryAt(pos.lat, pos.lng, WORLD), city = L.cityAt(pos.lat, pos.lng, CITIES());
    $('pPosNote').textContent = '지도 위치: ' + pos.lat.toFixed(4) + ', ' + pos.lng.toFixed(4) + ' (' + ([city ? city.name : '', c ? c.ko : ''].filter(Boolean).join(', ') || '도시 정보 없음') + ')';
  }
  function resetPlanForm(date) {
    var t = cur(); ui.planId = null; ui.planPos = null;
    if (!t) return;
    fillPlanSelects(t, '');
    $('pType').value = '관광'; $('pTitle').value = ''; $('pDate').value = date || $('pDate').value || t.start || '';
    $('pStart').value = ''; $('pEndDate').value = ''; $('pEnd').value = ''; $('pPlace').value = ''; $('pPos').value = '';
    $('pBooking').value = ''; $('pMemo').value = ''; $('pDone').checked = false; $('pAmount').value = ''; $('pCur').value = ui.lastCur;
    $('pCityHits').innerHTML = '';
    ['pTitleErr', 'pDateErr', 'pEndDateErr', 'pEndErr', 'pAmountErr'].forEach(function (id) { $(id).textContent = ''; });
    $('pSubmit').textContent = '추가'; $('pCancel').hidden = true; $('pDelete').hidden = true;
    showPlanPos();
  }
  function editPlan(p) {
    var t = cur(); ui.planId = p.id; ui.planPos = L.hasPos(p) ? { lat: p.lat, lng: p.lng } : null;
    fillPlanSelects(t, p.expenseId);
    $('pType').value = p.type; $('pTitle').value = p.title; $('pDate').value = p.date; $('pStart').value = p.start || '';
    $('pEndDate').value = p.endDate || ''; $('pEnd').value = p.end || ''; $('pPlace').value = p.place || '';
    $('pPos').value = ui.planPos ? ui.planPos.lat + ', ' + ui.planPos.lng : '';
    $('pBooking').value = p.booking || ''; $('pMemo').value = p.memo || ''; $('pDone').checked = !!p.done;
    $('pCityHits').innerHTML = '';
    $('pSubmit').textContent = '고친 내용 저장'; $('pCancel').hidden = false; $('pDelete').hidden = false;
    showPlanPos();
    $('pForm').scrollIntoView({ block: 'start', behavior: 'smooth' });
    $('pTitle').focus({ preventScroll: true });
  }
  function renderPlan(t) {
    if (document.activeElement !== $('pExpense')) fillPlanSelects(t, $('pExpense').value);   // 지출 목록이 바뀌었을 수 있어 다시 채우되 고른 값은 둔다
    var pr = L.planProgress(t), over = L.planOverlaps(plansOf(t));
    $('pProgress').textContent = pr.total ? '확인 ' + pr.done + ' / ' + pr.total : '';
    var days = L.plansByDay(t);
    $('planList').innerHTML = days.length ? days.map(function (g) {
      return '<div class="plan-day"><div class="day-head">' + (g.dayNo ? '<span class="day-no">Day ' + g.dayNo + '</span>' : '<span class="tag">여행 기간 밖</span>') +
        '<h3>' + esc(L.dateLabel(g.date)) + '</h3><button type="button" class="btn tiny" data-new-plan="' + g.date + '">이날 일정 더하기</button></div>' +
        (g.plans.length ? g.plans.map(function (p) {
          var cost = L.planCost(t, p), ov = over.indexOf(p.id) >= 0;
          return '<div class="plan-item' + (p.done ? ' done' : '') + (ov ? ' overlap' : '') + '">' +
            '<input type="checkbox" data-plan-done="' + esc(p.id) + '"' + (p.done ? ' checked' : '') + ' aria-label="' + esc(p.title) + ' 확인 끝">' +
            '<div><div class="plan-head"><span class="plan-time">' + esc(planTime(p)) + '</span><span class="plan-type">' + esc(p.type) + '</span><span class="plan-title">' + esc(p.title) + '</span></div>' +
            (p.place || L.hasPos(p) ? '<p class="plan-meta">' + esc(p.place || '') + (L.hasPos(p) ? (p.place ? ' · ' : '') + '지도 위치 있음' : '') + '</p>' : '') +
            (p.booking ? '<p class="plan-meta">예약 번호 ' + esc(p.booking) + '</p>' : '') +
            (cost ? '<p class="plan-meta">비용 ' + esc(L.comma(cost.expense.amount) + ' ' + cost.expense.currency) + (cost.expense.currency !== t.home ? ' (' + (cost.won == null ? '환율 없음' : L.won(cost.won)) + ')' : '') + ' — 경비에 적힘</p>' : '') +
            (p.memo ? '<p class="plan-meta">' + esc(p.memo) + '</p>' : '') +
            (ov ? '<p class="plan-warn">같은 날 시각이 겹치는 일정이 있어요.</p>' : '') +
            '<div class="actions"><button type="button" class="btn tiny" data-edit-plan="' + esc(p.id) + '">고치기</button>' +
            (L.hasPos(p) ? '<button type="button" class="btn tiny" data-plan-map="' + esc(p.id) + '">지도에서 보기</button>' : '') +
            '<button type="button" class="btn tiny" data-del-plan="' + esc(p.id) + '">지우기</button></div></div></div>';
        }).join('') : '<p class="small">아직 일정이 없어요.</p>') + '</div>';
    }).join('') : '<p class="hint">여행 기간을 적거나 왼쪽에서 일정을 더하면 날짜별 일정표가 생겨요.</p>';
  }
  function submitPlan() {
    var t = cur(), ps = plansOf(t);
    var p = { id: ui.planId || L.uid('pl'), type: $('pType').value, title: $('pTitle').value.trim(), date: $('pDate').value,
      start: $('pStart').value, endDate: $('pEndDate').value, end: $('pEnd').value, place: $('pPlace').value.trim(),
      lat: ui.planPos ? ui.planPos.lat : null, lng: ui.planPos ? ui.planPos.lng : null, booking: $('pBooking').value.trim(),
      memo: $('pMemo').value.trim(), expenseId: $('pExpense').value === '__new' ? '' : $('pExpense').value, done: $('pDone').checked };
    if (p.endDate === p.date) p.endDate = '';
    // 좌표 칸에 적었는데 아직 반영 안 된 값
    if ($('pPos').value.trim()) {
      var pos = L.parseLatLng($('pPos').value);
      if (!pos) { $('pPosErr').textContent = '「위도, 경도」 모양으로 적어 주세요(예: 34.6655, 135.5010).'; $('pPos').focus(); return; }
      p.lat = pos.lat; p.lng = pos.lng;
    } else if (!ui.planPos) { p.lat = null; p.lng = null; }
    var e = L.validPlan(p);
    $('pTitleErr').textContent = e.title || ''; $('pDateErr').textContent = e.date || ''; $('pEndDateErr').textContent = e.endDate || '';
    $('pEndErr').textContent = e.end || e.start || '';
    if (!L.ok(e)) return;
    var newX = null;
    if ($('pExpense').value === '__new') {
      var a = L.parseAmount($('pAmount').value);
      newX = L.expenseFromPlan(p, a, $('pCur').value);
      var ex = L.validExpense(newX);
      $('pAmountErr').textContent = ex.amount || '';
      if (!L.ok(ex)) return;
      if (t.expenses.length >= L.LIMITS.expensesPerTrip) { toast('한 여행의 지출은 ' + L.LIMITS.expensesPerTrip + '건까지예요.'); return; }
      t.expenses.push(newX); p.expenseId = newX.id; ui.lastCur = newX.currency;
    }
    var i = ps.findIndex(function (y) { return y.id === p.id; });
    if (i >= 0) ps[i] = p;
    else {
      if (ps.length >= L.LIMITS.plansPerTrip) { toast('한 여행의 일정은 ' + L.LIMITS.plansPerTrip + '개까지예요.'); return; }
      ps.push(p);
    }
    save(); toast((i >= 0 ? '일정을 고쳤어요.' : '일정을 더했어요.') + (newX ? ' 비용은 「경비」에도 적었어요.' : ''));
    resetPlanForm(p.date); renderTab(); $('pTitle').focus();
  }
  function deletePlan(id) {
    var t = cur(), ps = plansOf(t), k = ps.findIndex(function (y) { return y.id === id; }); if (k < 0) return;
    var old = ps[k]; ps.splice(k, 1); if (ui.planId === old.id) resetPlanForm(); save(); renderTab();
    toast('일정을 지웠어요' + (old.expenseId ? '(연결한 지출은 경비에 남아 있어요)' : '') + '.', function () { ps.splice(k, 0, old); save(); renderTab(); });
  }
  function planInfo(t, p) {
    var cost = L.planCost(t, p);
    return '<div class="pin-card"><div class="txt"><b>계획 · ' + esc(p.type) + ' · ' + esc(p.title) + '</b>' +
      '<p class="small">' + esc(L.dateLabel(p.date)) + ' ' + esc(planTime(p)) + (p.place ? ' · ' + esc(p.place) : '') + (p.done ? ' · 확인 끝' : ' · 아직 확인 전') + '</p>' +
      (p.booking ? '<p class="small">예약 번호 ' + esc(p.booking) + '</p>' : '') +
      (cost ? '<p class="small">비용 ' + esc(L.comma(cost.expense.amount) + ' ' + cost.expense.currency) + '</p>' : '') +
      (p.memo ? '<p>' + esc(p.memo) + '</p>' : '') +
      '<button type="button" class="btn small" data-goto-plan="' + esc(p.id) + '">일정표에서 고치기</button></div></div>';
  }
  function showPlanPin(id) {
    var t = cur(), p = planById(t, id); if (!p) return;
    ui.planPin = id; ui.pin = null; stepLabel();
    document.querySelectorAll('#tripMap .pin').forEach(function (g) { g.classList.remove('on'); });
    document.querySelectorAll('#tripMap .plan-pin').forEach(function (g) { g.classList.toggle('on', g.dataset.planPin === id); });
    $('pinInfo').innerHTML = planInfo(t, p);
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
    var url = thumbUrl(p), time = L.timeOf(L.photoStamp(p)), place = placeOf(p);
    return '<figure class="ph">' + (url ? '<img src="' + esc(url) + '" alt="' + esc(p.name) + '" loading="lazy">' : '<span class="noimg">' + esc(p.name) + '<br>(미리보기 없음)</span>') +
      (L.hasPos(p) ? '' : '<span class="nopos">위치 없음</span>') +
      '<button type="button" class="del" data-del-photo="' + esc(p.id) + '" aria-label="사진 ' + esc(p.name) + ' 지우기">지우기</button>' +
      '<figcaption>' + esc([time || (p.dateSource === 'file' ? '파일 날짜' : ''), place].filter(Boolean).join(' · ')) + (p.dateSource === 'file' && time ? ' · 파일 날짜' : '') + '</figcaption></figure>';
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
    // 보기 방식: 기록(일기 중심) / 사진 크게 보기(앨범 중심)
    var album = ui.logView === 'album';
    document.querySelectorAll('[data-logview]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.logview === ui.logView)); });
    $('dayList').hidden = album; $('gallery').hidden = !album;
    if (album) renderGallery(t, groups);
  }
  // 사진 중심 앨범 — 날짜마다 큰 사진 격자, 누르면 크게 보기(앞뒤 넘기기)
  function renderGallery(t, groups) {
    var list = [], html = '';
    dayDates(t).concat(groups[''] && groups[''].length ? [''] : []).forEach(function (d) {
      var ps = groups[d] || [];
      if (!ps.length) return;
      var n = d ? L.dayNo(t, d) : 0, names = [];
      ps.forEach(function (p) { var nm = placeOf(p); if (nm && names.indexOf(nm) < 0) names.push(nm); });
      var entry = d ? L.entriesOn(t, d)[0] : null, title = entry ? (L.splitTitle(entry.text).title || '') : '';
      html += '<section class="g-day"><h3>' + (d ? (n ? 'Day ' + n + ' · ' : '') + esc(L.dateLabel(d)) : '날짜를 확인할 사진') +
        (names.length ? ' <span class="g-places">' + names.map(esc).join(' · ') + '</span>' : '') + '</h3>' +
        (title ? '<p class="g-title">' + esc(title) + '</p>' : '') + '<div class="gallery">' +
        ps.map(function (p) {
          var i = list.length, url = thumbUrl(p); list.push(p);
          return '<button type="button" class="g-item" data-lb="' + i + '" aria-label="' + esc(p.name) + ' 크게 보기">' +
            (url ? '<img src="' + esc(url) + '" alt="" loading="lazy">' : '<span class="noimg">' + esc(p.name) + '<br>(미리보기 없음)</span>') +
            '<span class="g-cap">' + esc([L.timeOf(L.photoStamp(p)), placeOf(p)].filter(Boolean).join(' · ')) + '</span></button>';
        }).join('') + '</div></section>';
    });
    ui.lbList = list;
    $('gallery').innerHTML = html || '<p class="hint">아직 사진이 없어요. 왼쪽 「사진 고르기」로 불러와 주세요.</p>';
  }
  function openLightbox(i, from) {
    if (!ui.lbList.length) return;
    ui.lbIndex = (i + ui.lbList.length) % ui.lbList.length;
    if (from) ui.lbFrom = from;
    var t = cur(), p = ui.lbList[ui.lbIndex], url = thumbUrl(p), d = L.photoDate(p), n = d ? L.dayNo(t, d) : 0;
    $('lbImg').src = url || ''; $('lbImg').alt = p.name; $('lbImg').hidden = !url;
    $('lbCap').textContent = [(n ? 'Day ' + n + ' · ' : '') + (d ? L.dateLabel(d) : '날짜 없음'), L.timeOf(L.photoStamp(p)), placeOf(p), p.name,
      (ui.lbIndex + 1) + ' / ' + ui.lbList.length].filter(Boolean).join(' · ');
    $('lightbox').hidden = false;
    $('lbClose').focus();
  }
  function closeLightbox() {
    $('lightbox').hidden = true; $('lbImg').src = '';
    if (ui.lbFrom && document.body.contains(ui.lbFrom)) ui.lbFrom.focus();
    ui.lbFrom = null;
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
  // HEIC 미리보기 — 사파리는 직접 연다(위 makeThumb). 못 열면 heic2any 를 한 번 불러와 JPEG 로 바꾼 뒤 줄인다.
  function heicThumb(file) {
    return loadScript('vendor/heic2any.min.js').then(function () {
      if (typeof window.heic2any !== 'function') throw new Error('변환기 없음');
      return window.heic2any({ blob: file, toType: 'image/jpeg', quality: 0.8 });
    }).then(function (out) { return makeThumb(Array.isArray(out) ? out[0] : out); }).catch(function () { return ''; });
  }
  function thumbFor(file, ex) {
    return makeThumb(file).then(function (u) { return u || (ex && ex.format === 'heic' ? heicThumb(file) : ''); });
  }
  function importPhotos(files) {
    var t = cur(); if (!t || !files.length) return;
    var box = $('importResult'); box.hidden = false; box.className = 'note';
    var have = {}; t.photos.forEach(function (p) { have[L.photoKey(p)] = 1; });
    var res = { added: 0, dated: 0, located: 0, fileDated: 0, dup: 0, notJpeg: 0, over: 0, heic: 0, noThumb: 0 };
    var list = Array.prototype.slice.call(files), i = 0;
    function next() {
      if (i >= list.length) return finish();
      var f = list[i++];
      box.textContent = '사진 읽는 중… ' + i + ' / ' + list.length;
      if (t.photos.length >= L.LIMITS.photosPerTrip) { res.over++; return next(); }
      f.arrayBuffer().then(function (buf) {
        var ex = X.parse(buf);
        if (!ex) res.notJpeg++;
        else if (ex.format === 'heic') res.heic++;
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
        if (ex && ex.format === 'heic') box.textContent = '사진 읽는 중… ' + i + ' / ' + list.length + ' (HEIC 미리보기 만드는 중)';
        return thumbFor(f, ex).then(function (u) {
          if (u) { thumbs[p.id] = u; St.putThumb(p.id, u); } else res.noThumb++;
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
      var addedCities = CITIES() ? L.addCitiesFromPhotos(t, CITIES()) : [];
      save();
      var days = L.groupByDay(t.photos.filter(function (p) { return !L.needsDate(t, p); })).filter(function (g) { return g.date; }).length;
      var check = t.photos.filter(function (p) { return L.needsDate(t, p); }).length;
      box.innerHTML = '사진 <b>' + res.added + '장</b>을 더했어요 — 찍은 날짜 ' + res.dated + '장, 위치 ' + res.located + '장' +
        (res.fileDated ? ', 날짜를 파일에서 짐작 ' + res.fileDated + '장' : '') + '. 모두 ' + days + '일로 묶였어요.' + (check ? ' 날짜를 확인할 사진이 ' + check + '장 있어요.' : '') +
        (res.dup ? '<br>이미 있는 사진 ' + res.dup + '장은 건너뛰었어요.' : '') +
        (res.heic ? '<br>아이폰 HEIC 사진 ' + res.heic + '장의 날짜·위치를 읽었어요.' : '') +
        (res.noThumb ? '<br>미리보기를 만들지 못한 사진 ' + res.noThumb + '장 — 날짜·위치는 그대로 쓰고, 앨범에는 파일 이름으로 보여요.' : '') +
        (res.notJpeg ? '<br>JPEG·HEIC 가 아니어서 날짜·위치를 읽지 못한 파일 ' + res.notJpeg + '개(PNG·동영상 등).' : '') +
        (res.over ? '<br>한 여행의 사진 한도(' + L.LIMITS.photosPerTrip + '장)를 넘은 ' + res.over + '장은 넣지 않았어요.' : '') +
        (filled ? '<br>여행 기간을 사진 날짜(' + range.start + ' ~ ' + range.end + ')로 채웠어요.' : '') +
        (added.length ? '<br>사진 위치에서 찾은 나라를 더했어요: ' + added.map(esc).join(', ') : '') +
        (addedCities.length ? '<br>가까운 도시를 더했어요: ' + addedCities.map(esc).join(', ') + ' (여행 화면에서 뺄 수 있어요)' : '') +
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
      var c = L.countryAt(+la, +ln, WORLD), city = L.cityAt(+la, +ln, CITIES());
      $('ePos').textContent = '위치: ' + (+la).toFixed(4) + ', ' + (+ln).toFixed(4) + ' (' + [city ? city.name : '', c ? c.ko : ''].filter(Boolean).join(', ') + ') — 사진에서 가져왔어요.';
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
    var routes = L.tripRoutes(t), showPlans = $('mPlans').checked, planR = showPlans ? L.planRoutes(t) : [];
    var sel = $('mDay'), dset = {};
    routes.concat(planR).forEach(function (r) { dset[r.date] = r.dayNo; });
    var dates = Object.keys(dset).sort();
    sel.innerHTML = '<option value="">여행 전체</option>' + dates.map(function (d) {
      return '<option value="' + d + '"' + (ui.mapDay === d ? ' selected' : '') + '>' + (dset[d] ? 'Day ' + dset[d] + ' · ' : '') + esc(L.dateLabel(d)) + '</option>';
    }).join('');
    if (ui.mapDay && !dset.hasOwnProperty(ui.mapDay)) ui.mapDay = '';
    sel.value = ui.mapDay;
    // 지도 폭 = 화면에 보이는 폭 — 휴대폰에서 핀·글자가 작아지지 않게(viewBox 를 줄여 그림)
    var boxW = Math.round($('tripMap').clientWidth || 960), mapW = Math.max(300, Math.min(1200, boxW));
    var out = M.trip({ trip: t, routes: routes, plans: planR, day: ui.mapDay, thumbs: $('mThumbs').checked, width: mapW,
      thumbUrl: function (id) { return thumbUrl(photoById(t, id)); } });
    ui.stops = out.stops;
    $('tripMap').innerHTML = out.svg;
    $('mLegend').innerHTML = out.empty ? '<span>위치가 있는 사진이나 일정이 아직 없어요. 사진을 불러오거나 「일정」에 위치를 넣으면 지도에 그려져요.</span>' :
      routes.filter(function (r) { return !ui.mapDay || r.date === ui.mapDay; }).map(function (r, i) {
        return '<span><span class="sw" style="background:' + M.dayColor(routes.indexOf(r)) + '"></span>' + (r.dayNo ? 'Day ' + r.dayNo + ' ' : '') + esc(L.dateLabel(r.date)) + ' (사진)</span>';
      }).join('') + (out.plans ? '<span><span class="sw planline"></span><span class="sw plan"></span>계획한 일정 ' + out.plans + '곳 (네모 안 글자 = 종류)</span>' : '');
    if (ui.pin != null && ui.stops[ui.pin]) showPin(ui.pin);
    else if (ui.planPin && showPlans && document.querySelector('#tripMap [data-plan-pin="' + ui.planPin + '"]')) showPlanPin(ui.planPin);
    else { ui.planPin = null; $('pinInfo').innerHTML = ''; stepLabel(); }
    var g = St.getGeo(); $('geoActs').hidden = !(g.on && g.key && ui.stops.length);
    $('routeList').innerHTML = routes.length ? routes.map(function (r, i) {
      return '<div class="route-row"><span class="dotc" style="background:' + M.dayColor(i) + '"></span><b>' + (r.dayNo ? 'Day ' + r.dayNo : '기간 밖') + ' · ' + esc(L.dateLabel(r.date)) + '</b>' +
        '<span>장소 ' + r.stops.length + '곳 · 직선거리 ' + (Math.round(r.meters / 100) / 10) + 'km</span>' +
        '<span class="stop-btns">' + r.stops.map(function (s, k) {
          // 핀이 겹쳐 누르기 어려운 곳도 여기서 고를 수 있게 — 지도에 그려진 순서(ui.stops)의 번호를 찾아 둔다
          var n = ui.stops.findIndex(function (x) { return x.stop === s; });
          var nm = stopName(t, s), label = (k + 1) + '. ' + (L.timeOf(s.at) || '시각 없음') + (nm ? ' ' + nm : '');
          return n < 0 ? esc(label) : '<button type="button" class="btn tiny" data-stop-btn="' + n + '">' + esc(label) + '</button>';
        }).join(' ') + '</span></div>';
    }).join('') : '<p class="hint">위치가 있는 사진이나 좌표가 있는 기록이 없어요.</p>';
  }
  // 장소 이름: 그 점의 사진 중 외부 API 이름이 있으면 그것, 없으면 가까운 도시
  function stopName(t, stop) {
    var ps = stop.refs.filter(function (r) { return r.indexOf('p:') === 0; }).map(function (r) { return photoById(t, r.slice(2)); }).filter(Boolean);
    var api = ps.filter(function (p) { return p.place; })[0];
    return api ? api.place : L.placeName({ lat: stop.lat, lng: stop.lng }, CITIES());
  }
  function stepLabel() {
    var n = ui.stops ? ui.stops.length : 0;
    $('mStep').textContent = n ? (ui.pin != null ? (ui.pin + 1) + ' / ' + n + '번째 장소' : '장소 ' + n + '곳 — 「다음 장소」로 따라가 보세요') : '';
    $('mPrev').disabled = $('mNext').disabled = !n;
  }
  function stepPin(k) {
    if (!ui.stops || !ui.stops.length) return;
    var n = ui.pin == null ? (k > 0 ? 0 : ui.stops.length - 1) : (ui.pin + k + ui.stops.length) % ui.stops.length;
    showPin(n);
  }
  function showPin(n) {
    var t = cur(), s = ui.stops[n]; if (!s) return;
    ui.pin = n; ui.planPin = null; stepLabel();
    document.querySelectorAll('#tripMap .plan-pin').forEach(function (g) { g.classList.remove('on'); });
    document.querySelectorAll('#tripMap .pin').forEach(function (g) { g.classList.toggle('on', +g.dataset.stop === n); });
    var ps = s.stop.refs.filter(function (r) { return r.indexOf('p:') === 0; }).map(function (r) { return photoById(t, r.slice(2)); }).filter(Boolean);
    var es = s.stop.refs.filter(function (r) { return r.indexOf('e:') === 0; }).map(function (r) { return t.entries.filter(function (e) { return e.id === r.slice(2); })[0]; }).filter(Boolean);
    var entry = es[0] || (ps[0] && t.entries.filter(function (e) { return e.id === ps[0].entryId; })[0]);
    var c = L.countryAt(s.stop.lat, s.stop.lng, WORLD);
    var img = ps.map(function (p) { return thumbUrl(p) ? '<img src="' + esc(thumbUrl(p)) + '" alt="' + esc(p.name) + '">' : ''; }).join('');
    var nm = stopName(t, s.stop), api = ps.filter(function (p) { return p.place; })[0];
    $('pinInfo').innerHTML = '<div class="pin-card">' + img + '<div class="txt"><b>' + (s.dayNo ? 'Day ' + s.dayNo + ' · ' : '') + s.order + '번째 장소' + (nm ? ' · ' + esc(nm) : '') + '</b>' +
      (api && api.placeDetail ? '<p class="small">' + esc(api.placeDetail) + ' (외부 지도 API)</p>' : '') +
      '<p class="small">' + esc(L.dateLabel(s.date)) + (L.timeOf(s.stop.at) ? ' ' + L.timeOf(s.stop.at) : '') + ' · ' + s.stop.lat.toFixed(4) + ', ' + s.stop.lng.toFixed(4) + (c ? ' (' + esc(c.ko) + ')' : '') + '</p>' +
      (ps.length ? '<p class="small">사진 ' + ps.length + '장: ' + ps.map(function (p) { return esc(p.name); }).join(', ') + '</p>' : '') +
      (entry ? '<p>' + esc(entry.place || '') + '</p><button type="button" class="btn small" data-goto-entry="' + esc(entry.id) + '">이날 기록 보기</button>' : '') + '</div></div>';
  }

  // ------------------------------------------------------------ 4. 경비
  function resetExpenseForm() {
    ui.expenseId = null; var t = cur();
    $('xAmount').value = ''; $('xMemo').value = ''; $('xAmountErr').textContent = ''; $('xDateErr').textContent = '';
    fillWho(t, null);
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
  // 보기 통화 고르기(원·USD·JPY·EUR) — 경비 한눈에·정산이 같은 값을 쓴다
  function fillViewCur(sel) {
    if (!sel.options.length) sel.innerHTML = ['KRW'].concat(L.VIEW_CURRENCIES).map(function (c) { return '<option value="' + c + '">' + c + '</option>'; }).join('');
    sel.value = ui.viewCur;
  }
  // 보기 통화로 쓴 금액. 그 통화 환율이 없으면 원으로 쓰고 알려 준다
  function vmoney(t, won) {
    var s = L.money(won, ui.viewCur, t.rates, t.home);
    return s || L.money(won, 'KRW', t.rates, t.home);
  }
  function viewCurNote(t) {
    return ui.viewCur !== 'KRW' && !(t.rates[ui.viewCur] > 0) ? '<p class="small missing">' + ui.viewCur + ' 환율이 없어 원으로 보여 드려요. 「경비 → 환율」에 1 ' + ui.viewCur + ' = ?원 을 적어 주세요.</p>' : '';
  }
  // 지출 적기의 「낸 사람·나눌 사람」 — 함께 간 사람이 두 명 이상일 때만 보인다
  function fillWho(t, x) {
    if (!t) return;
    var ms = L.members(t);
    $('xWho').hidden = ms.length < 2;
    if (ms.length < 2) return;
    var payer = x ? L.payerOf(x, ms) : ($('xPaidBy').value && ms.some(function (m) { return m.id === $('xPaidBy').value; }) ? $('xPaidBy').value : ms[0].id);
    $('xPaidBy').innerHTML = ms.map(function (m) { return '<option value="' + esc(m.id) + '">' + esc(m.name) + '</option>'; }).join('');
    $('xPaidBy').value = payer;
    var sel = x ? L.sharersOf(x, ms) : ms.map(function (m) { return m.id; });
    $('xSplit').innerHTML = ms.map(function (m) {
      return '<label class="check"><input type="checkbox" value="' + esc(m.id) + '"' + (sel.indexOf(m.id) >= 0 ? ' checked' : '') + '> ' + esc(m.name) + '</label>';
    }).join('');
  }
  function renderDash(t, tot) {
    fillViewCur($('viewCur'));
    var days = L.nightsDays(t).days || Object.keys(tot.byDay).filter(Boolean).length || 1;
    var cats = Object.keys(tot.byCategory).sort(function (a, b) { return tot.byCategory[b] - tot.byCategory[a]; });
    var eq = L.equivalents(tot.total, t.rates, t.home);
    var tiles = [
      [vmoney(t, tot.total), '총 경비' + (ui.viewCur !== 'KRW' && t.rates[ui.viewCur] > 0 ? ' (' + L.won(tot.total) + ')' : '')],
      [vmoney(t, Math.round(tot.total / days)), '하루 평균 (' + days + '일)'],
      [cats.length ? cats[0] : '-', cats.length ? '가장 많이 쓴 곳 ' + Math.round(tot.byCategory[cats[0]] / (tot.total || 1) * 100) + '%' : '가장 많이 쓴 곳'],
      [tot.count + '건', '지출' + (tot.excluded ? ' (환율 없어 뺀 ' + tot.excluded + '건)' : '')]
    ];
    $('xDash').innerHTML = '<div class="tiles">' + tiles.map(function (x) { return '<div class="tile"><b>' + esc(x[0]) + '</b><span>' + esc(x[1]) + '</span></div>'; }).join('') + '</div>' +
      '<p class="eq">' + L.won(tot.total) + eq.map(function (e) { return ' <span>≈ ' + (e.text ? esc(e.text) : '<span class="missing">' + e.cur + ' 환율 없음</span>') + '</span>'; }).join('') + '</p>' +
      (cats.length ? '<div class="stack" aria-label="분류별 비율">' + cats.map(function (c, i) {
        return '<i style="width:' + (tot.byCategory[c] / (tot.total || 1) * 100).toFixed(2) + '%;background:' + M.dayColor(i) + '" title="' + esc(c) + '"></i>';
      }).join('') + '</div><p class="stack-legend">' + cats.map(function (c, i) {
        return '<span><span class="sw" style="background:' + M.dayColor(i) + '"></span>' + esc(c) + ' ' + Math.round(tot.byCategory[c] / (tot.total || 1) * 100) + '%</span>';
      }).join('') + '</p>' : '') + viewCurNote(t);
  }
  function renderMoney(t) {
    if (!$('xCat').options.length) {
      $('xCat').innerHTML = L.EXPENSE_CATEGORIES.map(function (c) { return '<option>' + c + '</option>'; }).join('');
      $('xCur').innerHTML = L.CURRENCIES.map(function (c) { return '<option value="' + c[0] + '">' + c[0] + ' · ' + c[1] + '</option>'; }).join('');
      $('xCur').value = ui.lastCur;
    }
    var tot = L.expenseTotals(t.expenses, t.rates, t.home);
    renderDash(t, tot);
    if (!ui.expenseId && document.activeElement && !$('xForm').contains(document.activeElement)) fillWho(t, null);
    // 환율: 이 여행에서 쓴 외화 + 지금 고른 통화 + 표시용 USD·JPY·EUR
    var curs = {};
    L.VIEW_CURRENCIES.forEach(function (c) { if (c !== t.home) curs[c] = 1; });
    t.expenses.forEach(function (x) { if (x.currency !== t.home) curs[x.currency] = 1; });
    Object.keys(t.rates).forEach(function (c) { curs[c] = 1; });
    if ($('xCur').value !== t.home) curs[$('xCur').value] = 1;
    $('rateList').innerHTML = Object.keys(curs).sort().map(function (c) {
      var miss = tot.missing.indexOf(c) >= 0;
      return '<div class="rate-row"><label class="inline-label" for="rate-' + c + '">1 ' + c + ' =</label>' +
        '<input id="rate-' + c + '" type="text" inputmode="decimal" data-rate="' + c + '" value="' + (t.rates[c] || '') + '" placeholder="예: 9.12"><span>원</span>' +
        (miss ? '<span class="missing">환율이 없어 합계에서 빠졌어요</span>' : (L.VIEW_CURRENCIES.indexOf(c) >= 0 && !t.expenses.some(function (x) { return x.currency === c; }) ? '<span class="small">표시용</span>' : '')) + '</div>';
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
    var ms = L.members(t), multi = ms.length > 1;
    var nameOf = function (id) { var m = ms.filter(function (y) { return y.id === id; })[0]; return m ? m.name : ''; };
    $('xList').innerHTML = rows.length ? '<div class="table-wrap"><table><thead><tr><th>날짜</th><th>내용</th><th class="num">금액</th><th class="num">원 환산</th><th></th></tr></thead><tbody>' +
      rows.map(function (x) {
        var h = L.toHome(x, t.rates, t.home);
        return '<tr class="x-row"><td class="num">' + esc(x.date.slice(5)) + '</td><td>' + esc(x.category) + (x.memo ? '<br><span class="small">' + esc(x.memo) + '</span>' : '') +
          (multi ? '<br><span class="small">' + esc(nameOf(L.payerOf(x, ms))) + ' 냄</span>' : '') + '</td>' +
          '<td class="num">' + L.comma(x.amount) + ' ' + x.currency + '</td><td class="num">' + (h.ok ? L.won(h.value) : '환율 없음') + '</td>' +
          '<td class="num"><button type="button" class="btn tiny" data-edit-x="' + esc(x.id) + '">고치기</button><button type="button" class="btn tiny" data-del-x="' + esc(x.id) + '">지우기</button></td></tr>';
      }).join('') + '</tbody></table></div>' : '<p class="hint">아직 지출이 없어요.</p>';
  }
  function submitExpense() {
    var t = cur();
    var x = { id: ui.expenseId || L.uid('x'), date: $('xDate').value, amount: L.parseAmount($('xAmount').value),
      currency: $('xCur').value, category: $('xCat').value, memo: $('xMemo').value.trim() };
    var ms = L.members(t);
    if (ms.length > 1) {
      x.paidBy = $('xPaidBy').value;
      var sel = Array.prototype.map.call($('xSplit').querySelectorAll('input:checked'), function (c) { return c.value; });
      if (!sel.length) { toast('나눌 사람을 한 명 이상 골라 주세요.'); return; }
      if (sel.length < ms.length) x.split = sel;
    } else {
      var old = t.expenses.filter(function (y) { return y.id === x.id; })[0];   // 한 사람일 때 고쳐도 예전 정산 정보는 둔다
      if (old && old.paidBy) x.paidBy = old.paidBy;
      if (old && old.split) x.split = old.split;
    }
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

  // ------------------------------------------------------------ 5. 정산
  function renderSettle(t) {
    var ms = L.members(t), st = L.settle(t);
    fillViewCur($('sViewCur'));
    $('sMembers').innerHTML = ms.map(function (m, i) {
      return '<span class="chip">' + esc(m.name) + (i === 0 ? ' <span class="small">(기본으로 낸 사람)</span>' : '') +
        '<button type="button" data-ren-member="' + esc(m.id) + '" aria-label="' + esc(m.name) + ' 이름 바꾸기">이름</button>' +
        (ms.length > 1 ? '<button type="button" data-del-member="' + esc(m.id) + '" aria-label="' + esc(m.name) + ' 빼기">빼기</button>' : '') + '</span>';
    }).join('');
    var name = function (id) { var m = ms.filter(function (x) { return x.id === id; })[0]; return m ? m.name : '?'; };
    var excl = st.excluded.length ? '<p class="small missing">환율이 없어 정산에서 뺀 지출 ' + st.excluded.length + '건 — 「경비 → 환율」에 적으면 들어가요.</p>' : '';
    if (ms.length < 2) {
      $('sTransfers').innerHTML = '<p class="hint">지금은 혼자 간 여행이에요. 왼쪽 위 「함께 간 사람」에 이름을 더하면 정산이 시작돼요.</p>';
      $('sPeople').innerHTML = ''; 
    } else {
      $('sTransfers').innerHTML = (st.transfers && st.transfers.length ?
        '<ol class="transfers">' + st.transfers.map(function (x) {
          return '<li><b>' + esc(name(x.from)) + '</b> → <b>' + esc(name(x.to)) + '</b><span class="amt">' + esc(vmoney(t, x.won)) + '</span>' +
            (ui.viewCur !== 'KRW' && t.rates[ui.viewCur] > 0 ? '<span class="small">' + L.won(x.won) + '</span>' : '') + '</li>';
        }).join('') + '</ol><p class="small">보낼 횟수가 가장 적은 방법이에요(' + st.transfers.length + '번).</p>' :
        '<p class="hint">서로 주고받을 돈이 없어요.</p>') + excl + viewCurNote(t);
      $('sPeople').innerHTML = '<h3>사람별</h3><div class="table-wrap"><table><thead><tr><th>이름</th><th class="num">낸 돈</th><th class="num">부담할 몫</th><th class="num">받을(+) / 낼(−)</th></tr></thead><tbody>' +
        ms.map(function (m) {
          var n = st.net[m.id];
          return '<tr><td>' + esc(m.name) + '</td><td class="num">' + esc(vmoney(t, st.paid[m.id])) + '</td><td class="num">' + esc(vmoney(t, st.owed[m.id])) + '</td>' +
            '<td class="num ' + (n > 0 ? 'pos' : n < 0 ? 'neg' : '') + '">' + (n > 0 ? '+' : '') + esc(vmoney(t, n)) + '</td></tr>';
        }).join('') + '<tr><th>합계</th><th class="num">' + esc(vmoney(t, st.total)) + '</th><th class="num">' + esc(vmoney(t, st.total)) + '</th><th></th></tr></tbody></table></div>';
    }
    var byId = {}; st.items.forEach(function (it) { byId[it.id] = it; });
    var rows = t.expenses.slice().sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    $('sItems').innerHTML = rows.length ? rows.map(function (x) {
      var it = byId[x.id];
      var head = '<div class="st-head"><b>' + esc(x.date.slice(5).replace('-', '/')) + ' · ' + esc(x.category) + (x.memo ? ' · ' + esc(x.memo) + '' : '') + '</b>' +
        '<span>' + (it ? esc(vmoney(t, it.won)) : '환율 없음') + (x.currency !== t.home ? ' <span class="small">(' + L.comma(x.amount) + ' ' + x.currency + ')</span>' : '') + '</span></div>';
      if (ms.length < 2) return '<div class="st-item">' + head + '</div>';
      var payer = L.payerOf(x, ms), who = L.sharersOf(x, ms);
      return '<div class="st-item" data-st="' + esc(x.id) + '">' + head +
        '<div class="st-row"><label class="inline-label">낸 사람<select data-st-payer="' + esc(x.id) + '">' + ms.map(function (m) {
          return '<option value="' + esc(m.id) + '"' + (m.id === payer ? ' selected' : '') + '>' + esc(m.name) + '</option>'; }).join('') + '</select></label></div>' +
        '<div class="st-row checks" role="group" aria-label="나눌 사람">' + ms.map(function (m) {
          return '<label class="check"><input type="checkbox" data-st-split="' + esc(x.id) + '" value="' + esc(m.id) + '"' + (who.indexOf(m.id) >= 0 ? ' checked' : '') + '> ' + esc(m.name) +
            (it && it.shares[m.id] != null ? ' <span class="small">' + esc(vmoney(t, it.shares[m.id])) + '</span>' : '') + '</label>';
        }).join('') + '</div></div>';
    }).join('') : '<p class="hint">아직 지출이 없어요. 「경비」에서 적어 주세요.</p>';
  }
  function memberEdit(t) {
    if (!t.members || !t.members.length) t.members = [{ id: L.ME.id, name: L.ME.name }];
    return t.members;
  }

  // ------------------------------------------------------------ 외부 지도 API (선택)
  function geoLookup(cfg, lat, lng) {
    var rq = L.geoRequest(cfg.provider, lat, lng, cfg.key);
    if (!rq) return Promise.reject(new Error('지도 API 를 골라 주세요.'));
    return fetch(rq.url, { headers: rq.headers }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (j) {
        if (!res.ok && !(j && (j.status || j.errorType))) throw new Error('지도 API 요청 실패 (HTTP ' + res.status + ')');
        var r = L.geoParse(cfg.provider, j);
        if (r.error) throw new Error(r.error);
        return r;
      });
    }, function () { throw new Error('지도 API 에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.'); });
  }
  function geoFetchAll() {
    var t = cur(), cfg = St.getGeo();
    if (ui.geoBusy || !cfg.on || !cfg.key) return;
    var todo = (ui.stops || []).filter(function (s) {
      return s.stop.refs.some(function (r) { var p = r.indexOf('p:') === 0 && photoById(t, r.slice(2)); return p && !p.place; });
    }).slice(0, 60);
    if (!todo.length) { $('geoMsg').textContent = '이미 모든 장소에 이름이 있어요.'; return; }
    ui.geoBusy = true; $('btnGeoFetch').disabled = true;
    var done = 0, i = 0;
    function next() {
      if (i >= todo.length) return finish('');
      var s = todo[i++];
      $('geoMsg').textContent = '장소 이름 받는 중… ' + i + ' / ' + todo.length;
      geoLookup(cfg, s.stop.lat, s.stop.lng).then(function (r) {
        if (r.name) {
          s.stop.refs.forEach(function (ref) { var p = ref.indexOf('p:') === 0 && photoById(t, ref.slice(2)); if (p) { p.place = r.name; p.placeDetail = r.detail || ''; } });
          done++;
        }
        setTimeout(next, 150);
      }, function (err) { finish(err.message); });
    }
    function finish(err) {
      ui.geoBusy = false; $('btnGeoFetch').disabled = false; save(); renderTab();
      $('geoMsg').textContent = (done ? '장소 ' + done + '곳의 이름을 받았어요.' : '') + (err ? ' ' + err : (done ? '' : ' 받은 이름이 없어요.'));
    }
    next();
  }
  function renderGeoSettings() {
    var g = St.getGeo(), sel = $('geoProvider');
    if (!sel.options.length) sel.innerHTML = Object.keys(L.GEO_PROVIDERS).map(function (k) { return '<option value="' + k + '">' + esc(L.GEO_PROVIDERS[k].label) + '</option>'; }).join('');
    $('geoOn').checked = !!g.on; sel.value = g.provider || 'google';
    $('geoKey').placeholder = g.key ? '저장된 키가 있어요(바꾸려면 새로 입력)' : L.GEO_PROVIDERS[sel.value].keyHint;
  }

  // ------------------------------------------------------------ 6. 요약·내보내기
  function renderExport(t) {
    $('rAuto').hidden = !St.getKey(); $('dAuto').hidden = !St.getKey();
    renderGeoSettings();
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
    var map = M.trip({ trip: t, routes: routes, plans: L.planRoutes(t), day: '', thumbs: false, width: 960 }).svg;
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
      printPlans(t) + '<h2>동선</h2>' + (L.planRoutes(t).length ? '<p class="p-meta">색 실선·번호 = 사진으로 그린 실제 동선, 검은 점선·네모 = 계획한 일정</p>' : '') + map + days +
      (cats.length ? '<h2>경비</h2><table><thead><tr><th>분류</th><th class="num">원 환산</th></tr></thead><tbody>' +
        cats.map(function (c) { return '<tr><td>' + esc(c) + '</td><td class="num">' + L.won(tot.byCategory[c]) + '</td></tr>'; }).join('') +
        '<tr><th>합계</th><th class="num">' + L.won(tot.total) + '</th></tr></tbody></table>' +
        '<p class="p-meta">환율(직접 입력): ' + Object.keys(t.rates).map(function (c) { return '1 ' + c + ' = ' + t.rates[c] + '원'; }).join(', ') + (tot.missing.length ? ' · 환율 없는 ' + tot.missing.join(', ') + ' 제외' : '') + '</p>' : '') +
      printSettle(t);
  }
  function printPlans(t) {
    var days = L.plansByDay(t).filter(function (g) { return g.plans.length; });
    if (!days.length) return '';
    var pr = L.planProgress(t);
    return '<h2>여행 일정</h2><p class="p-meta">일정 ' + pr.total + '개 · 확인 끝 ' + pr.done + '개</p>' +
      '<table class="p-plan"><thead><tr><th>날짜</th><th>시각</th><th>종류</th><th>일정 · 장소</th><th>예약 번호 · 메모</th><th>확인</th></tr></thead><tbody>' +
      days.map(function (g) {
        return g.plans.map(function (p, i) {
          var cost = L.planCost(t, p);
          return '<tr><td>' + (i ? '' : (g.dayNo ? 'Day ' + g.dayNo + '<br>' : '') + esc(L.dateLabel(g.date))) + '</td><td>' + esc(planTime(p)) + '</td><td>' + esc(p.type) + '</td>' +
            '<td>' + esc(p.title) + (p.place ? '<br><small>' + esc(p.place) + '</small>' : '') + '</td>' +
            '<td>' + esc(p.booking || '') + (p.memo ? (p.booking ? '<br>' : '') + '<small>' + esc(p.memo) + '</small>' : '') +
            (cost ? '<br><small>비용 ' + esc(L.comma(cost.expense.amount) + ' ' + cost.expense.currency) + '</small>' : '') + '</td><td>' + (p.done ? '✓' : '') + '</td></tr>';
        }).join('');
      }).join('') + '</tbody></table>';
  }
  function printSettle(t) {
    var ms = L.members(t); if (ms.length < 2 || !t.expenses.length) return '';
    var st = L.settle(t), name = function (id) { var m = ms.filter(function (x) { return x.id === id; })[0]; return m ? m.name : '?'; };
    return '<h2>정산</h2><table><thead><tr><th>이름</th><th class="num">낸 돈</th><th class="num">부담할 몫</th><th class="num">받을(+) / 낼(−)</th></tr></thead><tbody>' +
      ms.map(function (m) { return '<tr><td>' + esc(m.name) + '</td><td class="num">' + L.won(st.paid[m.id]) + '</td><td class="num">' + L.won(st.owed[m.id]) + '</td><td class="num">' + (st.net[m.id] > 0 ? '+' : '') + L.won(st.net[m.id]) + '</td></tr>'; }).join('') +
      '</tbody></table>' + (st.transfers && st.transfers.length ? '<p class="p-meta">' + st.transfers.map(function (x) { return esc(name(x.from)) + ' → ' + esc(name(x.to)) + ' ' + L.won(x.won); }).join(' · ') + '</p>' : '');
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
      var el = ev.target.closest('[data-del-country],[data-del-city],[data-trip],[data-new-entry],[data-edit-entry],[data-help-entry],[data-del-photo],[data-set-date],[data-edit-x],[data-del-x],[data-goto-entry],[data-stop-btn],#tripMap [data-stop],[data-new-plan],[data-edit-plan],[data-del-plan],[data-plan-map],[data-goto-plan],[data-city-hit],#tripMap [data-plan-pin]');
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
        fillWho(t, x);
        $('xSubmit').textContent = '고친 내용 저장'; $('xCancel').hidden = false; xPreview(); $('xAmount').focus();
      } else if (d.delX) {
        var k = t.expenses.findIndex(function (y) { return y.id === d.delX; }), old = t.expenses[k];
        t.expenses.splice(k, 1); save(); renderTab();
        toast('지출을 지웠어요.', function () { t.expenses.splice(k, 0, old); save(); renderTab(); });
      } else if (d.stopBtn != null) { showPin(+d.stopBtn); $('tripMap').scrollIntoView({ block: 'center', behavior: 'smooth' }); }
      else if (d.stop != null) showPin(+d.stop);
      else if (d.planPin) showPlanPin(d.planPin);
      else if (d.newPlan) { resetPlanForm(d.newPlan); $('pForm').scrollIntoView({ block: 'start', behavior: 'smooth' }); $('pTitle').focus({ preventScroll: true }); }
      else if (d.editPlan || d.gotoPlan) { var ep = planById(t, d.editPlan || d.gotoPlan); if (!ep) return; if (d.gotoPlan) setTab('plan'); editPlan(ep); }
      else if (d.planMap) { var mp = planById(t, d.planMap); if (!mp) return; ui.mapDay = mp.date; ui.pin = null; ui.planPin = mp.id; $('mPlans').checked = true; setTab('map'); }
      else if (d.delPlan) deletePlan(d.delPlan);
      else if (d.cityHit) {
        var h = ui.cityHits && ui.cityHits[+d.cityHit]; if (!h) return;
        ui.planPos = { lat: h.lat, lng: h.lng }; $('pPos').value = h.lat + ', ' + h.lng;
        if (!$('pPlace').value.trim()) $('pPlace').value = h.name;
        $('pCityHits').innerHTML = ''; showPlanPos();
      }
    });
    $('tripMap').addEventListener('keydown', function (ev) { var g = ev.target.closest('[data-plan-pin]'); if (g && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); showPlanPin(g.dataset.planPin); } });

    // 여행 일정
    $('pForm').addEventListener('submit', function (e) { e.preventDefault(); submitPlan(); });
    $('pCancel').onclick = function () { resetPlanForm(); renderTab(); };
    $('pDelete').onclick = function () { if (ui.planId) deletePlan(ui.planId); };
    $('pExpense').addEventListener('change', function () { $('pNewCost').hidden = this.value !== '__new'; if (this.value === '__new') $('pAmount').focus(); });
    $('planList').addEventListener('change', function (ev) {
      var id = ev.target.dataset.planDone; if (!id) return;
      var p = planById(cur(), id); if (!p) return;
      p.done = ev.target.checked; save(); renderTab();
      var again = document.querySelector('[data-plan-done="' + id + '"]'); if (again) again.focus();
    });
    $('pCityFind').onclick = function () {
      var q = $('pPlace').value.split(/[·,]/)[0].trim();
      if (!q) { $('pPlace').focus(); $('pPosErr').textContent = '장소 칸에 도시 이름을 먼저 적어 주세요(예: 오사카).'; return; }
      if (!CITIES()) { $('pPosErr').textContent = '도시 목록을 아직 불러오는 중이에요. 잠시 뒤 다시 눌러 주세요.'; return; }
      ui.cityHits = L.citySearch(q, CITIES(), 6);
      $('pPosErr').textContent = ui.cityHits.length ? '' : '「' + q + '」 도시를 찾지 못했어요. 인구 1만 5천 명 이상 도시만 있어요 — 좌표를 직접 넣어 주세요.';
      $('pCityHits').innerHTML = ui.cityHits.map(function (h, i) {
        return '<button type="button" class="btn tiny" data-city-hit="' + i + '">' + esc(h.name + ' (' + h.cc + (h.pop ? ', 인구 ' + L.comma(Math.round(h.pop / 1000)) + '천' : '') + ')') + '</button>';
      }).join('');
    };
    $('pPos').addEventListener('change', function () {
      var v = this.value.trim();
      if (!v) { ui.planPos = null; showPlanPos(); return; }
      var pos = L.parseLatLng(v);
      if (pos) { ui.planPos = pos; showPlanPos(); } else $('pPosErr').textContent = '「위도, 경도」 모양으로 적어 주세요(예: 34.6655, 135.5010).';
    });
    $('pClearPos').onclick = function () { ui.planPos = null; $('pPos').value = ''; showPlanPos(); };
    $('mPlans').addEventListener('change', function () { renderTab(); });
    $('tripMap').addEventListener('keydown', function (ev) { var g = ev.target.closest('[data-stop]'); if (g && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); showPin(+g.dataset.stop); } });

    // 앨범 보기 · 크게 보기
    document.querySelectorAll('[data-logview]').forEach(function (b) { b.addEventListener('click', function () { ui.logView = b.dataset.logview; renderTab(); }); });
    $('gallery').addEventListener('click', function (ev) { var b = ev.target.closest('[data-lb]'); if (b) openLightbox(+b.dataset.lb, b); });
    $('lbPrev').onclick = function () { openLightbox(ui.lbIndex - 1); };
    $('lbNext').onclick = function () { openLightbox(ui.lbIndex + 1); };
    $('lbClose').onclick = closeLightbox;
    $('lightbox').addEventListener('click', function (ev) { if (ev.target === this) closeLightbox(); });
    document.addEventListener('keydown', function (ev) {
      if ($('lightbox').hidden) return;
      if (ev.key === 'Escape') { ev.preventDefault(); closeLightbox(); }
      else if (ev.key === 'ArrowLeft') openLightbox(ui.lbIndex - 1);
      else if (ev.key === 'ArrowRight') openLightbox(ui.lbIndex + 1);
      else if (ev.key === 'Tab') {             // 창 안에서만 돌게
        var f = [$('lbPrev'), $('lbNext'), $('lbClose')], k = f.indexOf(document.activeElement);
        ev.preventDefault(); f[(k + (ev.shiftKey ? -1 : 1) + f.length) % f.length].focus();
      }
    });

    // 사진
    $('photoInput').addEventListener('change', function () { importPhotos(this.files); });
    $('btnMakeEntries').onclick = function () {
      var t = cur(), n = L.entriesFromPhotos(t, WORLD, CITIES());
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
    $('mPrev').onclick = function () { stepPin(-1); };
    $('mNext').onclick = function () { stepPin(1); };
    $('btnGeoFetch').onclick = geoFetchAll;

    // 보기 통화 · 정산
    ['viewCur', 'sViewCur'].forEach(function (id) { $(id).addEventListener('change', function () { ui.viewCur = this.value; renderTab(); }); });
    function addMember() {
      var t = cur(), nm = $('sName').value.trim(); if (!nm) { $('sName').focus(); return; }
      var ms = memberEdit(t);
      if (ms.length >= L.LIMITS.members) { toast('함께 간 사람은 ' + L.LIMITS.members + '명까지예요.'); return; }
      if (ms.some(function (m) { return m.name === nm; })) { toast('같은 이름이 이미 있어요.'); return; }
      ms.push({ id: L.uid('m'), name: nm.slice(0, 20) }); $('sName').value = ''; save(); renderTab(); $('sName').focus();
    }
    $('btnMemberAdd').onclick = addMember;
    $('sName').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addMember(); } });
    $('sMembers').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-del-member],[data-ren-member]'); if (!b) return;
      var t = cur(), ms = memberEdit(t);
      if (b.dataset.renMember) {
        var m = ms.filter(function (x) { return x.id === b.dataset.renMember; })[0], nm = m && prompt('새 이름', m.name);
        if (nm && nm.trim()) { m.name = nm.trim().slice(0, 20); save(); renderTab(); }
        return;
      }
      var id = b.dataset.delMember, used = t.expenses.filter(function (x) { return x.paidBy === id || (x.split || []).indexOf(id) >= 0; }).length;
      if (used && !confirm('이 사람이 들어간 지출이 ' + used + '건 있어요. 빼면 그 지출은 첫 사람이 낸 것으로, 나머지 사람끼리 나누는 것으로 바뀌어요. 뺄까요?')) return;
      t.members = ms.filter(function (x) { return x.id !== id; });
      t.expenses.forEach(function (x) {
        if (x.paidBy === id) delete x.paidBy;
        if (x.split) { x.split = x.split.filter(function (y) { return y !== id; }); if (!x.split.length) delete x.split; }
      });
      if (t.members.length === 1 && t.members[0].id === L.ME.id && t.members[0].name === L.ME.name) t.members = [];
      save(); renderTab();
    });
    $('sItems').addEventListener('change', function (ev) {
      var el = ev.target, t = cur(), ms = L.members(t);
      var id = el.dataset.stPayer || el.dataset.stSplit, x = t.expenses.filter(function (y) { return y.id === id; })[0]; if (!x) return;
      if (el.dataset.stPayer) x.paidBy = el.value;
      else {
        var sel = Array.prototype.map.call(document.querySelectorAll('[data-st-split="' + id + '"]:checked'), function (c) { return c.value; });
        if (!sel.length) { el.checked = true; toast('나눌 사람을 한 명 이상 골라 주세요.'); return; }
        if (sel.length === ms.length) delete x.split; else x.split = sel;
      }
      save(); renderTab();
      var again = document.querySelector('[data-st-payer="' + id + '"]'); if (again && el.dataset.stPayer) again.focus();
    });

    // 외부 지도 API 설정
    $('geoProvider').addEventListener('change', function () { $('geoKey').placeholder = L.GEO_PROVIDERS[this.value].keyHint; });
    $('btnGeoSave').onclick = function () {
      var g = St.getGeo(), k = $('geoKey').value.trim();
      var o = { on: $('geoOn').checked, provider: $('geoProvider').value, key: k || (g.provider === $('geoProvider').value ? g.key : '') };
      if (o.on && !o.key) { $('geoSetMsg').textContent = '켜려면 API 키를 넣어 주세요.'; return; }
      $('geoSetMsg').textContent = St.setGeo(o) ? (o.on ? '저장했어요. 「동선 지도」에서 「외부 지도 API 로 장소 이름 받기」를 눌러 주세요.' : '저장했어요(꺼짐 — 도시 이름만 씁니다).') : '저장하지 못했어요.';
      $('geoKey').value = ''; renderTab();
    };
    $('btnGeoDel').onclick = function () { St.setGeo(null); $('geoSetMsg').textContent = '키를 지우고 껐어요.'; renderTab(); };

    // 경비
    $('xForm').addEventListener('submit', function (e) { e.preventDefault(); submitExpense(); });
    $('xCancel').onclick = function () { resetExpenseForm(); };
    $('xAmount').addEventListener('input', xPreview);
    $('xCur').addEventListener('change', function () { ui.lastCur = this.value; xPreview(); renderTab(); });
    $('xSplit').addEventListener('change', function (ev) {
      if (!this.querySelector('input:checked')) { ev.target.checked = true; toast('나눌 사람을 한 명 이상 골라 주세요.'); }
    });
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
    resetExpenseForm(); resetPlanForm();
    setTab('trip');
    St.persistent().then(function (ok) { if (!ok) toast('이 브라우저에서는 사진 미리보기를 이번 창에서만 보관해요(사생활 보호 모드 등).'); });
    // 도시 이름 자료가 늦게 오면 그때 한 번 다시 그린다
    if (!CITIES() && $('citiesScript')) $('citiesScript').addEventListener('load', function () { renderTab(); });
  }
  start();
})();
