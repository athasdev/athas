# LLM Rules

This document explains the symlink structure used for various LLM models in this repository.

## Symlink Paths

The following symlink files are created to standardize access to the model rules:

- `/GEMINI.md` -> `.rules`
- `/CLAUDE.md` -> `.rules`
- `/.cursorrules` -> `.rules`
- `/.windsurfrules` -> `.rules`
- `/.clinerules` -> `.rules`

## Purpose

The purpose of these symlinks is to provide a consistent way to reference the rules for different LLM models. By pointing all these symlinks to a single `.rules` file, we ensure that any updates to the rules are reflected across all models without the need for duplication.

## Maintenance

When updating the rules for any of the LLM models, simply modify the `.rules` file. The changes will automatically apply to all symlinked paths.
