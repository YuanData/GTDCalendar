// 線上 DEMO 的範例資料（GitHub Pages 用）。
// d 是「與今天相差幾天」，載入時由 app.js 換算成實際日期，所以範例永遠落在目前這幾週。
// end 也是相差天數（必須大於 d）。其餘欄位同 data.sample.js。
window.GTD_DEMO = {
  "weeks": 6,
  "items": [
    {"d": -9, "done": true, "text": "交季度報告", "color": "gray"},
    {"d": -6, "done": true, "text": "牙醫回診"},
    {"d": -4, "done": false, "text": "台中客戶拜訪", "end": -2, "color": "amber"},
    {"d": -1, "done": false, "text": "回覆供應商報價", "color": "sky"},
    {"d": 0, "done": false, "text": "買牛奶"},
    {"d": 0, "done": true, "text": "寄合約", "color": "mint"},
    {"d": 0, "done": false, "text": "雙擊可以編輯，滑過可刪除", "color": "lavender"},
    {"d": 1, "done": false, "text": "專案週會 10:00", "color": "teal"},
    {"d": 2, "done": false, "text": "高雄出差", "end": 4, "color": "coral"},
    {"d": 3, "done": false, "text": "取消的會議", "color": "dgray", "strikeout": true},
    {"d": 6, "done": false, "text": "拖曳事項到其他天試試"},
    {"d": 8, "done": false, "text": "繳信用卡費", "color": "yellow"},
    {"d": 10, "done": false, "text": "年度健檢", "end": 11, "color": "pink"},
    {"d": 14, "done": false, "text": "朋友生日聚餐", "color": "brown"},
    {"d": 17, "done": false, "text": "整理下季計畫", "end": 21, "color": "sky"}
  ]
};
