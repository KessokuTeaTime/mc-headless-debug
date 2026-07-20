package dev.mchd.bridge.neoforge;

import dev.mchd.bridge.MchdBridge;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.fml.common.Mod;

@Mod(value = MchdBridge.ID, dist = Dist.CLIENT)
public final class MchdBridgeNeoForge {
	public MchdBridgeNeoForge() {
		MchdBridge.start("minecraft-java/26.2/neoforge");
	}
}
