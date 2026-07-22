# Runtime adapters

The engine does not contain Minecraft, ModLoader, mapping, Java, launcher, or operating-system version branches. It resolves one adapter ID and interacts only through `RuntimeAdapter`.

An adapter owns:

- Project detection
- Toolchain and Java requirements
- Mod artifact discovery and staging
- Bridge artifact acquisition
- ModLoader installation
- Headless display or container setup
- Process launch arguments
- Version-specific bridge implementation
- Declared runtime capabilities

## Adapter identity

Use hierarchical IDs:

```text
minecraft-java/1.21.1/fabric
minecraft-java/1.21.1/neoforge
minecraft-java/26.2/fabric
minecraft-java/26.2/neoforge
```

The hierarchy is descriptive, not hard-coded. Third parties can register different games, launchers, or custom loader distributions.

## Module contract

Every adapter package exports:

```ts
export function createAdapter(): RuntimeAdapter;
```

Published packages must expose each adapter entry through both `import` and `default` export conditions so project-local resolution works from the installed CLI.

Its manifest is data:

```json
{
  "schemaVersion": 1,
  "id": "minecraft-java/26.2/fabric",
  "displayName": "Minecraft Java 26.2 + Fabric",
  "engineApi": 1,
  "target": {
    "game": "minecraft-java",
    "gameVersion": "26.2",
    "loader": "fabric",
    "loaderVersion": "0.19.3"
  },
  "capabilities": [
    "world.create",
    "command.execute",
    "gui.inspect",
    "screenshot.capture"
  ],
  "requirements": {
    "java": 25
  }
}
```

## Version sharing

Adapters should be thin compositions:

- A game-family launcher component
- A Minecraft-version bridge component
- A ModLoader bootstrap component
- A host backend component

Fabric and NeoForge adapters for one Minecraft version share the version bridge and differ only in loader bootstrap code. New Minecraft versions implement a new bridge module without changing the engine, CLI, scenarios, MCP server, or skill.

Use capability negotiation instead of version checks. A scenario that requires unavailable behavior must fail before launch with the missing capability names.
