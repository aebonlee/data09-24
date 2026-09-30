/*
 * JOURNAL — 저장소
 *  - 여행·기록·경비·사진 정보(글자)  : localStorage `data09-24.db` 한 칸
 *  - 사진 미리보기(작게 줄인 JPEG)    : IndexedDB `data09-24` 의 thumbs (localStorage 는 5MB 안팎이라 사진을 담기 어렵다)
 *  - 원본 사진은 어디에도 올리거나 복사하지 않습니다. 이 브라우저 밖으로 나가지 않습니다.
 *  - OpenAI 키(선택)                 : localStorage `data09-24.openai` — 백업 파일에 넣지 않습니다
 *  - 외부 지도 API 설정(선택, 기본 꺼짐): localStorage `data09-24.geo` { on, provider, key } — 백업 파일에 넣지 않습니다
 */
(function (root) {
  'use strict';
  var KEY = 'data09-24.db', KEY_AI = 'data09-24.openai', KEY_GEO = 'data09-24.geo', DB = 'data09-24', STORE = 'thumbs';

  function load() {
    try { var s = root.localStorage.getItem(KEY); return s ? JSON.parse(s) : null; }
    catch (e) { return null; }
  }
  // 반환: '' = 성공, 그 밖 = 실패 문구
  function save(db) {
    try { root.localStorage.setItem(KEY, JSON.stringify(db)); return ''; }
    catch (e) {
      return /quota/i.test(String(e && (e.name + e.message))) ?
        '저장 공간이 가득 찼습니다. 오래된 여행을 백업한 뒤 지워 주세요.' : '이 브라우저에서는 저장할 수 없습니다(사생활 보호 모드 등).';
    }
  }
  function clear() { try { root.localStorage.removeItem(KEY); } catch (e) { /* 무시 */ } }
  function getKey() { try { return root.localStorage.getItem(KEY_AI) || ''; } catch (e) { return ''; } }
  function setKey(k) { try { if (k) root.localStorage.setItem(KEY_AI, k); else root.localStorage.removeItem(KEY_AI); return true; } catch (e) { return false; } }

  function getGeo() {
    try { var o = JSON.parse(root.localStorage.getItem(KEY_GEO) || 'null'); return o && typeof o === 'object' ? o : { on: false, provider: 'google', key: '' }; }
    catch (e) { return { on: false, provider: 'google', key: '' }; }
  }
  function setGeo(o) {
    try { if (o) root.localStorage.setItem(KEY_GEO, JSON.stringify(o)); else root.localStorage.removeItem(KEY_GEO); return true; } catch (e) { return false; }
  }

  // ---------------------------------------------------------------- IndexedDB (사진 미리보기)
  var memory = {};          // IndexedDB 를 못 쓰는 브라우저 — 이번 창에서만 보관
  var dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise(function (resolve) {
      try {
        if (!root.indexedDB) return resolve(null);
        var req = root.indexedDB.open(DB, 1);
        req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { resolve(null); };
        req.onblocked = function () { resolve(null); };
      } catch (e) { resolve(null); }
    });
    return dbp;
  }
  function tx(mode, fn) {
    return open().then(function (db) {
      if (!db) return fn(null);
      return new Promise(function (resolve) {
        try {
          var t = db.transaction(STORE, mode), st = t.objectStore(STORE), out = fn(st);
          t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
          t.onerror = function () { resolve(null); };
        } catch (e) { resolve(fn(null)); }
      });
    });
  }
  function putThumb(id, dataUrl) {
    memory[id] = dataUrl;
    return tx('readwrite', function (st) { if (st) st.put(dataUrl, id); return true; });
  }
  function getThumb(id) {
    if (memory[id]) return Promise.resolve(memory[id]);
    return tx('readonly', function (st) { return st ? st.get(id) : { result: memory[id] || null }; }).then(function (v) {
      if (v) memory[id] = v;
      return v || null;
    });
  }
  function delThumbs(ids) {
    ids.forEach(function (id) { delete memory[id]; });
    return tx('readwrite', function (st) { if (st) ids.forEach(function (id) { st.delete(id); }); return true; });
  }
  function persistent() { return open().then(function (db) { return !!db; }); }

  root.JStore = { load: load, save: save, clear: clear, getKey: getKey, setKey: setKey, getGeo: getGeo, setGeo: setGeo,
    putThumb: putThumb, getThumb: getThumb, delThumbs: delThumbs, persistent: persistent, KEY: KEY };
})(window);
