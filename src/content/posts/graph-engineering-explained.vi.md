---
title: "Graph Engineering diễn giải — Xây hệ thống multi-agent như một Graph"
date: 2026-08-18
lang: "vi"
private: false
draft: false
description: "Diễn giải lại bài 'Graph Engineering: The Complete Guide to Building Multi-Agent AI Systems' của Lunar theo phong cách TL;DR + chi tiết, kèm hình gốc."
tags: ["agents", "multi-agent", "graph-engineering", "orchestration", "workflows"]
translation_of: "graph-engineering-explained"
based_on: ["graph-engineering-the-complete-guide-to-building-multi-agent-ai-systems"]
references: []
---

> Bài viết này diễn giải lại bài gốc **Graph Engineering: The Complete Guide to
> Building Multi-Agent AI Systems** của [@LunarResearcher](https://x.com/LunarResearcher).
> Đây là bản tóm lược theo phong cách **TL;DR + chi tiết** để dễ đọc; bài gốc
> (giữ nguyên văn) nằm ở mục References bên dưới.

**TL;DR:** Khi có nhiều hơn một agent, bài toán khó nhất không phải làm từng
agent thông minh hơn — mà là quyết định **công việc di chuyển thế nào**: cái gì
chạy song song, cái gì phụ thuộc nhau, dữ liệu gì chạy qua từng cạnh, và chỗ nào
cần con người chặn lại.

---

## 1. Workflow không phải checklist

**Vấn đề:** Người ta viết các bước theo thứ tự, rồi hệ thống chạy tuần tự vì
chúng được viết theo thứ tự đó.

**Ví dụ sai:**
1. Nghiên cứu giá sản phẩm đối thủ
2. Nghiên cứu đánh giá khách hàng
3. Nghiên cứu tài liệu sản phẩm
4. Viết market brief

Ba bước đầu **không cần nhau** — chúng chỉ cần xong trước bước 4.

**Cách nghĩ đúng:** vẽ dependency thực sự, không phải thứ tự viết.

**Graph SAI — chạy tuần tự vì được viết tuần tự:**
```
inspect pricing → inspect reviews → inspect docs → write brief
```
Đây là một đường thẳng. Ba bước đầu không phụ thuộc nhau, nhưng vẫn phải chờ nhau
→ tốn `t1 + t2 + t3` trước khi tới bước 4.

**Graph ĐÚNG — chỉ giữ dependency thật:**
```
inspect pricing ──────┐
                      │
inspect reviews ──────┼──→ write brief
                      │
inspect docs ─────────┘
```
Ba bước đầu chạy song song, chỉ cần chờ bước chậm nhất `max(t1, t2, t3)` rồi gộp
vào bước 4. Cùng một công việc, nhưng tổng thời gian giảm hẳn.

**Câu hỏi quyết định:** *"Thông tin nào phải tồn tại trước khi bước này bắt đầu
được?"*

**Test nhanh:**
- `extract invoices → calculate total`: giá trị hóa đơn chạy qua → **dependency thật**.
- `review file A → review file B`: không có gì chạy qua → **fake dependency, xóa cạnh**.

Mục tiêu không phải tối đa song song, mà là **loại bỏ fake synchronization** —
những chỗ chờ đợi không cần thiết.

---

## 2. Graph cần state, không chỉ mũi tên

**Vấn đề:** Agent trả về blob text dài, agent tiếp theo phải "tự hiểu" blob đó.
Chạy được ở demo, sụp đổ ở hệ thống thật.

**Ví dụ đúng — structured state:**
```json
{
  "claim": "Sản phẩm X rẻ hơn chúng ta 30%",
  "evidence": "Trang pricing công khai: gói Pro $49/tháng vs của ta $70/tháng",
  "source": "https://competitor.com/pricing",
  "confidence": 0.9,
  "timestamp": "2026-08-17T10:00:00Z"
}
```

Structured state cho 3 thứ:
1. **Replaceability** — thay worker không phá phần sau.
2. **Inspectability** — thấy rõ dữ liệu vào/ra từng node.
3. **Determinism quanh model** — bên trong hộp mờ được, interface ngoài thì chặt.

**Nguyên tắc:** *Agent có thể ứng biến. Graph thì không.*

---

## 3. Dependency test

**Vấn đề:** Bạn thêm agent vì "cảm thấy cần", nhưng không định nghĩa được nó
nhận gì và trả gì.

**Test:** với mỗi mũi tên, hỏi *"dữ liệu chính xác nào chạy qua cạnh này?"*

**Trả lời tệ:** "Agent sau nên biết agent trước đã xong." → đó là *status*, không
phải dependency.

**Trả lời tốt:** "Reviewer nhận `claim`, `source_url`, và `evidence_excerpt` từ
researcher." → giờ cạnh có nghĩa.

---

## 4. Parallelism không miễn phí

**Vấn đề:** Phát hiện chạy song song được → phóng đại: 20 worker → 200 → 2000.
Graph rộng ra, **hóa đơn cũng rộng ra**.

**Chi phí ẩn khi Graph quá rộng:**
- research trùng lặp
- output mâu thuẫn
- rate limit
- áp lực merge
- nhiều verification hơn
- nhiều context ở giai đoạn cuối

**Nguyên tắc:** chỉ thêm width khi worker mới tăng *coverage* nhiều hơn tăng
*reconciliation cost*.

**Đơn vị tối ưu:** *useful independent coverage per dollar*, không phải "số agent".

---

## 5. Critical path quan trọng hơn tổng số bước

**Vấn đề:** Nhìn diagram nhiều box và nghĩ "càng nhiều càng chậm". Sai.

**Ví dụ con số:**
```
8s + 12s + 6s + 10s + 9s = 45 giây (tuần tự)
```
Nếu 4 task độc lập, chỉ cần chờ task chậm nhất (~12s) rồi merge.

**Critical path** = đường dài nhất không thể tránh từ start đến finish. Đường đó
quyết định latency. Mọi thứ ngoài critical path đều là cơ hội tối ưu.

**Điều này giải thích:** một graph 40 node có thể nhanh hơn một chain 7 node.

![Graph — critical path](/references/graph-engineering-the-complete-guide-to-building-multi-agent-ai-systems/HPMmGV7XcAAlfuc.jpg) <!-- image original: https://pbs.twimg.com/media/HPMmGV7XcAAlfuc.jpg -->

---

## 6. Compress trước khi reason

**Vấn đề:** Đây là lỗi tốn kém nhất — nhồi toàn bộ raw output vào một prompt
tổng hợp cuối cùng, biến model giỏi nhất thành "garbage collector".

**Giải pháp — đặt reducer trước synthesis:**
```
workers
   ↓
deterministic reduce (code thuần, không phải agent)
   ↓
reasoning / synthesis
```

**Reducer làm gì (toàn bằng code):** deduplicate IDs, sort theo timestamp, group
theo source, drop record malformed, count votes, normalize labels, xóa duplicate.

**Nguyên tắc:** *Dùng model cho ambiguity, dùng code cho plumbing.*

---

## 7. Verification phải bất đối xứng

**Vấn đề:** Worker tự bảo vệ đáp án của mình → confirmation bias.

**Sự khác biệt mục tiêu:**
- **Worker:** "Tìm đáp án mạnh nhất."
- **Verifier:** "Tìm lý do để loại bỏ đáp án này."

**Ví dụ cho code:**
- Worker: implement thay đổi.
- Verifier: tìm cách phá nó — chạy test, kiểm tra edge case, tìm regression.

**Điểm then chốt:** verifier phải có quyền **kill output**, nếu không nó chỉ là
trang trí.

---

## 8. Thiết kế failure domain trước khi chạy

**Vấn đề:** Distributed work luôn fail ở đâu đó. Câu hỏi: *"Bao nhiêu phần của
graph sẽ chết theo một node fail?"*

**Chính sách chuẩn:**
```
ON FAILURE:
1. retry once
2. retry với fallback model/tool
3. return structured failure
4. tiếp tục nếu quorum vẫn đủ
5. block chỉ khi node này critical
```

**Khác biệt quan trọng:** *resilience* (vẫn chạy) vs *silent incompleteness*
(giấu việc thiếu). **Degrade visibly** — báo rõ "chỉ 9/10 hoàn thành".

---

## 9. Human approval là một edge, không phải node

**Vấn đề:** Đa số model con người như `AI → human → AI`. Nhưng con người thường
**không làm việc** — họ đang **cấp phép cho state vượt qua một biên giới**.

**Ví dụ đúng:**
```
draft campaign
      ↓
quality checks
      ↓
[ HUMAN APPROVAL ]   ← edge condition, không phải node
      ↓
publish
```

Node `publish` phải **không thể reach** về mặt kiến trúc cho đến khi approval tồn
tại — không phải "nhắc model hỏi trước".

**Các hành động không thể đảo ngược cần human gate:** gửi tiền, deploy code,
email khách hàng, xóa data, đổi permissions, publish ra ngoài.

---

## 10. Một số rule phải "đóng băng"

**Vấn đề:** Agent là cỗ máy tối ưu hóa. Nếu "thành công" = ship nhanh hơn, nó sẽ
yếu dần bước review.

**Frozen constraints (nằm ngoài vòng tối ưu):**
```
never publish without approval
never cite a source that was not opened
never mark a test as passed unless it executed
never exceed the spend cap
never modify production credentials
```

**Nguyên tắc:** *Smart optimizer inside weak boundaries → dangerous faster. Inside
strong boundaries → useful faster.*

---

## 11. Quan sát graph, không phải chat

**Vấn đề:** Transcript chat là dashboard tệ cho hệ phân tán.

**Bảy metric đáng theo dõi:**
- **Critical-path latency** — đường dependency dài nhất.
- **Node failure rate** — worker nào fail nhiều nhất.
- **Retry rate** — graph "thành công" sau bao nhiêu retry.
- **Verifier kill rate** — 0% = verifier vô dụng; 80% = worker scoped kém.
- **Fan-out efficiency** — bao nhiêu worker tạo thông tin hữu ích.
- **Compression ratio** — bao nhiêu raw bị lọc trước synthesis.
- **Human intervention rate** — chỗ nào người còn phải cứu thủ công.

---

## 12. Năm hình dạng graph đáng nhớ

**1. Fork / Join** — chia rồi gộp (research, audit, batch analysis).

**2. Escalation Ladder** — cheap check → medium check → strong model/human.

**3. Tournament** — nhiều candidate → judge → winner.

**4. Map → Reduce → Verify → Synthesize** — research cấp quyết định.

**5. Bounded Discovery Loop** — có stopping rule (hết finding N vòng / max spend /
max time). Không có stopping rule, loop là **leak**.

**Nguyên tắc:** *The budget is part of the topology.*

---

## 13. Viết graph spec trước khi viết prompt

**Vấn đề:** Người ta viết 20 prompt trước, rồi mới nghĩ đến cấu trúc. Ngược rồi.

**Graph spec chuẩn:**
```
GOAL:           Cuối cùng phải tồn tại cái gì?
INPUT STATE:    Dữ liệu structured nào đi vào graph?
PARALLEL WORK:  Task nào thật sự độc lập?
EDGE DATA:      Thông tin chính xác nào chạy qua từng dependency?
REDUCER:        Cái gì có thể normalize/dedupe/rank/filter bằng code?
VERIFICATION:   Test độc lập nào có thể loại output yếu?
FAILURE POLICY: Retry gì? Fallback gì? Cái gì fail không giết run?
BUDGET:         Max agents? Max tokens/cost? Max wall-clock time?
HUMAN GATE:     Hành động không đảo ngược nào cần approval?
OUTPUT:         Schema/artifact chính xác trả về là gì?
```

**Nguyên tắc:** *Prompts optimize nodes. The spec optimizes the system.*

---

## 14. Khi nào KHÔNG nên dựng graph

**Dùng một agent khi:**
- Task nhỏ
- Mỗi bước thật sự phụ thuộc bước trước
- Bạn còn đang khám phá bài toán
- Chi phí điều phối > công việc
- Cần một góc nhìn nhất quán, không phải coverage rộng
- Con người muốn điều khiển từng bước trung gian

**Điều graph KHÔNG tự mua được:** taste, truth, và định nghĩa task tốt.

---

## Tổng kết — "The real shift"

Sự tiến hóa:
```
prompt engineering → tool use → loops → orchestration
```

Câu hỏi không còn là *"làm sao cho model thông minh hơn?"* mà là:
- Cái gì chạy song song?
- State gì được chia sẻ? State gì **không bao giờ** được chia sẻ?
- Cái gì được verify?
- Chuyện gì xảy ra khi worker chết?
- Cái gì được phép tiếp tục?
- Chi phí bùng nổ ở đâu?
- Con người còn giữ chìa khóa ở đâu?

**Câu kết:** *More agents are not the answer. Better topology is.*
