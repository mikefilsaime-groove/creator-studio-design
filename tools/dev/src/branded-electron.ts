import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, copyFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type BrandedElectronOptions = {
  cacheRoot: string;
  iconPath: string;
  platform?: NodeJS.Platform;
  productName?: string;
  sourceBinaryPath: string;
};

export function resolveMacElectronAppRoot(binaryPath: string): string | null {
  const macosDir = path.dirname(binaryPath);
  if (path.basename(macosDir) !== "MacOS") return null;
  const contentsDir = path.dirname(macosDir);
  if (path.basename(contentsDir) !== "Contents") return null;
  const appRoot = path.dirname(contentsDir);
  return appRoot.toLowerCase().endsWith(".app") ? appRoot : null;
}

/**
 * The downloaded development Electron.app is branded as "Electron" at the
 * native bundle layer. macOS always uses that bundle name for the first menu
 * and process identity, regardless of app.setName(). Build an ignored,
 * ad-hoc-signed clone so local visual QA matches the packaged product identity.
 */
export async function prepareBrandedElectronBinary(
  options: BrandedElectronOptions,
): Promise<string> {
  if ((options.platform ?? process.platform) !== "darwin") return options.sourceBinaryPath;
  const sourceAppRoot = resolveMacElectronAppRoot(options.sourceBinaryPath);
  if (sourceAppRoot == null) return options.sourceBinaryPath;

  const productName = options.productName ?? "Creator Studio Design";
  const targetRoot = path.join(options.cacheRoot, "branded-electron");
  const targetAppRoot = path.join(targetRoot, `${productName}.app`);
  const targetBinaryPath = path.join(targetAppRoot, "Contents", "MacOS", productName);
  const markerPath = path.join(targetRoot, "identity.json");
  const sourcePlistPath = path.join(sourceAppRoot, "Contents", "Info.plist");
  const sourcePlist = await stat(sourcePlistPath);
  const identity = JSON.stringify({
    iconPath: options.iconPath,
    productName,
    sourceAppRoot,
    sourcePlistMtimeMs: sourcePlist.mtimeMs,
    sourcePlistSize: sourcePlist.size,
  });

  const cachedIdentity = await readFile(markerPath, "utf8").catch(() => null);
  if (cachedIdentity === identity) {
    const executable = await access(targetBinaryPath, constants.X_OK)
      .then(() => true)
      .catch(() => false);
    if (executable) return targetBinaryPath;
  }

  await mkdir(targetRoot, { recursive: true });
  await rm(targetAppRoot, { force: true, recursive: true });
  await execFileAsync("/bin/cp", ["-cR", sourceAppRoot, targetAppRoot]);

  const sourceExecutableName = path.basename(options.sourceBinaryPath);
  const copiedSourceBinary = path.join(targetAppRoot, "Contents", "MacOS", sourceExecutableName);
  if (copiedSourceBinary !== targetBinaryPath) {
    await rename(copiedSourceBinary, targetBinaryPath);
  }

  const targetPlistPath = path.join(targetAppRoot, "Contents", "Info.plist");
  const setPlistValue = async (key: string, value: string): Promise<void> => {
    await execFileAsync("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${value}`, targetPlistPath]);
  };
  await setPlistValue("CFBundleDisplayName", productName);
  await setPlistValue("CFBundleExecutable", productName);
  await setPlistValue("CFBundleIdentifier", "gg.creatorstudio.design.dev");
  await setPlistValue("CFBundleName", productName);
  await setPlistValue("CFBundleIconFile", "creator-studio-design.icns");
  await copyFile(
    options.iconPath,
    path.join(targetAppRoot, "Contents", "Resources", "creator-studio-design.icns"),
  );

  await execFileAsync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", targetAppRoot]);
  await writeFile(markerPath, identity, "utf8");
  return targetBinaryPath;
}
