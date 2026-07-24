package dev.mchd.bridge;

import net.minecraft.client.Minecraft;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.file.Path;
import java.util.concurrent.atomic.AtomicBoolean;

public final class MchdBridge {
	public static final String ID = "mchd_bridge";
	public static final Logger LOGGER = LoggerFactory.getLogger(ID);

	private static final AtomicBoolean STARTED = new AtomicBoolean();
	private static final BridgeRuntime RUNTIME = new BridgeRuntime();
	private static BridgeServer server;

	private MchdBridge() {
	}

	public static void start(String adapterId) {
		if (!STARTED.compareAndSet(false, true)) {
			return;
		}

		Path gameDirectory = Path.of(System.getProperty("user.dir")).toAbsolutePath();
		server = BridgeServer.start(gameDirectory, adapterId, RUNTIME);
		LOGGER.info(
				"MC Headless Debug bridge {} listening on 127.0.0.1:{}",
				adapterId,
				server.port()
		);
	}

	public static void tick(Minecraft minecraft) {
		RUNTIME.tick(minecraft);
	}

	public static void frame(Minecraft minecraft) {
		RUNTIME.frame(minecraft);
	}


	public static void stop() {
		BridgeServer current = server;
		if (current != null) {
			current.close();
			server = null;
		}
	}
}
