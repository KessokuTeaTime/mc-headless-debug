---
name: minecraft-headless-debug
description: Launch and manipulate real Minecraft Java clients headlessly with MC Headless Debug. Use for mod runtime debugging, reproducible worlds, commands, players and entities, GUI inspection/input, screenshots, and visual regression scenarios on Fabric or NeoForge.
---

# Minecraft Headless Debug

Use `mchd` instead of launching a local game window when a Minecraft mod needs runtime or visual debugging.

## Workflow

1. Run `mchd doctor`.
2. Run `mchd init` if the repository has no `mchd.config.yaml`.
3. Build the mod with its existing Gradle tasks.
4. Start the configured headless runtime with `mchd run`.
5. Use `mchd scenario run <file>` for reproducible work.
6. Use `mchd call gui.inspect`, `mchd call screenshot.capture`, and related bridge methods for interactive diagnosis.
7. Read artifacts from the configured artifacts directory.
8. Stop the client with `mchd call runtime.stop`.

Never expose the bridge beyond loopback or print its token. Prefer deterministic tick waits and explicit state assertions over wall-clock sleeps.

## Common calls

```bash
mchd call runtime.status
mchd call command.execute '{"command":"time set noon"}'
mchd call entity.spawn '{"type":"minecraft:zombie","position":[0,64,3]}'
mchd call gui.inspect
mchd call screenshot.capture '{"name":"hud"}'
```

For repeatable debugging, write these operations as a scenario YAML file and commit it with the mod's tests.
