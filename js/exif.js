/*
 * JOURNAL — 사진 EXIF 읽기 (직접 만든 작은 JPEG APP1 파서, 외부 라이브러리 없음)
 * 브라우저에서는 window.JournalExif, Node(테스트)에서는 module.exports 로 씁니다.
 *
 * 읽는 것은 여행 기록에 필요한 것뿐입니다.
 *   찍은 시각  DateTimeOriginal(0x9003) → 없으면 DateTimeDigitized(0x9004) → 없으면 IFD0 DateTime(0x0132)
 *   시간대     OffsetTimeOriginal(0x9011) — 있을 때만 표시용으로 둡니다
 *   위치       GPS IFD(0x8825) 의 위도·경도(도·분·초 유리수)와 N/S·E/W
 *   방향       Orientation(0x0112) — 브라우저가 알아서 돌려 보여 주므로 참고용
 *
 * 구조: JPEG(FFD8) → 마커를 차례로 넘기며 APP1(FFE1) 중 "Exif\0\0" 로 시작하는 것을 찾는다
 *       → TIFF 머리(II = 리틀엔디언 / MM = 빅엔디언, 42) → IFD0 → Exif IFD · GPS IFD.
 * 잘못된 파일·잘린 파일에서 예외를 던지지 않고 null(또는 빈 칸)을 돌려줍니다.
 * HEIC(아이폰 기본 형식)·PNG 는 읽지 않습니다 — 화면에서 JPEG 로 내보내 달라고 안내합니다.
 */
(function (root) {
  'use strict';

  var TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

  function toBytes(buf) {
    if (buf instanceof Uint8Array) return buf;
    if (buf && typeof buf.byteLength === 'number') return new Uint8Array(buf);
    return null;
  }

  function isJpeg(b) { return !!b && b.length > 3 && b[0] === 0xFF && b[1] === 0xD8; }

  // JPEG 안의 Exif APP1 블록 위치 → { start: TIFF 머리 위치, end: 블록 끝 } 또는 null
  function findExifSegment(b) {
    if (!isJpeg(b)) return null;
    var i = 2;
    while (i + 4 <= b.length) {
      if (b[i] !== 0xFF) return null;               // 마커 자리에 다른 값 → 구조가 깨짐
      var m = b[i + 1];
      if (m === 0xFF) { i++; continue; }            // 채움 바이트
      if (m === 0xD9 || m === 0xDA) return null;    // 끝 · 영상 자료 시작 — 그 뒤에는 APP 블록이 없다
      if (m === 0x01 || (m >= 0xD0 && m <= 0xD7)) { i += 2; continue; }   // 길이 없는 마커
      var len = (b[i + 2] << 8) | b[i + 3];
      if (len < 2 || i + 2 + len > b.length) return null;
      if (m === 0xE1 && len >= 16 &&
          b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66 &&
          b[i + 8] === 0 && b[i + 9] === 0) {
        return { start: i + 10, end: i + 2 + len };
      }
      i += 2 + len;
    }
    return null;
  }

  function reader(b, start, end) {
    var le;
    if (b[start] === 0x49 && b[start + 1] === 0x49) le = true;
    else if (b[start] === 0x4D && b[start + 1] === 0x4D) le = false;
    else return null;
    function u16(o) {
      var p = start + o; if (o < 0 || p + 2 > end) return null;
      return le ? (b[p] | (b[p + 1] << 8)) : ((b[p] << 8) | b[p + 1]);
    }
    function u32(o) {
      var p = start + o; if (o < 0 || p + 4 > end) return null;
      return le ? ((b[p] | (b[p + 1] << 8) | (b[p + 2] << 16)) + b[p + 3] * 16777216)
                : (b[p] * 16777216 + ((b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]));
    }
    function s32(o) { var v = u32(o); return v === null ? null : (v > 2147483647 ? v - 4294967296 : v); }
    if (u16(2) !== 42) return null;
    return { le: le, u16: u16, u32: u32, s32: s32, size: end - start };
  }

  // IFD 하나 → { 태그번호: 값 } (값: 숫자, 숫자 배열, 글자)
  function readIfd(r, off) {
    var out = {};
    var n = r.u16(off);
    if (n === null || n > 500) return out;
    for (var k = 0; k < n; k++) {
      var e = off + 2 + k * 12;
      var tag = r.u16(e), type = r.u16(e + 2), count = r.u32(e + 4);
      if (tag === null || type === null || count === null) break;
      var unit = TYPE_SIZE[type];
      if (!unit || count > 10000) continue;
      var total = unit * count;
      var at = total <= 4 ? e + 8 : r.u32(e + 8);
      if (at === null || at + total > r.size) continue;
      out[tag] = readValue(r, type, count, at);
    }
    return out;
  }

  function readValue(r, type, count, at) {
    var vals = [], i;
    if (type === 2) {                                   // ASCII — NUL 앞까지
      var s = '';
      for (i = 0; i < count; i++) { var c = byteAt(r, at + i); if (!c) break; s += String.fromCharCode(c); }
      return s.trim();
    }
    for (i = 0; i < count; i++) {
      if (type === 1 || type === 7) vals.push(byteAt(r, at + i));
      else if (type === 3) vals.push(r.u16(at + i * 2));
      else if (type === 4) vals.push(r.u32(at + i * 4));
      else if (type === 9) vals.push(r.s32(at + i * 4));
      else if (type === 5) { var nu = r.u32(at + i * 8), de = r.u32(at + i * 8 + 4); vals.push(de ? nu / de : NaN); }
      else if (type === 10) { var sn = r.s32(at + i * 8), sd = r.s32(at + i * 8 + 4); vals.push(sd ? sn / sd : NaN); }
    }
    return count === 1 ? vals[0] : vals;
  }
  // 1바이트 값은 바이트 순서와 무관하다
  function byteAt(r, o) { return r._b[r._s + o]; }

  // "2026:04:03 11:20:00" → "2026-04-03T11:20:00" (0000:00:00 같은 빈 값은 '')
  function exifDate(s) {
    var m = /^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(s || ''));
    if (!m) return '';
    var y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], se = +(m[6] || 0);
    if (y < 1900 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return '';
    return m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + (m[6] || '00');
  }

  // 도·분·초 [d, m, s] + 'N'|'S'|'E'|'W' → 소수 도(6자리)
  function dms(v, ref) {
    if (!v || v.length !== 3 || v.some(function (x) { return typeof x !== 'number' || !isFinite(x) || x < 0; })) return null;
    var deg = v[0] + v[1] / 60 + v[2] / 3600;
    if (ref === 'S' || ref === 'W') deg = -deg;
    return Math.round(deg * 1e6) / 1e6;
  }

  // 공개 함수: 바이트 → { takenAt, offset, lat, lng, orientation, make, model, hasExif } 또는 null(JPEG 아님)
  function parse(buf) {
    var b = toBytes(buf);
    if (!isJpeg(b)) return null;
    var out = { hasExif: false, takenAt: '', offset: '', lat: null, lng: null, orientation: 1, make: '', model: '' };
    var seg = findExifSegment(b);
    if (!seg) return out;
    var r = reader(b, seg.start, seg.end);
    if (!r) return out;
    r._b = b; r._s = seg.start;   // byteAt 용
    var ifd0Off = r.u32(4);
    if (ifd0Off === null) return out;
    out.hasExif = true;
    var ifd0 = readIfd(r, ifd0Off);
    var exif = typeof ifd0[0x8769] === 'number' ? readIfd(r, ifd0[0x8769]) : {};
    var gps = typeof ifd0[0x8825] === 'number' ? readIfd(r, ifd0[0x8825]) : {};
    out.takenAt = exifDate(exif[0x9003]) || exifDate(exif[0x9004]) || exifDate(ifd0[0x0132]);
    if (typeof exif[0x9011] === 'string' && /^[+-]\d{2}:\d{2}$/.test(exif[0x9011])) out.offset = exif[0x9011];
    if (typeof ifd0[0x0112] === 'number' && ifd0[0x0112] >= 1 && ifd0[0x0112] <= 8) out.orientation = ifd0[0x0112];
    if (typeof ifd0[0x010F] === 'string') out.make = ifd0[0x010F];
    if (typeof ifd0[0x0110] === 'string') out.model = ifd0[0x0110];
    var lat = dms(gps[2], gps[1]), lng = dms(gps[4], gps[3]);
    // (0, 0) 은 GPS 를 못 잡은 카메라가 흔히 적는 값이라 위치 없음으로 본다
    if (lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) {
      out.lat = lat; out.lng = lng;
    }
    return out;
  }

  var API = { parse: parse, isJpeg: isJpeg, findExifSegment: findExifSegment, exifDate: exifDate, dms: dms };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else root.JournalExif = API;
})(typeof window !== 'undefined' ? window : this);
