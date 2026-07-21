package dev.mchd.bridge;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import dev.mchd.bridge.mixin.CreateWorldScreenInvoker;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraft.client.Screenshot;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.components.events.GuiEventListener;
import net.minecraft.client.gui.screens.PauseScreen;
import net.minecraft.client.gui.screens.Screen;
import net.minecraft.client.gui.screens.inventory.InventoryScreen;
import net.minecraft.client.gui.screens.worldselection.CreateWorldScreen;
import net.minecraft.client.gui.screens.worldselection.WorldCreationUiState;
import net.minecraft.client.input.CharacterEvent;
import net.minecraft.client.input.KeyEvent;
import net.minecraft.client.input.MouseButtonEvent;
import net.minecraft.client.input.MouseButtonInfo;
import net.minecraft.core.SectionPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.Difficulty;
import net.minecraft.world.entity.Entity;
import org.jspecify.annotations.Nullable;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.function.Predicate;
import java.util.regex.Pattern;

final class BridgeRuntime {
	private static final Pattern SAFE_SCREENSHOT_NAME =
			Pattern.compile("[a-zA-Z0-9][a-zA-Z0-9._-]*");
	private static final Pattern SAFE_ENTITY_TYPE =
			Pattern.compile("[a-z0-9_.-]+:[a-z0-9_./-]+");

	private final ConcurrentLinkedQueue<PendingCall> calls = new ConcurrentLinkedQueue<>();
	private final List<TickWaiter> waiters = new ArrayList<>();
	private final List<ScheduledAction> scheduledActions = new ArrayList<>();
	private long tick;
	private volatile boolean stopNextTick;
	private @Nullable WorldCreation worldCreation;

	CompletableFuture<JsonElement> dispatch(
			String adapterId,
			String method,
			JsonObject params
	) {
		CompletableFuture<JsonElement> result = new CompletableFuture<>();
		this.calls.add(new PendingCall(adapterId, method, params, result));
		return result;
	}

	void tick(Minecraft minecraft) {
		this.tick++;
		this.processCalls(minecraft);
		this.updateWorldCreation(minecraft);
		this.updateWaiters(minecraft);
		this.updateScheduledActions();
		if (this.stopNextTick) {
			this.stopNextTick = false;
			MchdBridge.stop();
			minecraft.stop();
		}
	}

	private void processCalls(Minecraft minecraft) {
		PendingCall call;
		while ((call = this.calls.poll()) != null) {
			try {
				this.handle(minecraft, call);
			} catch (RuntimeException exception) {
				call.result.completeExceptionally(exception);
			}
		}
	}

	private void handle(Minecraft minecraft, PendingCall call) {
		switch (call.method) {
			case "runtime.status" -> call.result.complete(
					this.runtimeStatus(minecraft, call.adapterId)
			);
			case "runtime.stop" -> {
				call.result.complete(ok());
			}
			case "world.create" -> this.createWorld(minecraft, call);
			case "world.configure" -> this.configureWorld(minecraft, call);
			case "command.execute" -> this.executeCommand(
					minecraft,
					requiredString(call.params, "command"),
					call.result
			);
			case "player.get" -> call.result.complete(this.playerState(minecraft));
			case "player.configure" -> this.configurePlayer(minecraft, call);
			case "player.input" -> this.controlPlayer(minecraft, call);
			case "entity.query" -> this.queryEntities(minecraft, call);
			case "entity.spawn" -> this.spawnEntity(minecraft, call);
			case "entity.configure" -> this.configureEntity(minecraft, call);
			case "entity.remove" -> this.removeEntity(minecraft, call);
			case "gui.inspect" -> call.result.complete(this.inspectGui(minecraft));
			case "gui.open" -> call.result.complete(this.openGui(minecraft, call.params));
			case "gui.click" -> call.result.complete(this.clickGui(minecraft, call.params));
			case "gui.key" -> call.result.complete(this.keyGui(minecraft, call.params));
			case "gui.type" -> call.result.complete(this.typeGui(minecraft, call.params));
			case "screenshot.capture" -> this.captureScreenshot(minecraft, call);
			case "wait.ticks" -> this.waitTicks(call);
			case "wait.until" -> this.waitUntil(call);
			default -> throw new BridgeRpcException(
					-32601,
					"Unsupported bridge method: " + call.method
			);
		}
	}

	void confirmStopResponse() {
		this.stopNextTick = true;
	}

	private JsonObject runtimeStatus(Minecraft minecraft, String adapterId) {
		JsonObject status = new JsonObject();
		status.addProperty("ready", true);
		status.addProperty("adapter", adapterId);
		status.addProperty("tick", this.tick);
		status.addProperty("inWorld", minecraft.level != null && minecraft.player != null);
		status.addProperty(
				"screen",
				minecraft.gui.screen() == null
						? null
						: minecraft.gui.screen().getClass().getName()
		);
		return status;
	}

	private void createWorld(Minecraft minecraft, PendingCall call) {
		if (minecraft.level != null || minecraft.player != null) {
			throw new BridgeRpcException(-32010, "A world is already open");
		}
		if (this.worldCreation != null) {
			throw new BridgeRpcException(-32011, "World creation is already in progress");
		}

		String name = optionalString(call.params, "name", "MC Headless Debug");
		String seed = optionalString(call.params, "seed", "1");
		String gameMode = optionalString(call.params, "gameMode", "creative");
		String difficulty = optionalString(call.params, "difficulty", "normal");
		boolean allowCommands = optionalBoolean(call.params, "allowCommands", true);
		WorldCreationUiState.SelectedGameMode selectedGameMode;
		Difficulty selectedDifficulty;
		try {
			selectedGameMode = WorldCreationUiState.SelectedGameMode.valueOf(
					gameMode.toUpperCase(Locale.ROOT)
			);
			selectedDifficulty = Difficulty.valueOf(difficulty.toUpperCase(Locale.ROOT));
		} catch (IllegalArgumentException exception) {
			throw new BridgeRpcException(
					-32602,
					"Invalid gameMode or difficulty"
			);
		}
		this.worldCreation = new WorldCreation(
				call.result,
				name,
				seed,
				selectedGameMode,
				selectedDifficulty,
				allowCommands
		);
		CreateWorldScreen.openFresh(minecraft, null);
	}

	private void updateWorldCreation(Minecraft minecraft) {
		WorldCreation creation = this.worldCreation;
		if (creation == null) {
			return;
		}
		if (creation.result.isCancelled()) {
			this.worldCreation = null;
			return;
		}

		if (!creation.submitted && minecraft.gui.screen() instanceof CreateWorldScreen screen) {
			WorldCreationUiState state = screen.getUiState();
			state.setName(creation.name);
			state.setSeed(creation.seed);
			state.setGameMode(creation.gameMode);
			state.setDifficulty(creation.difficulty);
			state.setAllowCommands(creation.allowCommands);
			((CreateWorldScreenInvoker) screen).mchd$createWorld();
			creation.submitted = true;
			return;
		}

		if (creation.submitted && worldReady(minecraft)) {
			JsonObject result = ok();
			result.addProperty("name", creation.name);
			result.addProperty("seed", creation.seed);
			creation.result.complete(result);
			this.worldCreation = null;
		}
	}

	private void configureWorld(Minecraft minecraft, PendingCall call) {
		List<String> commands = new ArrayList<>();
		if (call.params.has("time")) {
			commands.add("time set " + call.params.get("time").getAsString());
		}
		if (call.params.has("weather")) {
			commands.add("weather " + call.params.get("weather").getAsString());
		}
		if (call.params.has("difficulty")) {
			String difficulty = call.params.get("difficulty").getAsString();
			MinecraftServer server = minecraft.getSingleplayerServer();
			if (server == null || !server.getWorldData().getDifficulty().name()
					.equalsIgnoreCase(difficulty)) {
				commands.add("difficulty " + difficulty);
			}
		}
		if (call.params.has("gamerules")) {
			for (Map.Entry<String, JsonElement> entry
					: call.params.getAsJsonObject("gamerules").entrySet()) {
				commands.add("gamerule " + entry.getKey() + " " + entry.getValue().getAsString());
			}
		}
		this.executeCommands(minecraft, commands, call.result);
	}

	private void configurePlayer(Minecraft minecraft, PendingCall call) {
		List<String> commands = new ArrayList<>();
		if (call.params.has("position")) {
			JsonArray position = call.params.getAsJsonArray("position");
			commands.add("tp @s "
					+ number(position, 0) + " "
					+ number(position, 1) + " "
					+ number(position, 2));
		}
		if (call.params.has("gameMode")) {
			String gameMode = call.params.get("gameMode").getAsString();
			MinecraftServer server = minecraft.getSingleplayerServer();
			ServerPlayer serverPlayer = server == null || minecraft.player == null
					? null
					: server.getPlayerList().getPlayer(minecraft.player.getUUID());
			if (serverPlayer == null || !serverPlayer.gameMode.getGameModeForPlayer()
					.getName().equalsIgnoreCase(gameMode)) {
				commands.add("gamemode " + gameMode);
			}
		}
		if (call.params.has("selectedSlot")) {
			requirePlayer(minecraft).getInventory().setSelectedSlot(
					call.params.get("selectedSlot").getAsInt()
			);
		}
		this.executeCommands(minecraft, commands, call.result);
	}

	private void controlPlayer(Minecraft minecraft, PendingCall call) {
		String input = requiredString(call.params, "input");
		boolean down = optionalBoolean(call.params, "down", true);
		KeyMapping mapping = switch (input) {
			case "forward" -> minecraft.options.keyUp;
			case "back" -> minecraft.options.keyDown;
			case "left" -> minecraft.options.keyLeft;
			case "right" -> minecraft.options.keyRight;
			case "jump" -> minecraft.options.keyJump;
			case "sneak" -> minecraft.options.keyShift;
			case "sprint" -> minecraft.options.keySprint;
			case "attack" -> minecraft.options.keyAttack;
			case "use" -> minecraft.options.keyUse;
			default -> throw new BridgeRpcException(-32602, "Unknown player input: " + input);
		};
		mapping.setDown(down);
		int durationTicks = optionalInt(call.params, "durationTicks", 0);
		if (down && durationTicks > 0) {
			this.scheduledActions.add(new ScheduledAction(
					this.tick + durationTicks,
					() -> mapping.setDown(false)
			));
		}
		call.result.complete(ok());
	}

	private JsonObject playerState(Minecraft minecraft) {
		var player = requirePlayer(minecraft);
		JsonObject result = new JsonObject();
		result.addProperty("uuid", player.getUUID().toString());
		result.addProperty("x", player.getX());
		result.addProperty("y", player.getY());
		result.addProperty("z", player.getZ());
		result.addProperty("yaw", player.getYRot());
		result.addProperty("pitch", player.getXRot());
		result.addProperty("health", player.getHealth());
		result.addProperty("selectedSlot", player.getInventory().getSelectedSlot());
		return result;
	}

	private void queryEntities(Minecraft minecraft, PendingCall call) {
		MinecraftServer server = minecraft.getSingleplayerServer();
		if (server == null) {
			throw new BridgeRpcException(-32012, "No integrated server is running");
		}
		String typeFilter = call.params.has("type")
				? call.params.get("type").getAsString()
				: null;
		server.execute(() -> {
			try {
				JsonArray result = new JsonArray();
				for (var level : server.getAllLevels()) {
					for (Entity entity : level.getAllEntities()) {
						String type = BuiltInRegistries.ENTITY_TYPE.getKey(entity.getType()).toString();
						if (typeFilter != null && !typeFilter.equals(type)) {
							continue;
						}
						JsonObject value = new JsonObject();
						value.addProperty("uuid", entity.getUUID().toString());
						value.addProperty("type", type);
						value.addProperty("x", entity.getX());
						value.addProperty("y", entity.getY());
						value.addProperty("z", entity.getZ());
						result.add(value);
					}
				}
				call.result.complete(result);
			} catch (RuntimeException exception) {
				call.result.completeExceptionally(exception);
			}
		});
	}

	private void spawnEntity(Minecraft minecraft, PendingCall call) {
		String type = requiredString(call.params, "type");
		if (!SAFE_ENTITY_TYPE.matcher(type).matches()) {
			throw new BridgeRpcException(-32602, "Invalid entity type: " + type);
		}
		JsonArray position = call.params.getAsJsonArray("position");
		String command = "summon " + type + " "
				+ number(position, 0) + " "
				+ number(position, 1) + " "
				+ number(position, 2);
		if (call.params.has("nbt")) {
			command += " " + call.params.get("nbt").getAsString();
		}
		this.executeCommand(minecraft, command, call.result);
	}

	private void configureEntity(Minecraft minecraft, PendingCall call) {
		String selector = requiredString(call.params, "selector");
		String nbt = requiredString(call.params, "nbt");
		this.executeCommand(
				minecraft,
				"data merge entity " + selector + " " + nbt,
				call.result
		);
	}

	private void removeEntity(Minecraft minecraft, PendingCall call) {
		this.executeCommand(
				minecraft,
				"kill " + requiredString(call.params, "selector"),
				call.result
		);
	}

	private JsonObject inspectGui(Minecraft minecraft) {
		JsonObject result = new JsonObject();
		Screen screen = minecraft.gui.screen();
		if (screen == null) {
			result.addProperty("screen", (String) null);
			result.add("widgets", new JsonArray());
			return result;
		}

		result.addProperty("screen", screen.getClass().getName());
		JsonArray widgets = new JsonArray();
		for (GuiEventListener child : screen.children()) {
			JsonObject widget = new JsonObject();
			widget.addProperty("type", child.getClass().getName());
			if (child instanceof AbstractWidget abstractWidget) {
				widget.addProperty("message", abstractWidget.getMessage().getString());
				widget.addProperty("x", abstractWidget.getX());
				widget.addProperty("y", abstractWidget.getY());
				widget.addProperty("width", abstractWidget.getWidth());
				widget.addProperty("height", abstractWidget.getHeight());
				widget.addProperty("active", abstractWidget.active);
				widget.addProperty("visible", abstractWidget.visible);
			}
			widgets.add(widget);
		}
		result.add("widgets", widgets);
		return result;
	}

	private JsonObject openGui(Minecraft minecraft, JsonObject params) {
		String screen = requiredString(params, "screen");
		switch (screen) {
			case "none" -> minecraft.gui.setScreen(null);
			case "pause" -> minecraft.gui.setScreen(new PauseScreen(true));
			case "inventory" -> minecraft.gui.setScreen(
					new InventoryScreen(requirePlayer(minecraft))
			);
			default -> throw new BridgeRpcException(-32602, "Unknown screen: " + screen);
		}
		return ok();
	}

	private JsonObject clickGui(Minecraft minecraft, JsonObject params) {
		Screen screen = requireScreen(minecraft);
		double x = requiredDouble(params, "x");
		double y = requiredDouble(params, "y");
		int button = optionalInt(params, "button", 0);
		int modifiers = optionalInt(params, "modifiers", 0);
		MouseButtonEvent event = new MouseButtonEvent(
				x,
				y,
				new MouseButtonInfo(button, modifiers)
		);
		JsonObject result = ok();
		result.addProperty("handled", screen.mouseClicked(event, false));
		screen.mouseReleased(event);
		return result;
	}

	private JsonObject keyGui(Minecraft minecraft, JsonObject params) {
		Screen screen = requireScreen(minecraft);
		KeyEvent event = new KeyEvent(
				requiredInt(params, "key"),
				optionalInt(params, "scancode", 0),
				optionalInt(params, "modifiers", 0)
		);
		JsonObject result = ok();
		result.addProperty("handled", screen.keyPressed(event));
		return result;
	}

	private JsonObject typeGui(Minecraft minecraft, JsonObject params) {
		Screen screen = requireScreen(minecraft);
		String text = requiredString(params, "text");
		int handled = 0;
		for (int index = 0; index < text.length();) {
			int codepoint = text.codePointAt(index);
			if (screen.charTyped(new CharacterEvent(codepoint))) {
				handled++;
			}
			index += Character.charCount(codepoint);
		}
		JsonObject result = ok();
		result.addProperty("handledCodepoints", handled);
		return result;
	}

	private void captureScreenshot(Minecraft minecraft, PendingCall call) {
		String name = requiredString(call.params, "name");
		if (!SAFE_SCREENSHOT_NAME.matcher(name).matches()) {
			throw new BridgeRpcException(-32602, "Invalid screenshot name: " + name);
		}
		String filename = name.endsWith(".png") ? name : name + ".png";
		File screenshot = new File(new File(minecraft.gameDirectory, "screenshots"), filename);
		Screenshot.grab(
				minecraft.gameDirectory,
				filename,
				minecraft.gameRenderer.mainRenderTarget(),
				1,
				message -> {
					if (screenshot.isFile()) {
						JsonObject result = ok();
						result.addProperty("path", screenshot.getAbsolutePath());
						call.result.complete(result);
					} else {
						call.result.completeExceptionally(new BridgeRpcException(
								-32020,
								"Screenshot was not saved: " + screenshot
						));
					}
				}
		);
	}

	private void waitTicks(PendingCall call) {
		int ticks = requiredInt(call.params, "ticks");
		if (ticks < 0) {
			throw new BridgeRpcException(-32602, "ticks must not be negative");
		}
		this.waiters.add(new TickWaiter(
				this.tick + ticks,
				this.tick + ticks,
				minecraft -> true,
				call.result
		));
	}

	private void waitUntil(PendingCall call) {
		String condition = requiredString(call.params, "condition");
		Predicate<Minecraft> predicate = switch (condition) {
			case "worldReady" -> BridgeRuntime::worldReady;
			case "screen" -> {
				String expected = requiredString(call.params, "value");
				yield minecraft -> minecraft.gui.screen() != null
						&& (minecraft.gui.screen().getClass().getName().equals(expected)
						|| minecraft.gui.screen().getClass().getSimpleName().equals(expected));
			}
			case "noScreen" -> minecraft -> minecraft.gui.screen() == null;
			default -> throw new BridgeRpcException(
					-32602,
					"Unknown wait condition: " + condition
			);
		};
		this.waiters.add(new TickWaiter(
				this.tick,
				this.tick + optionalInt(call.params, "timeoutTicks", 2400),
				predicate,
				call.result
		));
	}

	private void updateWaiters(Minecraft minecraft) {
		this.waiters.removeIf(waiter -> {
			if (waiter.result.isCancelled()) {
				return true;
			}
			if (this.tick > waiter.deadlineTick) {
				waiter.result.completeExceptionally(new BridgeRpcException(
						-32003,
						"Wait condition timed out"
				));
				return true;
			}
			if (this.tick < waiter.minimumTick || !waiter.predicate.test(minecraft)) {
				return false;
			}
			waiter.result.complete(ok());
			return true;
		});
	}

	private void updateScheduledActions() {
		this.scheduledActions.removeIf(action -> {
			if (this.tick < action.tick) {
				return false;
			}
			action.action.run();
			return true;
		});
	}

	private void executeCommand(
			Minecraft minecraft,
			String command,
			CompletableFuture<JsonElement> result
	) {
		this.executeCommands(minecraft, List.of(command), result);
	}

	private void executeCommands(
			Minecraft minecraft,
			List<String> commands,
			CompletableFuture<JsonElement> result
	) {
		MinecraftServer server = minecraft.getSingleplayerServer();
		if (server == null) {
			throw new BridgeRpcException(-32012, "No integrated server is running");
		}
		server.execute(() -> {
			try {
				var source = server.createCommandSourceStack();
				if (minecraft.player != null) {
					ServerPlayer serverPlayer = server.getPlayerList().getPlayer(
							minecraft.player.getUUID()
					);
					if (serverPlayer != null) {
						source = serverPlayer.createCommandSourceStack();
					}
				}
				int commandResult = 0;
				for (String command : commands) {
					commandResult += server.getCommands().getDispatcher().execute(
							command.startsWith("/") ? command.substring(1) : command,
							source
					);
				}
				JsonObject response = ok();
				response.addProperty("executed", commands.size());
				response.addProperty("result", commandResult);
				result.complete(response);
			} catch (CommandSyntaxException | RuntimeException exception) {
				result.completeExceptionally(exception);
			}
		});
	}

	private static boolean worldReady(Minecraft minecraft) {
		return minecraft.player != null
				&& minecraft.level != null
				&& minecraft.getSingleplayerServer() != null
				&& !minecraft.level.getChunk(
						SectionPos.blockToSectionCoord(minecraft.player.getBlockX()),
						SectionPos.blockToSectionCoord(minecraft.player.getBlockZ())
				).isEmpty();
	}

	private static net.minecraft.client.player.LocalPlayer requirePlayer(Minecraft minecraft) {
		if (minecraft.player == null) {
			throw new BridgeRpcException(-32012, "No player is available");
		}
		return minecraft.player;
	}

	private static Screen requireScreen(Minecraft minecraft) {
		Screen screen = minecraft.gui.screen();
		if (screen == null) {
			throw new BridgeRpcException(-32013, "No screen is open");
		}
		return screen;
	}

	private static JsonObject ok() {
		JsonObject result = new JsonObject();
		result.addProperty("ok", true);
		return result;
	}

	private static String requiredString(JsonObject params, String key) {
		if (!params.has(key)) {
			throw new BridgeRpcException(-32602, "Missing parameter: " + key);
		}
		return params.get(key).getAsString();
	}

	private static int requiredInt(JsonObject params, String key) {
		if (!params.has(key)) {
			throw new BridgeRpcException(-32602, "Missing parameter: " + key);
		}
		return params.get(key).getAsInt();
	}

	private static double requiredDouble(JsonObject params, String key) {
		if (!params.has(key)) {
			throw new BridgeRpcException(-32602, "Missing parameter: " + key);
		}
		return params.get(key).getAsDouble();
	}

	private static String optionalString(JsonObject params, String key, String fallback) {
		return params.has(key) ? params.get(key).getAsString() : fallback;
	}

	private static boolean optionalBoolean(
			JsonObject params,
			String key,
			boolean fallback
	) {
		return params.has(key) ? params.get(key).getAsBoolean() : fallback;
	}

	private static int optionalInt(JsonObject params, String key, int fallback) {
		return params.has(key) ? params.get(key).getAsInt() : fallback;
	}

	private static double number(JsonArray values, int index) {
		if (values == null || values.size() <= index) {
			throw new BridgeRpcException(-32602, "Position requires three coordinates");
		}
		return values.get(index).getAsDouble();
	}

	private record PendingCall(
			String adapterId,
			String method,
			JsonObject params,
			CompletableFuture<JsonElement> result
	) {
	}

	private record TickWaiter(
			long minimumTick,
			long deadlineTick,
			Predicate<Minecraft> predicate,
			CompletableFuture<JsonElement> result
	) {
	}

	private record ScheduledAction(long tick, Runnable action) {
	}

	private static final class WorldCreation {
		private final CompletableFuture<JsonElement> result;
		private final String name;
		private final String seed;
		private final WorldCreationUiState.SelectedGameMode gameMode;
		private final Difficulty difficulty;
		private final boolean allowCommands;
		private boolean submitted;

		private WorldCreation(
				CompletableFuture<JsonElement> result,
				String name,
				String seed,
				WorldCreationUiState.SelectedGameMode gameMode,
				Difficulty difficulty,
				boolean allowCommands
		) {
			this.result = result;
			this.name = name;
			this.seed = seed;
			this.gameMode = gameMode;
			this.difficulty = difficulty;
			this.allowCommands = allowCommands;
		}
	}
}
