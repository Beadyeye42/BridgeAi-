import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("native customer-image runtime packaging", () => {
  it("does not initialise sharp while unrelated server routes are loading", () => {
    const source = read("lib/security/customer-image.ts");

    expect(source).not.toContain('import sharp from "sharp"');
    expect(source).toContain('await import("sharp")');
  });

  it("includes sharp and its Linux libvips runtime in server traces", () => {
    const config = read("next.config.ts");
    const packageJson = read("package.json");

    expect(config).toContain("outputFileTracingIncludes");
    expect(config).toContain("@img/sharp-linux-x64/**/*");
    expect(config).toContain("@img/sharp-libvips-linux-x64/**/*");
    expect(packageJson).toContain('"@img/sharp-linux-x64": "0.35.3"');
    expect(packageJson).toContain('"@img/sharp-libvips-linux-x64": "1.3.2"');
  });
});
