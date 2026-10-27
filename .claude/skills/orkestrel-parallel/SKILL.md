---
name: orkestrel-parallel
description: >-
  Coordinate independently owned writer lanes in one checkout through messages, with one runner for checks and an Orchestrator for decisions. Use when implementation units can progress in parallel with disjoint files or explicit regions of shared files. Serialize overlapping edits and hold every input needed for a reliable measurement. Require shared files and a channel that can wake an idle lane.
---

# Load the canonical workflow

Read `.agents/skills/orkestrel-parallel/SKILL.md` completely, then read every reference it requires. Follow that canonical workflow before acting.

This bridge contains no independent process. `AGENTS.md`, applicable rules, the canonical skill, and the governing guide/spec remain authoritative in that order.
