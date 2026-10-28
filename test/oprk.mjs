// Fake 'points allowed by position' for local preview (shape matches lib/espn.js dump.oprk)
const base = { 1: 18, 2: 22, 3: 32, 4: 9, 5: 8, 16: 7 };
const ids = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,33,34];
export const oprk = {};
for (const [pos, b] of Object.entries(base)) {
  const vals = ids.map((id) => [id, Math.round(b * (0.7 + ((id * 37 + Number(pos) * 11) % 60) / 100) * 10) / 10]);
  const sorted = [...vals].sort((x, y) => x[1] - y[1]);
  oprk[pos] = { avg: b };
  for (const [id, v] of vals) oprk[pos][id] = [v, sorted.findIndex((x) => x[0] === id) + 1];
}
