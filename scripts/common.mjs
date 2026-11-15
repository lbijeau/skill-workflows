import fs from "node:fs";
import path from "node:path";

export const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function normalizeText(s, { keepNewlines = false } = {}) {
  let out = String(s)
    .replace(/\r\n?/g, "\n")
    .replace(/\t/g, " ")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, " ");
  if (!keepNewlines) out = out.replace(/\n/g, " ");
  return out.replace(/[ ]{2,}/g, " ").trim();
}

// "wx" refuses to follow a pre-existing path (symlink or otherwise) at tmpf,
// so a local attacker who pre-places one at the predictable tmp path gets an
// EEXIST instead of us writing through it.
export function atomicWrite(file, content, mode) {
  const tmpf = `${file}.tmp-${process.pid}`;
  const fd = fs.openSync(tmpf, "wx");
  try {
    fs.writeFileSync(fd, content);
  } finally {
    fs.closeSync(fd);
  }
  try {
    if (mode !== undefined) fs.chmodSync(tmpf, mode);
    fs.renameSync(tmpf, file);
  } catch (e) {
    // Don't litter the tmp file when the chmod/rename leg fails.
    fs.rmSync(tmpf, { force: true });
    throw e;
  }
}
