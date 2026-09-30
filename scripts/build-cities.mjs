// vendor/cities15000.js 를 다시 만드는 스크립트 (한 번 만들어 커밋해 두었으므로 평소에는 돌릴 일이 없습니다).
//
//   임시 폴더에서:  curl -O https://download.geonames.org/export/dump/cities15000.zip && unzip cities15000.zip
//                   curl -O https://download.geonames.org/export/dump/alternateNamesV2.zip && unzip alternateNamesV2.zip alternateNamesV2.txt
//                   awk -F'\t' '$3=="ko"' alternateNamesV2.txt > alt_ko.txt        (한국어 이름만 — 200MB → 약 10MB)
//   node <이 리포>/scripts/build-cities.mjs <임시 폴더>/cities15000.txt <임시 폴더>/alt_ko.txt
//
// 원자료: GeoNames cities15000 — 인구 1만 5천 명 이상 도시(CC BY 4.0, https://www.geonames.org/).
// 좌표 → 가장 가까운 도시 이름(오프라인 역지오코딩)에 씁니다. 외부 서버를 부르지 않습니다.
//  - 이름은 GeoNames 한국어(ko) 대체 이름 — 옛 이름(isHistoric)·속칭(isColloquial)은 빼고, 짧은 이름(isShort) → 가장 짧은 것 순.
//    끝의 「 시」는 뗀다(「오사카 시」 → 「오사카」). 한국어 이름이 없으면 영어 이름(ASCII).
//    (cities15000.txt 의 alternatenames 칸만으로 고르면 서울이 「경성」이 된다 — 언어·옛 이름 표시가 없어서)
//  - 좌표는 소수 둘째 자리(약 1km) — 「어느 도시 근처인가」에는 충분하다. 100 을 곱한 정수로 둔다.
//  - 인구는 천 명 단위(도시 반경 짐작에 씀). 나라는 ISO 두 글자.
//  - 도시 안의 구역(PPLX)·옛 지명(PPLH)·버려진 곳(PPLQ·PPLW)은 뺀다 — 「주오구」 같은 구 이름이 도시 이름을 가리지 않게.
// 브라우저에서 file:// 로도 열려야 하므로 JSON 을 fetch 하지 않고, 전역 변수에 담은 일반 스크립트로 만든다.
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = process.argv[2], ALT = process.argv[3]
if (!SRC || !ALT) { console.error('사용법: node scripts/build-cities.mjs <cities15000.txt> <alt_ko.txt>'); process.exit(1) }
const SKIP = new Set(['PPLX', 'PPLH', 'PPLQ', 'PPLW'])

// geonameid → 한국어 이름 후보 [{ name, short }]
const KO = new Map()
for (const line of readFileSync(ALT, 'utf8').split('\n')) {
  const a = line.split('\t')
  if (a[2] !== 'ko' || !a[3]) continue
  if (a[6] === '1' || a[7] === '1') continue                  // 속칭 · 옛 이름
  if (!/[가-힣]/.test(a[3])) continue
  if (!KO.has(a[1])) KO.set(a[1], [])
  KO.get(a[1]).push({ name: a[3].trim(), short: a[5] === '1' })
}
function koName(id) {
  const c = KO.get(id)
  if (!c) return ''
  c.sort((x, y) => (y.short - x.short) || x.name.length - y.name.length || x.name.localeCompare(y.name))
  return c[0].name.replace(/\s+시$/, '')
}

const rows = []
for (const line of readFileSync(SRC, 'utf8').split('\n')) {
  if (!line) continue
  const f = line.split('\t')
  const [id, name, ascii, , lat, lng, , code, cc, , , , , , pop] = f
  if (SKIP.has(code)) continue
  const ko = koName(id)
  const label = (ko || ascii || name || '').replace(/[|\n]/g, ' ').trim()
  if (!label) continue
  rows.push([label, Math.round(+lat * 100), Math.round(+lng * 100), cc || '', Math.round((+pop || 0) / 1000)])
}
rows.sort((a, b) => a[1] - b[1] || a[2] - b[2])
const body = rows.map((r) => r.join('|')).join('\n')
const out = `/* 자동 생성 — scripts/build-cities.mjs. 손으로 고치지 말 것.
 * GeoNames cities15000 (https://www.geonames.org/, CC BY 4.0) — vendor/cities15000-LICENSE.txt
 * 도시 ${rows.length}곳. 한 줄 = 이름|위도×100|경도×100|나라(ISO 2)|인구(천 명). 이름은 한글 대체 이름이 있으면 그것.
 */
(function (root) {
  var CITIES = { source: 'GeoNames cities15000 (CC BY 4.0)', count: ${rows.length}, text: ${JSON.stringify(body)} };
  if (typeof module !== 'undefined' && module.exports) module.exports = CITIES;
  else root.JOURNAL_CITIES = CITIES;
})(typeof window !== 'undefined' ? window : this);
`
const dest = join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'cities15000.js')
writeFileSync(dest, out)
console.log(`도시 ${rows.length}곳, 한글 이름 ${rows.filter((r) => /[가-힣]/.test(r[0])).length}곳, ${out.length.toLocaleString()} 글자 → ${dest}`)
