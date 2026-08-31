import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(here, "../..");

function source(relativePath: string): string {
  return readFileSync(join(desktopRoot, relativePath), "utf8");
}

describe("Creator Studio Design open access", () => {
  it("does not expose an application authentication bridge or IPC handlers", () => {
    const main = source("src/main/index.ts");
    const preload = source("src/main/preload.cts");
    const runtime = source("src/main/runtime.ts");

    for (const contents of [main, preload, runtime]) {
      expect(contents).not.toContain("creatorStudioAuth");
      expect(contents).not.toContain("creator-studio-design:auth");
      expect(contents).not.toContain("CREATORSTUDIO_DESIGN_AUTH");
    }
  });
});
