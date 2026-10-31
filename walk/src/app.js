// エキさんぽ: JR の駅（池袋・東京・新宿・渋谷・品川・高輪ゲートウェイ）と地下街を人の目線で歩き回る。駅は URL の ?st=<駅>。
// 操作（PC）: WASD・矢印キーで歩く、ドラッグで見回す。（スマホ）左側を押したまま動かすと歩く、右側をなぞると見回す。

import * as THREE from 'three';
import { initPhoto } from './photo.js?v=mvw0bcr9';
import { buildWorld, addGateRow, EYE, STEP } from './world.js?v=mvw0bcr9';
import { encodeTrack, decodeTrack, startVideo, SAMPLE_MS, MAX_SAMPLES } from './record.js?v=mvw0bcr9';
import { addTrains } from './trains.js?v=mvw0bcr9';
import { routeSteps, stepLine } from './steps.js?v=mvw0bcr9';
import { initMeet } from './meet.js?v=mvw0bcr9';

const $ = (id) => document.getElementById(id);
const touchUI = matchMedia('(pointer: coarse)').matches;
if (touchUI) document.body.classList.add('touch');

const VER = '?v=mvw0bcr9'; // 公開用に書き出すとき、版の印（?v=…）に置きかえる（tools/publish.mjs）
const PRE = window.ekisanpoPre || {}; // index.html で先に読みはじめたデータ（同じ駅のときだけ使う）
const STATIONS = await (PRE.stations || Promise.reject()).catch(() => fetch(`data/stations.json${VER}`).then((r) => r.json()));
const ST = STATIONS.find((s) => s.key === new URLSearchParams(location.search).get('st')) || STATIONS[0];
const pre = (k, f) => (PRE.key === ST.key && PRE[k] ? PRE[k].catch(f) : f());
const [data, mallBuf] = await Promise.all([
  pre('data', () => fetch(`data/${ST.key}.json${VER}`).then((r) => r.json())),
  ST.mall ? pre('mall', () => fetch(`data/${ST.key}-mall.bin${VER}`).then((r) => r.arrayBuffer())) : null,
]);
const GL = data.mall ? data.mall.level : null; // 地下街をつなぐ階（マス目で道を探す階）。地下街の無い駅は null
$('credit').textContent = '出典: ' + data.credits.join(' ／ ');
$('helpCredit').textContent = '出典: ' + data.credits.join(' ／ ');
document.title = `エキさんぽ ${data.station.replace(/^JR/, '')}`;
$('stationName').textContent = `${data.station}駅`;
$('helpStation').textContent = `${data.station}駅`;
// 駅の切り替え（左上の駅名）
$('stationBtn').onclick = () => {
  const list = $('stationList');
  list.innerHTML = '';
  for (const s of STATIONS) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'item' + (s.key === ST.key ? ' sel' : '');
    b.innerHTML = `<span class="dot" style="background:#0b8f4d">駅</span>${s.name}駅<span class="tag">${s.mall ? '地下街も' : ''}</span>`;
    b.onclick = () => { location.href = `${location.pathname}?st=${s.key}`; };
    list.append(b);
  }
  $('stationPanel').hidden = false;
};
$('stationClose').onclick = () => { $('stationPanel').hidden = true; };
$('stationPanel').onclick = (e) => { if (e.target === $('stationPanel')) $('stationPanel').hidden = true; };
const LV = data.levels;
const levelOf = (z) => Number(Object.keys(LV).reduce((b, k) => (Math.abs(LV[k].z - z) < Math.abs(LV[b].z - z) ? k : b)));

// ---------- 描画 ----------
const renderer = new THREE.WebGLRenderer({ canvas: $('view'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color('#c3c8cc');
scene.fog = new THREE.Fog('#c3c8cc', 30, 170);
// 横からの光を強めにして、壁の向きで明るさが変わるように（一色に見えない）
scene.add(new THREE.HemisphereLight('#ffffff', '#b3ada2', 1.0));
const sun = new THREE.DirectionalLight('#ffffff', 1.0);
sun.position.set(40, 60, 25);
scene.add(sun);
const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1500); // 地上では 600 m 先まで見える（霧の終わり）
camera.rotation.order = 'YXZ';
const V3 = (x, y, z) => new THREE.Vector3(x, z, -y);

const { phys } = buildWorld(data, mallBuf, scene);
const trains = addTrains(scene, data);

// ---------- ほかの会社の改札（推定） ----------
// 構内のデータが無いので、推定の点にいちばん近い地下 1 階の JR の壁（店先・駅務・壁。JR のデータでは向こう側が描かれない）の
// 手前に、壁に向かう改札機を 5 台並べ、壁を会社の色の板にする。行き先の点は改札機の前へ
const OP_COLOR = (n) => (/東武/.test(n) ? '#1d50a2' : /丸ノ内/.test(n) ? '#e60012' : /有楽町/.test(n) ? '#c1a470' : /副都心/.test(n) ? '#9c5e31' : /西武/.test(n) ? '#00a0e9' : '#6b5ba8');
for (const d of data.dest.filter((x) => x.t === 'ogate')) {
  let best = null;
  for (const w of data.walls) {
    if (w[4] !== d.level || !'swf'.includes(w[5])) continue;
    const dx = w[2] - w[0], dy = w[3] - w[1], L = Math.hypot(dx, dy);
    if (L < 4.6) continue; // 5 台並ぶ長さのある壁だけ
    const t = Math.max(2.3, Math.min(L - 2.3, ((d.x - w[0]) * dx + (d.y - w[1]) * dy) / L));
    const px = w[0] + (dx / L) * t, py = w[1] + (dy / L) * t, dist = Math.hypot(d.x - px, d.y - py);
    if (!best || dist < best.dist) best = { dist, px, py, ux: dx / L, uy: dy / L };
  }
  if (!best || best.dist > 12) continue;
  const { px, py, ux, uy } = best;
  let nx = -uy, ny = ux;
  if ((d.x - px) * nx + (d.y - py) * ny < 0) { nx = -nx; ny = -ny; } // 推定の点の側へ
  const z = LV[d.level].z, ang = Math.atan2(ny, nx);
  addGateRow(scene, phys, [-2, -1, 0, 1, 2].map((k) => [px + ux * k * 0.9 + nx * 0.9, py + uy * k * 0.9 + ny * 0.9, z, 1.4, 0.2, ang]));
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.6), new THREE.MeshLambertMaterial({ color: OP_COLOR(d.name), emissive: '#222' }));
  panel.position.copy(V3(px + nx * 0.03, py + ny * 0.03, z + 1.3));
  panel.rotation.y = Math.atan2(nx, -ny); // 板の表（+z）を推定の点の側へ（データの (nx, ny) は three.js の (nx, 0, -ny)）
  scene.add(panel);
  d.x = Math.round((px + nx * 2.6) * 100) / 100; d.y = Math.round((py + ny * 2.6) * 100) / 100;
  d.est = 1;
}

// ---------- 札（看板） ----------
// badge: 丸の中の文字（番線など）。badges: [[文字, 色], ...] で複数並べる。arrow: 文字の前に矢印（'up' | 'down'）
const signMats = new Map(); // 同じ文字・色の札は絵（材質）を使い回す（池袋で数百枚あり、1 枚ずつ描くと開くのが遅かった）
function sign(text, opts = {}) {
  const k = text + '|' + JSON.stringify(opts);
  let m = signMats.get(k);
  if (!m) { m = signMat(text, opts); signMats.set(k, m); }
  const s = new THREE.Sprite(m.mat);
  s.scale.set(m.w, m.h, 1);
  return s;
}
function signMat(text, { bg = '#f5c400', fg = '#111', badge = null, badgeColor = null, badges = null, arrow = null, h = 0.55 } = {}) {
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  const font = 'bold 64px system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif';
  g.font = font;
  const bl = badges || (badge ? [[badge, badgeColor]] : []);
  const aw = arrow ? 70 : 0, bw = bl.length * 86 + (bl.length ? 10 : 0);
  c.width = Math.ceil(g.measureText(text).width + 56 + aw + bw);
  c.height = 104;
  g.fillStyle = bg;
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  g.lineWidth = 4;
  g.strokeRect(2, 2, c.width - 4, c.height - 4);
  let x = 24;
  if (arrow) { // 上り・下りの矢印
    g.fillStyle = fg;
    g.beginPath();
    if (arrow === 'up') { g.moveTo(x + 28, 18); g.lineTo(x + 56, 52); g.lineTo(x + 38, 52); g.lineTo(x + 38, 86); g.lineTo(x + 18, 86); g.lineTo(x + 18, 52); g.lineTo(x, 52); }
    else { g.moveTo(x + 28, 86); g.lineTo(x + 56, 52); g.lineTo(x + 38, 52); g.lineTo(x + 38, 18); g.lineTo(x + 18, 18); g.lineTo(x + 18, 52); g.lineTo(x, 52); }
    g.fill();
    x += aw;
  }
  for (const [t, col] of bl) {
    g.fillStyle = col || '#333';
    g.beginPath(); g.arc(x + 40, 52, 38, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 50px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(t, x + 40, 54);
    x += 86;
  }
  if (bl.length) x += 10;
  g.font = font; g.fillStyle = fg; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillText(text, x, 55);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { mat: new THREE.SpriteMaterial({ map: tex, fog: true }), w: (h * c.width) / c.height, h };
}
const placed = [];
// 札の位置が柱・壁の線から 0.8 m 以内なら、線と直角の向きに 1 m 離す（床のある側。池袋の南改札の案内所の札が PLATEAU の柱に隠れた）
function awayFromWall(x, y, z) {
  let best = null;
  for (const [ax, ay, bx, by] of phys.segsNear(x, y, z + 2.0, 1.5)) {
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy; if (!L) continue;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)), px = ax + dx * t, py = ay + dy * t, dd = Math.hypot(x - px, y - py);
    if (dd < 0.8 && (!best || dd < best.d)) best = { d: dd, nx: -dy / Math.sqrt(L), ny: dx / Math.sqrt(L), px, py };
  }
  if (!best) return [x, y];
  // 線と直角に 1〜2 m、線に沿って ±1.2 m の順に試す（案内所の札は箱の前の線の上にあり、すぐ横に丸い柱があった）
  const tx = best.ny, ty = -best.nx;
  for (const [d, e] of [[1, 0], [-1, 0], [1.5, 0], [-1.5, 0], [0.7, 1.2], [0.7, -1.2], [-0.7, 1.2], [-0.7, -1.2], [2, 0], [-2, 0]]) {
    const qx = best.px + best.nx * d + tx * e, qy = best.py + best.ny * d + ty * e;
    if (phys.groundAt(qx, qy, z) == null) continue;
    const clear = phys.segsNear(qx, qy, z + 2.0, 1).every(([ax, ay, bx, by]) => { const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((qx - ax) * dx + (qy - ay) * dy) / L)) : 0; return Math.hypot(qx - ax - dx * t, qy - ay - dy * t) >= 0.5; }); // segsNear は格子のます単位で返すので距離は自分で見る
    if (clear) return [qx, qy];
  }
  return [x, y];
}
// 札の上の天井の高さ（地下街の天井・JR の天井・屋根を真上に探す）。無ければ null
// 天井の三角形は 2 m のます目に振り分けておく（札ごとに全部の天井へ光線を当てると、札が数百枚あって開くのが遅かった）
let ceilGrid = null;
function ceilingAbove(x, y, z) {
  if (!ceilGrid) {
    ceilGrid = new Map();
    const v = new THREE.Vector3();
    scene.traverse((o) => {
      if (!o.isMesh || !['mallCeil', 'ceiling', 'roof'].includes(o.name)) return;
      o.updateMatrixWorld(true);
      const pos = o.geometry.attributes.position, ix = o.geometry.index, n = ix ? ix.count : pos.count;
      for (let t = 0; t < n; t += 3) {
        const P = [0, 1, 2].map((j) => { v.fromBufferAttribute(pos, ix ? ix.getX(t + j) : t + j).applyMatrix4(o.matrixWorld); return [v.x, -v.z, v.y]; });
        const x0 = Math.floor(Math.min(P[0][0], P[1][0], P[2][0]) / 2), x1 = Math.floor(Math.max(P[0][0], P[1][0], P[2][0]) / 2), y0 = Math.floor(Math.min(P[0][1], P[1][1], P[2][1]) / 2), y1 = Math.floor(Math.max(P[0][1], P[1][1], P[2][1]) / 2);
        if ((x1 - x0 + 1) * (y1 - y0 + 1) > 2500) continue; // とても大きな三角形（100 m 角を超える）は見ない
        for (let gx = x0; gx <= x1; gx++) for (let gy = y0; gy <= y1; gy++) { const k = gx * 100000 + gy; let a = ceilGrid.get(k); if (!a) ceilGrid.set(k, (a = [])); a.push(P); }
      }
    });
  }
  let best = null;
  for (const [p, q, r] of ceilGrid.get(Math.floor(x / 2) * 100000 + Math.floor(y / 2)) || []) {
    const d = (q[1] - r[1]) * (p[0] - r[0]) + (r[0] - q[0]) * (p[1] - r[1]); if (Math.abs(d) < 1e-9) continue;
    const l1 = ((q[1] - r[1]) * (x - r[0]) + (r[0] - q[0]) * (y - r[1])) / d, l2 = ((r[1] - p[1]) * (x - r[0]) + (p[0] - r[0]) * (y - r[1])) / d, l3 = 1 - l1 - l2;
    if (l1 < -1e-6 || l2 < -1e-6 || l3 < -1e-6) continue;
    const cz = l1 * p[2] + l2 * q[2] + l3 * r[2];
    if (cz > z && cz <= z + 6 && (best == null || cz < best)) best = cz;
  }
  return best;
}
const addSign = (s, x, y, z, near = 2.5) => { // near: 同じ札をまとめる距離
  if (placed.some((p) => Math.hypot(p[0] - x, p[1] - y) < near && Math.abs(p[2] - z) < 1 && p[3] === s.userData.key)) return;
  placed.push([x, y, z, s.userData.key]);
  // 天井が低い所（PLATEAU の天井が床の 2.3 m 上など）では札の上が天井にめり込んで切れたので、天井の 8 cm 下まで下げる（床の 1.9 m 上より下にはしない）
  const hh = s.scale.y / 2, top = ceilingAbove(x, y, z - 1.2);
  if (top != null && z + hh > top - 0.08) z = Math.max(z - 0.4, Math.min(z, top - hh - 0.08));
  s.position.copy(V3(x, y, z));
  scene.add(s);
};
// 駅の設備（構内地図の Facility）の札の記号と色
const FAC_LABEL = { ticket: 'きっぷ売り場', fare: '精算所', locker: 'コインロッカー', atm: 'ATM', kiosk: '売店', info: '案内所', nursing: '授乳室', exchange: '両替所' };
const FAC_WORDS = { ticket: '券売機 みどりの窓口 切符 きっぷ', fare: '精算機 のりこし', locker: 'ロッカー 荷物', atm: '銀行 お金', kiosk: 'キオスク コンビニ', info: 'インフォメーション 案内', nursing: '赤ちゃん おむつ ベビー', exchange: '外貨 お金' }; // 名前で探すときの言いかえ
const FAC_ICON = { ticket: ['券', '#0b8f4d'], fare: ['精', '#0b8f4d'], locker: ['ロ', '#6b737b'], atm: ['¥', '#c46a2b'], kiosk: ['売', '#d0344a'], info: ['i', '#1f6fd1'], nursing: ['授', '#d0607a'], exchange: ['両', '#c46a2b'] };
for (const d of data.dest) {
  const z = LV[d.level].z;
  if (d.t === 'gate') for (const [x, y] of d.pts) { const s = sign(d.name, { bg: '#f5c400' }); s.userData.key = d.name; addSign(s, x, y, z + 2.45); }
  if (d.t === 'toilet') { // 扉の上（扉が分かれば少し外側）
    const s = sign(d.name, { bg: '#1c3f74', fg: '#fff', badge: d.kind === 'M' ? '♂' : d.kind === 'F' ? '♀' : '♿', badgeColor: d.kind === 'M' ? '#1f6fd1' : d.kind === 'F' ? '#d0344a' : '#2f8f5b' });
    s.userData.key = d.name;
    const [sx, sy] = d.door ? [d.door[0] + (d.out[0] - d.door[0]) * 0.35, d.door[1] + (d.out[1] - d.door[1]) * 0.35] : [d.x, d.y];
    addSign(s, sx, sy, z + 2.35);
  }
  // 地下街: 出口は黄色、ほかの会社の改札は薄紫、お店・地下街は白い小さな札（通路から遠いものは置かない）
  if (d.t === 'exit' || d.t === 'ogate') { const s = sign(d.name, { bg: d.t === 'exit' ? '#f5c400' : '#e4d8f3' }); s.userData.key = d.name; addSign(s, ...(d.sign || [d.x, d.y]), d.sz ?? z + 2.25); } // sign・sz: 出口の階段の上り口の上（前処理で決めた所）
  if (d.t === 'fac') { const [ch, col] = FAC_ICON[d.kind]; const s = sign(FAC_LABEL[d.kind], { bg: '#1c3f74', fg: '#fff', badge: ch, badgeColor: col, h: 0.42 }); s.userData.key = 'fac' + d.kind; const [px, py] = awayFromWall(d.sign[0], d.sign[1], z); addSign(s, px, py, d.sz ?? z + 2.3); } // sz: 売店・案内所の箱の上
  if (d.t === 'spot' && !d.near) { const s = sign(d.name, { bg: '#fff', h: 0.38 }); s.userData.key = d.name; addSign(s, d.x, d.y, d.sz ?? z + 2.15); }
  // 階段の上の端の近くには置かない（上ってくる途中で目の前に大きく出る）
  if (d.t === 'plat') for (const [x, y] of d.signs) { if (data.ramps.some((r) => r.lb === d.level && Math.hypot(r.b[0] - x, r.b[1] - y) < 6)) continue; const s = sign(`${d.name.replace(/^\S+番線 /, '')} ${d.dir || ''}`.trim(), { bg: '#fff', badge: String(d.code), badgeColor: d.color }); s.userData.key = d.name; addSign(s, x, y, z + 2.7); }
}
// 地上の出口の札: 地下から地上へ出る階段（坂の exit）の階段室の屋根の上に、下りる矢印と出口の番号（地下街の出口の点が上の端から 20 m 以内のもの。
// 近い出口は「出口 41・42」とまとめる）。番号の無い階段は「地下通路」（利用者 2026-10-30「地上に出口札表示できる？」）
const gExitLabels = []; // 小さな地図の 1F に描く出口の番号 [x, y, 文字]
if (LV['1']) {
  const exitRamps = data.ramps.filter((r) => r.exit && r.lb === 1 && !r.low), names = exitRamps.map(() => []); // low（地上のすぐ下まで上る階段に足した短い坂）は札を立てない
  for (const d of data.dest) {
    if (d.t !== 'exit') continue;
    let bi = -1, bd = 20;
    exitRamps.forEach((r, i) => { const k = Math.hypot(r.b[0] - d.x, r.b[1] - d.y); if (k < bd) { bd = k; bi = i; } });
    if (bi >= 0) names[bi].push(d.name.replace(/^出口\s*/, ''));
  }
  const num = (t) => parseInt(t, 10) || 0;
  exitRamps.forEach((r, i) => {
    const len = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]) || 1, ux = (r.b[0] - r.a[0]) / len, uy = (r.b[1] - r.a[1]) / len;
    const ns = names[i].sort((p, q) => num(p) - num(q) || p.localeCompare(q));
    const s = ns.length ? sign(`出口 ${ns.join('・')}`, { bg: '#f5c400', arrow: 'down' }) : sign('地下通路', { bg: '#fff', arrow: 'down', h: 0.42 });
    if (ns.length) gExitLabels.push([r.b[0], r.b[1], `出${ns.join('・')}`]);
    // 階段室の屋根（地上の 2.7 m 上。world.js）の口のふちの上に載せる（屋根の下だと、横や後ろから屋根と壁に隠れた）。addSign は屋根の下へ下げるので使わない
    s.position.copy(V3(r.b[0] - ux * 0.4, r.b[1] - uy * 0.4, LV['1'].z + 2.7 + s.scale.y / 2 + 0.12));
    scene.add(s);
  });
}
// 階段・エスカレーターの下に、上った先の番線（ホームに着かないものは上の階の改札）
const ROUTE_NAME = Object.fromEntries(data.dest.filter((d) => d.t === 'plat').map((d) => [d.route, [d.name.replace(/^\S+番線 /, ''), d.color]]));
// 番線の札（上り・下りの矢印、番線の丸、路線と方面）
const platSign = (list, arrow) => {
  const routes = [...new Set(list.map((t) => t.route))], dirs = [...new Set(list.map((t) => t.dir).filter(Boolean))];
  return sign(`${routes.map((k) => ROUTE_NAME[k]?.[0] || k).join('・')} ${dirs.join('／')}`.trim(), { bg: '#fff', arrow, badges: list.map((t) => [String(t.code), ROUTE_NAME[t.route]?.[1]]) });
};
for (const r of data.ramps) {
  const len = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]), dx = (r.b[0] - r.a[0]) / len, dy = (r.b[1] - r.a[1]) / len;
  let s;
  // 下りた先がホームなら、下り口の上（上の端の先 0.8 m）にも「↓ 番線 路線 方面」（品川・高輪ゲートウェイのように改札が上の階の駅で、路線が分からなかった）
  if (r.down && r.down.length) {
    const d = platSign(r.down, 'down');
    d.userData.key = 'dn' + r.down.map((t) => t.code).join();
    addSign(d, r.b[0] + dx * 0.8, r.b[1] + dy * 0.8, r.b[2] + 2.4, 6); // 並んだ階段とエスカレーターは 1 枚に
  }
  if (r.to && r.to.length) {
    s = platSign(r.to, 'up');
    s.userData.key = 'to' + r.to.map((t) => t.code).join();
  } else {
    const g = data.dest.filter((d) => d.t === 'gate' && d.level === r.lb).sort((p, q) => Math.hypot(p.x - r.b[0], p.y - r.b[1]) - Math.hypot(q.x - r.b[0], q.y - r.b[1]))[0];
    if (!g) continue;
    s = sign(g.name, { bg: '#f5c400', arrow: 'up' });
    s.userData.key = 'to' + g.name;
  }
  addSign(s, r.a[0] - dx * 0.8, r.a[1] - dy * 0.8, r.a[2] + 2.4);
}
// 行けない所の札（地下街のデータの範囲外への口、改札口の外の歩道の先、地下街の出口の階段の下）
for (const [x, y, z, text] of data.noEntry || []) { const s = sign(text, { bg: '#4b5563', fg: '#fff', badge: '×', badgeColor: '#d93025', h: 0.4 }); s.userData.key = 'ne' + text; addSign(s, x, y, z); }
for (const e of data.elevs) { const s = sign('エレベーター', { bg: '#555', fg: '#fff', h: 0.4 }); s.userData.key = 'ev'; addSign(s, e.x, e.y, LV[e.l].z + 2.3); }

// ---------- 自分 ----------
const me = { x: 0, y: 0, z: 0, yaw: 0, pitch: -0.05, eye: 0 };
(function start() { // はじめは改札の近く（池袋は中央改札1、ほかの駅は一覧の最初の改札）
  const g = data.dest.find((d) => d.name === '中央改札1') || data.dest.find((d) => d.t === 'gate') || data.dest[0];
  me.z = LV[g.level].z;
  const z = LV[g.level].z;
  for (const r of [4, 6, 3, 8]) for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2, x = g.x + Math.sin(a) * r, y = g.y + Math.cos(a) * r;
    const gz = phys.groundAt(x, y, z);
    if (gz == null) continue;
    const [cx, cy] = phys.collide(x, y, gz);
    if (Math.hypot(cx - x, cy - y) > 0.01) continue;
    Object.assign(me, { x, y, z: gz, yaw: Math.atan2(g.x - x, g.y - y) });
    return;
  }
  Object.assign(me, { x: g.x, y: g.y, z });
})();
me.eye = me.z + EYE;

// 1 歩ずつ動かす: 壁から押し出し、床があるときだけ進む（無ければ x・y の片方だけで滑らせる）
function tryAt(x, y) {
  const [cx, cy] = phys.collide(x, y, me.z);
  const gz = phys.groundAt(cx, cy, me.z);
  return gz == null ? null : [cx, cy, gz];
}
function move(dx, dy) {
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / 0.12));
  for (let i = 0; i < n; i++) {
    const sx = dx / n, sy = dy / n;
    const r = tryAt(me.x + sx, me.y + sy) || tryAt(me.x + sx, me.y) || tryAt(me.x, me.y + sy);
    if (!r) break;
    [me.x, me.y, me.z] = r;
  }
}

// ---------- 操作 ----------
const keys = new Set();
addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('input,textarea')) return;
  keys.add(e.code);
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

const view = $('view');
const ptrs = new Map(); // id → {mode: 'look' | 'stick', x, y, ox, oy}
const stick = { id: null, vx: 0, vy: 0 };
view.addEventListener('pointerdown', (e) => {
  if (mapMode) { if (!viewAnim) setMapMode(false); return; } // 地図で見ているときの右下の小さな立体: 押すと立体で見るに戻る
  view.setPointerCapture(e.pointerId);
  const W = innerWidth, H = innerHeight;
  const isStick = e.pointerType === 'touch' && stick.id == null && e.clientX < W * 0.45 && e.clientY > H * 0.35;
  ptrs.set(e.pointerId, { mode: isStick ? 'stick' : 'look', x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY });
  if (isStick) {
    stick.id = e.pointerId;
    Object.assign($('stick').style, { left: e.clientX + 'px', top: e.clientY + 'px' });
    $('stick').hidden = false;
  }
});
view.addEventListener('pointermove', (e) => {
  const p = ptrs.get(e.pointerId);
  if (!p) return;
  if (p.mode === 'look') {
    pauseReplay('止めました（ここから歩けます）');
    // 写真を手でずらす向き（ストリートビューと同じ）
    me.yaw -= (e.clientX - p.x) * 0.0045;
    me.pitch = Math.max(-1.2, Math.min(1.2, me.pitch + (e.clientY - p.y) * 0.0045));
  } else {
    let dx = e.clientX - p.ox, dy = e.clientY - p.oy;
    const d = Math.hypot(dx, dy), R = 50;
    if (d > R) { dx *= R / d; dy *= R / d; }
    stick.vx = dx / R; stick.vy = -dy / R;
    $('stick').querySelector('.knob').style.transform = `translate(${dx}px, ${dy}px)`;
  }
  p.x = e.clientX; p.y = e.clientY;
});
const endPtr = (e) => {
  const p = ptrs.get(e.pointerId);
  if (!p) return;
  ptrs.delete(e.pointerId);
  if (p.mode === 'stick') {
    stick.id = null; stick.vx = stick.vy = 0;
    $('stick').hidden = true;
    $('stick').querySelector('.knob').style.transform = '';
  }
};
view.addEventListener('pointerup', endPtr);
view.addEventListener('pointercancel', endPtr);
view.addEventListener('contextmenu', (e) => e.preventDefault());

// 走る: PC は Shift、スマホはスティックを大きく倒す。左下の十字キー（▲▼◀▶・走る）はやめた（スティックと同じことができる。利用者 2026-10-30「画面左の透明の操作パネルのようなもの、あれ不要だよね？」）

// ---------- 経路（GTFS-Pathways） ----------
const GN = data.graph.n;
const adj = GN.map(() => []);
for (const [i, j, len, mode, bi] of data.graph.e) { adj[i].push([j, len, mode]); if (bi) adj[j].push([i, len, mode]); }
const MODE = { 2: '階段', 4: 'エスカレーター', 5: 'エレベーター' };

// 経路網で、いまいる所に近い 6 点から targets（点の番号の集合）のどれかへ。[{ v: 点の番号, mode: その点へ入る経路の種類 }]
// 改札を通る線（両端の改札の内・外が違う線。経路網の種類 6・7 でない普通の通路の線にも、改札機の列を横切るものがある）と、いる所と内・外が
// 違う点から歩きはじめることには GATE_COST の損を付け、改札を通る回数の少ない道を選ぶ（改札の外から外へ、改札に入ってすぐ別の改札から出る道を
// 案内していた。池袋で外から 442 通りのうち 55 通り）。内・外は左上の「改札内・改札外」と同じ判定（fareSide）。損は 1 km 分
const GATE_COST = 1000;
const nodeSideMemo = [];
const nodeSide = (i) => (nodeSideMemo[i] ??= fareSide(GN[i][0], GN[i][1], GN[i][2]));
// 床の途切れた所を通る経路網の線（東京の八重洲南の 1F は、線が床の無い所を 10 m 以上通っていて、そこで歩けなくなった）は、ほかに道が無いとき
// 以外は使わない。端の点の床の高さで 1 m ごとに床があるか見て、3 m 以上続けて無いもの
const gapMemo = new Map();
function edgeGap(u, v) {
  const key = u < v ? u * 100000 + v : v * 100000 + u;
  if (gapMemo.has(key)) return gapMemo.get(key);
  const a = GN[u], b = GN[v];
  let gap = false;
  if (a[2] === b[2]) {
    const z = phys.groundAt(a[0], a[1], LV[a[2]].z) ?? LV[a[2]].z, L = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(2, Math.ceil(L));
    let run = 0;
    for (let i = 1; i < k && !gap; i++) {
      const g = phys.groundAt(a[0] + ((b[0] - a[0]) * i) / k, a[1] + ((b[1] - a[1]) * i) / k, z);
      run = g == null || Math.abs(g - z) > 1.2 ? run + L / k : 0;
      if (run > 3) gap = true;
    }
  }
  gapMemo.set(key, gap);
  return gap;
}
// 損を付けるのは、行き先の点がみな改札の中か、みな外のときだけ（改札そのものが行き先のときは中からでも外からでも着けるので付けない。
// 付けると東京の八重洲側の改札へ、外の経路網が床の切れ目を通る道を選んで歩けなくなった）
function graphChain(px, py, pl, targets, seeds = null) { // seeds: 歩きはじめの点と、そこまでの道のり（地上にいるとき。findRoute）
  const n = GN.length, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), pmode = new Int8Array(n), done = new Uint8Array(n);
  const side = fareSide(px, py, pl), tsides = new Set([...targets].map(nodeSide)), cost = tsides.size === 1 ? GATE_COST : 0;
  // 歩きはじめの点: 近い 12 点のうち、まっすぐ行くと壁を横切る点には大きな損（池袋の西口(中央) の 1F は点が少なく、壁の向こう 72 m 先の
  // 8番線ホームの点から歩きはじめ、壁越しの直線の道になった）。損を入れて安い 6 点から
  const wallBetween = (g) => g[2] === pl && data.walls.some((w) => w[4] === pl && crosses([px, py], [g[0], g[1]], [w[0], w[1]], [w[2], w[3]]));
  GN.map((g, i) => [i, Math.hypot(g[0] - px, g[1] - py) + (g[2] === pl ? 0 : 80)]).sort((a, b) => a[1] - b[1]).slice(0, 12)
    .map(([i, c]) => [i, c + (nodeSide(i) !== side ? cost : 0) + (wallBetween(GN[i]) ? 1000 : 0)]).sort((a, b) => a[1] - b[1]).slice(0, 6)
    .forEach(([i, c]) => { if (!seeds) dist[i] = c; });
  if (seeds) for (const [i, c] of seeds) dist[i] = Math.min(dist[i], c);
  for (;;) {
    let u = -1, best = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && dist[i] < best) { best = dist[i]; u = i; }
    if (u < 0) return null;
    if (targets.has(u)) {
      const chain = [];
      for (let v = u; v >= 0; v = prev[v]) chain.push({ v, mode: pmode[v] || 1 });
      return chain.reverse();
    }
    done[u] = 1;
    for (const [v, len, mode] of adj[u]) {
      const nd = dist[u] + len + (mode === 5 ? 20 : 0) + (mode === 6 || mode === 7 || (GN[u][2] === GN[v][2] && nodeSide(u) !== nodeSide(v)) ? cost : 0) + (edgeGap(u, v) ? 3000 : 0);
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; pmode[v] = mode; }
    }
  }
}

let groundTreeFn = null; // 地上にいるときの道の木（meet.js の groundTree。待ち合わせ案内を読み込んだあとに入る）
// 道筋: 階をまたぐ所は経路網、地下 1 階の経路網の外（地下街）はマス目（gridPath）でつなぐ
function findRoute(px, py, pl, d) {
  const B1 = GL, P = (x, y, l, mode = 1) => ({ x, y, l, mode }); // B1: マス目の階（地下街の無い駅は null）
  const gridLeg = (ax, ay, bx, by) => gridPath(ax, ay, bx, by)?.map(([x, y]) => P(x, y, B1));
  // 地上（1F）で、経路網の 1F の点が 15 m 以内に無いとき（地上の歩道にいる）は、待ち合わせの経路網の地上の歩道を
  // たどって行ける経路網の 1F の点（JR の 1F）から歩きはじめる（まっすぐ建物を横切らないように）。seeds: [経路網の点, そこまでの道のり, 待ち合わせの経路網の点]
  let gt = null, seeds = null;
  if (groundTreeFn && pl === 1 && !GN.some((g) => g[2] === 1 && Math.hypot(g[0] - px, g[1] - py) < 15) && (gt = groundTreeFn(px, py))) {
    seeds = [];
    GN.forEach((g, i) => { if (g[2] !== 1) return; const r = gt.reach(g[0], g[1], 0); if (r) seeds.push([i, r.cost, r.node]); });
    if (!seeds.length) seeds = null;
  }
  const fromChain = (chain) => {
    const s = seeds && chain.length && seeds.find(([i]) => i === chain[0].v);
    const leg = s ? gt.path(s[2]).map(([x, y, l]) => P(x, y, l)) : [];
    return [P(px, py, pl), ...leg, ...chain.map(({ v, mode }) => P(GN[v][0], GN[v][1], GN[v][2], mode))];
  };
  if (!d.nodes) { // 地下街の行き先（経路網の外）。地上へ出る出口は、出口の階段の足元（foot。前処理で決めた所）まで
    const [dx, dy] = d.foot || [d.x, d.y];
    if (pl === B1) return gridLeg(px, py, dx, dy) || [P(px, py, pl), P(dx, dy, B1)];
    // ほかの階からは、経路網で行き先に近い地下 1 階の点まで行き、そこからマス目
    // 地下街の行き先は改札の外なので、改札の外の点を目指す（地図で選んだ場所は、その場所と同じ側）
    const want = d.t === 'pin' ? fareSide(d.x, d.y, B1) : 'out';
    const near = GN.map((g, i) => [i, g]).filter(([i, g]) => g[2] === B1 && nodeSide(i) === want).sort((a, b) => Math.hypot(a[1][0] - dx, a[1][1] - dy) - Math.hypot(b[1][0] - dx, b[1][1] - dy)).slice(0, 3).map(([i]) => i);
    const chain = graphChain(px, py, pl, new Set(near), seeds);
    if (!chain) return null;
    const pts = fromChain(chain), last = pts[pts.length - 1], leg = gridLeg(last.x, last.y, dx, dy);
    return leg ? [...pts, ...leg.slice(1)] : [...pts, P(dx, dy, B1)];
  }
  const chain = graphChain(px, py, pl, new Set(d.nodes), seeds);
  if (!chain) return null;
  let pts = fromChain(chain);
  // 地下 1 階で最初の点まで遠い（地下街にいる）ときは、最初の区間をマス目で
  if (B1 != null && pl === B1 && pts.length > 1 && pts[1].l === B1 && Math.hypot(pts[1].x - px, pts[1].y - py) > 5) {
    const leg = gridLeg(px, py, pts[1].x, pts[1].y);
    if (leg) pts = [P(px, py, pl), ...leg.slice(1), ...pts.slice(2)];
  }
  // トイレは 扉の外 → 扉 → 中 の順にたどる（扉が分からないものはトイレの点へ）
  if (d.t === 'toilet') for (const [x, y] of d.door ? [d.out, d.door, d.in] : [[d.x, d.y]]) pts.push(P(x, y, d.level));
  if (d.t === 'elev' || d.t === 'fac' || d.t === 'pin') pts.push(P(d.x, d.y, d.level)); // 箱の中まで・設備の前の通路まで・地図で選んだ場所まで
  return pts;
}

// ---------- 地下 1 階のマス目（経路網の無い地下街の中の道） ----------
// 0.5 m 角。床の無いマスと、胸の高さの壁の線が通るマスはふさぐ（改札機は通れるのでふさがない。階段の下は板の高さで決まる）
let grid = null;
function getGrid() {
  if (grid || GL == null) return grid;
  const C = 0.5, z0 = LV[GL].z, h = z0 + 1.0, lo = z0 - 3.0, hi = z0 + 2.0; // 地下街には地下 1 階より 2.6 m 低い所（新宿の西口側）、1.9 m 高い所（池袋の西武の地下）もある
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of phys.floors) {
    if (Math.min(t[2], t[5], t[8]) < lo || Math.max(t[2], t[5], t[8]) > hi) continue;
    x0 = Math.min(x0, t[0], t[3], t[6]); x1 = Math.max(x1, t[0], t[3], t[6]); y0 = Math.min(y0, t[1], t[4], t[7]); y1 = Math.max(y1, t[1], t[4], t[7]);
  }
  // マスごとの床の高さ（地下 1 階に近い面）
  const W = Math.ceil((x1 - x0) / C) + 1, H = Math.ceil((y1 - y0) / C) + 1, ok = new Uint8Array(W * H), zc = new Float32Array(W * H);
  const multi = new Map(); // 床が 2 枚以上重なるます → 高さの一覧
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const zs0 = phys.surfacesAt(x0 + (i + 0.5) * C, y0 + (j + 0.5) * C).filter((z) => z > lo && z < hi);
    // すぐ上（1.9 m 未満）に別の面がある床は使わない。段差（STEP）以内なら歩くと上の面に持ち上げられ、それより高ければ頭がつかえる。
    // 地下の床に低くかぶさる階段の足元で、ます目は下の床を通るのに、歩くと階段を上ってしまった（池袋の (195,44)。2026-10-30）
    const zs = zs0.filter((z) => !zs0.some((w) => w > z + 0.05 && w < z + 1.9));
    if (!zs.length) continue;
    ok[j * W + i] = 1;
    zc[j * W + i] = zs.reduce((b, v) => (Math.abs(v - z0) < Math.abs(b - z0) ? v : b));
    if (zs.length >= 3) { const o = zs.slice().sort((p, q) => p - q); zc[j * W + i] = o[Math.floor(o.length / 2)]; } // 3 枚以上重なる（下の床・坂・上の床）なら真ん中の坂
    else if (zs.length > 1 && Math.max(...zs) - Math.min(...zs) > 0.3) multi.set(j * W + i, zs);
  }
  // 重なるますは、となりのますの高さの平均にいちばん近い床を選び直す（3 回）。坂の下に JR の床が続いている所で、基準に近い下の床を選んで
  // 坂の途中に 1.1 m の段差ができ、東側の通路がつながっていないとみなされた（池袋の (69,-45)。2026-10-30）
  // となりとの段差（いちばん大きいもの）がいちばん小さくなる床を選ぶ。8 回くり返して、坂の上の床が順に選ばれるように
  for (let it = 0; it < 8; it++) for (const [c, zs] of multi) {
    const i = c % W, j = (c - i) / W, nb = [];
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue; const nc = jj * W + ii; if (ok[nc]) nb.push(zc[nc]); }
    if (!nb.length) continue;
    const cost = (v) => nb.reduce((s2, z) => s2 + Math.min(1.5, Math.abs(z - v)), 0);
    zc[c] = zs.reduce((b, v) => (cost(v) < cost(b) - 1e-6 ? v : b), zc[c]);
  }
  // 壁: そのマスの床から、すね〜頭（0.3〜1.75 m。当たり判定と同じ）の高さにかかればふさぐ
  const mark = (x, y, za, zb) => {
    const i = Math.floor((x - x0) / C), j = Math.floor((y - y0) / C);
    if (i < 0 || j < 0 || i >= W || j >= H) return;
    const c = j * W + i, f = zc[c];
    if (ok[c] && zb >= f + 0.3 && za <= f + 1.75) ok[c] = 0;
  };
  for (const s of phys.segs) {
    if (s.gate) continue;
    const L = Math.hypot(s.bx - s.ax, s.by - s.ay), n = Math.max(1, Math.ceil(L / 0.2));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      mark(s.ax + (s.bx - s.ax) * t, s.ay + (s.by - s.ay) * t, s.z0a + (s.z0b - s.z0a) * t, s.z1a + (s.z1b - s.z1a) * t);
    }
  }
  for (const t of phys.wtris) { // 地下街の壁: 0.25 m ごとの高さで水平に切った線
    const tz0 = Math.min(t[2], t[5], t[8]), tz1 = Math.max(t[2], t[5], t[8]);
    for (let hs = Math.max(tz0, lo + 0.3); hs <= Math.min(tz1, hi + 1.75); hs += 0.25) {
      const p = [];
      for (let k = 0; k < 3; k++) {
        const a = k * 3, b = ((k + 1) % 3) * 3, za = t[a + 2] - hs, zb = t[b + 2] - hs;
        if ((za < 0) !== (zb < 0)) { const u = za / (za - zb); p.push([t[a] + (t[b] - t[a]) * u, t[a + 1] + (t[b + 1] - t[a + 1]) * u]); }
      }
      if (p.length !== 2) continue;
      const L = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]), n = Math.max(1, Math.ceil(L / 0.2));
      for (let k = 0; k <= n; k++) mark(p[0][0] + ((p[1][0] - p[0][0]) * k) / n, p[0][1] + ((p[1][1] - p[0][1]) * k) / n, hs, hs);
    }
  }
  // 改札機の列: 改札機の線はふさぎ、となり合う改札機のあいだ（通路）の中心線だけ開ける（斜めに横切らないように）
  const B1gates = data.gates.filter((g) => g[2] === GL);
  const line = (ax, ay, bx, by, v) => {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 0.1));
    for (let k = 0; k <= n; k++) { const i = Math.floor((ax + ((bx - ax) * k) / n - x0) / C), j = Math.floor((ay + ((by - ay) * k) / n - y0) / C); if (i >= 0 && j >= 0 && i < W && j < H) ok[j * W + i] = v; }
  };
  // 改札の帯: 改札機の列の線から 0.6 m 以内（列の両端から 1.5 m 先まで。列どうしのすき間も通れるので）。ここに入るのに GATE_COST の損
  const gateCell = new Uint8Array(W * H);
  for (const r of fareRows) {
    if (r.l !== GL) continue;
    const ext = Math.max(Math.abs(r.t0), Math.abs(r.t1)) + 2.5;
    for (let j = Math.floor((r.cy - ext - y0) / C); j <= Math.ceil((r.cy + ext - y0) / C); j++) for (let i = Math.floor((r.cx - ext - x0) / C); i <= Math.ceil((r.cx + ext - x0) / C); i++) {
      if (i < 0 || j < 0 || i >= W || j >= H) continue;
      const x = x0 + (i + 0.5) * C, y = y0 + (j + 0.5) * C, t = (x - r.cx) * r.rx + (y - r.cy) * r.ry;
      if (t > r.t0 - 1.5 && t < r.t1 + 1.5 && Math.abs(r.side(x, y)) < 0.6) gateCell[j * W + i] = 1;
    }
  }
  for (const [cx, cy, , len, , ang] of B1gates) { const ux = Math.cos(ang) * len / 2, uy = Math.sin(ang) * len / 2; line(cx - ux, cy - uy, cx + ux, cy + uy, 0); }
  for (let a = 0; a < B1gates.length; a++) for (let b = a + 1; b < B1gates.length; b++) {
    const [ax, ay, , len, , ang] = B1gates[a], [bx, by] = B1gates[b];
    const ux = Math.cos(ang), uy = Math.sin(ang), dx = bx - ax, dy = by - ay;
    const along = dx * ux + dy * uy, perp = Math.abs(-dx * uy + dy * ux);
    if (Math.abs(along) > 0.6 || perp < 0.45 || perp > 1.3) continue;
    const mx = (ax + bx) / 2, my = (ay + by) / 2, h2 = len / 2 + 0.6; // 改札機の前後 0.6 m まで
    line(mx - ux * h2, my - uy * h2, mx + ux * h2, my + uy * h2, 1);
  }
  // 壁ぎわ（となりにふさいだマスがある）のマスと、つながりの番号（いちばん大きいものに出発・行き先を寄せる）
  const near = new Uint8Array(W * H), comp = new Int32Array(W * H).fill(-1);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (!ok[j * W + i]) continue;
    for (let dj = -1; dj <= 1 && !near[j * W + i]; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= W || jj >= H || !ok[jj * W + ii]) { near[j * W + i] = 1; break; }
    }
  }
  let main = -1, mainSize = 0;
  const sizes = [];
  for (let s = 0, id = 0; s < W * H; s++) {
    if (!ok[s] || comp[s] >= 0) continue;
    const q = [s]; comp[s] = id; let n = 0;
    while (q.length) {
      const c = q.pop(), i = c % W, j = (c / W) | 0; n++;
      for (const nc of [i + 1 < W ? c + 1 : -1, i > 0 ? c - 1 : -1, j + 1 < H ? c + W : -1, j > 0 ? c - W : -1]) if (nc >= 0 && ok[nc] && comp[nc] < 0 && Math.abs(zc[nc] - zc[c]) <= STEP) { comp[nc] = id; q.push(nc); }
    }
    sizes.push(n);
    if (n > mainSize) { mainSize = n; main = id; }
    id++;
  }
  grid = { C, x0, y0, W, H, ok, near, comp, main, zc, sizes, gateCell };
  // 地下街の行き先のうち、つながった部分に寄せられないものは行けない（一覧から外す）
  for (const d of data.dest) if (!d.nodes && snapCell(d.x, d.y) < 0) d.unreach = 1;
  return grid;
}
// 出発地に降りるマス: いちばん大きくつながった部分で、まわり 1 m（±2 マス）がすべて歩けるいちばん近いマス（12 m まで）。
// 出口の階段の下のような狭いすみに降りて、目の前が壁や階段にならないように
function openCell(x, y) {
  const { C, x0, y0, W, H, ok, comp, main } = grid;
  const ci = Math.floor((x - x0) / C), cj = Math.floor((y - y0) / C);
  const open = (i, j) => { for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= W || jj >= H || !ok[jj * W + ii]) return false; } return true; };
  for (let r = 0; r <= 24; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
    if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
    const i = ci + di, j = cj + dj;
    if (i >= 0 && j >= 0 && i < W && j < H && comp[j * W + i] === main && open(i, j)) return j * W + i;
  }
  return snapCell(x, y);
}
// いちばん大きくつながった部分の、いちばん近いマス（12 m まで。壁ぎわでないマスを先に）。
// wide: 地図のタップでは、データの上でつながっていない 100 m² 以上の部分にも降りる（新宿の西口側の地下街は JR の地下 1 階との間に床が無い）
function snapCell(x, y, wide = false) {
  if (!grid) return -1;
  const { C, x0, y0, W, H, ok, near, comp, main, sizes } = grid;
  const okComp = (k) => k === main || (wide && k >= 0 && sizes[k] >= 400);
  const ci = Math.floor((x - x0) / C), cj = Math.floor((y - y0) / C);
  // その点に床があれば、その床と段差（STEP）以内のますだけに寄せる。壁ぎわの点から、となりの階段の上のますに寄せて、
  // 地下の床の点へ向かう道が階段を上ってしまった（池袋の (197,41)。2026-10-30）
  const c0 = ci >= 0 && cj >= 0 && ci < W && cj < H && grid.ok[cj * W + ci] ? cj * W + ci : -1, zRef = c0 >= 0 ? grid.zc[c0] : null;
  let fallback = -1;
  for (let r = 0; r <= 24; r++) {
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const i = ci + di, j = cj + dj, c = j * W + i;
      if (i < 0 || j < 0 || i >= W || j >= H || !ok[c] || !okComp(comp[c])) continue;
      if (zRef != null && Math.abs(grid.zc[c] - zRef) > STEP) continue;
      if (!near[c]) return c;
      if (fallback < 0) fallback = c;
    }
    if (fallback >= 0 && r >= 2) return fallback;
  }
  return fallback;
}
// マス目の上の最短の道（A*、斜めは角をかすめない）。見通せる所はまっすぐにつなぐ。[[x, y], ...] か null
function gridPath(ax, ay, bx, by) {
  if (!getGrid()) return null; // 地下街の無い駅
  const { C, x0, y0, W, H, ok, near, zc, gateCell } = grid;
  const s = snapCell(ax, ay), t = snapCell(bx, by);
  if (s < 0 || t < 0) return null;
  const N = W * H, g = new Float32Array(N).fill(Infinity), came = new Int32Array(N).fill(-1), closed = new Uint8Array(N);
  const ti = t % W, tj = (t / W) | 0;
  const hfn = (c) => { const dx = Math.abs((c % W) - ti), dy = Math.abs(((c / W) | 0) - tj); return Math.max(dx, dy) + 0.414 * Math.min(dx, dy); };
  const heap = [], push = (f, c) => { heap.push([f, c]); let k = heap.length - 1; while (k) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k], heap[m]]; k = m; } } return top; };
  g[s] = 0; push(hfn(s), s);
  const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  let found = false;
  while (heap.length) {
    const [, c] = pop();
    if (closed[c]) continue;
    if (c === t) { found = true; break; }
    closed[c] = 1;
    const ci = c % W, cj = (c / W) | 0;
    for (const [di, dj, w] of NB) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= W || j >= H) continue;
      const nc = j * W + i;
      if (!ok[nc] || closed[nc] || Math.abs(zc[nc] - zc[c]) > STEP) continue; // 上れない段差
      if (di && dj && (!ok[cj * W + i] || !ok[j * W + ci])) continue; // 角をかすめない
      const ng = g[c] + w + (near[nc] ? 2 : 0) + (gateCell[nc] && !gateCell[c] ? GATE_COST / C : 0); // 壁ぎわは通りにくく（通路の真ん中を通る）。改札は通る回数を少なく
      if (ng < g[nc]) { g[nc] = ng; came[nc] = c; push(ng + hfn(nc), nc); }
    }
  }
  if (!found) return null;
  const cells = [];
  for (let c = t; c >= 0; c = came[c]) cells.push(c);
  cells.reverse();
  const xy = (c) => [x0 + ((c % W) + 0.5) * C, y0 + (((c / W) | 0) + 0.5) * C];
  const see = (a, b) => { // 2 つのマスのあいだが全部歩けて、壁ぎわを通らないか
    const [ax2, ay2] = xy(a), [bx2, by2] = xy(b), n = Math.ceil(Math.hypot(bx2 - ax2, by2 - ay2) / (C * 0.4));
    for (let k = 1; k < n; k++) {
      const c = Math.floor((ay2 + ((by2 - ay2) * k) / n - y0) / C) * W + Math.floor((ax2 + ((bx2 - ax2) * k) / n - x0) / C);
      if (!ok[c] || (near[c] && c !== a && c !== b) || Math.abs(zc[c] - zc[a]) > STEP + 0.15) return false;
    }
    return true;
  };
  const out = [xy(cells[0])];
  for (let a = 0; a < cells.length - 1;) {
    let b = a + 1;
    while (b + 1 < cells.length && see(cells[a], cells[b + 1])) b++;
    out.push(xy(cells[b]));
    a = b;
  }
  return out;
}
setTimeout(() => getGrid(), 1500); // 最初の案内で待たないように、読み込みのあとで作っておく

// ---------- 改札の内と外 ----------
// 経路網の点のうち、ホームの乗車位置から改札（経路の種類 6・7）を通らずにたどれる点が改札内
const paid = new Uint8Array(GN.length);
{
  const nb = GN.map(() => []);
  for (const [i, j, , mode] of data.graph.e) if (mode !== 6 && mode !== 7) { nb[i].push(j); nb[j].push(i); }
  const q = data.dest.filter((d) => d.t === 'plat').flatMap((d) => d.nodes);
  q.forEach((i) => { paid[i] = 1; });
  while (q.length) { const u = q.pop(); for (const v of nb[u]) if (!paid[v]) { paid[v] = 1; q.push(v); } }
}
// 改札機の列の線: となり合う改札機の中心をつなぐ。列の両端の改札機からは、列の向きに 0.8 m のばす（壁とのすき間をふさぐ）
const fareLines = [];
{
  const G = data.gates, deg = new Map();
  for (let a = 0; a < G.length; a++) for (let b = a + 1; b < G.length; b++) {
    if (G[a][2] !== G[b][2]) continue;
    const ux = Math.cos(G[a][5]), uy = Math.sin(G[a][5]), dx = G[b][0] - G[a][0], dy = G[b][1] - G[a][1];
    const along = dx * ux + dy * uy, perp = Math.abs(-dx * uy + dy * ux);
    if (Math.abs(along) > 0.6 || perp < 0.3 || perp > 1.3) continue;
    fareLines.push([G[a][0], G[a][1], G[b][0], G[b][1], G[a][2]]);
    for (const [k, o] of [[a, b], [b, a]]) { if (!deg.has(k)) deg.set(k, []); deg.get(k).push(o); }
  }
  for (const [k, os] of deg) {
    if (os.length !== 1) continue;
    const [x, y, l] = G[k], o = G[os[0]], L = Math.hypot(x - o[0], y - o[1]);
    fareLines.push([x, y, x + ((x - o[0]) / L) * 0.8, y + ((y - o[1]) / L) * 0.8, l]);
  }
}
const crosses = (p, q, a, b) => {
  const o = (u, v, w) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
  return o(a, b, p) * o(a, b, q) < 0 && o(p, q, a) * o(p, q, b) < 0;
};
// 改札機の列から 1 m 以内の点は判定に使わない（南改札の内側の点が列のちょうど上にあり、外からも列を横切らずに届いた）
const onFare = GN.map((g) => fareLines.some((f) => {
  if (f[4] !== g[2]) return false;
  const dx = f[2] - f[0], dy = f[3] - f[1], L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((g[0] - f[0]) * dx + (g[1] - f[1]) * dy) / L)) : 0;
  return Math.hypot(g[0] - f[0] - dx * t, g[1] - f[1] - dy * t) < 1;
}));
// 改札機の列ごとに、どちら側が改札内か。列は、となり合う改札機をつないでできるまとまり。向きは改札機に直角。
// 改札内の側は、列の近く（6 m 以内）を通る改札の経路（種類 6）の、改札外の点から改札内の点へ向かう向きの多数決。
// （前は改札内の点が列のどちら側にあるかで数えていた。池袋の南改札は経路網の改札の線が実際の改札機の列より 4〜6 m 南にずれていて、
// 改札内の点も列の南にあったので、南が改札内と逆に決まり、改札の外の帯が改札内になって案内が外を回った）
const fareRows = [];
{
  const G = data.gates, parent = G.map((_, i) => i), find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let a = 0; a < G.length; a++) for (let b = a + 1; b < G.length; b++) {
    if (G[a][2] !== G[b][2]) continue;
    const ux = Math.cos(G[a][5]), uy = Math.sin(G[a][5]), dx = G[b][0] - G[a][0], dy = G[b][1] - G[a][1];
    if (Math.abs(dx * ux + dy * uy) <= 0.6 && Math.abs(-dx * uy + dy * ux) <= 1.3) parent[find(a)] = find(b);
  }
  const groups = {};
  G.forEach((g, i) => (groups[find(i)] = groups[find(i)] || []).push(g));
  for (const ms of Object.values(groups)) {
    if (ms.length < 2) continue;
    const l = ms[0][2], ang = ms[0][5], rx = -Math.sin(ang), ry = Math.cos(ang); // 列の向き
    const cx = ms.reduce((s, g) => s + g[0], 0) / ms.length, cy = ms.reduce((s, g) => s + g[1], 0) / ms.length;
    const pr = ms.map((g) => (g[0] - cx) * rx + (g[1] - cy) * ry), t0 = Math.min(...pr), t1 = Math.max(...pr);
    const side = (x, y) => (x - cx) * -ry + (y - cy) * rx; // 列からの符号つきの距離
    let vote = 0;
    for (const [i, j, , mode] of data.graph.e) {
      if (mode !== 6 || GN[i][2] !== l) continue;
      const mx = (GN[i][0] + GN[j][0]) / 2, my = (GN[i][1] + GN[j][1]) / 2;
      if (Math.hypot(mx - cx, my - cy) > 6 + (t1 - t0) / 2) continue;
      const [pi, ui] = paid[i] ? [i, j] : [j, i], sp = side(GN[pi][0], GN[pi][1]), su = side(GN[ui][0], GN[ui][1]);
      if (Math.abs(sp - su) > 0.3) vote += Math.sign(sp - su);
    }
    if (vote) fareRows.push({ l, cx, cy, rx, ry, t0, t1, side, inSign: Math.sign(vote) });
  }
}
// いまいる所: 改札機の列の前後 4 m 以内なら、列のどちら側か。そうでなければ、改札機の列も壁も横切らずにまっすぐ行ける、
// いちばん近い経路網の点（30 m まで）の内・外。無ければ改札外（地下街など）
function fareSide(x, y, l) {
  for (const r of fareRows) {
    if (r.l !== l) continue;
    const t = (x - r.cx) * r.rx + (y - r.cy) * r.ry, s = r.side(x, y);
    if (t > r.t0 - 1.5 && t < r.t1 + 1.5 && Math.abs(s) < 4) return Math.sign(s) === r.inSign ? 'in' : 'out';
  }
  const cand = [];
  GN.forEach((g, i) => { if (g[2] === l && !onFare[i]) { const d = Math.hypot(g[0] - x, g[1] - y); if (d < 30) cand.push([i, d]); } });
  cand.sort((a, b) => a[1] - b[1]);
  for (const [i] of cand.slice(0, 12)) {
    const p = [x, y], q = [GN[i][0], GN[i][1]];
    if (fareLines.some((f) => f[4] === l && crosses(p, q, [f[0], f[1]], [f[2], f[3]]))) continue;
    if (data.walls.some((w) => w[4] === l && w[5] !== 'r' && crosses(p, q, [w[0], w[1]], [w[2], w[3]]))) continue;
    return paid[i] ? 'in' : 'out';
  }
  return 'out';
}

// ---------- 吊り下げの案内看板 ----------
// 経路網の分かれ道（同じ階の 3 方向以上につながる点。ホームの上は除く）の手前 2.5 m に、近づいてくる人の側を向けて天井から下げる。
// 改札とホームの番線のそれぞれへ経路網で道をたどり（graphChain と同じ損: 改札を通る・床の途切れた線）、その分かれ道から進む向きを
// 近づいてくる向きに対する矢印（← ↖ ↑ ↗ →）にする。向きが 2 つ以上に分かれる所だけ。改札は黄色、ホームは黒（JR の案内の色）。
// 行き先まで 8 m 以内のものは出さない。後ろへ戻る道のものは出さない。分かれ道は 12 m 以内を 1 つにまとめ、同じ向きの看板は 15 m（同じ中身は 30 m）以内に 2 つ置かない。全部の番線へ同じ向きなら「のりば（全番線）」
const guideSigns = [];
{
  const n = GN.length;
  // 行き先: 改札（名前ごと）と、ホーム（番線ごと）
  const targets = [
    ...data.dest.filter((d) => d.t === 'gate').map((d) => ({ kind: 'gate', name: d.name, nodes: d.nodes })),
    ...data.dest.filter((d) => d.t === 'plat').map((d) => ({ kind: 'plat', code: d.code, name: d.name, nodes: d.nodes })),
  ].filter((t) => t.nodes?.length);
  // 逆向きにたどる（行き先からの距離と、行き先へ向かう次の点）
  const radj = GN.map(() => []);
  for (const [i, j, len, mode, bi] of data.graph.e) { radj[j].push([i, len, mode]); if (bi) radj[i].push([j, len, mode]); }
  for (const t of targets) {
    const dist = new Float64Array(n).fill(Infinity), next = new Int32Array(n).fill(-1), done = new Uint8Array(n);
    const sides = new Set(t.nodes.map((i) => paid[i])), cost = sides.size === 1 ? GATE_COST : 0;
    const heap = []; // [距離, 点] の小さい順（東京は 3,000 点・行き先 40 なので、毎回いちばん近い点を探すと遅い）
    const push = (d, v) => { heap.push([d, v]); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const a = 2 * i + 1, b = a + 1; let m = i; if (a < heap.length && heap[a][0] < heap[m][0]) m = a; if (b < heap.length && heap[b][0] < heap[m][0]) m = b; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
    for (const i of t.nodes) { dist[i] = 0; push(0, i); }
    while (heap.length) {
      const [du, u] = pop();
      if (done[u] || du > dist[u]) continue;
      done[u] = 1;
      for (const [v, len, mode] of radj[u]) { // v → u の線
        const nd = dist[u] + len + (mode === 5 ? 60 : 0) + (mode === 6 || mode === 7 || (GN[u][2] === GN[v][2] && paid[u] !== paid[v]) ? cost : 0) + (edgeGap(u, v) ? 3000 : 0);
        if (nd < dist[v]) { dist[v] = nd; next[v] = u; push(nd, v); }
      }
    }
    t.dist = dist; t.next = next;
  }
  const inRing = (x, y, r) => { let s = false; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) if ((r[i + 1] > y) !== (r[j + 1] > y) && x < ((r[j] - r[i]) * (y - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) s = !s; return s; };
  const onPlat = (x, y, l) => data.floors.some((f) => f.k === 'plat' && f.l === l && inRing(x, y, f.r[0]));
  const nb = GN.map(() => new Set());
  for (const [i, j] of data.graph.e) if (GN[i][2] === GN[j][2]) { nb[i].add(j); nb[j].add(i); }
  const ARROWS = ['L', 'UL', 'U', 'UR', 'R'];
  const arrowOf = (ax, ay, bx, by) => { // 近づく向き (ax, ay) に対する進む向き (bx, by)。左が正
    const a = Math.atan2(ax * by - ay * bx, ax * bx + ay * by) * 180 / Math.PI;
    if (Math.abs(a) < 25) return 'U';
    if (Math.abs(a) < 65) return a > 0 ? 'UL' : 'UR';
    if (Math.abs(a) < 135) return a > 0 ? 'L' : 'R';
    return null; // 後ろ
  };
  // 分かれ道 J から行き先 t へ進む向き: 次の点をたどって 3 m 以上離れた所（階が変わる所まで）
  const goDir = (J, t) => {
    let v = J;
    for (let k = 0; k < 12; k++) {
      const w = t.next[v];
      if (w < 0) return null;
      if (GN[w][2] !== GN[J][2]) return [GN[w][0] - GN[J][0], GN[w][1] - GN[J][1], w, v === J ? w : v];
      v = w;
      if (Math.hypot(GN[v][0] - GN[J][0], GN[v][1] - GN[J][1]) >= 3) break;
    }
    return [GN[v][0] - GN[J][0], GN[v][1] - GN[J][1], v, t.next[J]];
  };
  const codeList = (codes) => { // 記号（K・S など）ごとに、3 つ以上続く番号は「1〜4」に
    const by = {};
    for (const c of new Set(codes)) { const m = /^(\D*)(\d+)$/.exec(c); (by[m ? m[1] : c] = by[m ? m[1] : c] || []).push(m ? +m[2] : null); }
    return Object.entries(by).map(([p, ks]) => {
      const nums = ks.filter((k) => k != null).sort((a, b) => a - b), out = ks.some((k) => k == null) ? [p] : [];
      for (let i = 0; i < nums.length;) {
        let j = i;
        while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
        out.push(j - i >= 2 ? `${p}${nums[i]}〜${p}${nums[j]}` : nums.slice(i, j + 1).map((k) => p + k).join('・'));
        i = j + 1;
      }
      return out.join('・');
    }).join('・') + '番線';
  };
  // 分かれ道: 12 m 以内のものは 1 つに（つながる線の多い点から）。東京は経路網の点が細かく、そのままでは 1,500 枚を超えた
  const junctions = [];
  for (const J of [...GN.keys()].filter((i) => nb[i].size >= 3).sort((a, b) => nb[b].size - nb[a].size)) {
    const [jx, jy, jl] = GN[J];
    if (onPlat(jx, jy, jl) || junctions.some((k) => GN[k][2] === jl && Math.hypot(GN[k][0] - jx, GN[k][1] - jy) < 12)) continue;
    junctions.push(J);
  }
  const allPlats = new Set(targets.filter((t) => t.kind === 'plat').map((t) => t.code));
  for (const J of junctions) {
    const [jx, jy, jl] = GN[J];
    for (const A of nb[J]) {
      const [ax, ay] = GN[A], L = Math.hypot(jx - ax, jy - ay);
      if (L < 4) continue; // 4 m 以上の通路から近づく向きだけ
      const ux = (jx - ax) / L, uy = (jy - ay) / L; // 近づく向き
      const groups = {};
      for (const t of targets) {
        if (!(t.dist[J] < 1e6) || t.dist[J] < 8) continue;
        const g = goDir(J, t);
        if (!g || t.next[J] === A) continue;
        const ar = arrowOf(ux, uy, g[0], g[1]);
        if (ar) (groups[ar] = groups[ar] || []).push(t);
      }
      const keys = ARROWS.filter((k) => groups[k]);
      if (keys.length < 2) continue;
      // 看板の中身: 向きごとに、改札（近い 2 つ）とホーム（番線をまとめる）
      const segs = [];
      for (const k of keys) {
        const gs = groups[k].filter((t) => t.kind === 'gate').sort((p, q) => p.dist[J] - q.dist[J]).slice(0, 2);
        const ps = groups[k].filter((t) => t.kind === 'plat');
        if (gs.length) segs.push({ arrow: k, kind: 'gate', text: gs.map((t) => t.name).join('・') });
        if (ps.length) segs.push({ arrow: k, kind: 'plat', text: allPlats.size > 2 && ps.length === allPlats.size ? 'のりば（全番線）' : codeList(ps.map((t) => t.code)) });
      }
      // 置く所: 分かれ道の手前 2.5 m（線が短ければ半分）。床の上で、天井の下
      // 看板の幅（最大 4.2 m）に柱・壁がかかる所は避ける: 手前 2.5 m がだめなら 1.5・3.5・4.5 m（線の半分まで）を試す（池袋の (-16,-31) で柱に札が切れた）
      let px, py, gz = null;
      for (const back of [2.5, 1.5, 3.5, 4.5]) {
        if (back > L / 2 && back !== 1.5) continue;
        const qx = jx - ux * back, qy = jy - uy * back, g = phys.groundAt(qx, qy, LV[jl].z);
        if (g == null || Math.abs(g - LV[jl].z) > 0.6) continue;
        const hw = 2.2, ex = -uy, ey = ux, a0 = [qx - ex * hw, qy - ey * hw], a1 = [qx + ex * hw, qy + ey * hw];
        const cross = (p, q, r, s) => { const d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]); if (Math.abs(d) < 1e-9) return false; const t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d, u = ((r[0] - p[0]) * (q[1] - p[1]) - (r[1] - p[1]) * (q[0] - p[0])) / d; return t > 0 && t < 1 && u > 0 && u < 1; };
        const segs = phys.segsNear(qx, qy, g + 2.2, hw + 2.5);
        let bad = false;
        for (let dd = 0; dd <= 3.5 && !bad; dd += 0.5) { const b0 = [a0[0] - ux * dd, a0[1] - uy * dd], b1 = [a1[0] - ux * dd, a1[1] - uy * dd]; if (segs.some(([sx, sy, tx, ty]) => cross(b0, b1, [sx, sy], [tx, ty]))) bad = true; } // 看板の面と、その手前 3.5 m まで
        if (bad) continue;
        px = qx; py = qy; gz = g; break;
      }
      if (gz == null) continue;
      const key = segs.map((sg) => sg.arrow + sg.text).join('|');
      if (guideSigns.some((s) => s.l === jl && s.ux * ux + s.uy * uy > 0.7 && Math.hypot(s.x - px, s.y - py) < (s.key === key ? 30 : 15))) continue; // 同じ向きは 15 m、同じ中身は 30 m 以内に 2 つ置かない
      if (guideSigns.some((s) => s.l === jl && Math.hypot(s.x - px, s.y - py) < 1.5)) continue;
      guideSigns.push({ x: px, y: py, z: gz, l: jl, ux, uy, segs, key });
    }
  }
  // 看板の絵: 区切りごとに 矢印 + 文字。改札は黄色の地に黒、ホームは黒の地に白
  const drawArrow = (g, k, x, y, s, col) => { // 中心 (x, y)、大きさ s
    const a = { L: Math.PI, UL: (Math.PI * 3) / 4, U: Math.PI / 2, UR: Math.PI / 4, R: 0 }[k];
    g.save(); g.translate(x, y); g.rotate(-a); g.fillStyle = col;
    g.beginPath(); g.moveTo(s, 0); g.lineTo(0, -s * 0.8); g.lineTo(0, -s * 0.32); g.lineTo(-s, -s * 0.32); g.lineTo(-s, s * 0.32); g.lineTo(0, s * 0.32); g.lineTo(0, s * 0.8); g.closePath(); g.fill();
    g.restore();
  };
  const FONT = 'bold 38px system-ui, "Hiragino Sans", "Noto Sans JP", sans-serif'; // 看板の数が多い（東京）ので絵は小さく（高さ 64 画素）
  const frame = new THREE.MeshLambertMaterial({ color: '#3a4048' }), backing = new THREE.MeshLambertMaterial({ color: '#b4bbc1' }); // 裏は明るい灰色（黒いと、裏から見た看板が天井の下で重たく見えた）
  const meas = document.createElement('canvas').getContext('2d');
  meas.font = FONT;
  // 文字の絵は近いものだけ作る（guideUpdate。東京は 500 枚あり、全部作るとスマホで重い）
  const paint = (s) => {
    const c = document.createElement('canvas'), g = c.getContext('2d');
    c.width = Math.ceil(s.ws.reduce((a, b) => a + b, 0)); c.height = 64;
    let x = 0;
    s.segs.forEach((sg, i) => {
      const [bg, fg] = sg.kind === 'gate' ? ['#f5c400', '#111'] : ['#1f2328', '#fff'];
      g.fillStyle = bg; g.fillRect(x, 0, s.ws[i], 64);
      if (i) { g.fillStyle = '#8a9096'; g.fillRect(x, 0, 2, 64); }
      drawArrow(g, sg.arrow, x + 14 + 23, 32, 21, fg);
      g.font = FONT; g.fillStyle = fg; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(sg.text, x + 14 + 46 + 10, 34);
      x += s.ws[i];
    });
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  };
  guideSigns.paint = paint;
  for (const s of guideSigns) {
    s.ws = s.segs.map((sg) => 14 + 46 + 10 + meas.measureText(sg.text).width + 16);
    let h = 0.42, w = (h * s.ws.reduce((a, b) => a + b, 0)) / 64;
    if (w > 4.2) { h *= 4.2 / w; w = 4.2; } // 長い看板は小さく
    const ceil = LV[s.l].ceil || 2.9, zc = s.z + Math.min(2.45, ceil - 0.2 - h / 2), top = LV[s.l].z + ceil;
    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, h + 0.06, 0.06), backing));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: '#2a2f35' })); // 光る板（絵は近づいてから）
    face.position.z = 0.035; grp.add(face);
    s.face = face; s.zc = zc;
    const rodLen = Math.max(0.05, top - zc - h / 2);
    for (const sx of [-w / 2 + 0.2, w / 2 - 0.2]) { const rod = new THREE.Mesh(new THREE.BoxGeometry(0.03, rodLen, 0.03), frame); rod.position.set(sx, h / 2 + rodLen / 2, 0); grp.add(rod); }
    grp.position.copy(V3(s.x, s.y, zc));
    grp.rotation.y = Math.atan2(-s.ux, s.uy); // 表（+z）を近づいてくる人の側 (-ux, -uy) へ
    scene.add(grp);
  }
}
// 自分から 50 m 以内（高さの差 8 m 以内）の看板に文字の絵を付け、70 m より遠くなったら外す。0.5 秒ごと
let guideAcc = 1;
function guideUpdate(dt) {
  guideAcc += dt;
  if (guideAcc < 0.5) return;
  guideAcc = 0;
  for (const s of guideSigns) {
    const d = Math.hypot(s.x - me.x, s.y - me.y), dz = Math.abs(s.zc - me.z);
    const mat = s.face.material;
    if (!mat.map && d < 50 && dz < 8) { mat.map = guideSigns.paint(s); mat.color.set('#fff'); mat.needsUpdate = true; }
    else if (mat.map && (d > 70 || dz > 12)) { mat.map.dispose(); mat.map = null; mat.color.set('#2a2f35'); mat.needsUpdate = true; }
  }
}

// ---------- 道のりの区切りと目印（steps.js） ----------
// 目印: 画面に札が出ているもの（改札・出口・ほかの会社の改札・設備・トイレ・待ち合わせ場所・エレベーター）。札と同じ言葉で案内する
const LANDMARKS = [];
for (const d of data.dest) {
  const add = (x, y, name, pri) => LANDMARKS.push({ x, y, l: d.level, name, pri });
  if (d.t === 'gate') for (const [x, y] of d.pts) add(x, y, d.name, 0);
  else if (d.t === 'exit') add(...(d.sign || [d.x, d.y]), d.name, 0);
  else if (d.t === 'ogate') add(d.x, d.y, d.name, 1);
  else if (d.t === 'fac') add(d.sign[0], d.sign[1], FAC_LABEL[d.kind], 1);
  else if (d.t === 'toilet') add(...(d.out || [d.x, d.y]), d.name, 2);
  else if (d.t === 'spot' && !d.near) add(d.x, d.y, d.name, 2);
  else if (d.t === 'elev') add(d.x, d.y, 'エレベーター', 3);
}
const stepHelp = {
  // いちばん近い目印（R m 以内、同じ階。近さと目印の強さで選ぶ）
  landmarkAt(x, y, l, R = 7) {
    let best = null, bv = Infinity;
    for (const m of LANDMARKS) { if (m.l !== l) continue; const d = Math.hypot(m.x - x, m.y - y); if (d < R && d + m.pri * 1.5 < bv) { bv = d + m.pri * 1.5; best = m.name; } }
    return best;
  },
  // a → b が改札機の列を横切るか。名前は 20 m 以内のいちばん近い改札
  gateCross(a, b) {
    for (const r of fareRows) {
      if (r.l !== a.l) continue;
      const sa = r.side(a.x, a.y), sb = r.side(b.x, b.y);
      if (sa * sb >= 0) continue;
      const u = sa / (sa - sb), x = a.x + (b.x - a.x) * u, y = a.y + (b.y - a.y) * u, t = (x - r.cx) * r.rx + (y - r.cy) * r.ry;
      if (t < r.t0 - 1 || t > r.t1 + 1) continue;
      return { name: stepHelp.gateNear(x, y, a.l), dir: Math.sign(sb) === r.inSign ? 'in' : 'out', u }; // u: a → b のどこで横切るか
    }
    return null;
  },
  fareAt: (x, y, l) => fareSide(x, y, l),
  gateNear(x, y, l) { // 20 m 以内のいちばん近い改札の名前
    let name = null, bd = 20;
    for (const d of data.dest) if (d.t === 'gate' && d.level === l) for (const [px, py] of d.pts) { const dd = Math.hypot(px - x, py - y); if (dd < bd) { bd = dd; name = d.name; } }
    return name;
  },
  // 階の変わり目の上り下りの手段。道筋は経路網の種類、足あとは近くの坂（無ければエレベーター）
  modeOf(P, i) {
    const a = P[i - 1], b = P[i];
    if (b.mode && MODE[b.mode]) return MODE[b.mode];
    if (b.z == null) return '階段';
    if (Math.hypot(b.x - a.x, b.y - a.y) > 8) return 'エレベーター';
    let best = null, bd = 6;
    for (const r of data.ramps) {
      if (![r.la, r.lb].includes(a.l) && ![r.la, r.lb].includes(b.l)) continue;
      const dx = r.b[0] - r.a[0], dy = r.b[1] - r.a[1], L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, ((a.x - r.a[0]) * dx + (a.y - r.a[1]) * dy) / L)) : 0;
      const d = Math.hypot(a.x - r.a[0] - dx * t, a.y - r.a[1] - dy * t);
      if (d < bd) { bd = d; best = r; }
    }
    return best ? (best.t === 'e' ? 'エスカレーター' : '階段') : 'エレベーター';
  },
  levelName: (l) => LV[l].name,
};

// 床の矢印
const chevGeo = (() => {
  const s = new THREE.Shape();
  s.moveTo(0, 0.32); s.lineTo(0.3, -0.05); s.lineTo(0.16, -0.05); s.lineTo(0, 0.13); s.lineTo(-0.16, -0.05); s.lineTo(-0.3, -0.05); s.closePath();
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(-Math.PI / 2);
  return g;
})();
const chevs = new THREE.InstancedMesh(chevGeo, new THREE.MeshBasicMaterial({ color: '#00a6ff', transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }), 800);
chevs.count = 0;
chevs.renderOrder = 3;
chevs.frustumCulled = false; // 矢印の置き場所は案内のたびに変わるので、範囲で間引かない
scene.add(chevs);

const nav = { dest: null, pts: null, steps: null, at: null, lastCalc: 0, arrived: false, fixed: null }; // fixed: 待ち合わせ案内の道筋（統合データ。探し直さない）
// 行き先の光の柱: 案内の行き先・足あとの終わりの床から天井まで。脈打たせて遠くから分かるように。同じ階で 4 m より遠いときは壁越しにも薄く見せる
const beacon = new THREE.Group();
{
  const geo = new THREE.CylinderGeometry(0.45, 0.45, 2.8, 24, 1, true);
  const mat = (o) => new THREE.MeshBasicMaterial({ color: '#ff5a36', transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, ...o }); // 霧で消えないように
  const col = new THREE.Mesh(geo, mat({ opacity: 0.45 }));
  const xray = new THREE.Mesh(geo, mat({ opacity: 0.3, depthTest: false }));
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.8, 40), mat({ opacity: 0.85 }));
  col.position.y = xray.position.y = 1.4;
  xray.renderOrder = 6;
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03;
  beacon.add(col, xray, ring);
  beacon.userData = { col, xray };
  beacon.visible = false;
  scene.add(beacon);
}
function updateBeacon(now) {
  let p = null;
  if (nav.dest && nav.pts) { const e = nav.pts[nav.pts.length - 1]; p = [e.x, e.y, floorNear(e.x, e.y, LV[e.l].z) ?? LV[e.l].z]; }
  else if (replay.samples) { const e = replay.samples[replay.samples.length - 1]; p = [e.x, e.y, e.z]; }
  else if (herePin) p = [herePin.x, herePin.y, floorNear(herePin.x, herePin.y, LV[herePin.level].z) ?? LV[herePin.level].z]; // 「ここにいます」の相手
  beacon.visible = !!p;
  if (!p) return;
  beacon.position.copy(V3(p[0], p[1], p[2]));
  const d = Math.hypot(p[0] - me.x, p[1] - me.y), k = 1 + 0.15 * Math.sin(now / 280), { col, xray } = beacon.userData;
  const kx = k * Math.max(1, d / 12); // 壁越しの柱は遠いほど太く（画面の上で細くなりすぎない）
  col.scale.set(k, 1, k); xray.scale.set(kx, 1, kx);
  xray.visible = Math.abs(p[2] - me.z) < 1.5 && d > 4;
}
// (x, y) の真下の床のうち、階の高さ z の近く（下 3.5 m・上 1.5 m）で、prev（一つ前の矢印の床）にいちばん近いもの。無ければ null
// （矢印を階の高さに置いていたので、地下街の通路など床が階の高さより低い所で、矢印が宙に浮いて天井の近くに見えた。池袋の地下 1 階）
function floorNear(x, y, z, prev = null) {
  const c = phys.surfacesAt(x, y).filter((s) => s >= z - 3.5 && s <= z + 1.5);
  if (!c.length) return null;
  const by = (r) => c.reduce((b, s) => (Math.abs(s - r) < Math.abs(b - r) ? s : b));
  const p = prev == null ? null : by(prev);
  return p != null && Math.abs(p - prev) < 1.5 ? p : by(z);
}
function drawChevrons() {
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  let k = 0, prev = null;
  const pts = nav.pts || [];
  for (let i = 1; i < pts.length && k < 800; i++) {
    const a = pts[i - 1], b = pts[i];
    if (b.mode === 5) { prev = null; continue; } // エレベーターの中は描かない
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const bearing = Math.atan2(b.x - a.x, b.y - a.y);
    q.setFromAxisAngle(yAxis, -bearing);
    const za = LV[a.l].z, zb = LV[b.l].z;
    if (i === 1 && Math.hypot(a.x - me.x, a.y - me.y) < 2) prev = me.z;
    for (let t = i === 1 ? 1.2 : 0.4; t < len && k < 800; t += 1.6) {
      const f = t / len, x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f, zt = za + (zb - za) * f;
      const g = floorNear(x, y, zt, prev);
      if (g != null) prev = g;
      m4.compose(V3(x, y, (g ?? zt) + (g == null && a.l !== b.l ? 0.3 : 0.06)), q, one);
      chevs.setMatrixAt(k++, m4);
    }
  }
  chevs.count = k;
  chevs.instanceMatrix.needsUpdate = true;
}
// 案内の札の下の端を CSS に渡す（スマホでは駅名・ボタンをその下に出す）
new ResizeObserver(() => { const g = $('guide'); if (!g.hidden) document.body.style.setProperty('--guideB', `${Math.round(g.getBoundingClientRect().bottom)}px`); }).observe($('guide'));
function setDest(d) {
  nav.dest = d; nav.arrived = false; nav.lastCalc = 0; nav.at = null;
  if (!d || !d.meet) nav.fixed = null;
  $('guide').hidden = !d;
  if (!d) { nav.pts = null; drawChevrons(); return; }
  $('gName').textContent = d.name + (d.t === 'toilet' ? `（${LV[d.level].name}）` : d.dir ? ` ${d.dir}` : '') + (d.near ? '（近くの通路まで）' : '');
  recalc();
}
function recalc() {
  const pl = levelOf(me.z);
  nav.pts = nav.fixed ? nav.fixed.pts : findRoute(me.x, me.y, pl, nav.dest);
  nav.steps = nav.pts && nav.pts.length > 1 ? routeSteps(nav.pts, stepHelp, { dest: nav.dest.name }) : null;
  if (!nav.pts) { $('gDist').textContent = 'ここからの道が見つかりません'; $('gHint').textContent = 'データの上で通路がつながっていません'; }
  nav.at = { x: me.x, y: me.y, l: pl };
  nav.lastCalc = performance.now();
  drawChevrons();
}
// 道筋の上で、いまいる所に近い位置と、そこから先の長さ
function progress() {
  const pts = nav.pts, pl = levelOf(me.z);
  let best = { d: Infinity, i: 1, t: 0 };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (a.l !== pl && b.l !== pl) continue;
    const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((me.x - a.x) * dx + (me.y - a.y) * dy) / L)) : 0;
    const d = Math.hypot(me.x - a.x - dx * t, me.y - a.y - dy * t);
    if (d < best.d) best = { d, i, t };
  }
  return best;
}
function updateGuide() {
  if (!nav.dest) return;
  if (!nav.pts) { if (performance.now() - nav.lastCalc > 1500) recalc(); return; } // 道が無いときは、歩いてつながった所へ来たら見つかる
  const now = performance.now();
  const pl = levelOf(me.z);
  const pr = progress();
  if (!nav.fixed && now - nav.lastCalc > 1000 && (pr.d > 5 || nav.at.l !== pl || Math.hypot(me.x - nav.at.x, me.y - nav.at.y) > 25)) { recalc(); return updateGuide(); }
  const pts = nav.pts;
  // 先の長さと、4 m 先の点
  let remain = 0, look = null, acc = 0;
  for (let i = pr.i; i < pts.length; i++) {
    const a = i === pr.i ? { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * pr.t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * pr.t } : pts[i - 1];
    const L = Math.hypot(pts[i].x - a.x, pts[i].y - a.y);
    if (!look && acc + L >= 4) { const f = (4 - acc) / L; look = { x: a.x + (pts[i].x - a.x) * f, y: a.y + (pts[i].y - a.y) * f }; }
    acc += L;
    remain += L;
  }
  const end = pts[pts.length - 1];
  look = look || end;
  const bearing = Math.atan2(look.x - me.x, look.y - me.y);
  $('arrow').style.transform = `rotate(${((bearing - me.yaw) * 180) / Math.PI}deg)`;
  $('gDist').textContent = `あと 約${Math.max(1, Math.round(remain + pr.d))} m`;
  // この先の上り下り
  let hint = '';
  let before = 0;
  for (let i = pr.i; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (a.l !== b.l) {
      hint = `${before < 5 ? 'この' : `約${Math.round(before)} m 先の`}${MODE[b.mode] || '階段'}で ${LV[b.l].name} へ${b.l > a.l ? '上る' : '下りる'}`;
      break;
    }
    before += Math.hypot(b.x - a.x, b.y - a.y) * (i === pr.i ? 1 - pr.t : 1);
  }
  if (!hint && end.l !== pl) hint = `${LV[end.l].name} へ`;
  // 次の区切り（曲がる・改札を通る・上り下り・着く）とそばの目印
  if (nav.steps) {
    const c = nav.steps.cum, sCur = c[pr.i - 1] + (c[pr.i] - c[pr.i - 1]) * pr.t;
    const next = nav.steps.steps.find((st) => st.kind !== 'start' && st.s > sCur - 1); // 区切りの 1 m 先までは「ここで」
    if (next) hint = stepLine(next, next.s - sCur);
  }
  if (nav.fixed && nav.fixed.hintAt) { const h = nav.fixed.hintAt(pr); if (h) hint = h; } // 待ち合わせ案内: 統合データの手順の文で
  $('gHint').textContent = hint;
  if (!nav.arrived && Math.hypot(end.x - me.x, end.y - me.y) < 3 && end.l === pl) {
    nav.arrived = true;
    toast(`到着しました（${nav.dest.name}）` + (nav.dest.est ? '。駅の中のデータが無いので、改札の位置と形は推定です' : ''));
    setTimeout(() => { if (nav.arrived) setDest(null); }, 2500);
  }
}

// 出発地・行き先を選ぶ。出発地を選ぶとそこへ移動し、続けて行き先を選べる
let destMode = 'to', startName = null;
// 出発地に降りる点。トイレは扉の外。改札口は、改札口の点から経路網で 1 つ中に入った、床の上の点（改札口の点は構内の外側に置かれていることがある。渋谷の西口）
const startPoint = (d) => {
  if (d.t === 'toilet' && d.out) return d.out;
  if (d.t === 'gate') for (const i of d.nodes) for (const [j] of adj[i]) { const [x, y, l] = GN[j]; if (l === d.level && phys.groundAt(x, y, LV[l].z) != null) return [x, y]; }
  return [d.x, d.y];
};
function startAt(d, animate = true, quick = false) { // quick: 開いたときのはじめの位置。地下 1 階のマス目（作るのに 0.6 秒ほど）を待たない（はじめの改札は広いコンコースに面したもの）
  const [x, y] = startPoint(d);
  startName = d.name;
  if (animate) { jumpTo(x, y, d.level, true); return; }
  const p = landingAt(x, y, d.level, true, !quick);
  if (p) { [me.x, me.y, me.z] = p; me.eye = me.z + EYE; me.yaw = openYaw(...p); }
}
// いちばん開けている向き: 32 方向で、いちばん遠くまで見通せる向き（地下 1 階はマス目の壁ぎわでないマス、ほかの階は当たり判定で歩いてみる）
function openYaw(x, y, z) {
  let best = [0, -1];
  const B1 = GL != null && levelOf(z) === GL && grid;
  for (let k = 0; k < 32; k++) {
    const a = (k / 32) * Math.PI * 2, sx = Math.sin(a) * 0.25, sy = Math.cos(a) * 0.25;
    let px = x, py = y, pz = z, d = 0;
    for (; d < 80; d++) {
      if (B1) {
        const c = Math.floor((py + sy - grid.y0) / grid.C) * grid.W + Math.floor((px + sx - grid.x0) / grid.C);
        if (!grid.ok[c] || grid.near[c]) break;
        px += sx; py += sy;
      } else {
        const [cx, cy] = phys.collide(px + sx, py + sy, pz), gz = phys.groundAt(cx, cy, pz);
        if (gz == null || Math.hypot(cx - px, cy - py) < 0.12) break;
        px = cx; py = cy; pz = gz;
      }
    }
    if (d > best[1]) best = [a, d];
  }
  return best[0];
}
// 現在地（GPS）: 端末の位置から、地上（1F）のいちばん近い床（60 m 以内）を出発にする。GPS では階が分からないので、地下にいても地上として扱う
// （利用者 2026-10-30「現在地は設定できないんだっけ？」「『出発・行き先』の出発にも、GPS の現在地を足して」。待ち合わせの「現在地」（meet.js）と同じ考え）
const GEO = (() => { const o = data.origin, D = Math.PI / 180, a = 6378137, e2 = 6.69437999014e-3, w = Math.sqrt(1 - e2 * Math.sin(o.lat * D) ** 2); return { kx: D * (a / w) * Math.cos(o.lat * D), ky: D * ((a * (1 - e2)) / w ** 3) }; })();
function gpsStart(done) {
  if (!navigator.geolocation) { toast('この端末では位置が取れません'); return; }
  toast('現在地を調べています…');
  navigator.geolocation.getCurrentPosition((p) => {
    const x = (p.coords.longitude - data.origin.lon) * GEO.kx, y = (p.coords.latitude - data.origin.lat) * GEO.ky, gz = LV['1'].z;
    const gb = data.groundBox || [-450, -450, 450, 450];
    if (x < gb[0] || x > gb[2] || y < gb[1] || y > gb[3]) { toast(`駅から約${Math.round(Math.hypot(x - (gb[0] + gb[2]) / 2, y - (gb[1] + gb[3]) / 2))} m 離れています。駅のまわり ${Math.round((gb[2] - gb[0]) / 2)} m の中で使ってください`); return; }
    const on = (qx, qy) => { const z = phys.groundAt(qx, qy, gz + 0.5); return z != null && Math.abs(z - gz) < 0.3; };
    let best = on(x, y) ? [x, y] : null;
    for (let r = 1; r <= 60 && !best; r++) for (let k = 0; k < 24 && !best; k++) { const a = (k / 24) * Math.PI * 2, qx = x + Math.sin(a) * r, qy = y + Math.cos(a) * r; if (on(qx, qy)) best = [qx, qy]; }
    if (!best) { toast('現在地のそばに歩ける所が見つかりませんでした'); return; }
    $('toast').hidden = true;
    done({ t: 'gps', name: '現在地', x: best[0], y: best[1], level: 1 });
  }, () => toast('位置が取れませんでした（位置情報の許可を確かめてください）'), { enableHighAccuracy: true, timeout: 10000 });
}
// 「出発・行き先」の画面: 上の 2 行（出発・行き先）のうち選んでいる行の一覧を出す。選んだものはこの画面の中だけで覚え、
// 「案内を始める」（行き先が無ければ「ここへ移動」）で出発地へ移動し、行き先の案内を始める
const pend = { from: null, to: null }; // from: null はいまいる所
function renderRows() {
  for (const b of document.querySelectorAll('#routeRows .rrow')) b.classList.toggle('on', b.dataset.m === destMode);
  $('fromVal').textContent = pend.from ? pend.from.name : 'いまいる所';
  $('toVal').textContent = pend.to ? pend.to.name + (pend.to.dir ? ` ${pend.to.dir}` : '') : '選んでください';
  $('toVal').classList.toggle('empty', !pend.to);
  $('goBtn').disabled = !pend.from && !pend.to;
  $('goBtn').textContent = pend.from && !pend.to ? 'ここへ移動' : '案内を始める';
}
function openDest(mode = destMode) {
  destMode = mode;
  renderRows();
  const list = $('destList');
  list.innerHTML = '';
  const pl = levelOf(me.z);
  const q = $('destFilter').value.trim();
  const add = (title, items) => {
    items = items.filter(([d]) => !d.unreach); // マス目でつながらない地下街の場所は出さない
    if (q) items = items.filter(([d]) => d.name.includes(q) || (d.kind || '').includes(q) || (d.dir || '').includes(q) || (d.t === 'fac' && FAC_WORDS[d.kind].includes(q)));
    if (!items.length) return;
    const h = document.createElement('div'); h.className = 'grp'; h.textContent = title; list.append(h);
    for (const [d, html, tag] of items) {
      const b = document.createElement('button');
      b.className = 'item' + (pend[destMode] === d ? ' sel' : ''); b.type = 'button';
      b.innerHTML = html + (tag ? `<span class="tag">${tag}</span>` : '');
      b.onclick = () => {
        // 迷ったら: 見えている看板を選んだら、すぐそこに立つ（'here' は続けて相手のいる場所への案内）
        if (whereMode && destMode === 'from') {
          const mode = whereMode;
          setWhere(null);
          $('destPanel').hidden = true;
          standToSee(d);
          if (mode === 'here' && herePin) { if (jump) jump.after = () => setDest(herePin); else setDest(herePin); }
          else if (jump) jump.msg = `${d.name}のそばに立ちました`;
          return;
        }
        pend[destMode] = d;
        // 出発を選んだら行き先の一覧へ。行き先を選んだらそのまま（出発を変えるときは上の行を押す）
        openDest('to');
        $('destList').scrollTop = 0;
      };
      list.append(b);
    }
  };
  if (mode === 'from' && !q && !whereMode) { // いまいる所（移動しない）
    const b = document.createElement('button');
    b.className = 'item' + (!pend.from ? ' sel' : ''); b.type = 'button';
    b.innerHTML = '<span class="dot" style="background:#1a73e8">今</span>いまいる所<span class="tag">移動しない</span>';
    b.onclick = () => { pend.from = null; openDest('to'); };
    list.append(b);
    if (LV['1']) { // 現在地（GPS）
      const g = document.createElement('button');
      g.className = 'item' + (pend.from && pend.from.t === 'gps' ? ' sel' : ''); g.type = 'button';
      g.innerHTML = '<span class="dot" style="background:#1a73e8">◎</span>現在地<span class="tag">端末の位置・地上</span>';
      g.onclick = () => gpsStart((d) => { pend.from = d; openDest('to'); });
      list.append(g);
    }
  }
  const dist = (d) => Math.hypot(d.x - me.x, d.y - me.y) + Math.abs(d.level - pl) * 30;
  const gates = data.dest.filter((d) => d.t === 'gate');
  add('改札', gates.map((d) => [d, `<span class="dot" style="background:#f5c400;color:#111">改</span>${d.name}`, LV[d.level].name]));
  add('ホーム', data.dest.filter((d) => d.t === 'plat').map((d) => [d, `<span class="dot" style="background:${d.color}">${d.code}</span><span>${d.name} <b>${d.dir || ''}</b>${d.heads?.length ? `<br><small>主な行き先: ${d.heads.join('・')}</small>` : ''}</span>`, '']));
  const toilets = data.dest.filter((d) => d.t === 'toilet').sort((a, b) => dist(a) - dist(b));
  const elevs = data.dest.filter((d) => d.t === 'elev' && d.level === pl).sort((a, b) => dist(a) - dist(b));
  if (elevs.length) add(`エレベーター（${LV[pl].name}・近い順）`, elevs.map((d) => [d, `<span class="dot" style="background:#6b737b">EV</span>${d.name.replace(/^エレベーター（(.*)）$/, '$1')}`, `約${Math.round(dist(d))} m`]));
  add('トイレ（近い順）', toilets.map((d) => [d, `<span class="dot" style="background:${d.kind === 'M' ? '#1f6fd1' : d.kind === 'F' ? '#d0344a' : '#2f8f5b'}">${d.kind === 'M' ? '♂' : d.kind === 'F' ? '♀' : '♿'}</span>${d.name}`, `${LV[d.level].name}・約${Math.round(dist(d))} m`]));
  // 駅の設備（種類ごとに近い順）
  for (const k of Object.keys(FAC_LABEL)) {
    const fs = data.dest.filter((d) => d.t === 'fac' && d.kind === k).sort((a, b) => dist(a) - dist(b));
    add(`${FAC_LABEL[k]}（近い順）`, fs.map((d) => [d, `<span class="dot" style="background:${FAC_ICON[k][1]}">${FAC_ICON[k][0]}</span>${d.name}`, `${LV[d.level].name}・約${Math.round(dist(d))} m`]));
  }
  // 地下街（Machiawase の OpenStreetMap の場所）
  const near = (d) => (d.near ? '<br><small>近くの通路まで</small>' : '');
  add('ほかの会社の改札', data.dest.filter((d) => d.t === 'ogate').map((d) => [d, `<span class="dot" style="background:#7a5ea8">改</span><span>${d.name}${near(d)}</span>`, `約${Math.round(dist(d))} m`]));
  const num = (d) => parseInt(d.name.replace(/\D/g, ''), 10) || 0;
  add('地下街の出口', data.dest.filter((d) => d.t === 'exit').sort((a, b) => num(a) - num(b)).map((d) => [d, `<span class="dot" style="background:#f5c400;color:#111">出</span><span>${d.name}${near(d)}</span>`, `約${Math.round(dist(d))} m`]));
  add('地下街・お店（近い順）', data.dest.filter((d) => d.t === 'spot').sort((a, b) => dist(a) - dist(b)).map((d) => [d, `<span class="dot" style="background:#c46a2b">${d.kind === 'カフェ・飲食' ? '食' : d.kind === '店' ? '店' : '街'}</span><span>${d.name}<br><small>${d.kind}${d.near ? '・近くの通路まで' : ''}</small></span>`, `約${Math.round(dist(d))} m`]));
  if (!list.children.length) list.innerHTML = '<p class="note">見つかりませんでした</p>';
  $('destPanel').hidden = false;
}
$('destBtn').onclick = () => {
  $('destFilter').value = '';
  setWhere(null);
  pend.from = null; pend.to = nav.dest; // 出発はいまいる所、行き先はいまの案内
  openDest('to');
};
// ---------- 迷ったら: いまどこ？（見えている看板から現在地）・ここにいます（今いる所をリンクで送る） ----------
// whereMode: 'where' は見えている看板を選ぶとすぐそこに立つ、'here' は選んだ所から相手のいる場所（herePin）へ案内する
let whereMode = null, herePin = null;
function setWhere(mode, hint = '') {
  whereMode = mode;
  $('destHint').hidden = !mode;
  $('destHint').textContent = hint;
  $('destPanel').classList.toggle('where', !!mode); // 出発・行き先の 2 行と「案内を始める」を隠す
  $('destTitle').textContent = mode === 'where' ? 'いまどこ？' : mode === 'here' ? 'あなたはどこ？' : '出発・行き先';
}
function openWhere(mode, hint) {
  $('destFilter').value = '';
  pend.from = null; pend.to = mode === 'here' ? herePin : nav.dest;
  setWhere(mode, hint);
  openDest('from');
}
$('lostBtn').onclick = () => { $('lostPanel').hidden = false; };
$('lostClose').onclick = () => { $('lostPanel').hidden = true; };
$('lostPanel').onclick = (e) => { if (e.target === $('lostPanel')) $('lostPanel').hidden = true; };
$('lostWhere').onclick = () => { $('lostPanel').hidden = true; openWhere('where', '近くに見える看板（出口の番号・改札・番線・トイレ・コインロッカーなど）を選ぶと、その場所に立ちます'); };
// 看板が見える所に立つ: 看板から 5 m（無ければ 3・7 m）離れた歩ける所のうち、あいだに壁が無く、出発地に降りる点に近い所で、看板の方を向く
// （看板の真下に立つと、看板が画面いっぱいになった）
// p から看板の下（1 m 手前まで）へ、壁に当たらずに歩いて近づけるか（JR の壁も地下街の壁も当たり判定で見る）
function walkTo(p, S) {
  let [x, y, z] = p;
  for (let k = 0; k < 60 && Math.hypot(S[0] - x, S[1] - y) > 1; k++) {
    const L = Math.hypot(S[0] - x, S[1] - y), [cx, cy] = phys.collide(x + ((S[0] - x) / L) * 0.25, y + ((S[1] - y) / L) * 0.25, z);
    if (Math.hypot(cx - x, cy - y) < 0.15) return false;
    x = cx; y = cy; z = phys.groundAt(x, y, z) ?? z;
  }
  return true;
}
function standToSee(d) {
  const S = d.t === 'gate' ? d.pts[0] : d.t === 'exit' ? d.sign || [d.x, d.y] : d.t === 'fac' ? d.sign : d.t === 'toilet' && d.door ? d.door : [d.x, d.y];
  const p0 = startPoint(d);
  let best = null;
  for (const r of [5, 3, 7]) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, cx = S[0] + Math.sin(a) * r, cy = S[1] + Math.cos(a) * r;
      const p = landingAt(cx, cy, d.level);
      if (!p || Math.hypot(p[0] - cx, p[1] - cy) > 1 || levelOf(p[2]) !== d.level) continue;
      if (!walkTo(p, S)) continue;
      const score = Math.hypot(p[0] - p0[0], p[1] - p0[1]);
      if (!best || score < best.score) best = { p, score };
    }
    if (best) break;
  }
  if (!best) { startAt(d); return; }
  startName = d.name;
  jumpTo(best.p[0], best.p[1], d.level);
  if (jump) jump.yaw = Math.atan2(S[0] - best.p[0], S[1] - best.p[1]);
}
// いま見ている所の言葉（近くの目印・階・改札の内外）
const hereWords = (x, y, l) => { const lm = stepHelp.landmarkAt(x, y, l, 15); return `${lm ? `${lm}のそば・` : ''}${LV[l].name}・${fareSide(x, y, l) === 'in' ? '改札内' : '改札外'}`; };
$('lostHere').onclick = async () => {
  $('lostPanel').hidden = true;
  const l = levelOf(me.z), deg = Math.round(((me.yaw * 180) / Math.PI + 360) % 360);
  const url = `${location.origin}${location.pathname}?st=${ST.key}#here=${me.x.toFixed(1)},${me.y.toFixed(1)},${l},${deg}`;
  const text = `${data.station}駅で、ここにいます（${hereWords(me.x, me.y, l)}）。開くと場所と、そこまでの道が分かります。`;
  if (navigator.share) { try { await navigator.share({ title: 'エキさんぽ: ここにいます', text, url }); return; } catch { /* 取り消し */ } }
  copy(url);
};
// 「ここにいます」のリンクを開いたとき: 相手のいる場所に光の柱を立て、景色を見るか、そこまでの案内を選ぶ
function openHere() {
  const m = location.hash.match(/^#here=(-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?\d+)$/);
  if (!m) return false;
  const [x, y, l, deg] = m.slice(1).map(Number);
  if (!LV[l]) return false;
  herePin = makePin(x, y, l, '相手のいる場所');
  herePin.yaw = (deg * Math.PI) / 180;
  $('hereInfo').textContent = hereWords(x, y, l);
  $('herePanel').hidden = false;
  return true;
}
$('hereLook').onclick = () => {
  $('herePanel').hidden = true;
  jumpTo(herePin.x, herePin.y, herePin.level);
  if (jump) { jump.yaw = herePin.yaw; jump.msg = '相手のいる場所です（相手が見ている向き）'; }
};
$('hereRoute').onclick = () => { $('herePanel').hidden = true; openWhere('here', 'あなたがいる所の近くに見える看板を選ぶと、相手のいる場所までの道を案内します'); };
$('hereClose').onclick = () => { $('herePanel').hidden = true; };
$('destFilter').addEventListener('input', () => openDest(destMode));
for (const b of document.querySelectorAll('#routeRows .rrow')) b.onclick = () => { $('destFilter').value = ''; openDest(b.dataset.m); };
$('goBtn').onclick = () => {
  $('destPanel').hidden = true;
  const { from, to } = pend;
  if (from) {
    startAt(from);
    if (jump && to) jump.after = () => setDest(to); // 出発地に着いてから道筋を探す
    else if (to) setDest(to);
  } else if (to) setDest(to);
};
// 案内を共有: 出発地（選んでいれば）と行き先を URL に
$('gShare').onclick = async () => {
  if (!nav.dest) return;
  const q = new URLSearchParams({ st: ST.key });
  if (startName && startName !== '現在地') q.set('from', startName); // 現在地（GPS）は送った先では意味が無い
  q.set('to', nav.dest.name);
  const url = `${location.origin}${location.pathname}?${q}`;
  if (navigator.share) { try { await navigator.share({ title: 'エキさんぽの案内', text: `${startName ? startName + ' から ' : ''}${nav.dest.name} への案内`, url }); return; } catch { /* 取り消し */ } }
  copy(url);
};
$('destClose').onclick = () => { $('destPanel').hidden = true; setWhere(null); };
$('destPanel').onclick = (e) => { if (e.target === $('destPanel')) { $('destPanel').hidden = true; setWhere(null); } };
$('gClose').onclick = () => setDest(null);

let toastTimer = 0;
function toast(msg) {
  $('toast').textContent = msg; $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 2200);
}

// ---------- エレベーター ----------
let elevHere = null;
function updateElev() {
  const pl = levelOf(me.z);
  const e = data.elevs.find((v) => v.l === pl && Math.hypot(v.x - me.x, v.y - me.y) < 1.4 && v.pair.length);
  if (e === elevHere) return;
  elevHere = e;
  const box = $('elev');
  box.hidden = !e;
  if (!e) return;
  box.innerHTML = '<span>エレベーター</span>';
  for (const l of [...e.pair, e.l].sort((a, b) => b - a)) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = LV[l].name;
    b.disabled = l === e.l;
    if (l === e.l) b.style.opacity = 0.4;
    b.onclick = () => {
      const t = data.elevs.find((v) => v.l === l && Math.hypot(v.x - e.x, v.y - e.y) < 3);
      if (!t) return;
      // 扉が閉まって（画面を少し暗く）、2.5 秒かけて上り下りする
      elevHere = null; box.hidden = true;
      toast(l > e.l ? '上へまいります' : '下へまいります');
      document.body.classList.add('riding');
      jump = { from: [me.x, me.y, me.z], to: [t.x, t.y, LV[l].z], t: 0, dur: 2.5, msg: `${LV[l].name} に着きました`, yaw0: me.yaw };
    };
    box.append(b);
  }
}

// ---------- 小さな地図 ----------
// floor: 地図に出している階（null なら自分のいる階）
const mini = { cx: me.x, cy: me.y, s: 1.6, rot: 0, follow: true, head: false, floor: null }; // head: 進む向きを上に（現在地のボタンをもう一度押す）
const mcv = $('miniCv'), mg = mcv.getContext('2d');
const paths = {}; // 階ごとの Path2D
// 図形は 200 個ずつ別の Path2D に分ける（1 つの Path2D に図形をたくさん足すと、数の 2 乗ほど遅くなる。地上の床 88,000 個で読み込みに 12 秒かかった。2026-10-30）
const chunks = () => { const a = []; let n = 0; a.p = () => { if (n++ % 200 === 0) a.push(new Path2D()); return a[a.length - 1]; }; return a; };
for (const l of Object.keys(LV)) {
  const floor = chunks(), block = chunks(), wall = chunks(), mall = chunks();
  const ring = (A, r) => { const P = A.p(); P.moveTo(r[0], r[1]); for (let i = 2; i < r.length; i += 2) P.lineTo(r[i], r[i + 1]); P.closePath(); };
  const tri = (A, f, i) => { const P = A.p(); P.moveTo(f[i], f[i + 1]); P.lineTo(f[i + 3], f[i + 4]); P.lineTo(f[i + 6], f[i + 7]); P.closePath(); };
  for (const f of data.floors) if (String(f.l) === l) f.r.forEach((r) => ring(floor, r));
  for (const f of data.blocks) if (String(f.l) === l) f.r.forEach((r) => ring(block, r));
  for (const w of data.walls) if (String(w[4]) === l) { const P = wall.p(); P.moveTo(w[0], w[1]); P.lineTo(w[2], w[3]); }
  if (GL != null && Number(l) === GL) {
    const L = data.mall.layout.floor, f = new Float32Array(mallBuf, L[0], L[1]);
    for (let i = 0; i < f.length; i += 9) if (Math.abs(f[i + 2] - LV[l].z) < 2.5) tri(mall, f, i);
  }
  // 地上（1F）の街並み: 歩道・道路（地下街のファイルの gfloor。道路は歩道より低い）と建物の輪郭（gbld）
  const gside = chunks(), groad = chunks(), gbld = chunks();
  if (l === '1' && data.mall && data.mall.layout.gfloor) {
    const L = data.mall.layout.gfloor, f = new Float32Array(mallBuf, L[0], L[1]), gz = LV[l].z;
    for (let i = 0; i < f.length; i += 9) tri(Math.max(f[i + 2], f[i + 5], f[i + 8]) < gz - 0.06 ? groad : gside, f, i);
    for (const r of data.gbld || []) ring(gbld, r);
  }
  paths[l] = { floor, block, wall, mall, gside, groad, gbld };
}
const ramps2d = data.ramps;
let photoBtnSync = null; // 写真の街並みのボタンを、見ている階に合わせて出し入れする
let photoCity = null; // 写真の街並み（photo.js）。1F の小さな地図に航空写真を敷く
function miniSize() { // 大きさは変形（地図 ⇄ 立体の切り替えで縮む・広がるアニメーション）を含まない clientWidth で（含めると、切り替えの途中に測って地図が描けなくなった）
  mcv.width = Math.round(mcv.clientWidth * devicePixelRatio);
  mcv.height = Math.round(mcv.clientHeight * devicePixelRatio);
}
const W2S = (x, y) => {
  const W = mcv.clientWidth, H = mcv.clientHeight, c = Math.cos(mini.rot), s = Math.sin(mini.rot);
  const dx = x - mini.cx, dy = y - mini.cy;
  return [W / 2 + mini.s * (c * dx - s * dy), H / 2 - mini.s * (s * dx + c * dy)];
};
const S2W = (sx, sy) => {
  const W = mcv.clientWidth, H = mcv.clientHeight, c = Math.cos(mini.rot), s = Math.sin(mini.rot);
  const u = (sx - W / 2) / mini.s, v = -(sy - H / 2) / mini.s;
  return [mini.cx + c * u + s * v, mini.cy - s * u + c * v];
};
const fillAll = (A) => { for (const p of A) mg.fill(p); }, strokeAll = (A) => { for (const p of A) mg.stroke(p); };
function drawMini() {
  { // 地図で見ていて待ち合わせ案内のパネルが開いているときは、地図をパネルの横（スマホは上）に
    const open = mapMode && !$('meetPanel').hidden, side = open && innerWidth > 760, bottom = open && !side;
    if (side !== document.body.classList.contains('meetSide') || bottom !== document.body.classList.contains('meetBottom')) { document.body.classList.toggle('meetSide', side); document.body.classList.toggle('meetBottom', bottom); miniSize(); }
  }
  { // 地図で見ているとき、右上の階のボタンが案内のカードと重なるなら、カードの下へよける（スマホは案内のカードが横いっぱい。利用者 2026-10-31「右上のフロアボタンと案内がかぶってる」）
    const fp = $('floorPick'), g = $('guide');
    let top = '';
    if (mapMode && !g.hidden && getComputedStyle(g).display !== 'none') {
      const gr = g.getBoundingClientRect(), fr = fp.getBoundingClientRect(), mr = $('mini').getBoundingClientRect();
      if (gr.right > fr.left - 4 && gr.left < fr.right + 4) top = `${Math.round(gr.bottom - mr.top + 8)}px`;
    }
    if (fp.style.top !== top) fp.style.top = top;
  }
  if (mini.follow) { mini.cx = me.x; mini.cy = me.y; }
  if (mini.follow && mini.head) mini.rot = me.yaw;
  const W = mcv.clientWidth, H = mcv.clientHeight, dpr = devicePixelRatio;
  const c = Math.cos(mini.rot), s = Math.sin(mini.rot), k = mini.s;
  mg.setTransform(dpr, 0, 0, dpr, 0, 0);
  mg.fillStyle = '#e9e6df';
  mg.fillRect(0, 0, W, H);
  const cur = String(levelOf(me.z));
  const pl = mini.floor ?? cur;
  const P = paths[pl];
  mg.setTransform(dpr * k * c, -dpr * k * s, -dpr * k * s, -dpr * k * c, dpr * (W / 2 - k * (c * mini.cx - s * mini.cy)), dpr * (H / 2 + k * (s * mini.cx + c * mini.cy)));
  const gphoto = pl === '1' && photoCity && photoCity.ground; // 写真の街並みのときは航空写真
  if (mapMode) drawBase(W, H, pl);
  if (gphoto) { const e = gphoto.ext; mg.save(); mg.translate(e.w, e.n); mg.scale(1, -1); mg.drawImage(gphoto.canvas, 0, 0, e.e - e.w, e.n - e.s); mg.restore(); }
  else {
    if (mapMode) mg.globalAlpha = 0.75; // 下地の淡色地図（通りの名前）が透けるように
    mg.fillStyle = '#f4f2ed'; fillAll(P.gside);
    mg.fillStyle = '#c3c6cb'; fillAll(P.groad);
    mg.fillStyle = '#dcd5c8'; fillAll(P.gbld);
    mg.strokeStyle = '#c2b9aa'; mg.lineWidth = 0.8 / k; strokeAll(P.gbld);
    mg.globalAlpha = 1;
  }
  mg.fillStyle = '#fbfaf6'; fillAll(P.mall);
  mg.fillStyle = '#ffffff'; fillAll(P.floor);
  mg.fillStyle = '#d5cfc4'; fillAll(P.block);
  mg.strokeStyle = '#8a8378'; mg.lineWidth = 1.2 / k; strokeAll(P.wall);
  mg.fillStyle = 'rgba(224,152,40,0.55)';
  for (const r of ramps2d) if (String(r.la) === pl || String(r.lb) === pl) {
    const len = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]), nx = (-(r.b[1] - r.a[1]) / len) * r.w / 2, ny = ((r.b[0] - r.a[0]) / len) * r.w / 2;
    mg.beginPath(); mg.moveTo(r.a[0] + nx, r.a[1] + ny); mg.lineTo(r.b[0] + nx, r.b[1] + ny); mg.lineTo(r.b[0] - nx, r.b[1] - ny); mg.lineTo(r.a[0] - nx, r.a[1] - ny); mg.fill();
  }
  // 待ち合わせ案内の道（地図で見ているとき。立体に床の無い地上の区間も、灰色の点線で）
  if (mapMode && meetShared.route) {
    const R = meetShared.route; mg.lineWidth = 5 / k; mg.lineJoin = 'round'; mg.lineCap = 'round';
    for (let i = 1; i < R.length; i++) {
      const a = R[i - 1], b = R[i]; if (String(a.l) !== pl && String(b.l) !== pl) continue;
      const g = a.ground || b.ground; mg.strokeStyle = g ? 'rgba(110,110,110,0.9)' : 'rgba(240,140,0,0.85)'; mg.setLineDash(g ? [6 / k, 5 / k] : []);
      mg.beginPath(); mg.moveTo(a.x, a.y); mg.lineTo(b.x, b.y); mg.stroke();
    }
    mg.setLineDash([]);
  }
  // 道筋
  if (nav.pts) {
    mg.strokeStyle = '#0a84ff'; mg.lineWidth = 3.5 / k; mg.lineJoin = 'round'; mg.lineCap = 'round';
    mg.beginPath();
    for (let i = 1; i < nav.pts.length; i++) {
      const a = nav.pts[i - 1], b = nav.pts[i];
      if (String(a.l) !== pl && String(b.l) !== pl) continue;
      mg.moveTo(a.x, a.y); mg.lineTo(b.x, b.y);
    }
    mg.stroke();
  }
  // 再生中の足あと
  if (replay.samples) {
    mg.strokeStyle = '#f08c00'; mg.lineWidth = 3 / k; mg.lineJoin = 'round'; mg.lineCap = 'round';
    mg.beginPath();
    const S = replay.samples, z0 = LV[pl].z;
    for (let i = 1; i < S.length; i++) {
      if (Math.abs(S[i].z - z0) > 2.9 || Math.abs(S[i - 1].z - z0) > 2.9 || Math.hypot(S[i].x - S[i - 1].x, S[i].y - S[i - 1].y) > 8) continue;
      mg.moveTo(S[i - 1].x, S[i - 1].y); mg.lineTo(S[i].x, S[i].y);
    }
    mg.stroke();
  }
  mg.setTransform(dpr, 0, 0, dpr, 0, 0);
  // 改札・トイレの名前
  miniHits.length = 0;
  mg.font = 'bold 10px system-ui, sans-serif'; mg.textAlign = 'center'; mg.textBaseline = 'middle';
  for (const d of data.dest) {
    if (String(d.level) !== pl || d.t === 'plat' || d.t === 'elev' || d.t === 'spot') continue;
    const [x, y] = W2S(...(d.foot || [d.x, d.y])); // 地上へ出る出口は階段の足元に
    if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
    const t = d.t === 'gate' || d.t === 'exit' || d.t === 'ogate' ? d.name : d.t === 'fac' ? FAC_ICON[d.kind][0] : d.kind === 'M' ? '♂' : d.kind === 'F' ? '♀' : '♿';
    mg.fillStyle = d.t === 'gate' || d.t === 'exit' ? '#f5c400' : d.t === 'ogate' ? '#e4d8f3' : d.t === 'fac' ? FAC_ICON[d.kind][1] : '#1c3f74';
    const w = mg.measureText(t).width + 6;
    mg.fillRect(x - w / 2, y - 7, w, 14);
    miniHits.push([x - w / 2 - 4, y - 11, x + w / 2 + 4, y + 11, d]); // 指で押しやすく少し広く
    mg.fillStyle = d.t === 'toilet' || d.t === 'fac' ? '#fff' : '#111';
    mg.fillText(t, x, y);
  }
  if (pl === '1') for (const [gx, gy, t] of gExitLabels) { // 地上の出口の番号（地下へ下りる階段の口）
    const [x, y] = W2S(gx, gy);
    if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
    const w = mg.measureText(t).width + 6;
    mg.fillStyle = '#f5c400'; mg.fillRect(x - w / 2, y - 7, w, 14);
    mg.fillStyle = '#111'; mg.fillText(t, x, y);
  }
  const goal = nav.dest ? [...(nav.dest.foot || [nav.dest.x, nav.dest.y]), true] : replay.samples ? (() => { const e = replay.samples[replay.samples.length - 1]; return [e.x, e.y, String(levelOf(e.z)) === pl]; })() : herePin ? [herePin.x, herePin.y, String(herePin.level) === pl] : null; // 足あとの終わり・「ここにいます」の相手も、その階を出しているとき
  if (goal && goal[2]) {
    const [x, y] = W2S(goal[0], goal[1]);
    mg.fillStyle = '#e8453c'; mg.beginPath(); mg.arc(x, y - 9, 6, 0, Math.PI * 2); mg.moveTo(x - 5, y - 6); mg.lineTo(x, y); mg.lineTo(x + 5, y - 6); mg.fill();
  }
  // あいて（待ち合わせの部屋でつながっているとき。向きつき、だいだい）
  if (meetShared.p && String(meetShared.p.l) === pl) {
    const [x, y] = W2S(meetShared.p.x, meetShared.p.y);
    mg.save(); mg.translate(x, y); mg.rotate(((meetShared.p.yaw || 0) * Math.PI) / 180 - mini.rot);
    mg.fillStyle = '#f08c00'; mg.strokeStyle = '#fff'; mg.lineWidth = 2;
    mg.beginPath(); mg.moveTo(0, -9); mg.lineTo(6, 6); mg.lineTo(0, 3); mg.lineTo(-6, 6); mg.closePath(); mg.fill(); mg.stroke();
    mg.restore();
    mg.fillStyle = '#f08c00'; mg.font = 'bold 11px system-ui, sans-serif'; mg.textAlign = 'center'; mg.fillText('あいて', x, y - 14);
  }
  // 移動先
  if (jump) {
    const [x, y] = W2S(jump.to[0], jump.to[1]);
    mg.strokeStyle = '#1a73e8'; mg.lineWidth = 2.5;
    mg.beginPath(); mg.arc(x, y, 8, 0, Math.PI * 2); mg.stroke();
  }
  // 自分（向きつき）。ほかの階を出しているときは薄く
  const [px, py] = W2S(me.x, me.y);
  const a = me.yaw - mini.rot;
  mg.save(); mg.translate(px, py); mg.rotate(a);
  if (pl !== cur) mg.globalAlpha = 0.35;
  mg.fillStyle = 'rgba(26,115,232,0.18)'; mg.beginPath(); mg.moveTo(0, 0); mg.arc(0, 0, 26, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); mg.fill();
  mg.fillStyle = '#1a73e8'; mg.strokeStyle = '#fff'; mg.lineWidth = 2;
  mg.beginPath(); mg.moveTo(0, -9); mg.lineTo(6, 6); mg.lineTo(0, 3); mg.lineTo(-6, 6); mg.closePath(); mg.fill(); mg.stroke();
  mg.restore();
  for (const b of floorBtns) { b.classList.toggle('on', b.dataset.l === pl); b.classList.toggle('me', b.dataset.l === cur); }
  $('needle').setAttribute('transform', `rotate(${(-mini.rot * 180) / Math.PI} 12 12)`);
  $('mLocate').classList.toggle('on', mini.follow);
  $('mLocate').classList.toggle('head', mini.follow && mini.head);
}
// 地図の操作（Google マップと同じ: 左ドラッグ・指 1 本で移動、右ドラッグで回転、ホイールで拡大・縮小、2 本指でひねる・広げる・動かす）
const mp = new Map();
const zoomAt = (sx, sy, f) => {
  const [wx, wy] = S2W(sx, sy);
  mini.s = Math.max(0.3, Math.min(14, mini.s * f));
  const [nx, ny] = W2S(wx, wy);
  const [ax, ay] = S2W(nx, ny), [bx, by] = S2W(sx, sy);
  mini.cx += ax - bx; mini.cy += ay - by;
};
const rotateAt = (sx, sy, da) => {
  const [wx, wy] = S2W(sx, sy);
  mini.rot += da;
  const [nx, ny] = W2S(wx, wy);
  const [ax, ay] = S2W(nx, ny), [bx, by] = S2W(sx, sy);
  mini.cx += ax - bx; mini.cy += ay - by;
};
const panBy = (dx, dy) => {
  const [ax, ay] = S2W(0, 0), [bx, by] = S2W(dx, dy);
  mini.cx -= bx - ax; mini.cy -= by - ay;
};
const local = (e) => { const r = mcv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
// 指 1 本・左クリックで、ほとんど動かさずに離したら「タップ」: 改札・出口・トイレなどの印なら「行き先にする・ここへ移動」の札、
// タップ（印の上でも印の無い所でも）は、いつも「行き先にする・ここへ移動」の札を出す（利用者「ミニマップはタップした際、必ず行き先にする、
// ここへ移動を表示してほしい」。前は印の無い所のタップですぐ移動し、札は長押しのときだけだった）
let tap = null;
const miniHits = []; // 地図に描いた印の範囲 [x0, y0, x1, y1, 行き先]
mcv.addEventListener('pointerdown', (e) => {
  try { mcv.setPointerCapture(e.pointerId); } catch { /* 作った操作（確かめ用）では捕まえられない */ }
  const [x, y] = local(e);
  mp.set(e.pointerId, { x, y, btn: e.button });
  tap = mp.size === 1 && e.button === 0 ? { id: e.pointerId, x, y, t: performance.now(), moved: false } : null;
});
mcv.addEventListener('pointermove', (e) => {
  const p = mp.get(e.pointerId);
  if (!p) return;
  const [x, y] = local(e);
  if (tap && tap.id === e.pointerId && !tap.moved) {
    if (Math.hypot(x - tap.x, y - tap.y) < 6) return; // まだタップかもしれない
    tap.moved = true;
    p.x = tap.x; p.y = tap.y;
  }
  if (mp.size === 1) {
    mini.follow = false; mini.head = false;
    if (p.btn === 2) rotateAt(mcv.clientWidth / 2, mcv.clientHeight / 2, (x - p.x) * 0.01);
    else panBy(x - p.x, y - p.y);
  } else if (mp.size === 2) {
    const [q] = [...mp.entries()].filter(([id]) => id !== e.pointerId).map(([, v]) => v);
    const ox = (p.x + q.x) / 2, oy = (p.y + q.y) / 2, nx = (x + q.x) / 2, ny = (y + q.y) / 2;
    const d0 = Math.hypot(p.x - q.x, p.y - q.y), d1 = Math.hypot(x - q.x, y - q.y);
    const a0 = Math.atan2(p.y - q.y, p.x - q.x), a1 = Math.atan2(y - q.y, x - q.x);
    mini.follow = false; mini.head = false;
    panBy(nx - ox, ny - oy);
    if (d0 > 10) zoomAt(nx, ny, d1 / d0);
    rotateAt(nx, ny, -(a1 - a0));
  }
  p.x = x; p.y = y;
});
const mEnd = (e) => {
  mp.delete(e.pointerId);
  if (tap && tap.id === e.pointerId) {
    if (e.type === 'pointerup' && !tap.moved) {
      const hit = miniHits.find(([x0, y0, x1, y1]) => tap.x >= x0 && tap.x <= x1 && tap.y >= y0 && tap.y <= y1);
      openMiniPop(tap.x, tap.y, hit ? hit[4] : null);
    }
    tap = null;
  }
};
// 地図の上の場所を行き先にする（地下 1 階はマス目で、ほかの階は近い 3 つの経路網の点からその場所まで）
function makePin(x, y, l, name) {
  const d = { t: 'pin', name, x, y, level: l };
  if (l !== GL) d.nodes = GN.map((g, i) => [i, g]).filter(([, g]) => g[2] === l).sort((a, b) => Math.hypot(a[1][0] - x, a[1][1] - y) - Math.hypot(b[1][0] - x, b[1][1] - y)).slice(0, 3).map(([i]) => i);
  return d;
}
// 地図の上の小さな札: 行き先にする・ここへ移動。d が無いときは地図で選んだ場所（歩ける所に寄せる）
let miniPopAt = null;
function openMiniPop(sx, sy, d) {
  const l = Number(mini.floor ?? levelOf(me.z));
  let target = d;
  if (!target) {
    const to = landingAt(...S2W(sx, sy), l);
    if (!to) { closeMiniPop(); toast('そこへは行けません'); return; }
    target = makePin(to[0], to[1], l, '地図で選んだ場所');
  }
  miniPopAt = target;
  $('mpName').textContent = target.name + (target.t === 'plat' && target.dir ? ` ${target.dir}` : '');
  const pop = $('miniPop'), r = mcv.getBoundingClientRect();
  pop.hidden = false;
  const w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left + sx - w / 2))}px`;
  pop.style.top = `${Math.max(8, r.top + sy - h - 14)}px`;
}
function closeMiniPop() { $('miniPop').hidden = true; miniPopAt = null; }
$('mpClose').onclick = closeMiniPop;
// 行き先にしたら、地図は自分のいる階・現在地に戻す（ほかの階に切り替えて行き先を選ぶと、地図がその階のままで、いる階の道が見えなかった）
$('mpDest').onclick = () => { const d = miniPopAt; closeMiniPop(); if (!d) return; startName = null; setDest(d); mini.floor = null; mini.follow = true; toast(`${d.name}への案内を始めます`); };
$('mpGo').onclick = () => { const d = miniPopAt; closeMiniPop(); if (d) jumpTo(d.x, d.y, d.level); };
mcv.addEventListener('pointerup', mEnd);
mcv.addEventListener('pointercancel', mEnd);
mcv.addEventListener('contextmenu', (e) => e.preventDefault());
mcv.addEventListener('wheel', (e) => { e.preventDefault(); const [x, y] = local(e); zoomAt(x, y, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
$('mCompass').onclick = () => { mini.rot = 0; mini.head = false; };
// 現在地: 1 回目で自分を真ん中に、自分を追っているときにもう一度押すと進む向きを上に（Google マップと同じ）。もう一度で北を上に戻す
$('mLocate').onclick = () => {
  if (mini.follow && mini.floor == null) { mini.head = !mini.head; if (!mini.head) mini.rot = 0; }
  mini.follow = true; mini.floor = null;
};
// 地図で見る ⇄ 立体で見る（待ち合わせ案内の図と歩く立体を 1 つの画面で行き来する。利用者 2026-10-31「meet と walk を融合したい。シームレスに行き来できるように」
// 「meet は地上以外も表示してほしい」）: 小さな地図を画面いっぱいに広げ、下に国土地理院の淡色地図を敷く。位置・向き・行き先・案内はそのまま。URL の ?view=map で地図から
// 切り替えはアニメーションで（利用者 2026-10-31「地図で見る、立体で見るはアニメーションを使って切り替えてほしい」）: 右下の小さな地図が画面いっぱいに広がり（戻るときは右下へ縮み）、
// あわせて立体のカメラが真上へ上がって見下ろす（戻るときは真上から降りてくる）。動きを減らす設定の端末ではすぐ切り替える
let mapMode = false, viewAnim = null;
const VIEW_MS = 650, VIEW_H = 45; // かかる時間（ms）、カメラが上がる高さ（m）
function setMapMode(on, anim = true) {
  if (on === mapMode) return;
  const el = $('mini');
  if (on && el.classList.contains('big')) $('mBig').onclick();
  const reduce = !anim || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const r0 = el.getBoundingClientRect();
  mapMode = on;
  document.body.classList.toggle('mapMode', on);
  $('viewBtn').textContent = on ? '立体で見る' : '地図で見る';
  view.title = on ? '押すと立体で見る' : '';
  miniSize();
  if (!reduce) {
    // FLIP: 切り替えたあとの位置から、前の位置に見えるよう変形しておき、変形を外して動かす
    const r1 = el.getBoundingClientRect();
    el.style.transition = 'none'; el.style.transformOrigin = '0 0';
    el.style.transform = `translate(${r0.left - r1.left}px, ${r0.top - r1.top}px) scale(${r0.width / r1.width}, ${r0.height / r1.height})`;
    if (!on) el.style.zIndex = '1'; // 縮むあいだは上のボタンより下、立体より上
    void el.offsetWidth;
    el.style.transition = `transform ${VIEW_MS}ms cubic-bezier(.4,0,.2,1), border-radius ${VIEW_MS}ms`;
    el.style.transform = '';
    const done = () => { el.style.transition = ''; el.style.transform = ''; el.style.transformOrigin = ''; el.style.zIndex = ''; el.removeEventListener('transitionend', done); };
    el.addEventListener('transitionend', done); setTimeout(done, VIEW_MS + 100);
    viewAnim = { on, t0: performance.now() };
    document.body.classList.add('viewAnim'); setTimeout(() => document.body.classList.remove('viewAnim'), VIEW_MS + 50); // 広がるあいだは立体も見せる
  }
  const cr = $('credit'); if (cr) { cr.textContent = cr.textContent.replace(/ ／ 地図: 国土地理院（淡色地図）$/, ''); if (on) cr.textContent += ' ／ 地図: 国土地理院（淡色地図）'; }
  try { const u = new URL(location.href); if (on) u.searchParams.set('view', 'map'); else u.searchParams.delete('view'); history.replaceState(null, '', u); } catch (err) { void err; }
}
$('viewBtn').onclick = () => setMapMode(!mapMode);
// 地図のある場所・階へ（待ち合わせ案内の手順を押したとき）
function mapFocus(x, y, l) { mini.follow = false; mini.head = false; mini.cx = x; mini.cy = y; mini.floor = String(l) === String(levelOf(me.z)) ? null : String(l); if (mini.s < 2) mini.s = 2; }
// 下地: 国土地理院の淡色地図のタイルを、地図の向き・縮尺に合わせて局所平面の上に並べる（地下・2F は薄く。地上は立体の歩道・道路・建物を少し透かして重ねる）
const baseTiles = new Map();
function drawBase(W, H, pl) {
  const cs = [S2W(0, 0), S2W(W, 0), S2W(0, H), S2W(W, H)], xs = cs.map((p) => p[0]), ys = cs.map((p) => p[1]), o = data.origin;
  const lon0 = o.lon + Math.min(...xs) / GEO.kx, lon1 = o.lon + Math.max(...xs) / GEO.kx, lat0 = o.lat + Math.min(...ys) / GEO.ky, lat1 = o.lat + Math.max(...ys) / GEO.ky;
  const z = Math.max(12, Math.min(18, Math.round(Math.log2((40075016 * Math.cos((o.lat * Math.PI) / 180) * mini.s) / 256))));
  const n = 2 ** z, tx = (lon) => Math.floor(((lon + 180) / 360) * n), ty = (lat) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n); };
  const lonOf = (x) => (x / n) * 360 - 180, latOf = (y) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const X0 = tx(lon0), X1 = tx(lon1), Y0 = ty(lat1), Y1 = ty(lat0);
  if ((X1 - X0 + 1) * (Y1 - Y0 + 1) > 120) return;
  mg.globalAlpha = pl === '1' ? 1 : 0.4;
  for (let X = X0; X <= X1; X++) for (let Y = Y0; Y <= Y1; Y++) {
    const key = `${z}/${X}/${Y}`; let im = baseTiles.get(key);
    if (!im) { im = new Image(); im.src = `https://cyberjapandata.gsi.go.jp/xyz/pale/${key}.png`; baseTiles.set(key, im); if (baseTiles.size > 600) baseTiles.delete(baseTiles.keys().next().value); }
    if (!im.complete || !im.naturalWidth) continue;
    const xw = (lonOf(X) - o.lon) * GEO.kx, xe = (lonOf(X + 1) - o.lon) * GEO.kx, yn = (latOf(Y) - o.lat) * GEO.ky, yS = (latOf(Y + 1) - o.lat) * GEO.ky;
    mg.save(); mg.translate(xw, yn); mg.scale(1, -1); mg.drawImage(im, 0, 0, xe - xw + 0.05, yn - yS + 0.05); mg.restore();
  }
  mg.globalAlpha = 1;
}

// 地図を大きく・小さく（地図の右上のボタン）
const BIG_ICON = $('mBig').innerHTML, SMALL_ICON = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" fill="none" stroke="#444" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
$('mBig').onclick = () => {
  const big = $('mini').classList.toggle('big');
  document.body.classList.toggle('miniBig', big);
  $('mBig').innerHTML = big ? SMALL_ICON : BIG_ICON;
  $('mBig').setAttribute('aria-label', big ? '地図を小さく' : '地図を大きく');
  miniSize();
};

// 階の切り替え（地図の左に、上の階から）
const floorBtns = Object.keys(LV).sort((p, q) => q - p).map((l) => {
  const b = document.createElement('button');
  b.type = 'button'; b.textContent = LV[l].name; b.dataset.l = l;
  b.setAttribute('aria-label', `${LV[l].name} の地図`);
  b.onclick = () => { mini.floor = l === String(levelOf(me.z)) ? null : l; };
  $('floorPick').append(b);
  return b;
});
let lastLevel = levelOf(me.z);
function watchLevel() { // 歩いて階が変わったら、地図も自分の階に戻す
  const l = levelOf(me.z);
  if (l !== lastLevel) { lastLevel = l; if (mini.follow) mini.floor = null; }
}

// 地図でタップした所へ移動（ストリートビューのように）。歩けない所なら 3 m 以内の歩ける所へ寄せる
let jump = null;
function landingAt(x, y, level, open = false, useGrid = true) {
  const z0 = LV[level].z;
  // 地下 1 階は、マス目のいちばん大きくつながった部分のいちばん近い所へ（囲まれた小さな区画に降りて出られなくならないように）。
  // 出発地（open）は開けたマスへ
  if (level === GL && useGrid && getGrid()) {
    const c = open ? openCell(x, y) : snapCell(x, y, true);
    if (c >= 0) { x = grid.x0 + ((c % grid.W) + 0.5) * grid.C; y = grid.y0 + (((c / grid.W) | 0) + 0.5) * grid.C; }
  }
  let lo = z0 - (level === GL ? 3.0 : 1.5), hi = z0 + (level === GL ? 2.5 : 0.6); // 地下 1 階は地下街の低い所（新宿の西口側 -2.6 m）も
  const pick = (px, py) => {
    const zs = phys.surfacesAt(px, py).filter((z) => z > lo && z < hi);
    if (!zs.length) return null;
    const z = zs.reduce((b, v) => (Math.abs(v - z0) < Math.abs(b - z0) ? v : b));
    const [cx, cy] = phys.collide(px, py, z);
    const gz = phys.groundAt(cx, cy, z);
    return gz == null ? null : [cx, cy, gz];
  };
  // 出発地（open）は 12 m まで探す（渋谷の西口のように、改札口の点が通路の面の外にあることがある）。地図のタップは 3 m まで
  for (let r = 0; r <= (open ? 12 : 3); r += 0.5) for (let k = 0; k < (r ? 12 : 1); k++) {
    const a = (k / 12) * Math.PI * 2, p = pick(x + Math.sin(a) * r, y + Math.cos(a) * r);
    if (p) return p;
  }
  // 出発地で見つからないときは、高さを広げてその場所のいちばん近い床へ（新宿の京王口は、GTFS では地下 1 階だが構内地図の床は地下 2 階）
  if (open) {
    lo = z0 - 7; hi = z0 + 7;
    for (let r = 0; r <= 6; r += 0.5) for (let k = 0; k < (r ? 12 : 1); k++) {
      const a = (k / 12) * Math.PI * 2, p = pick(x + Math.sin(a) * r, y + Math.cos(a) * r);
      if (p) return p;
    }
  }
  return null;
}
function jumpTo(x, y, level, faceOpen = false) {
  const to = landingAt(x, y, level, faceOpen);
  if (!to) { toast('そこへは行けません'); return; }
  pauseReplay('止めました（ここから歩けます）');
  jump = { from: [me.x, me.y, me.z], to, t: 0, dur: Math.min(1.2, 0.35 + Math.hypot(to[0] - me.x, to[1] - me.y) / 120) };
  // 出発地は開けている向き、地図のタップは進む向きを向く（真上をタップしたときはそのまま）
  if (faceOpen) jump.yaw = openYaw(...to);
  else if (Math.hypot(to[0] - me.x, to[1] - me.y) > 1) jump.yaw = Math.atan2(to[0] - me.x, to[1] - me.y);
  jump.yaw0 = me.yaw;
}
function updateJump(dt) {
  if (!jump) return false;
  jump.t += dt / jump.dur;
  const u = Math.min(1, jump.t), e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
  const [fx, fy, fz] = jump.from, [tx, ty, tz] = jump.to;
  me.x = fx + (tx - fx) * e; me.y = fy + (ty - fy) * e; me.z = fz + (tz - fz) * e;
  if (jump.yaw != null) { const d = Math.atan2(Math.sin(jump.yaw - jump.yaw0), Math.cos(jump.yaw - jump.yaw0)); me.yaw = jump.yaw0 + d * Math.min(1, u * 2); }
  if (u >= 1) {
    const msg = jump.msg || (levelOf(me.z) !== levelOf(fz) ? `${LV[levelOf(me.z)].name} に移動しました` : ''), after = jump.after;
    jump = null;
    mini.floor = null;
    mini.follow = true;
    document.body.classList.remove('riding');
    if (msg) toast(msg);
    if (after) after();
  }
  return true;
}
$('mIn').onclick = () => zoomAt(mcv.clientWidth / 2, mcv.clientHeight / 2, 1.4);
$('mOut').onclick = () => zoomAt(mcv.clientWidth / 2, mcv.clientHeight / 2, 1 / 1.4);

// ---------- 録画と再生 ----------
const rec = { on: false, samples: [], last: 0, t0: 0, video: null };
const trail = new THREE.InstancedMesh(chevGeo, new THREE.MeshBasicMaterial({ color: '#f08c00', transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }), 1500);
trail.count = 0;
trail.renderOrder = 3;
trail.frustumCulled = false;
scene.add(trail);
const replay = { samples: null, t: 0, playing: false, steps: null, dest: null, stepMode: false, next: 1 }; // steps: 道のりの区切り、next: ひとつずつ見るときに次に止まる区切り

function sampleNow() { return { x: me.x, y: me.y, z: me.z, yaw: me.yaw, pitch: me.pitch }; }
async function toggleRec() {
  if (!rec.on) {
    Object.assign(rec, { on: true, samples: [sampleNow()], last: performance.now(), t0: performance.now(), video: startVideo(renderer.domElement) });
    $('recBtn').classList.add('on');
    return;
  }
  rec.on = false;
  $('recBtn').classList.remove('on');
  $('recLabel').textContent = '録画';
  rec.samples.push(sampleNow());
  const blob = rec.video ? await rec.video.stop() : null;
  const destIndex = nav.dest ? data.dest.indexOf(nav.dest) : 255;
  const code = await encodeTrack(rec.samples, destIndex);
  openShare(code, blob, (rec.samples.length * SAMPLE_MS) / 1000);
}
$('recBtn').onclick = toggleRec;

let videoURL = null;
function openShare(code, blob, sec) {
  const url = `${location.origin}${location.pathname}?st=${ST.key}#rec=${code}`;
  const mmss = `${Math.floor(sec / 60)}分${String(Math.round(sec % 60)).padStart(2, '0')}秒`;
  $('shareInfo').textContent = `${mmss}の録画です。` + (nav.dest ? `行き先: ${nav.dest.name}` : '');
  $('linkShare').onclick = async () => {
    if (navigator.share) { try { await navigator.share({ title: 'エキさんぽの足あと', text: `${data.station}駅で歩いた道すじです。` + '開くと同じ道を再生できます。', url }); return; } catch { /* 取り消し */ } }
    copy(url);
  };
  $('linkCopy').onclick = () => copy(url);
  $('videoBox').hidden = !blob;
  if (blob) {
    if (videoURL) URL.revokeObjectURL(videoURL);
    videoURL = URL.createObjectURL(blob);
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    const d = new Date(), pad = (n) => String(n).padStart(2, '0');
    const name = `ekisanpo-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.${ext}`;
    $('videoPrev').src = videoURL;
    $('videoSave').href = videoURL;
    $('videoSave').download = name;
    $('videoShare').onclick = async () => {
      const file = new File([blob], name, { type: blob.type });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { try { await navigator.share({ files: [file], title: 'エキさんぽの録画' }); return; } catch { /* 取り消し */ } }
      $('videoSave').click();
    };
  }
  $('sharePanel').hidden = false;
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('リンクをコピーしました'); } catch { prompt('このリンクをコピーしてください', text); }
}
$('shareClose').onclick = () => { $('sharePanel').hidden = true; };
$('sharePanel').onclick = (e) => { if (e.target === $('sharePanel')) $('sharePanel').hidden = true; };

function drawTrail(samples) {
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  let k = 0, acc = 0;
  for (let i = 1; i < samples.length && k < 1500; i++) {
    const a = samples[i - 1], b = samples[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len > 8) { acc = 0; continue; } // エレベーターの飛び
    acc += len;
    if (acc < 2) continue;
    acc = 0;
    q.setFromAxisAngle(yAxis, -Math.atan2(b.x - a.x, b.y - a.y));
    m4.compose(V3(b.x, b.y, b.z + 0.08), q, one);
    trail.setMatrixAt(k++, m4);
  }
  trail.count = k;
  trail.instanceMatrix.needsUpdate = true;
}
function setReplayPose(t) {
  const S = replay.samples, f = Math.max(0, Math.min(S.length - 1, t / SAMPLE_MS)), i = Math.floor(f), u = f - i;
  const a = S[i], b = S[Math.min(S.length - 1, i + 1)];
  let dyaw = b.yaw - a.yaw;
  dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
  const jump = Math.hypot(b.x - a.x, b.y - a.y) > 8;
  const w = jump ? 0 : u;
  Object.assign(me, { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w, z: a.z + (b.z - a.z) * w, yaw: a.yaw + dyaw * w, pitch: a.pitch + (b.pitch - a.pitch) * w });
  $('replayProg').style.width = `${(100 * f) / Math.max(1, S.length - 1)}%`;
}
function pauseReplay(msg) {
  if (!replay.playing) return;
  replay.playing = false;
  setPlayBtn();
  if (msg) $('replayTitle').textContent = msg;
}
// 再生の帯のボタン: 再生中は ❚❚、ひとつずつ見るときは「次へ」、ほかは ▶
const setPlayBtn = () => {
  const next = !replay.playing && replay.stepMode && replay.next < replay.steps.steps.length;
  $('replayPlay').textContent = replay.playing ? '❚❚' : next ? '次へ ▶' : '▶';
  $('replayPlay').classList.toggle('next', next);
};
const playReplay = () => {
  if (replay.t >= (replay.samples.length - 1) * SAMPLE_MS - 1) { replay.t = 0; replay.next = 1; }
  replay.playing = true;
  setPlayBtn();
  $('replayTitle').textContent = replay.stepMode ? `区切り ${replay.next}/${replay.steps.steps.length - 1} へ` : '足あとを再生中';
};
$('replayPlay').onclick = () => { if (replay.playing) pauseReplay('一時停止中'); else playReplay(); };
$('replayEnd').onclick = () => {
  replay.playing = false; replay.samples = null; replay.steps = null;
  $('replayBar').hidden = true;
  $('routePanel').hidden = true;
  trail.count = 0;
  if (!nav.dest) $('guide').hidden = true;
  $('guide').classList.remove('replay');
  history.replaceState(null, '', location.pathname + location.search);
};
// 区切り k の所へ（止めて、その場所の景色を見せる）
function goStep(k) {
  const st = replay.steps.steps[k];
  replay.playing = false;
  replay.t = st.t ?? 0;
  replay.next = k + 1;
  setReplayPose(replay.t);
  me.eye = me.z + EYE;
  $('replayTitle').textContent = k === 0 ? '出発地' : `区切り ${k}/${replay.steps.steps.length - 1}`;
  setPlayBtn();
}
async function loadReplay() {
  const m = location.hash.match(/^#rec=(.+)$/);
  if (!m) return false;
  try {
    const { samples, destIndex } = await decodeTrack(m[1]);
    if (samples.length < 2) return false;
    const dest = destIndex < data.dest.length ? data.dest[destIndex] : null;
    const P = samples.map((p, i) => ({ x: p.x, y: p.y, z: p.z, l: levelOf(p.z), t: i * SAMPLE_MS }));
    Object.assign(replay, { samples, t: 0, playing: false, dest, steps: routeSteps(P, stepHelp, { dest: dest?.name, jump: 8 }), stepMode: false, next: 1 });
    drawTrail(samples);
    setReplayPose(0);
    me.eye = me.z + EYE;
    $('replayBar').hidden = false;
    $('replayTitle').textContent = '道順を見る';
    setPlayBtn();
    openRoutePanel();
    return true;
  } catch (e) {
    toast('足あとを開けませんでした');
    console.warn(e);
    return false;
  }
}
// ---------- 道順の画面（再生リンクを開いたとき）: 要約・道のりの図・区切りの一覧 ----------
const STEP_MARK = { start: '出', arrive: '着' };
function openRoutePanel() {
  const R = replay.steps, S = replay.samples, steps = R.steps;
  if (replay.playing) pauseReplay('一時停止中');
  $('routeTitle').textContent = `${R.startName || '出発地'} → ${R.endName || '行き先'}`;
  const ups = {};
  for (const st of steps) if (st.kind === 'level') { const k = st.act.split('で')[0]; ups[k] = (ups[k] || 0) + 1; }
  const sec = ((S.length - 1) * SAMPLE_MS) / 1000;
  $('routeSum').textContent = [`約 ${Math.max(1, Math.round(R.total))} m`, `歩いて約 ${Math.max(1, Math.round(sec / 60))} 分`, ...Object.entries(ups).map(([k, n]) => `${k} ${n} 回`)].join('・');
  const ol = $('routeSteps');
  ol.innerHTML = '';
  steps.forEach((st, k) => {
    const li = document.createElement('li'), b = document.createElement('button');
    b.type = 'button';
    const cls = st.kind === 'start' ? 's' : st.kind === 'arrive' ? 'g' : '';
    b.innerHTML = `<span class="no ${cls}">${STEP_MARK[st.kind] || k}</span><span></span><small>${k && st.kind !== 'arrive' ? `${Math.round(st.s)} m` : ''}</small>`;
    b.children[1].textContent = st.text;
    b.onclick = () => { $('routePanel').hidden = true; goStep(k); };
    li.append(b); ol.append(li);
  });
  $('routePanel').hidden = false;
  requestAnimationFrame(drawRouteMap);
}
// 道のりの図: 通る階の床（上が北）、足あとの線、区切りの番号
function drawRouteMap() {
  const cv = $('routeMap'), W = cv.clientWidth, H = cv.clientHeight, dpr = devicePixelRatio || 1;
  if (!W) return;
  cv.width = W * dpr; cv.height = H * dpr;
  const g = cv.getContext('2d'), S = replay.samples, steps = replay.steps.steps;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of S) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  const pad = 14, k = Math.min((W - 2 * pad) / Math.max(20, x1 - x0), (H - 2 * pad) / Math.max(20, y1 - y0));
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, X = (x) => W / 2 + (x - cx) * k, Y = (y) => H / 2 - (y - cy) * k;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = '#f4f2ee'; g.fillRect(0, 0, W, H);
  const levels = new Set(S.map((p) => levelOf(p.z)));
  g.fillStyle = 'rgba(255,255,255,0.85)'; g.strokeStyle = '#cfc8bb'; g.lineWidth = 0.8;
  for (const f of data.floors) {
    if (!levels.has(f.l)) continue;
    g.beginPath();
    for (const r of f.r) { for (let i = 0; i < r.length; i += 2) (i ? g.lineTo : g.moveTo).call(g, X(r[i]), Y(r[i + 1])); g.closePath(); }
    g.fill('evenodd'); g.stroke();
  }
  g.strokeStyle = '#f08c00'; g.lineWidth = 4; g.lineJoin = 'round'; g.lineCap = 'round';
  g.beginPath();
  for (let i = 1; i < S.length; i++) { if (Math.hypot(S[i].x - S[i - 1].x, S[i].y - S[i - 1].y) > 8) continue; g.moveTo(X(S[i - 1].x), Y(S[i - 1].y)); g.lineTo(X(S[i].x), Y(S[i].y)); }
  g.stroke();
  g.font = 'bold 11px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  steps.forEach((st, i) => {
    const x = X(st.x), y = Y(st.y);
    g.fillStyle = st.kind === 'start' ? '#0b8f4d' : st.kind === 'arrive' ? '#e8453c' : '#f08c00';
    g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.stroke();
    g.fillStyle = '#fff'; g.fillText(STEP_MARK[st.kind] || String(i), x, y + 0.5);
  });
}
$('routeClose').onclick = () => { $('routePanel').hidden = true; };
$('routePanel').onclick = (e) => { if (e.target === $('routePanel')) $('routePanel').hidden = true; };
$('routeStepBtn').onclick = () => { $('routePanel').hidden = true; replay.stepMode = true; goStep(0); playReplay(); };
$('routePlayBtn').onclick = () => { $('routePanel').hidden = true; replay.stepMode = false; playReplay(); };
$('replayList').onclick = () => openRoutePanel();
// 再生中・止めているあいだの案内の札（足あとの残りの長さと次の区切り）
function updateReplayGuide() {
  if (!replay.samples || !replay.steps || nav.dest) return;
  const R = replay.steps, c = R.cum, f = Math.max(0, Math.min(c.length - 1, replay.t / SAMPLE_MS)), i = Math.min(c.length - 2, Math.floor(f));
  const sCur = c[i] + (c[i + 1] - c[i]) * (f - i);
  const gd = $('guide');
  if (gd.hidden || !gd.classList.contains('replay')) { gd.hidden = false; gd.classList.add('replay'); }
  $('gName').textContent = replay.dest ? `${replay.dest.name}へ（足あと）` : '足あとの道順';
  $('gDist').textContent = `あと 約${Math.max(0, Math.round(R.total - sCur))} m`;
  const next = R.steps.find((st) => st.kind !== 'start' && st.s > sCur - 1) || R.steps[R.steps.length - 1]; // 区切りの 1 m 先までは「ここで」
  $('gHint').textContent = stepLine(next, next.s - sCur);
  // 画面の矢印: 足あとの 4 m 先
  let j = i; while (j < c.length - 1 && c[j] < sCur + 4) j++;
  const b = replay.samples[j];
  $('arrow').style.transform = `rotate(${((Math.atan2(b.x - me.x, b.y - me.y) - me.yaw) * 180) / Math.PI}deg)`;
}
const replaying = await loadReplay();
const hereOpen = !replaying && openHere();
// URL の ?from=出発地&to=行き先（名前。「5番線」のように先頭だけでもよい）
if (!replaying) {
  const q = new URLSearchParams(location.search);
  const find = (s) => s && (data.dest.find((d) => d.name === s) || data.dest.find((d) => d.name.startsWith(s)));
  const from = find(q.get('from')), to = find(q.get('to'));
  if (from) startAt(from, false);
  else { // はじめの位置も、出発地と同じ降り方で（改札口の点が通路の外にある駅で、動けない所に立っていた。渋谷の西口）
    // 改札は駅ごとに決めた広いコンコースに面したもの（data.start。東京で京葉地下丸の内口改札の脇の、エスカレーターの開口に近い狭い所に立っていた）
    const g = data.dest.find((d) => d.t === 'gate' && d.name === data.start) || data.dest.find((d) => d.t === 'gate' && /改札$/.test(d.name)) || data.dest.find((d) => d.t === 'gate');
    if (g) { startAt(g, false, true); startName = null; }
  }
  if (to) setDest(to);
  if (from && to && nav.pts) { const p = nav.pts.find((t, i) => i > 0 && Math.hypot(t.x - me.x, t.y - me.y) > 3); if (p) me.yaw = Math.atan2(p.x - me.x, p.y - me.y); }
}

// ---------- 待ち合わせ案内（統合データ。図と手順 + 立体） ----------
const meetShared = { p: null }; // あいての位置（小さな地図が描く）
const meet = await initMeet({ $, VER, data, LV, me, nav, phys, toast, jumpTo, landingAt, levelOf, scene, THREE, V3, floorNear, shared: meetShared, view: { get map() { return mapMode; }, set: setMapMode, focus: mapFocus }, setMeetRoute: (r) => { nav.fixed = r; setDest(r); }, clearRoute: () => setDest(null) });
groundTreeFn = meet.groundTree;
if (new URLSearchParams(location.search).get('view') === 'map') setMapMode(true, false); // 地図で開く（meet/ の古いリンクもここへ来る）
// 空と霧: 地下は近くで霧が濃い（30〜170 m）。地上（1F より上）では遠くまで見えるように霧を 60〜600 m にし、空を明るくする
// （利用者 2026-10-30「地上を歩いてると遠くが見えないので、恐い印象を与える」）。地上の範囲（±450 m）の外には平らな地面を敷く（空の色の穴が見えないように）
const SKY = { in: new THREE.Color('#c3c8cc'), out: new THREE.Color('#d3dfe9'), near: [30, 60], far: [170, 600] };
let skyK = 0, photoAt = 0;
function updateSky(dt) {
  const want = LV['1'] && me.z > LV['1'].z - 1.5 ? 1 : 0;
  if (Math.abs(want - skyK) < 0.001) return;
  skyK += (want - skyK) * Math.min(1, dt * 3);
  if (Math.abs(want - skyK) < 0.002) skyK = want;
  scene.background.copy(SKY.in).lerp(SKY.out, skyK); scene.fog.color.copy(scene.background);
  scene.fog.near = SKY.near[0] + (SKY.near[1] - SKY.near[0]) * skyK; scene.fog.far = SKY.far[0] + (SKY.far[1] - SKY.far[0]) * skyK;
}
// 写真の街並み（photo.js。Ekishirube を参考に）: 地上のある駅だけボタンを出す。選んだかどうかは端末に覚える
if (data.mall && data.mall.layout && data.mall.layout.gfloor) {
  { // 地上の範囲の外の地面
    const sh = new THREE.Shape([[-3000, -3000], [3000, -3000], [3000, 3000], [-3000, 3000]].map(([x, y]) => new THREE.Vector2(x, y)));
    const [bx0, by0, bx1, by1] = (data.groundBox || [-450, -450, 450, 450]).map((v, i) => v + (i < 2 ? 1 : -1)); // 地上の範囲（駅ごと）
    sh.holes.push(new THREE.Path([[bx0, by0], [bx0, by1], [bx1, by1], [bx1, by0]].map(([x, y]) => new THREE.Vector2(x, y))));
    const m = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshLambertMaterial({ color: '#b4b2ac' }));
    m.rotation.x = -Math.PI / 2; m.position.y = LV['1'].z - 0.15; m.name = 'outerGround'; scene.add(m);
  }
  const baseCredit = '出典: ' + data.credits.join(' ／ ');
  const photo = initPhoto({ scene, data, groundZ: LV['1'].z, stationKey: ST.key, light: touchUI, here: () => [me.x, me.y], setStatus: (t) => { if (t) toast(t); }, onCredit: (c) => { $('credit').textContent = c ? baseCredit + ' ／ ' + c : baseCredit; } });
  const btn = $('photoBtn');
  // ボタンは街並みが見える階（地上の 1F より上）を見ているときだけ出す。歩くときは自分の階、地図で見るときは地図に出している階（利用者 2026-10-31）
  photoBtnSync = () => { const l = Number(mapMode && mini.floor != null ? mini.floor : levelOf(me.z)), hide = !(l >= 1); if (btn.hidden !== hide) btn.hidden = hide; };
  photoBtnSync();
  const show = (on) => { btn.classList.toggle('primary', on); btn.textContent = on ? '写真の街並み ✓' : '写真の街並み'; };
  // 読み込みの途中で画面が落ちた（スマホで重すぎた）ときは、次に開いたとき自動では読まない（読み込み中の印が残っていたら、ふつうの見た目で開く）
  const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (err) { void err; } return null; };
  const turn = async (on) => { if (on) ls('ekisanpo.photoBusy', '1'); const r = await photo.set(on); ls('ekisanpo.photoBusy', null); show(r); return r; };
  btn.onclick = async () => { const on = await turn(!photo.on); ls('ekisanpo.photo', on ? '1' : '0'); };
  if (ls('ekisanpo.photoBusy') === '1') { ls('ekisanpo.photoBusy', null); ls('ekisanpo.photo', '0'); toast('前に写真の街並みの読み込みが終わらなかったので、ふつうの見た目で開きました'); }
  else if (ls('ekisanpo.photo') === '1') turn(true);
  window.ekisanpoPhoto = photo; photoCity = photo;
}

// ---------- はじめの説明 ----------
const seen = (() => { try { return localStorage.getItem('ekisanpo.help') === '1'; } catch { return false; } })();
$('help').hidden = seen || replaying || hereOpen;
$('helpOk').onclick = () => { $('help').hidden = true; try { localStorage.setItem('ekisanpo.help', '1'); } catch { /* 保存できなくてもよい */ } };

// ---------- 方角の帯 ----------
// 向いている方向の左右 75° を帯の幅に。東西南北と、駅のまわりの目印（data.marks）の方向を出す（地下で方向が分からなくならないように）。
// 帯の外の目印は、左右の端に「◀ 名前」で近い方から 1 つずつ
const cmp = { cv: $('compassCv'), key: '' };
function drawCompass() {
  const cv = cmp.cv, w = cv.clientWidth, h = cv.clientHeight, dpr = devicePixelRatio || 1;
  const key = `${w}|${Math.round(me.yaw * 200)}|${Math.round(me.x)}|${Math.round(me.y)}`;
  if (key === cmp.key || !w) return;
  cmp.key = key;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const SPAN = (75 * Math.PI) / 180, cx = w / 2, px = (w / 2 - 6) / SPAN;
  const rel = (b) => Math.atan2(Math.sin(b - me.yaw), Math.cos(b - me.yaw));
  g.textAlign = 'center'; g.textBaseline = 'middle';
  // 帯の外の目印（左右の端に「◀ 名前」、近い方から 1 つ）の場所を先に決める。そこには目盛り・東西南北を描かない
  // （端の名前に背景が無く、「北」が「サンシャインシティ ▶」に重なって読めなかった。スマホ実機）
  const marks = (data.marks || []).map(([name, mx, my]) => [name, rel(Math.atan2(mx - me.x, my - me.y))]);
  const used = [], side = { l: null, r: null };
  for (const [name, a] of marks) if (Math.abs(a) > SPAN) { const k = a < 0 ? 'l' : 'r'; if (!side[k] || Math.abs(a) < Math.abs(side[k][1])) side[k] = [name, a]; }
  // ただし帯に東西南北が 1 つしか無く、それが端の名前にかかるときは、東西南北を残して端の名前を出さない（方角が分からなくならないように）
  g.font = '11px system-ui, sans-serif';
  const cards = [0, 90, 180, 270].map((d) => cx + rel((d * Math.PI) / 180) * px).filter((x) => Math.abs(x - cx) <= SPAN * px);
  for (const k of ['l', 'r']) {
    if (!side[k]) continue;
    side[k][2] = k === 'l' ? `◀ ${side[k][0]}` : `${side[k][0]} ▶`;
    const tw = g.measureText(side[k][2]).width + 14, zone = k === 'l' ? [0, tw] : [w - tw, w];
    const hit = (x) => x + 7 > zone[0] && x - 7 < zone[1];
    if (cards.some(hit) && !cards.some((x) => !hit(x))) { side[k] = null; continue; }
    used.push(zone);
  }
  const edge = used.slice(), shown = []; // shown: 描いた東西南北の位置
  // 目盛り（15° ごと）と東西南北
  for (let d = 0; d < 360; d += 15) {
    const a = rel((d * Math.PI) / 180);
    if (Math.abs(a) > SPAN) continue;
    const x = cx + a * px, card = d % 90 === 0;
    if (edge.some(([l, r]) => x + (card ? 7 : 1) > l && x - (card ? 7 : 1) < r)) continue;
    if (card) {
      shown.push(x);
      g.font = 'bold 13px system-ui, sans-serif';
      g.fillStyle = d === 0 ? '#ff6b5e' : '#fff';
      g.fillText('北東南西'[d / 90], x, h / 2 + 1);
    } else {
      g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, h - (d % 45 === 0 ? 9 : 6)); g.lineTo(x, h); g.stroke();
    }
  }
  // 目印: 帯の外のものは左右の端に。帯の中の名前の札はそこと重ならないように（札どうしが重なるときは、一覧の先のものを残す）
  g.font = '11px system-ui, sans-serif'; g.fillStyle = 'rgba(255,255,255,0.85)';
  if (side.l) { g.textAlign = 'left'; g.fillText(side.l[2], 8, h / 2 + 0.5); }
  if (side.r) { g.textAlign = 'right'; g.fillText(side.r[2], w - 8, h / 2 + 0.5); }
  g.font = 'bold 11px system-ui, sans-serif'; g.textAlign = 'center';
  for (const [name, a] of marks) {
    if (Math.abs(a) > SPAN) continue;
    const tw = g.measureText(name).width + 12, clamp = (v) => Math.max(tw / 2 + 2, Math.min(w - tw / 2 - 2, v));
    // 東西南北の文字にかかるときは、札を文字のすぐ横へずらす（札の下に隠れて、帯に方角の文字が 1 つも見えないことがあった）
    const onCard = (v) => shown.find((c) => v + tw / 2 + 2 > c - 8 && v - tw / 2 - 2 < c + 8);
    let x = clamp(cx + a * px);
    const c0 = onCard(x);
    if (c0 != null) { const L = clamp(c0 - 10 - tw / 2), R = clamp(c0 + 10 + tw / 2); x = Math.abs(L - x) <= Math.abs(R - x) && onCard(L) == null ? L : R; }
    if (onCard(x) != null || used.some(([l, r]) => x + tw / 2 > l && x - tw / 2 < r)) continue;
    used.push([x - tw / 2, x + tw / 2]);
    g.fillStyle = '#0b8f4d';
    g.beginPath(); g.roundRect(x - tw / 2, 5, tw, h - 10, 8); g.fill();
    g.fillStyle = '#fff'; g.fillText(name, x, h / 2 + 0.5);
  }
  // 真ん中（向いている方向）の印
  g.fillStyle = '#ffd24a';
  g.beginPath(); g.moveTo(cx - 5, 0); g.lineTo(cx + 5, 0); g.lineTo(cx, 6); g.fill();
}

// ---------- ループ ----------
function resize() { // 立体の大きさ（地図で見ているときは右下の小さな立体の大きさ）
  const w = view.clientWidth || innerWidth, h = view.clientHeight || innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  miniSize();
}
addEventListener('resize', resize);
if (window.ResizeObserver) new ResizeObserver(() => resize()).observe(view); // 地図で見る ⇄ 立体で見るで大きさが変わったとき
resize();

let last = performance.now();
let floorShown = '', fareShown = 'out', fareAt = 0;
function frame(now) {
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); // 最初のコマは now が last より前のことがある
  last = now;
  // 歩く
  let f = 0, s = 0, turn = 0;
  if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
  if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
  if (keys.has('KeyA')) s -= 1;
  if (keys.has('KeyD')) s += 1;
  if (keys.has('ArrowLeft')) turn -= 1;
  if (keys.has('ArrowRight')) turn += 1;
  me.yaw += turn * 1.9 * dt;
  const RUN = 7.5, WALK = 1.5; // 走る・歩く速さ（m/秒）。走るは 5.0 の 1.5 倍（利用者「走る速度を1.5倍にしてほしい」）
  let speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? RUN : WALK;
  if (stick.id != null) {
    f += stick.vy; s += stick.vx;
    // スティックは大きく倒すと走る
    speed = WALK + Math.max(0, Math.hypot(stick.vx, stick.vy) - 0.85) * ((RUN - WALK) / 0.15);
  }
  const mag = Math.hypot(f, s);
  if (updateJump(dt)) {
    // 地図で選んだ所へ移動中は、歩く操作を受けない
  } else if (replay.playing) {
    if (mag > 0.01 || turn) pauseReplay('止めました（ここから歩けます）');
    else {
      replay.t += dt * 1000;
      const end = (replay.samples.length - 1) * SAMPLE_MS;
      // ひとつずつ見る: 次の区切りの所で止める
      const st = replay.stepMode && replay.steps.steps[replay.next];
      if (st && st.t != null && replay.t >= st.t && st.kind !== 'arrive') {
        replay.t = st.t;
        setReplayPose(replay.t);
        const k = replay.next++;
        pauseReplay(`区切り ${k}/${replay.steps.steps.length - 1}`);
      } else {
        setReplayPose(Math.min(replay.t, end));
        if (replay.t >= end) { replay.next = replay.steps.steps.length; pauseReplay('着きました（ここから歩けます）'); }
      }
    }
  } else if (mag > 0.01) {
    const k = (speed * dt) / Math.max(1, mag);
    const fx = Math.sin(me.yaw), fy = Math.cos(me.yaw);
    move((fx * f + fy * s) * k, (fy * f - fx * s) * k);
  }
  if (rec.on && now - rec.last >= SAMPLE_MS) {
    rec.last += SAMPLE_MS;
    rec.samples.push(sampleNow());
    const sec = Math.floor((now - rec.t0) / 1000);
    $('recLabel').textContent = `止める ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    if (rec.samples.length >= MAX_SAMPLES) toggleRec();
  }
  me.eye += (me.z + EYE - me.eye) * Math.min(1, dt * 10);
  camera.position.copy(V3(me.x, me.y, me.eye));
  camera.rotation.set(me.pitch, -me.yaw, 0);
  if (viewAnim) { // 地図 ⇄ 立体の切り替え: u = 0 で目の高さ、1 で真上から見下ろす（地図の上を上に）
    const k = Math.min(1, (now - viewAnim.t0) / VIEW_MS), e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2, u = viewAnim.on ? e : 1 - e;
    const ty = mini.rot; let dy = ty - me.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); // ty: 地図の上の向き（北が上なら 0、進む向きを上にしていれば自分の向き）
    camera.position.y += u * VIEW_H;
    camera.rotation.set(me.pitch + (-Math.PI / 2 + 0.001 - me.pitch) * u, -(me.yaw + dy * u), 0);
    if (k >= 1) viewAnim = null;
  }
  const fl = LV[levelOf(me.z)].name;
  if (fl !== floorShown) { $('floor').textContent = fl; floorShown = fl; }
  if (now - fareAt > 300) { // 改札の内・外（0.3 秒ごと）
    fareAt = now;
    const side = fareSide(me.x, me.y, levelOf(me.z));
    if (side !== fareShown) { fareShown = side; $('fare').textContent = side === 'in' ? '改札内' : '改札外'; $('fare').className = `pill fare ${side}`; }
  }
  trains.update(dt);
  guideUpdate(dt);
  watchLevel();
  updateGuide();
  updateReplayGuide();
  updateBeacon(now);
  updateElev();
  updateSky(dt);
  if (photoBtnSync) photoBtnSync();
  if (photoCity && now - photoAt > 3000) { photoAt = now; photoCity.update(); } // スマホの写真の街並み: 近くのタイルを読み足す
  drawMini();
  drawCompass();
  renderer.render(scene, camera); // 地図で見ているあいだは右下の小さな立体に描く
  requestAnimationFrame(frame);
}
$('loading').hidden = true;
requestAnimationFrame(frame);

// 確かめ用（コンソールから位置を見る・動かす）
window.ekisanpo = { me, phys, setDest, data, move, nav, rec, replay, meet, encodeTrack, decodeTrack, trains, mini, jumpTo, W2S, S2W, getGrid, gridPath, startAt, scene, camera, THREE, fareSide, stepHelp, fareRows, guideSigns };
