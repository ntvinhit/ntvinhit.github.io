---
title: "Graph Engineering, Explained — Building multi-agent systems as a Graph"
date: 2026-08-18
lang: "en"
private: false
draft: false
description: "A TL;DR + detail walkthrough of Lunar's 'Graph Engineering: The Complete Guide to Building Multi-Agent AI Systems', with the original figures."
tags: ["agents", "multi-agent", "graph-engineering", "orchestration", "workflows"]
translation_of: "graph-engineering-explained"
based_on: ["graph-engineering-the-complete-guide-to-building-multi-agent-ai-systems"]
references: []
---

> This post explains **Graph Engineering: The Complete Guide to Building
> Multi-Agent AI Systems** by [@LunarResearcher](https://x.com/LunarResearcher)
> in a TL;DR + detail style for easier reading. The original article (verbatim)
> lives in the References section below.

**TL;DR:** When you have more than one agent, the hardest problem is no longer
making each agent smarter — it is deciding **how the work moves**: what runs in
parallel, what depends on what, what data crosses each edge, and where a human
must hold the gate.

---

## 1. A workflow is not a checklist

**Problem:** People write steps in order, so the system runs them in order.

**Wrong example:**
1. Inspect competitor pricing
2. Inspect customer reviews
3. Inspect product docs
4. Write a market brief

The first three **do not need each other** — they only need to finish before
step four.

**The right way to think:** draw real dependencies, not written order.

**The wrong Graph — sequential because it was written sequentially:**
```
inspect pricing → inspect reviews → inspect docs → write brief
```
This is a straight line. The first three steps don't depend on each other, yet
they wait for each other → you pay `t1 + t2 + t3` before step four.

**The right Graph — keep only real dependencies:**
```
inspect pricing ──────┐
                      │
inspect reviews ──────┼──→ write brief
                      │
inspect docs ─────────┘
```
The first three run in parallel; you only wait for the slowest one
`max(t1, t2, t3)` before merging into step four. Same work, much less total time.

**The deciding question:** *"What information must exist before this can start?"*

**Quick test:**
- `extract invoices → calculate total`: the invoice values cross → **real dependency**.
- `review file A → review file B`: nothing crosses → **fake dependency, delete the edge**.

The goal is not to maximize parallelism — it is to **remove fake synchronization**.

---

## 2. The Graph needs state, not just arrows

**Problem:** Agents return a huge blob of text, and the next agent must "figure
out" that blob. Works in a demo, collapses in a real system.

**Right example — structured state:**
```json
{
  "claim": "Product X is 30% cheaper than us",
  "evidence": "Public pricing page: Pro $49/month vs our $70/month",
  "source": "https://competitor.com/pricing",
  "confidence": 0.9,
  "timestamp": "2026-08-17T10:00:00Z"
}
```

Structured state gives you three things:
1. **Replaceability** — swap a worker without breaking downstream.
2. **Inspectability** — see exactly what entered and left each node.
3. **Determinism around the model** — the inside of the box may be fuzzy, but the interface stays strict.

**Rule:** *The agent can improvise. The Graph should not.*

---

## 3. The dependency test

**Problem:** You add an agent because it "feels needed", without defining what it
receives and returns.

**Test:** for every arrow, ask *"What exact data crosses this edge?"*

**Bad answer:** "The next agent should know the previous one finished." → that is
*status*, not dependency.

**Good answer:** "The reviewer receives `claim`, `source_url`, and
`evidence_excerpt` from the researcher." → now the edge means something.

---

## 4. Parallelism is not free

**Problem:** Discovering parallelism → going overboard: 20 workers → 200 → 2000.
The Graph gets wider, **and the bill gets wider too**.

**Hidden costs when the Graph is too wide:**
- duplicated research
- conflicting outputs
- rate limits
- merge pressure
- more verification
- more context at the final stage

**Rule:** only add width when the extra worker increases *coverage* more than it
increases *reconciliation cost*.

**The unit to optimize:** *useful independent coverage per dollar*, not "number of agents".

---

## 5. The critical path matters more than total steps

**Problem:** Looking at a diagram with many boxes and thinking "more is slower".
Wrong.

**Numeric example:**
```
8s + 12s + 6s + 10s + 9s = 45 seconds (sequential)
```
If four tasks are independent, you only wait for the slowest one (~12s) then merge.

**Critical path** = the longest unavoidable path from start to finish. It
determines latency. Everything off the critical path is an optimization
opportunity.

**This explains why:** a 40-node Graph can finish faster than a 7-node chain.

![Graph — critical path](/references/graph-engineering-the-complete-guide-to-building-multi-agent-ai-systems/HPMmGV7XcAAlfuc.jpg) <!-- image original: https://pbs.twimg.com/media/HPMmGV7XcAAlfuc.jpg -->

---

## 6. Compress before you reason

**Problem:** The most expensive mistake — stuffing all raw outputs into one final
synthesis prompt, turning your smartest model into a "garbage collector".

**Solution — put a reducer before synthesis:**
```
workers
   ↓
deterministic reduce (plain code, not another agent)
   ↓
reasoning / synthesis
```

**What a reducer does (all in code):** deduplicate IDs, sort by timestamp, group
by source, drop malformed records, count votes, normalize labels, remove exact
duplicates.

**Rule:** *Use models for ambiguity. Use code for plumbing.*

---

## 7. Verification should be asymmetric

**Problem:** A worker defending its own answer → confirmation bias.

**The difference in objective:**
- **Worker:** "Find the strongest answer."
- **Verifier:** "Find the reason this answer should be rejected."

**Example for code:**
- Worker: implement the change.
- Verifier: try to break it — run tests, inspect edge cases, look for regressions.

**The key point:** the verifier must have permission to **kill output**, otherwise
it is decoration.

---

## 8. Design failure domains before the Graph runs

**Problem:** Distributed work always fails somewhere. The question: *"How much of
the Graph should die with one node?"*

**Standard policy:**
```
ON FAILURE:
1. retry once
2. retry with a fallback model/tool
3. return a structured failure
4. continue if quorum is still sufficient
5. block only if this node is critical
```

**The important distinction:** *resilience* (keeps running) vs *silent
incompleteness* (hides missing work). **Degrade visibly** — report "only 9/10 completed".

---

## 9. Human approval is an edge, not a node

**Problem:** Most people model the human as `AI → human → AI`. But the human is
usually **not doing work** — they are **granting permission for state to cross a
boundary**.

**Right example:**
```
draft campaign
      ↓
quality checks
      ↓
[ HUMAN APPROVAL ]   ← edge condition, not a node
      ↓
publish
```

The `publish` node must be **unreachable** in the architecture until approval
exists — not "the model was instructed to ask first".

**Irreversible actions that need a human gate:** sending money, deploying code,
emailing customers, deleting data, changing permissions, publishing externally.

---

## 10. Some rules should be frozen

**Problem:** Agents are optimization machines. If "success" means shipping faster,
they will weaken review.

**Frozen constraints (outside optimization):**
```
never publish without approval
never cite a source that was not opened
never mark a test as passed unless it executed
never exceed the spend cap
never modify production credentials
```

**Rule:** *A smart optimizer inside weak boundaries becomes dangerous faster.
Inside strong boundaries it becomes useful faster.*

---

## 11. Observe the Graph, not the chat

**Problem:** A chat transcript is a terrible dashboard for a distributed system.

**Seven metrics worth tracking:**
- **Critical-path latency** — the longest dependency chain.
- **Node failure rate** — which workers fail most often.
- **Retry rate** — a Graph that "succeeds" after four retries per node is unhealthy.
- **Verifier kill rate** — 0% = useless verifier; 80% = poorly scoped workers.
- **Fan-out efficiency** — how many parallel workers produced unique useful info.
- **Compression ratio** — how much raw material is removed before synthesis.
- **Human intervention rate** — where people still rescue the system manually.

---

## 12. Five Graph shapes worth knowing

**1. Fork / Join** — split then merge (research, audit, batch analysis).

**2. Escalation Ladder** — cheap check → medium check → strong model/human.

**3. Tournament** — multiple candidates → judge → winner.

**4. Map → Reduce → Verify → Synthesize** — decision-grade research.

**5. Bounded Discovery Loop** — has a stopping rule (no new findings for N rounds /
max spend / max time). Without a stopping rule, a loop is a **leak**.

**Rule:** *The budget is part of the topology.*

---

## 13. Write the Graph spec before the prompts

**Problem:** People write twenty prompts first, then think about structure.
Backwards.

**The standard Graph spec:**
```
GOAL:           What must exist at the end?
INPUT STATE:    What structured data enters the Graph?
PARALLEL WORK:  Which tasks are truly independent?
EDGE DATA:      What exact information crosses each dependency?
REDUCER:        What can be normalized/deduped/ranked/filtered with code?
VERIFICATION:   What independent test can reject weak output?
FAILURE POLICY: What retries? What fallback? What can fail without killing the run?
BUDGET:         Max agents? Max tokens/cost? Max wall-clock time?
HUMAN GATE:     Which irreversible actions require approval?
OUTPUT:         What exact schema or artifact is returned?
```

**Rule:** *Prompts optimize nodes. The spec optimizes the system.*

---

## 14. When you should NOT build a Graph

**Use a single agent when:**
- the task is small
- each step genuinely depends on the previous one
- you are still exploring the problem
- coordination cost exceeds the work
- you need one coherent perspective, not broad coverage
- the human wants to steer every intermediate step

**What a Graph does NOT automatically buy:** taste, truth, and a good task
definition.

---

## Summary — "The real shift"

The evolution:
```
prompt engineering → tool use → loops → orchestration
```

The question is no longer *"how do I make the model smarter?"* but:
- What can run at the same time?
- What state should be shared? What should **never** be shared?
- What gets verified?
- What happens when a worker dies?
- What is allowed to continue?
- Where does cost explode?
- Where does a human still hold the key?

**The closing line:** *More agents are not the answer. Better topology is.*
