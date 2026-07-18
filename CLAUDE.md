# Command Center

Obsidian plugin — personal dashboard. TypeScript + React 18 + esbuild.
Vault: /home/sg8/SilverCenterLife

## About me
- Fedora Linux 44 KDE. Obsidian ติดตั้งแบบ AppImage (ไม่ใช่ Flatpak)
- ผมไม่เคยเขียน TypeScript หรือ React มาก่อน
- อธิบายเป็นภาษาไทยทุกครั้งที่แก้โค้ด และบอกด้วยว่าไฟล์ไหนคุมอะไร
- อย่า refactor หรือเพิ่มฟีเจอร์ที่ผมไม่ได้ขอ

## Hard rules — IMPORTANT
- ห้ามใช้ AppleScript, osascript, Apple Calendar, Apple Notes — macOS only, ผมอยู่บน Linux
- ห้ามใส่ API key ลงไฟล์ใน vault — ใช้ data.json ของปลั๊กอินเท่านั้น
- ปฏิทิน: local-only เท่านั้น ห้ามเพิ่ม calendar sync จนกว่าผมจะสั่ง
- Learn tab: queue มีเพดาน 15 ชิ้น เป็นฟีเจอร์ ไม่ใช่บั๊ก ห้ามเอาออก
- ห้ามใช้ localStorage / sessionStorage — persist ลง markdown ใน vault เท่านั้น

## Design
- Tabs: Client · Build · Inbox · Learn · Inspired (ไม่ใช่ 5 tab เดิมของ build pack)
- Monochrome, #0A0A0B background, glass cards
- ทุก state เก็บเป็น markdown ธรรมดาใน command-center/ — ไม่มี DB

## Known trap
- vault watcher + save-on-change ทำให้เกิดลูป (save → modify event → re-read → save)
  → echo suppression (hash) + debounce 300ms + skipSave ref กันรอบแรกหลัง hydrate
  ทุกไฟล์ใหม่ที่ persist ต้องใช้กลไกนี้ซ้ำ ห้ามสร้างตัวที่สองขนานกัน
  และ dep array ของ save effect ห้ามมีค่าที่เปลี่ยนทุกวินาที (เช่น now)
- setNow(at) ใน timer handler ดูซ้ำซ้อนแต่ห้ามลบ
  now แช่แข็งเมื่อ interval ถูก cleanup (pause/done) ทุกสาขาที่เซ็ต pausedAt = null
  ต้อง setNow ด้วย timestamp ตัวเดียวกับที่เขียนลง state ไม่งั้นเฟรมแรกอ่านเกิน totalSec
  → progress bar width ติดลบ CSS ทิ้ง declaration = แถบเต็มแว้บ
  กัดมาแล้ว 2 รอบ (Start, Resume)

## Commands
- `npm run dev` — esbuild watch, dev build (ปล่อยรันทิ้งไว้)
- `npm run build` — typecheck + minified bundle
- reload Obsidian: Ctrl+R · dev console: Ctrl+Shift+I

## Git / sync — IMPORTANT
- vault นี้ sync ข้ามเครื่องด้วย git → `main.js` ต้อง commit เข้า git เสมอ
  ห้าม ignore main.js เด็ดขาด (.gitignore มีได้ แต่ต้องมีแค่ node_modules/, data.json, .env)
  เครื่องปลายทางไม่มี node_modules/ ถ้าไม่มี main.js ปลั๊กอินจะไม่ทำงาน
- **รัน `npm run build` ก่อน commit ทุกครั้ง** เพื่อให้ main.js ใน git เป็น minified เสมอ
  `npm run dev` เขียน main.js เป็น dev build (inline sourcemap ~24k บรรทัด) ถ้า commit ตอนนั้น
  diff จะเด้ง 24k บรรทัดสลับไปมาทุก commit — เลือกวิธีนี้แทนการ gitignore main.js แล้ว (2026-07-16)

## Phase 6 — ความหมายของเลข (pin ไว้ ห้ามตีความเอง)
- **6a** = อ่าน calendar.md + Day view ✅ เสร็จแล้ว
- **6b** = **Week view — layout ล้วน ยัง read-only ไม่แตะ persistence**
- **6c** = เขียนผ่าน UI — จุดที่ echo-suppression/save กลับมา
  ก่อนเริ่ม 6c ต้องเปลี่ยน `key={i}` ใน DayView (src/app.tsx:369) เป็น id จริงก่อน
  ไม่งั้น React จับคู่แถวผิดตอนลบ/แทรก
- ถ้าสั่งแค่ "ทำ 6b" ให้ยึดนิยามข้างบนนี้ ห้ามเดาว่าเป็น Day view แบบเขียนได้

## Status
- Phase 2 ✅ scaffold + 5 tabs
- Phase 3 ✅ MIT banner + timer — timestamp-derived แล้ว ไม่ได้นับ tick อีกต่อไป
- Phase 5a ✅ mit.md persistence + watcher + echo suppression
- Phase 5b ✅ todos/{tabId}.md + checkbox (wire แล้วเฉพาะ client)
- todo → MIT ✅ คลิกข้อความ todo = promote ขึ้น front seat (checkbox ยังเป็น toggle) · คลิก todo ที่นั่งอยู่แล้ว = no-op (ไม่ถาม ไม่รีเซ็ต ไม่เขียนไฟล์)
- Phase 7 ✅ live feeds บน Build tab (HN + Reddit + tweets.md) — src/data-sources/feeds.ts
  cache 10m TTL + in-flight guard + stale fallback · refresh interval แยกจาก timer 1 วิ · tweets เข้า watcher ตัวเดิม
  runtime verify: เปิด/ปิด view 5 รอบ → MOUNT=CLEANUP interval ไม่งอก ✅ (2026-07-18)
  offline stale ข้าม runtime — มี unit test คุม (stale fallback via Date.now time-travel)
  document.hidden guard: refresh ข้ามรอบเมื่อพับ/minimize Obsidian ประหยัด quota HN/Reddit (2026-07-18)
- Phase 6a ✅ Day view read-only (src/app.tsx:304–424) + parser src/data-sources/calendar.ts
  parser ทิ้ง event ที่ end <= start (เช่น `- 15:00-09:00`) — data layer ส่งเฉพาะที่ layout ได้จริง
  UI ไม่ต้องแบกความรับผิดชอบนั้น สำคัญขึ้นตอน Week view ที่ block เล็กลง (2026-07-19)
- ข้ามไปก่อน: racing seat (4), terminal pane (9), voice (10)
