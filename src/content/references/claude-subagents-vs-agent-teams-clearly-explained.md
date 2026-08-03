---
title: "Claude Subagents vs. Agent Teams, clearly explained"
date: 2026-08-03
lang: "en"
private: false
draft: false
author:
  name: "Avi Chawla"
  handle: "_avichawla"
original_url: "https://x.com/_avichawla/status/2050463606719000627"
published_date: 2026-05-02
fetched_date: 2026-08-03
has_attachments: true
cover_image: "/references/claude-subagents-vs-agent-teams-clearly-explained/HHSuzxwbAAAbn5v.jpg"
description: "A clear explanation of Claude's two multi-agent paradigms — sub-agents and agent teams — and how to choose between them."
tags: ["claude", "multi-agent", "llm", "agent-architecture"]
images_original: ["https://pbs.twimg.com/media/HHSuzxwbAAAbn5v.jpg", "https://pbs.twimg.com/media/HHSu2Y7bwAAVggs.jpg", "https://pbs.twimg.com/media/HHSu5yCaMAA9ri2.jpg", "https://pbs.twimg.com/media/HHSvDGybkAAaGeO.jpg", "https://pbs.twimg.com/media/HHSwvqjbgAA-s-i.jpg", "https://pbs.twimg.com/media/HHSvMfma4AAT9NX.jpg", "https://pbs.twimg.com/media/HHSvPzmaMAAVykf.jpg"]
---

Most people reach for multi-agent systems the moment a task feels complex.

That's almost always the wrong instinct.

The right question isn't "should I use multiple agents?" It's "what kind of coordination does this task actually need?"

The answer to that determines everything about your architecture.

Claude gives you two distinct multi-agent paradigms: sub-agents and agent teams. They look similar on the surface but architecturally, they solve completely different problems.

![Image](/references/claude-subagents-vs-agent-teams-clearly-explained/HHSu2Y7bwAAVggs.jpg) <!-- image original: https://pbs.twimg.com/media/HHSu2Y7bwAAVggs.jpg -->

## Sub-Agents: Parallelism through isolation

A sub-agent is a specialized Claude instance that runs in its own isolated context window.

Here's the mental model: imagine you're a research lead. You don't read every primary source yourself. You delegate focused questions to researchers, they come back with distilled findings, and you synthesize everything into a coherent output.

That's exactly what sub-agents do.

Each sub-agent gets:

- Its own system prompt defining its specialty
- A specific set of tools it can access
- A clean, isolated context window
- One job to do

![Image](/references/claude-subagents-vs-agent-teams-clearly-explained/HHSu5yCaMAA9ri2.jpg) <!-- image original: https://pbs.twimg.com/media/HHSu5yCaMAA9ri2.jpg -->

```python
from claude_agent_sdk import query, ClaudeAgentOptions, AgentDefinition

async def main():
    async for message in query(
        prompt="Review the authentication module for security vulnerabilities",
        options=ClaudeAgentOptions(
            allowed_tools=["Read", "Grep", "Glob", "Agent"],
            agents={
                "security-reviewer": AgentDefinition(
                    description="Security specialist. Use for vulnerability checks and security audits.",
                    prompt="You are a security specialist with expertise in identifying vulnerabilities.",
                    tools=["Read", "Grep", "Glob"],
                    model="sonnet",
                ),
                "performance-optimizer": AgentDefinition(
                    description="Performance specialist. Use for latency issues and optimization reviews.",
                    prompt="You are a performance engineer with expertise in identifying bottlenecks.",
                    tools=["Read", "Grep", "Glob"],
                    model="sonnet",
                ),
            },
        ),
    ):
        print(message)
```

The description field is what tells the parent agent which sub-agent to invoke. Here, the prompt mentions "security vulnerabilities" so the parent routes to security-reviewer, not performance-optimizer.

If the prompt had asked about latency or bottlenecks instead, the other agent would have been picked. The description is the routing signal. Keep it specific.

## Agent Teams: Coordination through communication

Agent teams are a fundamentally different model.

Where sub-agents are short-lived workers that complete a task and disappear, agent teams are long-running instances that persist, communicate directly with each other, and coordinate through shared state.

Think of it like the difference between hiring contractors for isolated tasks vs. assembling a team that works together in the same room.

An agent team has three moving parts:

- A team lead that coordinates work, assigns tasks, and synthesizes results
- Teammates that are independent agent instances, each with their own context window, working in parallel
- A shared task list that tracks what's pending, in progress, and done, along with dependencies between tasks

![Image](/references/claude-subagents-vs-agent-teams-clearly-explained/HHSvDGybkAAaGeO.jpg) <!-- image original: https://pbs.twimg.com/media/HHSvDGybkAAaGeO.jpg -->

A typical lifecycle looks like this:

```plaintext
Claude (Team Lead):
└── spawnTeam("auth-feature")
    Phase 1 - Planning:
    └── spawn("architect", prompt="Design OAuth flow", plan_mode_required=true)
    Phase 2 - Implementation (parallel):
    └── spawn("backend-dev", prompt="Implement OAuth controller")
    └── spawn("frontend-dev", prompt="Build login UI components")
    └── spawn("test-writer", prompt="Write integration tests", blockedBy=["backend-dev"])
```

Notice the blockedBy field on the test writer. That's the shared task list doing real coordination work: the test writer won't start until the backend agent is done, without the lead having to manually manage that sequencing.

The big difference from sub-agents is direct peer-to-peer communication. Teammates can send messages to each other, share findings, surface blockers, and negotiate without routing everything through the lead.

You can also interact with individual teammates directly. You're not forced to go through the lead agent for everything.

## The core distinction

Here's how to think about the choice between them.

![Image](/references/claude-subagents-vs-agent-teams-clearly-explained/HHSwvqjbgAA-s-i.jpg) <!-- image original: https://pbs.twimg.com/media/HHSwvqjbgAA-s-i.jpg -->

Sub-agents are fire-and-forget.

- You give them a task, they complete it, and report back
- No conversation between agents
- No shared memory
- No ongoing state
- Each sub-agent lives and dies within a single session

Agent teams are collaborative.

- Agents persist and accumulate context over time
- Mid-task discoveries surface to teammates immediately
- A frontend agent can tell a backend agent "the API response structure needs to change" and the backend agent adjusts without waiting for the lead to mediate

The clearest way to choose between them:

- Use sub-agents when your work is embarrassingly parallel: independent research streams, codebase exploration, or lookups where the parent only needs the summary
- Use agent teams when your work requires ongoing negotiation: agents that need to reconcile their outputs before proceeding, or where a discovery in one thread changes what another thread should do

## How to design agent systems from first principles

Most multi-agent designs fail because people split work by role instead of by context.

The intuitive instinct is to split by role: planner, implementer, tester. It feels organized. But it creates a telephone game where information degrades at every handoff.

- The implementer doesn't have what the planner knew
- The tester doesn't have what the implementer decided
- Quality drops at every boundary

![Image](/references/claude-subagents-vs-agent-teams-clearly-explained/HHSvMfma4AAT9NX.jpg) <!-- image original: https://pbs.twimg.com/media/HHSvMfma4AAT9NX.jpg -->

The right mental model is context-centric decomposition.

Ask what context does this subtask actually needs? If two subtasks need deeply overlapping information, they probably belong to the same agent. If they can operate with truly isolated information and clean interfaces between them, that's where you split.

A practical example: an agent implementing a feature should also write the tests for that feature. It already has the context. Splitting those two into separate agents creates a handoff problem that costs more than the parallelism saves.

Only separate when context can be genuinely isolated.

## The five orchestration patterns

Regardless of which paradigm you use, these five patterns cover most real-world needs:

![Image](/references/claude-subagents-vs-agent-teams-clearly-explained/HHSvPzmaMAAVykf.jpg) <!-- image original: https://pbs.twimg.com/media/HHSvPzmaMAAVykf.jpg -->

1. Prompt chaining: Sequential steps where each call processes the previous output. Use when order matters and steps are dependent.
2. Routing: A classifier decides which specialized handler gets the task. Easy questions go to cheaper, faster models. Hard questions go to more capable ones. This is how you keep costs from exploding.
3. Parallelization: Independent subtasks run simultaneously. Either the same task runs multiple times for diverse outputs (voting), or different subtasks run at the same time (sectioning).
4. Orchestrator-worker: A central agent breaks down the task, delegates to workers, and synthesizes results. This is the dominant architecture for both sub-agents and agent teams, and what most production systems actually use.
5. Evaluator-optimizer: One agent generates, another evaluates and provides feedback in a loop. Useful when quality matters more than speed and a single pass isn't reliable enough.

## When not to use multi-agent systems

Teams have spent months building elaborate multi-agent pipelines only to discover that better prompting on a single agent achieved equivalent results.

Start simple and add complexity only when you can clearly measure that it's needed.

Multi-agent systems earn their cost in three situations:

- Context protection: A subtask generates information irrelevant to the main task. Keeping it in a sub-agent prevents context bloat.
- True parallelization: Independent research or search tasks that benefit from simultaneous coverage.
- Specialization: The task requires conflicting system prompts, or one agent is juggling so many tools that its performance degrades.

But they're the wrong call when:

- Agents constantly need to share context with each other
- Inter-agent dependencies create more overhead than execution value
- The task is simple enough that one well-prompted agent handles it

One specific warning for coding: parallel agents writing code make incompatible assumptions. When you merge their work, those implicit decisions conflict in ways that are hard to debug. Sub-agents for coding should answer questions and explore, not write code simultaneously with the main agent.

## What makes multi-agent systems fail

Three failure modes show up constantly.

1. Vague task descriptions cause agents to duplicate each other's work.

Every agent needs a clear objective, an expected output format, guidance on what tools or sources to use, and explicit boundaries on what it should not cover. Without this, two agents will research the same thing and neither will notice.

2. Verification agents declare victory without verifying.

Explicit, concrete instructions are non-negotiable: run the full test suite, cover these specific cases, do not mark as complete until each one passes. Vague approval criteria produce false positives.

3. Token costs compound faster than you expect.

The solution is to tier your models intelligently:

- Use your most capable model where it genuinely matters
- Route routine work to faster, cheaper models
- Build in budget controls so costs can't run away unchecked

Design around context boundaries, not around roles or org charts.

Start with a single agent. Push it until you find where it breaks. That failure point tells you exactly what to add next.

Add complexity only where it solves a real, measured problem.

---

That's a wrap!

If you enjoyed this tutorial:

Find me →  [@_avichawla](https://x.com/_avichawla)

Every day, I share tutorials and insights on DS, ML, LLMs, and RAGs.
