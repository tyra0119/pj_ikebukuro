// 写真の街並み: 地上の歩道・道路の床に国土地理院の航空写真（シームレス空中写真）を貼り、地上の建物を PLATEAU の建物（LOD2・写真の模様付き 3D Tiles）に替える。
// 作り方は Ekishirube（../Ekishirube の src/view3d.js の addPhotoCity・groundPhoto・tileMatrix）を参考にした（利用者 2026-10-30「地上の 3D 建物と、写真の貼り付けは、
// Ekishirube を参考にして」）。重いので「写真の街並み」を押したときだけ読み込む。当たり判定は今の建物の壁（bwall）のまま。
// タイルの一覧は data/<駅>-tiles.json（tools/plateau-tiles.mjs）。
import * as THREE from 'three';

const JSM = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/';
const CREDIT = '航空写真: 国土地理院（シームレス空中写真）／ 建物: 3D 都市モデル（Project PLATEAU）国土交通省 建築物モデル LOD2';

export function initPhoto({ scene, data, groundZ, stationKey, setStatus, onCredit }) {
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
    let z = 18, x0, x1, y0, y1;
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
    st.ground = groundPhoto(list.box);
    st.ground.ready.then(() => { if (st.on) applyGround(st.ground); });
    await ensureLoader();
    let done = 0;
    setStatus(`写真の街並みを読み込み中（0/${list.tiles.length}）`);
    const tiles = await Promise.all(list.tiles.map(([b, rel]) => loadTile(list.bases[b] + rel).then((r) => { done++; setStatus(`写真の街並みを読み込み中（${done}/${list.tiles.length}）`); return r; }, () => { done++; return null; })));
    const grp = new THREE.Group(), mins = [];
    for (const r of tiles) {
      if (!r) continue;
      const holder = new THREE.Group(); holder.matrixAutoUpdate = false; holder.matrix.copy(tileMatrix(r.center));
      holder.add(r.scene); grp.add(holder);
    }
    grp.updateMatrixWorld(true);
    // 地面の高さ: 建物ごとのいちばん低い点（楕円体高）の中央値を、この画面の地上の床の高さにそろえる
    grp.traverse((o) => {
      if (!o.isMesh) return;
      const p = o.geometry.attributes.position, id = o.geometry.attributes._batchid || o.geometry.attributes._feature_id_0, lo = {}, v = new THREE.Vector3();
      for (let k = 0; k < p.count; k++) { v.fromBufferAttribute(p, k).applyMatrix4(o.matrixWorld); const b = id ? id.getX(k) : 0; if (!(b in lo) || v.y < lo[b]) lo[b] = v.y; }
      for (const b of Object.keys(lo)) mins.push(lo[b]);
      const old = o.material;
      if (old.map) old.map.colorSpace = THREE.SRGBColorSpace;
      o.material = new THREE.MeshLambertMaterial({ map: old.map || null, color: old.map ? 0xffffff : 0xd9d2c8, side: THREE.DoubleSide });
      o.name = 'photoBldg';
    });
    mins.sort((p, q) => p - q);
    grp.position.y = groundZ - (mins.length ? mins[Math.floor(mins.length / 2)] : 0);
    // JR の 1F・2F の構内（駅の建物の中）にかかる建物は外す: 建物（batch）ごとの足元の点のうち 2 割以上が JR の 1F・2F の面の中なら、その建物の三角形を落とす
    // （駅ビルの箱の中に JR の構内が入っていて、構内を歩くと駅ビルの壁の中に入った）
    const jrUp = [...(data.floors || []), ...(data.blocks || [])].filter((f) => f.l >= 1).map((f) => { const r = f.r[0]; let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); y0 = Math.min(y0, r[i + 1]); y1 = Math.max(y1, r[i + 1]); } return { r: f.r, bb: [x0, y0, x1, y1] }; });
    const pip = (ring, x, y) => { let c = false; for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) { const xi = ring[i], yi = ring[i + 1], xj = ring[j], yj = ring[j + 1]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
    const inJrUp = (x, y) => jrUp.some((f) => x >= f.bb[0] && x <= f.bb[2] && y >= f.bb[1] && y <= f.bb[3] && f.r.some((r) => pip(r, x, y)));
    let dropped = 0;
    grp.updateMatrixWorld(true);
    grp.traverse((o) => {
      if (!o.isMesh) return;
      const g = o.geometry, p = g.attributes.position, id = g.attributes._batchid || g.attributes._feature_id_0; if (!id) return;
      const v = new THREE.Vector3(), cnt = {}, inn = {};
      for (let k = 0; k < p.count; k++) { const b = id.getX(k); v.fromBufferAttribute(p, k).applyMatrix4(o.matrixWorld); cnt[b] = (cnt[b] || 0) + 1; if (inJrUp(v.x, -v.z)) inn[b] = (inn[b] || 0) + 1; }
      const drop = new Set(Object.keys(cnt).filter((b) => (inn[b] || 0) >= cnt[b] * 0.2).map(Number)); if (!drop.size) return;
      const idx = g.index ? Array.from(g.index.array) : Array.from({ length: p.count }, (_, i) => i), keep = [];
      for (let t = 0; t < idx.length; t += 3) { if (drop.has(id.getX(idx[t]))) continue; keep.push(idx[t], idx[t + 1], idx[t + 2]); }
      g.setIndex(keep); dropped += drop.size;
    });
    console.log('写真の街並み: JR の 1F・2F にかかる建物を外した', dropped);
    grp.name = 'photoCity';
    st.city = grp;
    setStatus('');
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
  return { set, get on() { return st.on; }, get ground() { return st.on && st.ground ? st.ground : null; } }; // ground: 小さな地図の 1F に敷く航空写真
}
