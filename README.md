# MC Headless Debug

**MC Headless Debug** is an agent-oriented toolchain for launching and manipulating real Minecraft Java clients without taking over a developer's desktop.

It combines:

- An installable `mchd` CLI
- A stable authenticated bridge protocol
- Versioned bridge and ModLoader adapters
- Reproducible YAML scenarios
- An MCP server for coding agents
- An installable agent skill
- Xvfb, Mesa, Docker, and GitHub Actions backends

## Intended capabilities

- Create or enter deterministic test worlds
- Configure time, weather, difficulty, gamerules, blocks, and inventories
- Execute commands and wait for tick-level conditions
- Move and configure players
- Spawn, inspect, configure, and remove entities
- Inspect screens and widgets
- Send mouse, keyboard, and text input
- Capture framebuffer screenshots and visual diffs
- Collect logs, crashes, traces, and scenario artifacts

## Current status

The core engine is version-agnostic. It knows only adapter discovery, sessions, RPC, scenarios, capabilities, and artifacts. Minecraft versions, ModLoaders, mappings, Java versions, launchers, and game APIs are implemented by adapters.

The TypeScript engine/protocol, CLI, scenario runner, MCP adapter, and agent skill are implemented. Fabric and NeoForge adapters for Minecraft 1.21.1 and 26.2 provide Linux/Xvfb, Docker, WSL, and macOS runtimes plus a shared control bridge for worlds, commands, players, entities, GUI input/inspection, screenshots, and deterministic waits.

The original CI prototype is proven on Fabric and NeoForge in [Faded Widgets run 29717600890](https://github.com/KessokuTeaTime/Faded-Widgets/actions/runs/29717600890). This repository includes its own adapter bridge smoke workflow for execution after upload.

## Supported adapters

| Minecraft | Java | Fabric | NeoForge |
| --- | ---: | ---: | ---: |
| 1.21.1 | 21 | 0.19.3 | 21.1.243 |
| 26.2 | 25 | 0.19.3 | 26.2.0.25-beta |

Each version package exports both loader adapters, such as `minecraft-java/1.21.1/fabric` and `minecraft-java/26.2/neoforge`.

Create support for another game version or ModLoader without changing the engine:

```bash
mchd adapter create minecraft-java/1.21.11/quilt \
  --game minecraft-java \
  --game-version 1.21.11 \
  --loader quilt
```

See [`docs/adapters.md`](docs/adapters.md) for the adapter contract.

## Roadmap

- Additional Minecraft-version and ModLoader adapters
- Screenshot baselines and image-diff assertions
- Structured traces and replayable input recordings

## Development

Requirements:

- Node.js 24+
- pnpm 11.15.1
- Java 21 for Minecraft 1.21.1 and Java 25 for Minecraft 26.2

```bash
pnpm install
pnpm check
pnpm test
pnpm build
pnpm --filter @mc-headless-debug/cli dev doctor
```

## Configuration

```yaml
schemaVersion: 1
projectRoot: .
artifacts: artifacts
runtime:
  adapter: minecraft-java/26.2/fabric
  backend: native
  options: {}
endpoint:
  host: 127.0.0.1
  port: 25570
  tokenFile: .mchd/token
adapters:
  minecraft-java/1.21.1/fabric: "@mc-headless-debug/adapter-minecraft-java-1.21.1/fabric"
  minecraft-java/1.21.1/neoforge: "@mc-headless-debug/adapter-minecraft-java-1.21.1/neoforge"
  minecraft-java/26.2/fabric: "@mc-headless-debug/adapter-minecraft-java-26.2/fabric"
  minecraft-java/26.2/neoforge: "@mc-headless-debug/adapter-minecraft-java-26.2/neoforge"
```

## Agent installation

After the repository is published:

```bash
npx skills add KessokuTeaTime/mc-headless-debug@minecraft-headless-debug -g -y
```

The skill describes the safe workflow; the CLI and Minecraft bridge provide the actual runtime capability.

Install the CLI globally and the required runtime adapter in each mod project:

```bash
pnpm add -g @mc-headless-debug/cli @mc-headless-debug/mcp
pnpm add -D @mc-headless-debug/adapter-minecraft-java-1.21.1
# or
pnpm add -D @mc-headless-debug/adapter-minecraft-java-26.2
```

## Security

The bridge binds to loopback only, uses a fresh random token for each session, and dispatches operations onto the proper Minecraft client or integrated-server thread. It must never accept arbitrary shell commands.

## License

GPL-3.0-only.
