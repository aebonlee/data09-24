// samples/*.jpg — 가짜 EXIF(찍은 시각·GPS)를 넣은 「합성 사진」 만들기. 실제 사진은 한 장도 없습니다.
//
//   임시 폴더에서:  npm i sharp
//   node <이 리포>/scripts/make-samples.mjs <임시 폴더>/node_modules
//
// 그림은 sharp 로 SVG(색 띠·도형·글자)를 JPEG 로 굽기만 하고, EXIF 는 이 스크립트가 직접 씁니다
// (APP1 "Exif\0\0" + TIFF 머리 + IFD0 · Exif IFD · GPS IFD). 파서(js/exif.js)와 따로 만든 쓰기
// 코드라서, 테스트가 「쓴 값을 그대로 읽는가」를 서로 독립적으로 확인할 수 있습니다.
// 바이트 순서는 II(리틀엔디언)와 MM(빅엔디언)을 섞었고, 위치가 없는 사진·EXIF 가 아예 없는 사진도 넣었습니다.
// 좌표는 누구나 아는 관광 명소의 대략 위치(공개 정보)이고, 시각은 가상의 여행 일정입니다.
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const NM = process.argv[2]
if (!NM) { console.error('사용법: node scripts/make-samples.mjs <node_modules 경로>'); process.exit(1) }
const sharp = createRequire(join(NM, 'x.js'))('sharp')
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'samples')

// file, 제목, 찍은 시각, 위도, 경도, 바이트 순서, 시간대, 색
export const SAMPLES = [
  { file: 'kansai_01_airport.jpg', label: '간사이 공항 도착', at: '2026-04-03 11:20:05', lat: 34.4347, lng: 135.2440, order: 'II', offset: '+09:00', color: ['#8ec5e8', '#e9f3fb'] },
  { file: 'kansai_02_dotonbori.jpg', label: '도톤보리 저녁', at: '2026-04-03 18:42:10', lat: 34.6687, lng: 135.5013, order: 'MM', offset: '+09:00', color: ['#2b2459', '#e0739a'] },
  { file: 'kansai_03_castle.jpg', label: '오사카성 공원', at: '2026-04-04 09:31:00', lat: 34.6873, lng: 135.5262, order: 'II', offset: '', color: ['#9fd3a8', '#f4efd9'] },
  { file: 'kansai_04_umeda.jpg', label: '우메다 전망대', at: '2026-04-04 17:55:30', lat: 34.7053, lng: 135.4906, order: 'MM', offset: '+09:00', color: ['#f3a65b', '#fbe3c4'] },
  { file: 'kansai_05_inari.jpg', label: '후시미 이나리 입구', at: '2026-04-05 08:50:12', lat: 34.9671, lng: 135.7727, order: 'II', offset: '+09:00', color: ['#d9472b', '#f7d7c9'] },
  { file: 'kansai_06_kiyomizu.jpg', label: '기요미즈데라', at: '2026-04-05 13:10:44', lat: 34.9949, lng: 135.7850, order: 'II', offset: '+09:00', color: ['#7aa66b', '#e8f1d8'] },
  { file: 'kansai_07_gion.jpg', label: '기온 거리', at: '2026-04-05 16:30:00', lat: 35.0037, lng: 135.7788, order: 'MM', offset: '', color: ['#6b4a8a', '#eadcf2'] },
  { file: 'kansai_08_nara.jpg', label: '나라 공원 사슴', at: '2026-04-06 10:02:18', lat: 34.6851, lng: 135.8430, order: 'II', offset: '+09:00', color: ['#b98a4a', '#f3e6cf'] },
  // 위치가 없는 사진(비행기 모드 등) — 날짜만 있다
  { file: 'kansai_09_nogps.jpg', label: '공항 가는 열차(위치 없음)', at: '2026-04-06 14:05:00', lat: null, lng: null, order: 'MM', offset: '', color: ['#8a96a8', '#e3e7ee'] },
  // EXIF 가 아예 없는 사진(메신저로 받은 사진 등) — 파일 날짜로만 짐작할 수 있다
  { file: 'kansai_10_noexif.jpg', label: '메신저로 받은 사진(EXIF 없음)', at: null, lat: null, lng: null, order: null, offset: '', color: ['#c9c9c9', '#f2f2f2'] },
]

// ---------------------------------------------------------------- EXIF 쓰기
function toRational(x) {             // 소수 → [분자, 분모] (소수 넷째 자리까지)
  const den = 10000
  return [Math.round(x * den), den]
}
function dmsRationals(deg) {
  const a = Math.abs(deg)
  const d = Math.floor(a), mf = (a - d) * 60, m = Math.floor(mf), s = (mf - m) * 60
  return [[d, 1], [m, 1], toRational(s)]
}
const ascii = (s) => Buffer.from(s + '\0', 'latin1')

function buildExif(s) {
  const le = s.order === 'II'
  const T = { BYTE: 1, ASCII: 2, SHORT: 3, LONG: 4, RATIONAL: 5 }
  const dt = s.at.replace(/-/g, ':')
  const ifd0 = [
    [0x010F, T.ASCII, ascii('JOURNAL-SAMPLE')],
    [0x0110, T.ASCII, ascii('SyntheticCam')],
    [0x0112, T.SHORT, [1]],
    [0x0132, T.ASCII, ascii(dt)],
    [0x8769, T.LONG, ['@exif']],
  ]
  if (s.lat !== null) ifd0.push([0x8825, T.LONG, ['@gps']])
  const exif = [[0x9003, T.ASCII, ascii(dt)]]
  if (s.offset) exif.push([0x9011, T.ASCII, ascii(s.offset)])
  const gps = s.lat === null ? null : [
    [0x0000, T.BYTE, [2, 3, 0, 0]],
    [0x0001, T.ASCII, ascii(s.lat >= 0 ? 'N' : 'S')],
    [0x0002, T.RATIONAL, dmsRationals(s.lat)],
    [0x0003, T.ASCII, ascii(s.lng >= 0 ? 'E' : 'W')],
    [0x0004, T.RATIONAL, dmsRationals(s.lng)],
  ]
  const ifds = { ifd0, exif }
  if (gps) ifds.gps = gps
  const unit = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8 }
  const countOf = (type, v) => (type === 2 ? v.length : v.length)
  const dataSize = (type, v) => { const n = unit[type] * countOf(type, v); return n <= 4 ? 0 : n + (n % 2) }
  // 배치: TIFF 머리 8바이트 → IFD0 → Exif IFD → GPS IFD, 각 IFD 바로 뒤에 그 IFD 의 긴 값
  const order = Object.keys(ifds), at = {}
  let off = 8
  for (const k of order) {
    at[k] = off
    off += 2 + ifds[k].length * 12 + 4 + ifds[k].reduce((a, [, t, v]) => a + dataSize(t, v), 0)
  }
  const buf = Buffer.alloc(off)
  const w16 = (o, v) => (le ? buf.writeUInt16LE(v, o) : buf.writeUInt16BE(v, o))
  const w32 = (o, v) => (le ? buf.writeUInt32LE(v, o) : buf.writeUInt32BE(v, o))
  buf.write(le ? 'II' : 'MM', 0, 'latin1'); w16(2, 42); w32(4, at.ifd0)
  for (const k of order) {
    const list = ifds[k].slice().sort((a, b) => a[0] - b[0])
    let p = at[k], data = p + 2 + list.length * 12 + 4
    w16(p, list.length); p += 2
    for (const [tag, type, v0] of list) {
      const v = v0.map((x) => (typeof x === 'string' && x[0] === '@' ? at[x.slice(1)] : x))
      const n = countOf(type, v)
      w16(p, tag); w16(p + 2, type); w32(p + 4, n)
      const size = unit[type] * n
      let q = p + 8
      if (size > 4) { w32(p + 8, data); q = data; data += size + (size % 2) }
      if (type === 2) Buffer.from(v).copy(buf, q)
      else for (let i = 0; i < v.length; i++) {
        if (type === 1) buf[q + i] = v[i]
        else if (type === 3) w16(q + i * 2, v[i])
        else if (type === 4) w32(q + i * 4, v[i])
        else if (type === 5) { w32(q + i * 8, v[i][0]); w32(q + i * 8 + 4, v[i][1]) }
      }
      p += 12
    }
    w32(p, 0)   // 다음 IFD 없음
  }
  const head = Buffer.from('Exif\0\0', 'latin1')
  const len = 2 + head.length + buf.length
  const app1 = Buffer.alloc(4); app1[0] = 0xFF; app1[1] = 0xE1; app1.writeUInt16BE(len, 2)
  return Buffer.concat([app1, head, buf])
}

// 기대값 — 쓰기 쪽 유리수에서 다시 계산한 도 단위(소수 여섯째 자리)
function expectedDeg(deg) {
  const r = dmsRationals(deg)
  const v = r[0][0] / r[0][1] + r[1][0] / r[1][1] / 60 + r[2][0] / r[2][1] / 3600
  return Math.round((deg < 0 ? -v : v) * 1e6) / 1e6
}

function svgOf(s, i) {
  const [c1, c2] = s.color
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480">
<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
<rect width="640" height="480" fill="url(#g)"/>
<path d="M0 360 L120 250 L220 320 L340 200 L470 330 L560 270 L640 320 L640 480 L0 480 Z" fill="#000" fill-opacity="0.18"/>
<circle cx="${480 - i * 20}" cy="${110 + i * 6}" r="44" fill="#fff" fill-opacity="0.55"/>
<rect x="32" y="376" width="576" height="72" rx="12" fill="#fff" fill-opacity="0.82"/>
<text x="56" y="422" font-family="Apple SD Gothic Neo" font-size="30" font-weight="700" fill="#1d2a3a">${esc(s.label)}</text>
<text x="32" y="56" font-family="Apple SD Gothic Neo" font-size="22" font-weight="700" fill="#fff">SAMPLE ${String(i + 1).padStart(2, '0')} · 합성 이미지(실제 사진 아님)</text>
</svg>`
}

const manifest = []
for (let i = 0; i < SAMPLES.length; i++) {
  const s = SAMPLES[i]
  const jpg = await sharp(Buffer.from(svgOf(s, i))).jpeg({ quality: 72 }).toBuffer()
  let out = jpg
  if (s.at) {
    const exif = buildExif(s)
    out = Buffer.concat([jpg.subarray(0, 2), exif, jpg.subarray(2)])   // SOI 바로 뒤
  }
  writeFileSync(join(OUT, s.file), out)
  manifest.push({
    file: s.file, label: s.label, byteOrder: s.order,
    takenAt: s.at ? s.at.replace(' ', 'T') : '',
    offset: s.offset || '',
    lat: s.lat === null ? null : expectedDeg(s.lat), lng: s.lng === null ? null : expectedDeg(s.lng),
    intendedLat: s.lat, intendedLng: s.lng, bytes: out.length,
  })
  console.log(`${s.file}  ${out.length} bytes`)
}
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({ note: '합성 이미지와 가짜 EXIF — scripts/make-samples.mjs 가 만든 기대값', samples: manifest }, null, 2) + '\n')
console.log('samples/manifest.json')
