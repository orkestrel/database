---
name: orkestrel-parallel
description: >-
  Run parallel work: lanes inside one session (subagents, child tasks, background commands) and peer sessions that share a checkout, a machine, or an execution lane. Use when units can progress in parallel, when another session works on the same machine or checkout, or before the first lane on a harness. Bound the host, keep lanes visible, coordinate writers through messages with one runner for checks, and hand a shared execution lane over in one message. Each harness page records its mechanics and quirks; a harness with no page carries no writer or runner lane until its bring-up questions are answered on one.
---

# Load the canonical workflow

Read `.agents/skills/orkestrel-parallel/SKILL.md` completely, then read every reference it requires. Follow that canonical workflow before acting.

Apply `AGENTS.md` § Authority and loading.
