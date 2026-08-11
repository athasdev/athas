#!/usr/bin/env bun

import { rm } from "node:fs/promises";
import { GENERATED_CDN_DIR } from "./extension-workspace";

await rm(GENERATED_CDN_DIR, { recursive: true, force: true });

console.log("Cleaned generated extension CDN output.");
