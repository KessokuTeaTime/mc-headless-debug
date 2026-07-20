package dev.mchd.bridge.fabric;

import dev.mchd.bridge.MchdBridge;
import net.fabricmc.api.ClientModInitializer;

public final class MchdBridgeFabric implements ClientModInitializer {
	@Override
	public void onInitializeClient() {
		MchdBridge.start("minecraft-java/26.2/fabric");
	}
}
