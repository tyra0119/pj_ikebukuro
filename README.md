# 池袋 統合データ（公開用）

池袋駅のまわりの 4 つのデータ（JR東日本の駅構内・PLATEAU 地下街・OpenStreetMap の地下・国土交通省の地上の歩行空間ネットワーク）を重ねて 1 つにまとめた結果の確認画面と生成物。
ソースは https://github.com/tyra0119/ikebukuro （`npm run publish` の出力だけをここに置く）。

- 確認画面: https://tyra0119.github.io/pj_ikebukuro/
- `data/merged.json` … 画面用（点・線・面・指摘）、`data/merged.geojson` … 点と線（緯度経度・階・標高）、`data/report.md` … 点検結果、`data/issues.json` … 指摘

## 出典

- 東日本旅客鉄道・公共交通オープンデータ協議会「JR東日本 鉄道関連情報 (GTFS-Pathways)」「歩行空間ネットワークデータ」「構内地図データ」（公共交通オープンデータチャレンジ限定ライセンス）を加工
- 3D都市モデル（Project PLATEAU）豊島区（2025年度）国土交通省 — 地下街モデル LOD4 を加工
- © OpenStreetMap contributors（ODbL）
- 国土交通省「歩行空間ネットワークデータ（池袋駅周辺）」（政府標準利用規約 第2.0版）
- 国土地理院 標高API
