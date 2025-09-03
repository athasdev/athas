# Tentative Vision for Athas

We want to build an opinionated IDE that is free and open, but also modular and [malleable](https://www.inkandswitch.com/essay/malleable-software/).

As users of many editors and IDEs, we also see the pain points of each.
Our goal is to take the good parts of each and put them all together in a single editor.

## Zed

**GPUI is great, but not everyone knows Rust or are willing to learn it to making UI changes.**

Athas aims to bring the speed of Rust to a React + TypeScript frontend, technologies that many users are already familiar with.

This way, it becomes easier to onboard new contributors and community developers to create extensions and themes, without having to learn Rust to customize UIs.

## VSCode

**Feels more like an editor with extensions than an IDE. Also, Electron**

We like the extensibility, but not so much the whole browser in a desktop app. We can just use the native OS webview.

Athas aims to create a **code** editor, not an **editor** that can be used for code.

We also don't like `settings.json`, there must be a better way.

## Neovim

**Modular and fast, but ships too few core features.**

Too few core features means overreliance on third-party plugins to create the full IDE experience.

Siloed plugin development often leads to compounding performance issues.

Athas aims to deliver core features out-of-the-box for more cohesion, maintained by the core team, with room for extensions.

## JetBrains

**5GB per IDE is a bit much, but understandable because most of them are paid**

Most of their IDEs have the same borrowed look, just with different tools for different languages and tech stacks.

Even though there are community plugins to support other languages in IntelliJ, it just doesn't have the same first-class experience as the official features, which makes sense because that's their main selling point.

But we love JetBrains' tooling though, so we would like to combine all those into 1 single editor.

## Cursor, Windsurf, AI Editors (VSCode forks)

**There is joy in building, not forking VSCode**

We build because it's fun, we're not trying to get into YC.

There is also less technical debt to inherit when starting from scratch.
