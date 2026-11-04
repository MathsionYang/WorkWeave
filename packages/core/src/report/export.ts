import { basename, dirname, join } from "node:path";
import { rename, unlink, writeFile } from "node:fs/promises";

export async function exportReportAtomic(targetPath: string, content: string | Buffer): Promise<string> {
  const dir = dirname(targetPath);
  const tempPath = join(dir, `.${basename(targetPath)}.${process.pid}.${Date.now()}.tmp`);

  await writeFile(tempPath, content);
  try {
    await rename(tempPath, targetPath);
  } catch (error) {
    await unlink(tempPath).catch(() => undefined);
    throw error;
  }
  return targetPath;
}