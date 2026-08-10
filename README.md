# Creator Studio Design

<p align="center">
  <img src="apps/web/public/app-icon.png" alt="Creator Studio Design" width="160" />
</p>

Creator Studio Design is the agent-native desktop design workspace for Creator Studio members. It turns briefs into interactive prototypes, web and mobile interfaces, decks, images, video, and other production-ready design artifacts.

[Download the latest Creator Studio Design release](https://github.com/mikefilsaime-groove/creator-studio-design/releases/latest)

## Requirements

- An active Creator Studio Mastermind membership verified through ClickCampaigns GodMode.
- Claude Code or Codex CLI installed and signed in with the member's existing Claude or ChatGPT subscription.
- macOS, Windows, or Linux.

Creator Studio Design does not ask members for model API keys and does not include hosted, BYOK, or local-model execution. Claude Code and Codex are the only supported execution engines.

## Secure member connection

On first launch, Creator Studio Design displays a short-lived pairing code. In an authenticated ClickCampaigns GodMode connection, authorize that code for Creator Studio Design. The desktop app receives its own revocable application token; it never copies or exposes the member's GodMode MCP credential.

The application token and signed offline entitlement lease are encrypted with the operating system's secure credential storage. Inactive, suspended, expired, or revoked Mastermind access fails closed.

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

- unsigned macOS Apple Silicon and Intel installers;
- unsigned Windows installer and portable archive;
- Linux AppImage;
- launcher payloads and checksummed updater metadata.

Run the workflow in GitHub with a stable `x.y.z` version. A validation run can leave the assets as a workflow artifact; enabling `publish` creates the latest GitHub Release and makes it available to the in-app updater.

These community installers do not require paid Apple or Windows developer certificates. On first launch, macOS users may need to Control-click the app and choose **Open**; Windows users may need to choose **More info** and **Run anyway** if SmartScreen warns.

The `Sync upstream Creator Studio Design base` workflow brings the newest upstream base into a review branch so product identity, authentication, execution restrictions, and packaging checks can be validated before merging.

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
