import { zstdDecompressSync } from "node:zlib";

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

export interface ZstdFramesResult {
  readonly text: string;
  readonly frames: number;
  readonly corrupt: number;
}

export function decompressZstdFrames(buffer: Buffer): ZstdFramesResult {
  const offsets: number[] = [];
  for (let index = 0; index <= buffer.length - MAGIC.length; index += 1) {
    if (
      buffer[index] === MAGIC[0] &&
      buffer[index + 1] === MAGIC[1] &&
      buffer[index + 2] === MAGIC[2] &&
      buffer[index + 3] === MAGIC[3]
    ) {
      offsets.push(index);
    }
  }

  if (offsets.length === 0) {
    try {
      return { text: zstdDecompressSync(buffer).toString("utf8"), frames: 1, corrupt: 0 };
    } catch {
      return { text: "", frames: 0, corrupt: 1 };
    }
  }

  const chunks: Buffer[] = [];
  let corrupt = 0;
  for (let index = 0; index < offsets.length; index += 1) {
    const start = offsets[index] ?? 0;
    const end = offsets[index + 1] ?? buffer.length;
    try {
      chunks.push(zstdDecompressSync(buffer.subarray(start, end)));
    } catch {
      corrupt += 1;
    }
  }

  return {
    text: chunks.map((chunk) => chunk.toString("utf8")).join("\n"),
    frames: offsets.length,
    corrupt
  };
}