# Creator Studio Design

<p align="center">
  <img src="apps/web/public/app-icon.png" alt="Creator Studio Design" width="160" />
</p>

Creator Studio Design is an agent-native desktop design workspace. It turns briefs into interactive prototypes, web and mobile interfaces, decks, images, video, and other production-ready design artifacts.

[Download the latest Creator Studio Design release](https://github.com/mikefilsaime-groove/creator-studio-design/releases/latest)

## Requirements

- Claude Code or Codex CLI installed and signed in with your existing Claude or ChatGPT subscription.
- macOS, Windows, or Linux.

Creator Studio Design does not require a Creator Studio account, membership check, pairing code, or application login. If you can download it, you can use it.

The app does not ask for model API keys and does not include hosted, BYOK, or local-model execution. Claude Code and Codex are the supported execution engines, so those tools still require their own normal sign-in.

## Local development

The workspace targets Node.js 24 and `pnpm@10.33.2`.

```bash
corepack enable
pnpm install
pnpm tools-dev
```

Use `pnpm tools-dev inspect desktop status` to inspect the Electron runtime. Do not use a root `pnpm dev`, `pnpm build`, or `pnpm test` command; package and lifecycle commands are intentionally scoped.

## Releases and updates

The `Creator Studio Design release` GitHub Action builds:

- Developer ID signed and notarized macOS Apple Silicon and Intel disk images;
- unsigned Windows installer and portable archive;
- Linux AppImage;
- launcher payloads and checksummed updater metadata.

Run the workflow in GitHub with a stable `x.y.z` version. A validation run can leave the assets as a workflow artifact; enabling `publish` creates the latest GitHub Release and makes it available to the in-app updater.

Current macOS treats an unsigned or unnotarized download as malware and only offers **Move to Trash**. The Mac jobs therefore refuse to build unless these repository Actions secrets are set:

- `APPLE_SIGNING_CERTIFICATE_BASE64` — base64 of a **Developer ID Application** `.p12` (not a development or Mac App Store certificate)
- `APPLE_SIGNING_CERTIFICATE_PASSWORD` — password for that `.p12`
- `APPLE_ID` — Apple ID on the Developer ID team
- `APPLE_APP_SPECIFIC_PASSWORD` — app-specific password for that Apple ID, from appleid.apple.com
- `APPLE_TEAM_ID` — 10-character Apple Developer Team ID

Windows builds stay unsigned. On first launch, Windows users may need to choose **More info** and **Run anyway** if SmartScreen warns.

The `Sync upstream Creator Studio Design base` workflow brings the newest upstream base into a review branch so product identity, open-access behavior, execution restrictions, and packaging checks can be validated before merging.

## Validation

Before a release, run:

```bash
pnpm guard
pnpm typecheck
pnpm --filter @open-design/desktop test
pnpm --filter @open-design/tools-pack test
```

## License

See [LICENSE](LICENSE) and the repository's applicable notice and third-party attribution files.
