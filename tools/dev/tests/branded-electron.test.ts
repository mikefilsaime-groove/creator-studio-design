import assert from "node:assert/strict";
import test from "node:test";

import {
  prepareBrandedElectronBinary,
  resolveMacElectronAppRoot,
} from "../src/branded-electron.js";

test("resolves a native macOS Electron app root from its executable", () => {
  assert.equal(
    resolveMacElectronAppRoot("/workspace/Electron.app/Contents/MacOS/Electron"),
    "/workspace/Electron.app",
  );
  assert.equal(resolveMacElectronAppRoot("/usr/bin/electron"), null);
});

test("leaves non-macOS Electron binaries unchanged", async () => {
  const binary = "/workspace/electron";
  assert.equal(await prepareBrandedElectronBinary({
    cacheRoot: "/unused",
    iconPath: "/unused/icon.icns",
    platform: "linux",
    sourceBinaryPath: binary,
  }), binary);
});
