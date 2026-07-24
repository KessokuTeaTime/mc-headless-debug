# Bridge protocol

The bridge listens only on a configured loopback address and accepts one NDJSON JSON-RPC request per connection. Every request includes the random session token written to `.mchd/token`.

```json
{"jsonrpc":"2.0","id":"uuid","token":"secret","method":"runtime.status","params":{},"timeoutMs":30000}
```

```json
{"jsonrpc":"2.0","id":"uuid","result":{"ready":true}}
```

Client operations are scheduled on Minecraft's client thread. Integrated-server mutations are then scheduled on the server thread. A response is emitted only after the requested operation and its synchronization barrier complete.

`timeoutMs` is configurable per request from 1 ms through 600,000 ms. CLI scenarios and both MCP tools default to 30,000 ms; world creation and other long operations should set an explicit larger value.

The stable method families are:

- `runtime.*`: lifecycle status and deterministic shutdown
- `world.*`: create, configure, publish, and inspect the current singleplayer world
- `command.*`: execute integrated-server commands
- `player.*`: inspect, configure, control, and inventory-probe the local player
- `entity.*`: query, spawn, configure, and remove entities
- `gui.*`: inspect, open, click, type, and send keys to screens
- `input.*`: dispatch ordered raw keyboard, text, and mouse events and inspect pointer/button state
- `window.*`: resize the Minecraft client window
- `screenshot.*`: capture named framebuffer images
- `wait.*`: deterministic client-tick, render-frame, lifecycle, screen, and overlay barriers

## Current Minecraft bridge boundaries

- Server-side mutations target the local integrated server and local player. Multiplayer servers and dedicated-server control are not supported.
- `input.dispatch` calls Minecraft keyboard and mouse handlers on the client thread. It does not synthesize operating-system input, control launchers or native dialogs, or provide clipboard/IME automation. Event order and `delayTicks` are deterministic relative to client ticks.
- `gui.inspect` enumerates the active `Screen` children. Full bounds and labels are available for `AbstractWidget` children; custom-drawn controls require framebuffer inspection and raw coordinate input. `gui.open` directly supports only `none`, `pause`, and `inventory`.
- `wait.until` supports `gameReady`, `menuReady`, `worldLoaded`, `worldReady`, `phase`, `screen`, `noScreen`, `overlay`, and `noOverlay`. Other conditions require polling a probe or an adapter extension.
- Gameplay probes expose the current world, one block position, the local player, and the local inventory. They do not expose arbitrary Java object graphs or arbitrary code execution.
- Screenshots capture the current client framebuffer. Baseline storage and image-diff assertions remain outside the bridge.

The protocol is intentionally independent of mappings, loaders, and Minecraft versions. Bridge adapters translate these calls into version-specific game APIs.
