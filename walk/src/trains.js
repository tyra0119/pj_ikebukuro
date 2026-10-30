// ホームの電車: 番線ごとに、入ってくる → 止まる → 出ていく → しばらく来ない をくり返す。
// 線路は、その番線の乗車位置の点からいちばん近いホームドア（壁 p）の外 1.5 m（軌道の中心）に置く。

import * as THREE from 'three';

const V3 = (x, y, z) => new THREE.Vector3(x, z, -y);
const CAR = 20;             // 1 両の長さ（m）
const ARRIVE = 14, STOP = 30, LEAVE = 14; // 入ってくる・止まる・出ていく秒
// 両数（ホームに入る数まで）と帯の色。表に無い路線は 10 両、帯は路線の色 1 本
const CARS = { JY: 11, JA: 10, JS: 15, JK: 10, JC: 10, JB: 10, JE: 10, JT: 15, JU: 15, JO: 15, JJ: 15 };
const BAND = { JS: ['#f68b1e', '#2e9f4a'], JT: ['#f68b1e', '#2e9f4a'], JU: ['#f68b1e', '#2e9f4a'], JO: ['#0067c0', '#f0c419'] }; // 2 色の帯（橙と緑、紺とクリーム）

function carTexture(route, color) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#eef1f3'); grad.addColorStop(0.5, '#c9ced2'); grad.addColorStop(1, '#a9afb4');
  g.fillStyle = grad; g.fillRect(0, 0, 1024, 256);
  const [b1, b2] = BAND[route] || [color || '#888', null];
  // 窓の上の帯と、窓の下の帯
  g.fillStyle = b1; g.fillRect(0, 40, 1024, 14);
  g.fillStyle = b2 || b1; g.fillRect(0, 172, 1024, b2 ? 10 : 16);
  if (b2) { g.fillStyle = b1; g.fillRect(0, 184, 1024, 10); }
  // 扉 4 か所と、そのあいだの窓
  const doors = [110, 370, 630, 890];
  g.fillStyle = '#26323b';
  for (let i = 0; i < 5; i++) {
    const x0 = i === 0 ? 10 : doors[i - 1] + 50, x1 = i === 4 ? 1014 : doors[i] - 50;
    g.fillRect(x0 + 8, 66, x1 - x0 - 16, 90);
  }
  for (const x of doors) {
    g.fillStyle = '#b6bcc1'; g.fillRect(x - 44, 58, 88, 190);
    g.strokeStyle = '#7f878d'; g.lineWidth = 3; g.strokeRect(x - 44, 58, 88, 190);
    g.beginPath(); g.moveTo(x, 58); g.lineTo(x, 248); g.stroke();
    g.fillStyle = '#26323b'; g.fillRect(x - 36, 72, 28, 70); g.fillRect(x + 8, 72, 28, 70);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function addTrains(scene, data) {
  const N = data.graph.n, LV = data.levels;
  const pw = data.walls.filter((w) => w[5] === 'p');
  const tracks = [];
  for (const d of data.dest.filter((x) => x.t === 'plat')) {
    // 乗車位置の点ごとに、いちばん近いホームドアの外 1.5 m の点
    const pts = [];
    for (const i of d.nodes) {
      const [x, y, l] = N[i];
      let best = null;
      for (const w of pw) {
        if (w[4] !== l) continue;
        const dx = w[2] - w[0], dy = w[3] - w[1], L = dx * dx + dy * dy;
        const t = Math.max(0, Math.min(1, ((x - w[0]) * dx + (y - w[1]) * dy) / L));
        const px = w[0] + dx * t, py = w[1] + dy * t, dist = Math.hypot(x - px, y - py);
        if (!best || dist < best.dist) { const len = Math.sqrt(L); best = { dist, px, py, nx: dy / len, ny: -dx / len }; }
      }
      if (best && best.dist < 6) pts.push([best.px + best.nx * 1.53, best.py + best.ny * 1.53]);
    }
    if (pts.length < 2) continue;
    // 主軸で直線にする
    const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length, my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    let sxx = 0, sxy = 0, syy = 0;
    for (const [x, y] of pts) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); syy += (y - my) ** 2; }
    const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy), ux = Math.cos(ang), uy = Math.sin(ang);
    // ホームの長さ: 乗車位置の点がいちばん多く入っているホームの面を、線路の向きに測る（乗車位置の点はホームの一部にしか無い）
    const inRing = (x, y, r) => { let s = false; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) if ((r[i + 1] > y) !== (r[j + 1] > y) && x < ((r[j] - r[i]) * (y - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) s = !s; return s; };
    const plats = data.floors.filter((f) => f.k === 'plat' && f.l === d.level);
    const plat = plats.map((f) => [f, d.nodes.filter((i) => inRing(N[i][0], N[i][1], f.r[0])).length]).sort((p, q) => q[1] - p[1])[0]?.[0];
    let along = pts.map(([x, y]) => (x - mx) * ux + (y - my) * uy);
    if (plat) { along = []; const r = plat.r[0]; for (let i = 0; i < r.length; i += 2) along.push((r[i] - mx) * ux + (r[i + 1] - my) * uy); }
    const a0 = Math.min(...along), a1 = Math.max(...along);
    const platLen = a1 - a0;
    const cars = Math.max(4, Math.min(CARS[d.route] || 10, Math.floor(platLen / CAR)));
    const cx = mx + ux * (a0 + a1) / 2, cy = my + uy * (a0 + a1) / 2;
    tracks.push({ d, cx, cy, ux, uy, ang, cars, plat, z: LV[d.level].z - 0.9, dir: (d.ord ?? 0) % 2 ? 1 : -1 });
  }

  const geo = new THREE.BoxGeometry(CAR - 0.6, 3.55, 2.9);
  const gap = () => 25 + Math.random() * 50;
  const mats = {};
  const trains = tracks.map((tr, k) => {
    const mat = mats[tr.d.route] || (mats[tr.d.route] = [
      new THREE.MeshLambertMaterial({ map: carTexture(tr.d.route, tr.d.color) }), // 横（+x の面は使わないが同じ）
      new THREE.MeshLambertMaterial({ color: '#d4d8db' }),
    ]);
    const group = new THREE.Group();
    for (let i = 0; i < tr.cars; i++) {
      const m = new THREE.Mesh(geo, [mat[1], mat[1], mat[1], mat[1], mat[0], mat[0]]);
      m.position.set((i - (tr.cars - 1) / 2) * CAR, 0, 0);
      group.add(m);
    }
    // 屋根の上の機器
    const roof = new THREE.Mesh(new THREE.BoxGeometry(tr.cars * CAR - 2, 0.25, 1.6), new THREE.MeshLambertMaterial({ color: '#8d9399' }));
    roof.position.y = 1.9;
    group.add(roof);
    group.rotation.y = tr.ang; // データの角（東から反時計回り）は three.js の y 回りと同じ向き
    group.visible = false;
    scene.add(group);
    // 番線ごとに時間をずらす（はじめから半分は止まっている）
    // n: 何本目か（発車標の行先をかえる）。gaps: このあとの「しばらく来ない」秒（発車標の次発の時刻に使うので先に決めておく）
    return k % 2 ? { tr, group, phase: 'away', t: -(5 + k * 6), n: 0, gaps: [gap(), gap()] } : { tr, group, phase: 'stop', t: k * 3, n: 0, gaps: [gap(), gap()] };
  });

  const place = (o, s) => { // s: 止まる位置からの距離（m、進む向きが正）
    const { tr } = o;
    const x = tr.cx + tr.ux * s * tr.dir, y = tr.cy + tr.uy * s * tr.dir;
    o.group.position.copy(V3(x, y, tr.z + 1.95));
    o.group.visible = true;
  };
  const boards = addBoards(scene, data, trains);
  return {
    count: trains.length,
    boards: boards.list,
    list: trains,
    update(dt) {
      for (const o of trains) {
        o.t += dt;
        const len = o.tr.cars * CAR;
        if (o.phase === 'away') {
          o.group.visible = false;
          if (o.t > 0) { o.phase = 'arrive'; o.t = 0; }
        } else if (o.phase === 'arrive') {
          const u = Math.min(1, o.t / ARRIVE), ease = 1 - (1 - u) ** 2; // だんだん遅く
          o.group.visible = true;
          place(o, -(len + 120) * (1 - ease));
          if (u >= 1) { o.phase = 'stop'; o.t = 0; }
        } else if (o.phase === 'stop') {
          place(o, 0);
          if (o.t > STOP) { o.phase = 'leave'; o.t = 0; }
        } else if (o.phase === 'leave') {
          const u = Math.min(1, o.t / LEAVE);
          place(o, (len + 120) * u * u); // だんだん速く
          if (u >= 1) { o.phase = 'away'; o.t = -o.gaps.shift(); o.gaps.push(gap()); o.n++; }
        }
      }
      boards.update(dt);
    },
  };
}

// ---------- ホームの駅名標と発車標 ----------
// 駅名標: 番線の札の両端の点から 5 m ホームの中ほどへ、線路と平行に（表と裏）。駅名・よみ・ローマ字・駅番号・路線の色の帯に「つぎは」
// 発車標: 番線の札の中ほどの点から 4 m 線路の向きにずらし、線路の向きに向けて（表と裏）。先発・次発の種別・時刻・行先・両数（電車の動きと同じ時刻）
// どちらも乗車位置の点から 0.6 m ホームの内側へ、天井から下げる（下の端は床から 2.3 m ほど）
const STATION = {
  ikebukuro: ['池袋', 'いけぶくろ', 'Ikebukuro'], tokyo: ['東京', 'とうきょう', 'Tōkyō'], shinjuku: ['新宿', 'しんじゅく', 'Shinjuku'],
  shibuya: ['渋谷', 'しぶや', 'Shibuya'], shinagawa: ['品川', 'しながわ', 'Shinagawa'], takanawa_gateway: ['高輪ゲートウェイ', 'たかなわゲートウェイ', 'Takanawa Gateway'],
};
// 駅番号（路線の記号ごと。分からないものは出さない）
const NUMBER = {
  ikebukuro: { JY: 'JY 13', JA: 'JA 12', JS: 'JS 21' }, tokyo: { JY: 'JY 01', JK: 'JK 26', JC: 'JC 01', JE: 'JE 01', JO: 'JO 19' },
  shinjuku: { JY: 'JY 17', JB: 'JB 10', JC: 'JC 05', JA: 'JA 11', JS: 'JS 20' }, shibuya: { JY: 'JY 20', JA: 'JA 10' },
  shinagawa: { JY: 'JY 25', JK: 'JK 20', JT: 'JT 03', JO: 'JO 17' }, takanawa_gateway: { JY: 'JY 26', JK: 'JK 21' },
};
// つぎの駅: 番線の方面（dir）に合う言葉 → つぎの駅。R38・R18 は東京・品川を通る上野東京ラインの電車
const NEXT = {
  ikebukuro: { JY: [[/新宿|渋谷/, '目白'], [/上野|東京/, '大塚']], JS: [[/新宿|渋谷/, '新宿'], [/赤羽|大宮/, '赤羽']], JA: [[/新宿|渋谷/, '新宿'], [/赤羽|大宮/, '板橋']] },
  tokyo: {
    JE: [[/新木場|舞浜/, '八丁堀']], JO: [[/錦糸町|船橋/, '新日本橋'], [/品川|横浜/, '新橋']], JC: [[/新宿|三鷹/, '神田']],
    JK: [[/秋葉原|上野/, '神田'], [/品川|蒲田/, '有楽町']], JY: [[/上野|池袋/, '神田'], [/品川|大崎/, '有楽町']],
    R38: [[/上野|大宮/, '上野'], [/品川|横浜/, '新橋']], R18: [[/上野|大宮/, '上野'], [/品川|横浜/, '新橋']],
  },
  shinjuku: {
    JB: [[/中野|三鷹/, '大久保'], [/御茶ノ水|秋葉原/, '代々木']], JY: [[/池袋|上野/, '新大久保'], [/渋谷|大崎/, '代々木']],
    JC: [[/中野|三鷹/, '中野'], [/御茶ノ水|東京/, '四ツ谷']], JA: [[/池袋|赤羽/, '池袋'], [/渋谷|大崎/, '渋谷']], JS: [[/渋谷|大崎/, '渋谷'], [/池袋|赤羽/, '池袋']],
  },
  shibuya: { JY: [[/新宿|池袋/, '原宿'], [/大崎/, '恵比寿']], JA: [[/新宿|池袋/, '新宿'], [/大崎|横浜/, '恵比寿']] },
  shinagawa: {
    JY: [[/東京|上野/, '高輪ゲートウェイ'], [/大崎/, '大崎']], JK: [[/東京|上野/, '高輪ゲートウェイ'], [/蒲田|川崎/, '大井町']],
    JT: [[/東京/, '新橋'], [/横浜|大船/, '川崎']], R18: [[/東京|上野/, '新橋']], JO: [[/東京/, '新橋'], [/横浜|大船/, '西大井']],
  },
  takanawa_gateway: { JY: [[/東京|上野/, '田町'], [/品川|大崎/, '品川']], JK: [[/東京|上野/, '田町'], [/品川|蒲田/, '品川']] },
};
const KIND = { JC: '快速' }; // 発車標の種別（ほかは普通）
const FONT = '"Hiragino Sans", "Noto Sans JP", "Yu Gothic UI", system-ui, sans-serif';

function nameBoard(st, d) {
  const [kanji, kana, roma] = STATION[st] || [d.name, '', ''];
  const num = NUMBER[st]?.[d.route], next = (NEXT[st]?.[d.route] || []).find(([re]) => re.test(d.dir || ''))?.[1];
  const c = document.createElement('canvas'); c.width = 768; c.height = 240;
  const g = c.getContext('2d'), col = d.color || '#0b8f4d';
  g.fillStyle = '#fff'; g.fillRect(0, 0, 768, 240);
  g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillStyle = '#111';
  g.font = `bold ${kanji.length > 4 ? 64 : 92}px ${FONT}`; g.fillText(kanji, 384, 104);
  g.font = `bold 30px ${FONT}`; g.fillText(kana, 384, 142);
  g.font = `28px ${FONT}`; g.fillStyle = '#444'; g.fillText(roma, 384, 174);
  if (num) { // 駅番号（路線の色の枠）
    g.fillStyle = '#fff'; g.strokeStyle = col; g.lineWidth = 8; g.beginPath(); g.roundRect(28, 26, 104, 104, 16); g.fill(); g.stroke();
    g.fillStyle = '#111'; g.font = `bold 34px ${FONT}`; g.fillText(num.split(' ')[0], 80, 72); g.font = `bold 44px ${FONT}`; g.fillText(num.split(' ')[1], 80, 118);
  }
  g.fillStyle = col; g.fillRect(0, 188, 768, 52); // 路線の色の帯
  g.fillStyle = '#fff'; g.textAlign = 'left'; g.font = `bold 28px ${FONT}`; g.fillText(d.name.replace(/^\S+番線 /, ''), 20, 225);
  if (next) { g.textAlign = 'right'; g.font = `bold 32px ${FONT}`; g.fillText(`つぎは  ${next}`, 748, 226); }
  g.strokeStyle = '#9aa2aa'; g.lineWidth = 6; g.strokeRect(3, 3, 762, 234);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function addBoards(scene, data, trains) {
  const st = data.key, LV = data.levels;
  const inRing = (x, y, r) => { let s = false; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) if ((r[i + 1] > y) !== (r[j + 1] > y) && x < ((r[j] - r[i]) * (y - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) s = !s; return s; };
  const frame = new THREE.MeshLambertMaterial({ color: '#3a4048' });
  // 表と裏の 2 枚の板と、天井からの 2 本の吊り棒。(fx, fy): 表の向く方向
  const hang = (x, y, l, fx, fy, w, h, mat) => {
    const L = LV[l], ceil = L.ceil || 3.2, zc = L.z + Math.min(2.3 + h / 2, ceil - 0.25 - h / 2), top = L.z + ceil;
    const grp = new THREE.Group();
    grp.add(new THREE.Mesh(new THREE.BoxGeometry(w + 0.08, h + 0.08, 0.08), frame));
    for (const sgn of [1, -1]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat); p.position.z = 0.045 * sgn; if (sgn < 0) p.rotation.y = Math.PI; grp.add(p); }
    const rodLen = top - zc - h / 2;
    for (const sx of [-w / 2 + 0.15, w / 2 - 0.15]) { const rod = new THREE.Mesh(new THREE.BoxGeometry(0.03, rodLen, 0.03), frame); rod.position.set(sx, h / 2 + rodLen / 2, 0); grp.add(rod); }
    grp.position.set(x, zc, -y);
    grp.rotation.y = Math.atan2(fx, -fy); // 板の表（+z）を (fx, fy) へ（データの (x, y) は three.js の (x, 0, -y)）
    scene.add(grp);
  };
  // 乗車位置の印（床）: 路線の色の枠と、線路の側を指す 3 つの三角。路線の色ごとに 1 枚の絵
  const markTex = {}, markGeo = new THREE.PlaneGeometry(1.4, 0.8);
  const markMat = (col) => markTex[col] || (markTex[col] = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 146;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.fillRect(6, 6, 244, 134);
    g.strokeStyle = col; g.lineWidth = 10; g.strokeRect(6, 6, 244, 134);
    g.fillStyle = col;
    for (const x of [64, 128, 192]) { g.beginPath(); g.moveTo(x, 30); g.lineTo(x + 30, 112); g.lineTo(x - 30, 112); g.closePath(); g.fill(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return new THREE.MeshLambertMaterial({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  })());
  const N = data.graph.n;
  const boards = [];
  for (const o of trains) {
    const { d, cx, cy, ux, uy, plat } = o.tr;
    if (!plat || !d.signs?.length) continue;
    const r = plat.r[0], nx = -uy, ny = ux;
    const side = (x, y) => Math.sign((x - cx) * nx + (y - cy) * ny) || 1; // 線路のどちら側か
    const inward = (x, y) => { const s = side(x, y); return [x + s * 0.6 * nx, y + s * 0.6 * ny]; }; // 線路から離れる向きへ 0.6 m
    const along = (p) => (p[0] - cx) * ux + (p[1] - cy) * uy;
    // 乗車位置の印: 乗車位置の点を線路に直角に動かし、ホームドアの線（線路の中心から 1.53 m）から 0.6 m ホームの側に。三角は線路の側へ
    for (const i of d.nodes) {
      const [x, y, l] = N[i], s = (x - cx) * nx + (y - cy) * ny, sg = Math.sign(s) || 1;
      if (l !== d.level || Math.abs(s) > 8) continue;
      const k = Math.abs(s) - 1.53 - 0.6, mx = x - sg * nx * k, my = y - sg * ny * k;
      if (!inRing(mx, my, r)) continue;
      const m = new THREE.Mesh(markGeo, markMat(d.color || '#0b8f4d'));
      m.rotation.x = -Math.PI / 2;
      const grp = new THREE.Group();
      grp.add(m);
      grp.position.set(mx, LV[l].z + 0.01, -my);
      grp.rotation.y = Math.atan2(sg * nx, -sg * ny); // 絵の上（データの +y）を線路の側 (-sg·n) へ
      scene.add(grp);
    }
    // 駅名標: 両端の点から 5 m 中ほどへ
    const nm = new THREE.MeshBasicMaterial({ map: nameBoard(st, d) }); // 光る板
    for (const p of [d.signs[0], d.signs[d.signs.length - 1]]) {
      const k = Math.sign(-along(p)) || 1;
      const [x, y] = inward(p[0] + ux * k * 5, p[1] + uy * k * 5);
      if (!inRing(x, y, r)) continue;
      const s = side(x, y);
      hang(x, y, d.level, nx * s, ny * s, 1.9, 0.6, nm); // 表はホームの側、裏は線路の側
    }
    // 発車標: 中ほどの点から 4 m 線路の向きに（ホームの外なら反対へ）
    const mid = d.signs[Math.floor(d.signs.length / 2)];
    for (const k of [1, -1]) {
      const [x, y] = inward(mid[0] + ux * k * 4, mid[1] + uy * k * 4);
      if (!inRing(x, y, r)) continue;
      const c = document.createElement('canvas'); c.width = 640; c.height = 208;
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
      hang(x, y, d.level, ux * k, uy * k, 1.6, 0.52, new THREE.MeshBasicMaterial({ map: t })); // 光る板
      boards.push({ o, c, t, text: '' });
      break;
    }
  }
  // 発車の時刻: いまの時計 + その電車が出るまでの秒
  const leaveIn = (o) => {
    if (o.phase === 'away') return -o.t + ARRIVE + STOP;
    if (o.phase === 'arrive') return ARRIVE - o.t + STOP;
    if (o.phase === 'stop') return STOP - o.t;
    return null; // 出ていくところ
  };
  const hhmm = (sec) => { const t = new Date(Date.now() + sec * 1000); return `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`; };
  const head = (o, i) => { const h = o.tr.d.heads || []; return h.length ? h[i % h.length] : (o.tr.d.dir || '').replace(/方面$/, ''); };
  const draw = (b) => {
    const { o, c, t } = b, d = o.tr.d;
    let s1 = leaveIn(o), n1 = o.n, g = o.gaps;
    if (s1 == null) { s1 = LEAVE - o.t + g[0] + ARRIVE + STOP; n1 = o.n + 1; g = g.slice(1); }
    const s2 = s1 + LEAVE + g[0] + ARRIVE + STOP;
    const kind = KIND[d.route] || '普通';
    const rows = [[kind, hhmm(s1), head(o, n1), `${o.tr.cars}両`], [kind, hhmm(s2), head(o, n1 + 1), `${o.tr.cars}両`]];
    const status = o.phase === 'stop' ? '発車します' : o.phase === 'arrive' ? '電車がまいります' : '';
    const text = JSON.stringify([rows, status]);
    if (text === b.text) return;
    b.text = text;
    const x = c.getContext('2d');
    x.fillStyle = '#0d0f12'; x.fillRect(0, 0, 640, 208);
    x.fillStyle = d.color || '#0b8f4d'; x.fillRect(0, 0, 640, 46);
    x.fillStyle = '#fff'; x.textBaseline = 'middle'; x.textAlign = 'left'; x.font = `bold 28px ${FONT}`;
    x.fillText(`${d.code}番線  ${d.name.replace(/^\S+番線 /, '')}`, 14, 24);
    x.textAlign = 'right'; x.font = `bold 24px ${FONT}`; x.fillText(d.dir || '', 626, 24);
    rows.forEach(([k, time, to, cars], i) => {
      const y = 76 + i * 50;
      x.textAlign = 'left'; x.font = `bold 22px ${FONT}`; x.fillStyle = '#9aa2aa'; x.fillText(i ? '次発' : '先発', 12, y);
      x.font = `bold 30px ${FONT}`; x.fillStyle = k === '普通' ? '#e8eef2' : '#ff5a4f'; x.fillText(k, 72, y);
      x.fillStyle = '#ffb02e'; x.fillText(time, 160, y); x.fillText(to.slice(0, 9), 268, y);
      x.textAlign = 'right'; x.fillStyle = '#e8eef2'; x.fillText(cars, 626, y);
    });
    x.textAlign = 'center'; x.font = `bold 26px ${FONT}`; x.fillStyle = '#ffb02e'; x.fillText(status, 320, 184);
    t.needsUpdate = true;
  };
  let acc = 1;
  return { list: boards, update(dt) { acc += dt; if (acc < 0.5) return; acc = 0; for (const b of boards) draw(b); } };
}
