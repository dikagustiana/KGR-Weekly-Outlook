#!/usr/bin/env tsx
/**
 * pnpm outlook --week 2026-08-24 --today 2026-08-27 [--blocks 1-7] [--json]
 * Prints the outlook blocks as text so the numbers can be checked without the UI.
 */
import { computeWeek } from "./week";
import { loadFixtureWeek } from "./fixtures";
import { renderText } from "./render";
import { snapshotJson } from "./snapshot";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) return process.argv[i + 1];
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq?.split("=")[1];
}

const week = arg("week") ?? "2026-08-24";
const today = arg("today");
const blocksArg = arg("blocks") ?? "1-8";
const blocks: number[] = [];
for (const part of blocksArg.split(",")) {
  const [a, b] = part.split("-").map(Number);
  for (let i = a; i <= (b ?? a); i++) blocks.push(i);
}

const result = computeWeek(loadFixtureWeek(week, today));
if (process.argv.includes("--json")) process.stdout.write(snapshotJson(result));
else process.stdout.write(renderText(result, blocks) + "\n");
