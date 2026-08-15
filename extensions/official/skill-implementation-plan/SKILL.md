---
name: implementation-plan
description: Turn a product request into a concrete, repository-grounded implementation plan.
---

# Implementation Plan

Build the plan from the current repository rather than from assumptions.

## Process

1. Identify the user-visible outcome and the surfaces that must behave consistently.
2. Inspect the owning modules, shared primitives, state boundaries, and nearby tests.
3. Find existing contracts that should be extended instead of creating parallel systems.
4. Resolve important unknowns through read-only investigation.
5. Split the work into independently verifiable steps in dependency order.
6. Name the likely files and validation for each step.
7. Call out migration, compatibility, security, and rollout risks only when they are real.

The final plan should be specific enough that another engineer can implement it without repeating the architectural investigation.
