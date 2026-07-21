package dev.mchd.bridge.mixin;

import dev.mchd.bridge.MchdBridge;
import net.minecraft.client.Minecraft;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(Minecraft.class)
public abstract class MinecraftMixin {
	@Inject(method = "tick", at = @At("TAIL"))
	private void mchd$tick(CallbackInfo callback) {
		MchdBridge.tick((Minecraft) (Object) this);
	}
}
