---
title: "How to Build an AI That Never Stops Learning"
date: 2026-08-03
lang: "en"
private: false
draft: false
author:
  name: "rvaniaaa"
  handle: "rvaniaaaa"
original_url: "https://x.com/rvaniaaaa/status/2075975822461084061"
published_date: 2026-07-11
fetched_date: 2026-08-03
has_attachments: true
description: "How one engineer built a self-improving AI agent pipeline that scans GitHub, extracts reusable workflows, and converts them into Agent Skills — with a human as the final reviewer."
tags: ["ai-agents", "github", "agent-skills", "pipeline", "self-improvement"]
images_original: ["https://pbs.twimg.com/media/HM9Uu7PW0AA1jho.jpg", "https://pbs.twimg.com/media/HM9X2KlW4AAr0Tb.jpg"]
cover_image: "/references/how-to-build-an-ai-that-never-stops-learning/HM9Uu7PW0AA1jho.jpg"
---

Every AI agent stops improving the moment you stop improving it. Not because the models stop getting better. Because new workflows, architectures and engineering tricks never reach your agent on their own.

They're buried inside thousands of GitHub repositories. Somewhere, there's already a workflow your agent has never seen. Finding it is still a human job.

Open the repository. Read the code. Figure out what's actually new. Decide whether it's worth keeping. Then teach the agent manually.

That never made sense to me.

If an AI can write code, review pull requests and use tools, why can't it discover new skills by itself?

So I built a system that does exactly that. It continuously scans GitHub, extracts reusable workflows, converts them into Agent Skills and expands its own capabilities without waiting for a human to update it.

Here's how I built it.

## High-Level Architecture

Before diving into the individual agents, here's the complete system at a high level.

At first glance, it looks like a single pipeline. In reality, each agent has exactly one responsibility and passes its output to the next stage. That separation keeps every component simple, makes the pipeline easier to maintain and allows individual agents to improve without changing the rest of the system.

![Image](/references/how-to-build-an-ai-that-never-stops-learning/HM9X2KlW4AAr0Tb.jpg) <!-- image original: https://pbs.twimg.com/media/HM9X2KlW4AAr0Tb.jpg -->

Instead of solving everything with one giant prompt, the pipeline breaks the problem into eight smaller steps. Each agent does one job well, passes structured output to the next stage and never needs to understand the entire system.

Every agent has one job. That's what makes the entire system reliable.

Everything starts with discovery.

## 1. Scout

Every pipeline starts with one question: where do new ideas come from?

For this system, the answer is GitHub. The Scout agent continuously monitors GitHub Trending and targeted GitHub searches, looking for repositories that may contain new AI workflows, agent architectures and engineering patterns. It doesn't read repositories or judge their quality. Its only job is to discover candidates and pass them to the next stage.

Instead of describing the search abstractly, here's what one query looks like in practice. 

```
Query:
("agent framework" OR langgraph OR mcp OR "multi-agent")

Filters:
stars:>100
pushed:>2026-06-01
language:Python
archived:false
sort:updated-desc
```

A discovered repository already looks like a structured object before any model sees it.

```json
{
  "name": "awesome-mcp-server",
  "stars": 842,
  "language": "Python",
  "last_updated": "2026-07-09T14:32:00Z",
  "status": "QUEUED"
}
```

Input

- GitHub Trending
- GitHub Search

Output

- List of newly discovered repositories

## 2. Filter

Finding repositories is easy. Finding useful ones is not.

Most repositories have nothing to do with reusable AI workflows. Running the rest of the pipeline on games, CSS frameworks, datasets or starter templates would only waste compute and model tokens. Before a repository ever reaches an LLM, the Filter removes everything that obviously isn't relevant.

Instead of asking a model to classify every repository, the Filter applies a small set of deterministic rules first.

A typical decision looks like this.

```json
{
  "repository": "awesome-mcp-server",
  "category": "AI Agent",
  "language": "Python",
  "decision": "KEEP",
  "reason": "Contains reusable agent workflows"
}
```

Rejected repositories look exactly the same.

```json
{
  "repository": "css-animation-library",
  "category": "CSS",
  "language": "TypeScript",
  "decision": "REJECT",
  "reason": "Outside AI workflow scope"
}
```

The goal isn't to make a perfect decision. It's to eliminate the obvious noise so the expensive stages spend their time where they actually matter.

## 3. Reader

The Reader is one of the most important agents in the entire pipeline.

Most repository analyzers jump straight into the source code. That's usually the slowest way to understand a project. Well-structured repositories explain their architecture long before you need to understand the implementation, so the Reader always follows the same sequence.

```
README
   ↓
docs/
   ↓
examples/
   ↓
package.json
   ↓
requirements.txt
   ↓
source code
```

The Reader only moves to the next step when the previous one doesn't provide enough information. In many cases, the documentation and examples already explain the workflow well enough, allowing the pipeline to skip most of the source code entirely.

Documentation explains intent. Code explains implementation. You almost always need the first before the second.

Good repositories teach you before their code ever does.

Rather than dumping an entire repository into the model, the Reader builds context incrementally.

```json
{
  "repository": "langgraph-agent",
  "context_loaded": [
    "README",
    "docs/workflows.md",
    "examples/basic_agent.py"
  ],
  "source_code_loaded": false,
  "decision_reason": "Workflow identified before code analysis."
}
```

This simple ordering reduces both token usage and unnecessary reasoning. Instead of learning implementation details first, the system focuses on understanding how the project actually works.

## 4. Workflow Extractor

This is the heart of the entire system.

The goal isn't to understand the repository. It's to discover a workflow worth reusing.

If the answer is no, the repository leaves the pipeline immediately. If the answer is yes, the workflow is extracted into a standardized structure that every downstream agent can understand.

Instead of returning placeholders, the Extractor produces a complete workflow another agent could execute immediately.

```json
{
  "skill_name": "github-pr-reviewer",
  "goal": "Review GitHub pull requests before merge",
  "inputs": [
    "Pull Request URL",
    "Repository Context"
  ],
  "steps": [
    "Read changed files",
    "Identify risky modifications",
    "Check coding standards",
    "Generate review comments"
  ],
  "outputs": [
    "Review Summary",
    "Action Items"
  ],
  "failure_modes": [
    "Missing project context",
    "Large architectural refactor"
  ]
}
```

If no reusable workflow is found, the repository is rejected.

Everything else is just implementation detail.

Reusable workflows outlive the repositories they came from.

From this point on, the pipeline no longer works with repositories. It works with reusable workflows.

## 5. Skill Score

Not every workflow deserves to become an Agent Skill.

Before anything is generated, every extracted workflow goes through the same objective evaluation. Instead of asking another model whether a workflow "looks good," the system checks a fixed set of rules. Not every decision should be made by an LLM. Some decisions are simply better expressed as deterministic rules.

Every workflow is evaluated against the following criteria.

<img src="https://abs.twimg.com/emoji/v2/svg/2705.svg" alt="emoji" class="inline-emoji" />

| Check              | Result |
| ----------------- | :--: |
| README exists     |   ✅  |
| Examples exist    |   ✅  |
| ≥3 workflow steps |   ✅  |
| Reusable          |   ✅  |
| General purpose   |   ✅  |
| Confidence > 0.85 |   ✅  |


If any required rule fails, the workflow is rejected. The result is returned as structured data instead of free-form text.

```json
{
  "skill_name": "github-pr-reviewer",
  "score": 0.94,
  "checks": {
    "readme": true,
    "examples": true,
    "min_steps": true,
    "reusable": true,
    "general_purpose": true
  },
  "decision": "PASS"
}
```

Which becomes:

```
Result

PASS

Confidence: 94%
```

This is one of the few places where I deliberately avoided relying on an LLM. A simple rule engine is faster, cheaper and far more predictable than asking a model to make the same decision repeatedly.

## 6. Skill Generator

Once a workflow passes every check, it becomes an Agent Skill.

The Skill Generator transforms the extracted workflow into a standardized package that another agent can install immediately. Every generated Skill follows exactly the same format, regardless of which repository it came from.

A generated Skill looks like this.

```yaml
name: github-pr-reviewer
version: 1.0.0

description: Review GitHub pull requests and generate actionable feedback.

inputs:
  - github_pull_request
  - repository_context

steps:
  - Read changed files
  - Identify risky modifications
  - Verify coding standards
  - Generate review comments

outputs:
  - review_summary
  - review_comments

tags:
  - github
  - code-review
  - engineering
```

Alongside the Skill definition, the generator also creates supporting files.

```
github-pr-reviewer/
├── SKILL.md
├── examples.md
├── commands.md
├── metadata.json
└── tests.md
```

Standardization is what makes the library useful. A workflow extracted from a LangGraph project and one extracted from an MCP server may look completely different internally, but once they're converted into the same format, the agent can use both without caring where they came from.

## 7. Reviewer

The Reviewer has only one responsibility: decide whether a Skill is worth publishing.

Unlike the previous agents, it doesn't generate or modify anything. The agent that writes the Skill should never decide whether it's good. Keeping generation and review separate makes the pipeline much more reliable.

The prompt is intentionally simple.

```
Would an experienced engineer install this Skill without editing it?

Answer only:

YES or NO

Explain your reasoning in one paragraph.

Point out any missing assumptions or unclear steps.

If NO, suggest the minimum changes required for approval.

Do not rewrite the entire Skill.
```

A typical review looks like this.

```json
{
  "decision": "YES",
  "confidence": 0.96,
  "reason": "The workflow is reusable, clearly documented and can be applied outside the original repository."
}
```

If the answer is NO, the pipeline stops.

If the answer is YES, the Skill moves to the final stage.

## 8. Publisher

Once a Skill is approved, everything else is automation.

The Publisher prepares the release without ever touching the main branch. Every approved Skill follows exactly the same publishing process.

```
GitHub Action
      ↓
Create Branch
      ↓
Commit Skill Package
      ↓
Open Pull Request
      ↓
Assign Reviewer
```

The resulting pull request already contains everything needed for review.

```
Title:
Add Skill: github-pr-reviewer

Files:
✓ SKILL.md
✓ examples.md
✓ commands.md
✓ metadata.json
✓ tests.md
```

Nothing is merged automatically.

Automation proposes. Humans approve.

The pipeline discovers repositories, extracts reusable workflows, generates Skills and prepares pull requests. The final decision always belongs to a human reviewer.

## Conclusion

Today, every new capability has to be discovered by a person before an AI can use it.

That's the bottleneck this system is designed to remove.

Instead of waiting for someone to discover a repository, understand it, extract the workflow and manually turn it into an Agent Skill, the entire process becomes a pipeline. New repositories are discovered automatically, reusable workflows are extracted, weak ideas are filtered out and only the strongest Skills reach the final review.

The goal isn't to replace engineers. It's to eliminate repetitive work so they can focus on problems that actually require human judgment. Engineers should decide which ideas matter, not spend hours digging through hundreds of repositories looking for them.

Today, AI can already write code.

The next generation of agents won't be trained once. They'll keep learning from software that humans build every day.

This pipeline is my attempt to make that happen.

Maybe you'll build a better one.
