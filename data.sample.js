// GTD 資料檔範例（實際使用的檔案是同資料夾的 gtd-data.js，不進版控）
// 欄位：date 起始日 YYYY-MM-DD；done 是否完成；text 事項；end 結束日（有才是跨日事項）；color 色名（可省略）；strikeout 為 true 才有，文字畫刪除線
// color 可用：mint teal sky lavender yellow amber coral pink gray brown dgray；已過期或已勾選的事項會自動顯示成較淺的顏色
// weeks 為顯示週數（3~8）；items 依 date 倒序，同一天內由上而下就是畫面順序
window.GTD_DATA = {
  "weeks": 7,
  "items": [
    {"date": "2026-10-23", "done": true, "text": "寄合約"},
    {"date": "2026-10-21", "done": false, "text": "高雄出差", "end": "2026-10-23", "color": "coral"},
    {"date": "2026-10-20", "done": false, "text": "買牛奶"}
  ]
};
