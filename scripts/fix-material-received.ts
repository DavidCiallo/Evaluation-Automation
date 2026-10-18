import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dataDir = "data";
const matFile = join(dataDir, "Material.jsonl");

interface MaterialRow {
  id: string;
  file_ids?: string[];
  received?: boolean;
  [k: string]: unknown;
}

const lines = readFileSync(matFile, "utf-8").split("\n").filter((l) => l.trim());
let changed = 0;
const out = lines.map((line) => {
  const row: MaterialRow = JSON.parse(line);
  if (row.delete_time) return line;
  const hasFile = (row.file_ids || []).length > 0;
  if (hasFile && !row.received) {
    row.received = true;
    row.update_time = Date.now();
    changed++;
    return JSON.stringify(row);
  }
  return line;
});

if (changed > 0) {
  writeFileSync(matFile, out.join("\n") + "\n", "utf-8");
  console.log(`修正 ${changed} 行：有文件但未收 => 已收`);
} else {
  console.log("无需修复：所有有文件的行均已收");
}
