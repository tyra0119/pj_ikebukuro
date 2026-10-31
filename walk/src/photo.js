// 写真の街並み: 地上の歩道・道路の床に国土地理院の航空写真（シームレス空中写真）を貼り、地上の建物を PLATEAU の建物（LOD2・写真の模様付き 3D Tiles）に替える。
// 作り方は Ekishirube（../Ekishirube の src/view3d.js の addPhotoCity・groundPhoto・tileMatrix）を参考にした（利用者 2026-10-30「地上の 3D 建物と、写真の貼り付けは、
// Ekishirube を参考にして」）。重いので「写真の街並み」を押したときだけ読み込む。当たり判定は今の建物の壁（bwall）のまま。
// タイルの一覧は data/<駅>-tiles.json（tools/plateau-tiles.mjs）。
import * as THREE from 'three';

const JSM = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/';
const CREDIT = '航空写真: 国土地理院（シームレス空中写真）／ 建物: 3D 都市モデル（Project PLATEAU）国土交通省 建築物モデル LOD2';

// light: スマホ。建物は近く（here() から NEAR m）のタイルだけ、空中写真はズーム 17 にする（全部で約 85 MB あり、スマホでは重すぎて読み込みが終わらないことがある。2026-10-30 利用者「読み込み中から進まない」）
export function initPhoto({ scene, data, groundZ, stationKey, setStatus, onCredit, light = false, here = () => [0, 0] }) {
  const NEAR = 150; // スマホで建物を読む範囲（m）。タイルは 1 枚 約 220 × 130 m で、150 m なら 8 枚前後・約 17 MB（全部は 46 枚・約 85 MB）
  const st = { on: false, loading: null, ground: null, city: null, tex: null };
  const origin = data.origin; // { lat, lon }
  const D = Math.PI / 180, a = 6378137, e2 = 6.69437999014e-3;
  const phi = origin.lat * D, w = Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const KX = D * (a / w) * Math.cos(phi), KY = D * ((a * (1 - e2)) / w ** 3); // build/lib.mjs と同じ（1 度あたりの m）
  const floorMeshes = () => ['groundFloor', 'groundRoad'].map((n) => scene.getObjectByName(n)).filter(Boolean), bldgMesh = () => scene.getObjectByName('groundBldg');

  // 地面の航空写真: ±450 m にかかる地理院タイル（ズーム 18、多ければ 17）を 1 枚の画像に並べる
  function groundPhoto(box) {
    const lon0 = origin.lon + box[0] / KX, lon1 = origin.lon + box[2] / KX, lat0 = origin.lat + box[1] / KY, lat1 = origin.lat + box[3] / KY;
    const tx = (lon, z) => ((lon + 180) / 360) * 2 ** z;
    const ty = (lat, z) => { const r = lat * D; return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z; };
    const lonOf = (x, z) => (x / 2 ** z) * 360 - 180;
    const latOf = (y, z) => { const n = Math.PI * (1 - (2 * y) / 2 ** z); return Math.atan(Math.sinh(n)) / D; };
    let z = light ? 17 : 18, x0, x1, y0, y1;
    for (; z >= 16; z--) { x0 = Math.floor(tx(lon0, z)); x1 = Math.floor(tx(lon1, z)); y0 = Math.floor(ty(lat1, z)); y1 = Math.floor(ty(lat0, z)); if (Math.max(x1 - x0, y1 - y0) < 12) break; }
    const c = document.createElement('canvas'); c.width = (x1 - x0 + 1) * 256; c.height = (y1 - y0 + 1) * 256;
    const cx = c.getContext('2d'), tex = new THREE.CanvasTexture(c), jobs = [];
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    for (let X = x0; X <= x1; X++) for (let Y = y0; Y <= y1; Y++) jobs.push(new Promise((ok) => {
      const im = new Image(); im.crossOrigin = 'anonymous';
      im.onload = () => { cx.drawImage(im, (X - x0) * 256, (Y - y0) * 256); tex.needsUpdate = true; ok(); };
      im.onerror = () => ok();
      im.src = `https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/${z}/${X}/${Y}.jpg`;
    }));
    // 画像の範囲（局所平面 m）: 西・東・南・北
    const ext = { w: (lonOf(x0, z) - origin.lon) * KX, e: (lonOf(x1 + 1, z) - origin.lon) * KX, s: (latOf(y1 + 1, z) - origin.lat) * KY, n: (latOf(y0, z) - origin.lat) * KY };
    return { tex, ext, canvas: c, ready: Promise.all(jobs) };
  }
  // 地上の床（groundFloor）に、位置から求めた写真の座標を付けて写真を貼る（出口の階段の口はあいたまま）
  function applyGround(g) { for (const m of floorMeshes()) applyGroundTo(m, g); }
  function applyGroundTo(m, g) {
    const pos = m.geometry.attributes.position, uv = new Float32Array(pos.count * 2), W = g.ext.e - g.ext.w, H = g.ext.n - g.ext.s;
    for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), y = -pos.getZ(i); uv[i * 2] = (x - g.ext.w) / W; uv[i * 2 + 1] = (y - g.ext.s) / H; }
    if (!m.userData.tileUv) m.userData.tileUv = m.geometry.attributes.uv;
    m.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (!m.userData.tileMat) m.userData.tileMat = m.material;
    m.material = new THREE.MeshLambertMaterial({ map: g.tex });
  }
  function restoreGround() {
    for (const m of floorMeshes()) { if (!m.userData.tileMat) continue; m.material = m.userData.tileMat; m.geometry.setAttribute('uv', m.userData.tileUv); }
  }

  // 3D Tiles（b3dm の中の glb）を読む
  let loader = null;
  async function ensureLoader() {
    if (loader) return loader;
    const [{ GLTFLoader }, { DRACOLoader }] = await Promise.all([import(JSM + 'loaders/GLTFLoader.js'), import(JSM + 'loaders/DRACOLoader.js')]);
    const d = new DRACOLoader(); d.setDecoderPath(JSM + 'libs/draco/');
    loader = new GLTFLoader(); loader.setDRACOLoader(d);
    return loader;
  }
  async function loadTile(url) {
    const buf = await fetch(url).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); });
    const dv = new DataView(buf); let glb = buf, center = [0, 0, 0];
    if (dv.getUint32(0, true) === 0x6d643362) { // 'b3dm'
      const ftj = dv.getUint32(12, true), off = 28 + ftj + dv.getUint32(16, true) + dv.getUint32(20, true) + dv.getUint32(24, true);
      if (ftj) { const ft = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 28, ftj))); if (ft.RTC_CENTER) center = ft.RTC_CENTER; }
      glb = buf.slice(off);
    }
    const gv = new DataView(glb), jl = gv.getUint32(12, true), json = JSON.parse(new TextDecoder().decode(new Uint8Array(glb, 20, jl)));
    if (json.extensions && json.extensions.CESIUM_RTC) center = json.extensions.CESIUM_RTC.center;
    const g = await new Promise((ok, ng) => loader.parse(glb, '', ok, ng));
    return { scene: g.scene, center };
  }
  const ecef = (lat, lon, h) => { const p = lat * D, l = lon * D, sp = Math.sin(p), N = a / Math.sqrt(1 - e2 * sp * sp); return new THREE.Vector3((N + h) * Math.cos(p) * Math.cos(l), (N + h) * Math.cos(p) * Math.sin(l), (N * (1 - e2) + h) * sp); };
  // タイル（glTF は y が上。3D Tiles では ECEF = 中心 + (x, -z, y)）を、局所平面（x 東・y 上・z 南。この画面の three.js の向き）に置く行列。
  // 局所平面は 1 度あたりの長さを楕円体の曲率半径で決めているので、東・北の向きの倍率は 1
  function tileMatrix(center) {
    const p = origin.lat * D, l = origin.lon * D, sp = Math.sin(p), cp = Math.cos(p), sl = Math.sin(l), cl = Math.cos(l);
    const R = new THREE.Matrix4().set(-sl, cl, 0, 0, cp * cl, cp * sl, sp, 0, sp * cl, sp * sl, -cp, 0, 0, 0, 0, 1);
    const o = ecef(origin.lat, origin.lon, 0), T = new THREE.Matrix4().makeTranslation(center[0] - o.x, center[1] - o.y, center[2] - o.z);
    const Y = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1);
    return R.multiply(T).multiply(Y);
  }

  async function load() {
    const list = await fetch(`data/${stationKey}-tiles.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!list || !list.tiles.length) throw new Error('この駅には写真の街並みのデータがありません');
    st.list = list; st.loaded = new Map(); st.yOff = null;
    st.ground = groundPhoto(list.box);
    st.ground.ready.then(() => { if (st.on) applyGround(st.ground); });
    await ensureLoader();
    const grp = new THREE.Group(); grp.name = 'photoCity'; grp.matrixAutoUpdate = true;
    st.city = grp;
    await addTiles(light ? wanted(NEAR) : list.tiles.map((_, i) => i), true);
    setStatus('');
  }
  // here() から r m 以内にかかるタイルの番号（範囲の無いタイルは常に）
  function wanted(r) {
    const [hx, hy] = here();
    return st.list.tiles.map((t, i) => (t.length < 6 || Math.max(t[2] - hx, 0, hx - t[4]) ** 2 + Math.max(t[3] - hy, 0, hy - t[5]) ** 2 <= r * r ? i : -1)).filter((i) => i >= 0);
  }
  // スマホ: 歩いて動いたら、近くのタイルを読み足し、遠くなったタイルは捨てる（app.js が数秒ごとに呼ぶ）
  async function update() {
    if (!light || !st.on || !st.city || st.busy) return;
    const near = new Set(wanted(NEAR)), keep = new Set(wanted(NEAR + 150));
    for (const [i, h] of st.loaded) if (!keep.has(i)) { st.city.remove(h); h.traverse((o) => { if (!o.isMesh) return; o.geometry.dispose(); if (o.material.map) o.material.map.dispose(); o.material.dispose(); }); st.loaded.delete(i); }
    const add = [...near].filter((i) => !st.loaded.has(i));
    if (add.length) await addTiles(add, false);
  }
  async function addTiles(idx, status) {
    st.busy = true;
    const list = st.list, grp = st.city;
    let done = 0;
    if (status) setStatus(`写真の街並みを読み込み中（0/${idx.length}）`);
    const tiles = await Promise.all(idx.map((i) => loadTile(list.bases[list.tiles[i][0]] + list.tiles[i][1]).then((r) => { done++; if (status) setStatus(`写真の街並みを読み込み中（${done}/${idx.length}）`); return r; }, () => { done++; return null; })));
    const holders = [];
    tiles.forEach((r, k) => {
      if (!r) return;
      const holder = new THREE.Group(); holder.matrixAutoUpdate = false; holder.matrix.copy(tileMatrix(r.center));
      holder.add(r.scene); grp.add(holder); st.loaded.set(idx[k], holder); holders.push(holder);
    });
    grp.updateMatrixWorld(true);
    const mins = [];
    for (const h of holders) h.traverse((o) => {
      if (!o.isMesh) return;
      if (st.yOff == null) { // 地面の高さ: 建物ごとのいちばん低い点（楕円体高）の中央値を、この画面の地上の床の高さにそろえる（はじめに読んだタイルで決める）
        const p = o.geometry.attributes.position, id = o.geometry.attributes._batchid || o.geometry.attributes._feature_id_0, lo = {}, v = new THREE.Vector3();
        for (let k = 0; k < p.count; k++) { v.fromBufferAttribute(p, k).applyMatrix4(o.matrixWorld); const b = id ? id.getX(k) : 0; if (!(b in lo) || v.y < lo[b]) lo[b] = v.y; }
        for (const b of Object.keys(lo)) mins.push(lo[b] - grp.position.y);
      }
      const old = o.material;
      if (old.map) old.map.colorSpace = THREE.SRGBColorSpace;
      o.material = new THREE.MeshLambertMaterial({ map: old.map || null, color: old.map ? 0xffffff : 0xd9d2c8, side: THREE.DoubleSide });
      old.dispose();
      o.name = 'photoBldg';
    });
    if (st.yOff == null && mins.length) { mins.sort((p, q) => p - q); st.yOff = groundZ - mins[Math.floor(mins.length / 2)]; }
    grp.position.y = st.yOff || 0;
    // JR の 1F・2F の構内（駅の建物の中）にかかる建物は外す: 建物（batch）ごとの足元の点のうち 2 割以上が JR の 1F・2F の面の中なら、その建物の三角形を落とす
    // （駅ビルの箱の中に JR の構内が入っていて、構内を歩くと駅ビルの壁の中に入った）
    if (!st.jrUp) st.jrUp = [...(data.floors || []), ...(data.blocks || [])].filter((f) => f.l >= 1).map((f) => { const r = f.r[0]; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]); } return { r: f.r, bb: [x0, y0, x1, y1] }; });
    const pip = (ring, x, y) => { let c = false; for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) { const xi = ring[i], yi = ring[i + 1], xj = ring[j], yj = ring[j + 1]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
    const exitPts = (data.ramps || []).filter((r) => r.exit).flatMap((r) => [r.a, r.b, [(r.a[0] + r.b[0]) / 2, (r.a[1] + r.b[1]) / 2]]).concat((data.pstairs || []).filter((st) => st.hi[2] > groundZ - 2.5).map((st) => st.hi)); // 出口の階段（坂の両端と真ん中、地上のすぐ下まで上る階段の上の端）
    const inJrUp = (x, y) => st.jrUp.some((f) => x >= f.bb[0] && x <= f.bb[2] && y >= f.bb[1] && y <= f.bb[3] && f.r.some((r) => pip(r, x, y)));
    let dropped = 0;
    grp.updateMatrixWorld(true);
    for (const h of holders) h.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry, p = g.attributes.position, id = g.attributes._batchid || g.attributes._feature_id_0; if (!id) return;
      const v = new THREE.Vector3(), cnt = {}, inn = {}, bb = {};
      for (let k = 0; k < p.count; k++) { const b = id.getX(k); v.fromBufferAttribute(p, k).applyMatrix4(o.matrixWorld); cnt[b] = (cnt[b] || 0) + 1; if (inJrUp(v.x, -v.z)) inn[b] = (inn[b] || 0) + 1; const r = bb[b] || (bb[b] = [Infinity, Infinity, -Infinity, -Infinity]); r[0] = Math.min(r[0], v.x); r[1] = Math.min(r[1], -v.z); r[2] = Math.max(r[2], v.x); r[3] = Math.max(r[3], -v.z); }
      // 出口の階段にかぶさる小さな建物（200 m² 未満。PLATEAU では出口の上屋が閉じた箱で、階段の上にふたをし、中から見ると頭のすぐ上に底が見えた。池袋の出口 39。2026-10-31）も外す
      const onExit = (b) => { const r = bb[b]; return (r[2] - r[0]) * (r[3] - r[1]) < 200 && exitPts.some(([x, y]) => x > r[0] - 0.5 && x < r[2] + 0.5 && y > r[1] - 0.5 && y < r[3] + 0.5); };
      const drop = new Set(Object.keys(cnt).filter((b) => (inn[b] || 0) >= cnt[b] * 0.2 || onExit(b)).map(Number)); if (!drop.size) return;
      const ix = g.index ? Array.from(g.index.array) : Array.from({ length: p.count }, (_, i) => i), keep = [];
      for (let t = 0; t < ix.length; t += 3) { if (drop.has(id.getX(ix[t]))) continue; keep.push(ix[t], ix[t + 1], ix[t + 2]); }
      g.setIndex(keep); dropped += drop.size;
    });
    if (dropped) console.log('写真の街並み: JR の 1F・2F にかかる建物を外した', dropped);
    // 建物の底の面（3 つの角がどれも地上の床から 0.3 m 以内）を外す。道からは見えず、出口の階段の上にかかる建物の底が、階段の中から見上げるとふたになった（池袋の出口 39。2026-10-31）
    grp.updateMatrixWorld(true);
    let bottoms = 0;
    for (const h of holders) h.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry, p = g.attributes.position, v = new THREE.Vector3(), low = new Uint8Array(p.count);
      for (let k = 0; k < p.count; k++) { v.fromBufferAttribute(p, k).applyMatrix4(o.matrixWorld); low[k] = v.y < groundZ + 0.3 ? 1 : 0; }
      const ix = g.index ? Array.from(g.index.array) : Array.from({ length: p.count }, (_, i) => i), keep = [];
      for (let t = 0; t < ix.length; t += 3) { if (low[ix[t]] && low[ix[t + 1]] && low[ix[t + 2]]) { bottoms++; continue; } keep.push(ix[t], ix[t + 1], ix[t + 2]); }
      if (keep.length !== ix.length) g.setIndex(keep);
    });
    if (bottoms) console.log('写真の街並み: 建物の底の面を外した', bottoms);
    // 出口の上屋（data.exitBoxes。地上のすぐ下まで上る階段のまわり）の中の、地上から 3 m までの写真の建物の面も外す（出口 39 は建物の中にあり、建物の壁が上屋の中を横切った）
    // 出口の坂（地上へ出る階段）の長方形（上の端の 1.5 m 先まで、横は幅の半分 + 0.5 m）も同じく外す（建物の壁が出口の口をふさいだ）
    const rampBoxes = (data.ramps || []).filter((r) => r.exit).map((r) => { const L = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]) || 1, ux = (r.b[0] - r.a[0]) / L, uy = (r.b[1] - r.a[1]) / L, hw = r.w / 2 + 0.5, ex = r.b[0] + ux * 1.5, ey = r.b[1] + uy * 1.5; return [r.a[0] - uy * hw, r.a[1] + ux * hw, ex - uy * hw, ey + ux * hw, ex + uy * hw, ey - ux * hw, r.a[0] + uy * hw, r.a[1] - ux * hw]; });
    const boxes = [...(data.exitBoxes || []), ...rampBoxes];
    if (boxes.length) {
      // 三角形を切る: 地上から 3 m の高さで上下に分け、下の部分から箱（凸多角形）の中を除く。写真の建物の壁の三角形は大きく、真ん中の点だけで見ると外れた。
      // 頂点の値（位置・テクスチャの座標など）は辺の上で按分する
      const zTop = groundZ + 3, polys = boxes.map((r) => { const P = []; for (let i = 0; i < r.length; i += 2) P.push([r[i], r[i + 1]]); let a = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } const bb = [Math.min(...P.map((p) => p[0])), Math.min(...P.map((p) => p[1])), Math.max(...P.map((p) => p[0])), Math.max(...P.map((p) => p[1]))]; return { P, sg: a > 0 ? 1 : -1, bb }; });
      const lerp = (p, q, t) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, z: p.z + (q.z - p.z) * t, a: p.a.map((v, i) => v.map((c, k) => c + (q.a[i][k] - c) * t)) });
      const split = (poly, f) => { const inn = [], out = []; for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length], fp = f(p), fq = f(q); if (fp >= 0) inn.push(p); if (fp <= 0) out.push(p); if ((fp > 0 && fq < 0) || (fp < 0 && fq > 0)) { const m = lerp(p, q, fp / (fp - fq)); inn.push(m); out.push(m); } } return [inn, out]; };
      let clipped = 0;
      for (const h of holders) h.traverse((o) => {
        if (!o.isMesh) return;
        const g = o.geometry, pos = g.attributes.position, names = Object.keys(g.attributes), A = names.map((n) => g.attributes[n]), M = o.matrixWorld, v = new THREE.Vector3();
        const ix = g.index ? Array.from(g.index.array) : Array.from({ length: pos.count }, (_, i) => i);
        const vert = (k) => { v.fromBufferAttribute(pos, k).applyMatrix4(M); return { x: v.x, y: -v.z, z: v.y, a: A.map((at) => Array.from({ length: at.itemSize }, (_, c) => at.getComponent(k, c))) }; };
        // 先に頂点の位置だけ世界の座標にして、箱にかかる三角形を探す（全部の三角形で頂点の値を作ると、読み込みが止まったように遅くなった）
        const W = new Float32Array(pos.count * 3);
        for (let k = 0; k < pos.count; k++) { v.fromBufferAttribute(pos, k).applyMatrix4(M); W[k * 3] = v.x; W[k * 3 + 1] = -v.z; W[k * 3 + 2] = v.y; }
        const hitOf = (t) => {
          const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
          if (Math.min(W[a + 2], W[b + 2], W[c + 2]) >= zTop) return null;
          const x0 = Math.min(W[a], W[b], W[c]), x1 = Math.max(W[a], W[b], W[c]), y0 = Math.min(W[a + 1], W[b + 1], W[c + 1]), y1 = Math.max(W[a + 1], W[b + 1], W[c + 1]);
          const h = polys.filter((q) => !(x0 > q.bb[2] || x1 < q.bb[0] || y0 > q.bb[3] || y1 < q.bb[1]));
          return h.length ? h : null;
        };
        const hits = []; for (let t = 0; t < ix.length; t += 3) { const h = hitOf(t); if (h) hits.push([t, h]); }
        if (!hits.length) return;
        const out = []; let touched = false, hi = 0;
        for (let t = 0; t < ix.length; t += 3) {
          const tri = [vert(ix[t]), vert(ix[t + 1]), vert(ix[t + 2])];
          const hit = hi < hits.length && hits[hi][0] === t ? hits[hi++][1] : null;
          if (!hit) { out.push(tri); continue; }
          let [low, up] = split(tri, (p) => zTop - p.z); // low: zTop より下
          const keep = up.length >= 3 ? [up] : [];
          let pieces = low.length >= 3 ? [low] : [];
          for (const b of hit) {
            const next = [];
            for (const pc of pieces) {
              let inside = [pc];
              for (let e = 0; e < b.P.length; e++) {
                const p0 = b.P[e], p1 = b.P[(e + 1) % b.P.length], f = (p) => b.sg * ((p1[0] - p0[0]) * (p.y - p0[1]) - (p1[1] - p0[1]) * (p.x - p0[0]));
                const nin = []; for (const c of inside) { const [i2, o2] = split(c, f); if (i2.length >= 3) nin.push(i2); if (o2.length >= 3) next.push(o2); } inside = nin;
              }
              if (inside.length) touched = true;
            }
            pieces = next;
          }
          for (const pc of [...keep, ...pieces]) for (let i = 1; i + 1 < pc.length; i++) out.push([pc[0], pc[i], pc[i + 1]]);
        }
        if (!touched) return;
        clipped++;
        const ng = new THREE.BufferGeometry(), inv = new THREE.Matrix4().copy(M).invert();
        names.forEach((n, ai) => {
          const at = A[ai], arr = new Float32Array(out.length * 3 * at.itemSize);
          let w = 0; for (const tr of out) for (const p of tr) for (let c = 0; c < at.itemSize; c++) arr[w++] = p.a[ai][c];
          ng.setAttribute(n, new THREE.BufferAttribute(arr, at.itemSize, at.normalized));
        });
        void inv;
        o.geometry = ng;
      });
      if (clipped) console.log('写真の街並み: 出口の上屋・坂にかかる写真の建物を切った部品', clipped);
    }
    st.busy = false;
  }

  async function set(on) {
    st.on = on;
    if (on) {
      try { if (!st.city) await (st.loading = st.loading || load()); }
      catch (e) { st.on = false; st.loading = null; setStatus(e.message || '写真の街並みを読み込めませんでした'); setTimeout(() => setStatus(''), 4000); return false; }
      if (!st.on) return false;
      scene.add(st.city);
      const b = bldgMesh(); if (b) b.visible = false;
      if (st.ground) st.ground.ready.then(() => { if (st.on) applyGround(st.ground); });
      onCredit(CREDIT);
    } else {
      if (st.city) scene.remove(st.city);
      const b = bldgMesh(); if (b) b.visible = true;
      restoreGround();
      onCredit(null);
    }
    return st.on;
  }
  return { set, update, get on() { return st.on; }, get ground() { return st.on && st.ground ? st.ground : null; } }; // ground: 小さな地図の 1F に敷く航空写真
}
