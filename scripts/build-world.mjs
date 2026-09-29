// vendor/world-110m.js 를 다시 만드는 스크립트 (한 번 만들어 커밋해 두었으므로 평소에는 돌릴 일이 없습니다).
//
//   임시 폴더에서:  npm i world-atlas@2 topojson-client@3
//   node <이 리포>/scripts/build-world.mjs <임시 폴더>/node_modules
//
// 원자료: Natural Earth 1:110m Admin 0 Countries (공개 도메인) — world-atlas 2.0.2 의 countries-110m.json(TopoJSON).
// 브라우저에서 file:// 로도 열려야 하므로 JSON 을 fetch 하지 않고, 전역 변수에 담은 일반 스크립트로 만든다.
//  - 좌표는 소수 둘째 자리(약 1km)로 줄이고, 고리마다 [경도, 위도, 경도, 위도 …] 평평한 배열로 둔다.
//  - 날짜변경선을 넘는 고리(러시아 추코트카·피지)는 경도를 ±360 옮겨 이어 붙인다(가로줄 방지).
//  - 남극은 뺀다(여행지 표시에 필요 없고, 지구를 한 바퀴 도는 고리라 평면 지도에서 깨진다).
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const NM = process.argv[2]
if (!NM) { console.error('사용법: node scripts/build-world.mjs <node_modules 경로>'); process.exit(1) }
const require = createRequire(join(NM, 'x.js'))
const tc = require('topojson-client')
const topo = JSON.parse(readFileSync(join(NM, 'world-atlas/countries-110m.json'), 'utf8'))
const fc = tc.feature(topo, topo.objects.countries)

const r2 = (v) => Math.round(v * 100) / 100
const countries = []
for (const f of fc.features) {
  const name = f.properties.name
  if (name === 'Antarctica') continue
  const id = f.id || ('X-' + name.replace(/[^A-Za-z]/g, ''))    // 코소보 등 번호 없는 곳
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
  const out = []
  let bb = [Infinity, Infinity, -Infinity, -Infinity]
  for (const poly of polys) {
    const rings = []
    for (const ring of poly) {
      const flat = []
      let prev = null
      for (const [lon0, lat] of ring) {
        let lon = lon0
        if (prev !== null) { while (lon - prev > 180) lon -= 360; while (prev - lon > 180) lon += 360 }
        prev = lon
        const x = r2(lon), y = r2(lat)
        const n = flat.length
        if (n >= 2 && flat[n - 2] === x && flat[n - 1] === y) continue   // 반올림으로 겹친 점
        flat.push(x, y)
        bb = [Math.min(bb[0], x), Math.min(bb[1], y), Math.max(bb[2], x), Math.max(bb[3], y)]
      }
      if (flat.length >= 6) rings.push(flat)
    }
    if (rings.length) out.push(rings)
  }
  countries.push({ id, en: name, bbox: bb, polys: out })
}
countries.sort((a, b) => a.id.localeCompare(b.id))

const HERE = dirname(fileURLToPath(import.meta.url))
const body = `/* 자동 생성 — scripts/build-world.mjs. 손으로 고치지 말 것.
 * Natural Earth 1:110m Admin 0 Countries (public domain, https://www.naturalearthdata.com/)
 * via world-atlas 2.0.2 (ISC, Mike Bostock) — vendor/world-110m-LICENSE.txt
 * 나라 ${countries.length}개(남극 제외), 좌표 소수 둘째 자리, 고리 = [경도, 위도, …] 평평한 배열.
 */
(function (root) {
  var WORLD = ${JSON.stringify({ source: 'Natural Earth 110m via world-atlas 2.0.2', countries })};
  if (typeof module !== 'undefined' && module.exports) module.exports = WORLD;
  else root.JOURNAL_WORLD = WORLD;
})(typeof window !== 'undefined' ? window : this);
`
writeFileSync(join(HERE, '..', 'vendor', 'world-110m.js'), body)
console.log(`나라 ${countries.length}개 → vendor/world-110m.js (${Math.round(body.length / 1024)}KB)`)
