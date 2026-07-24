package dev.mchd.bridge.mixin;

import net.minecraft.client.MouseHandler;
import net.minecraft.client.input.MouseButtonInfo;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Invoker;

@Mixin(MouseHandler.class)
public interface MouseHandlerInvoker {
	@Invoker("onMove")
	void mchd$onMove(long window, double x, double y);

	@Invoker("onButton")
	void mchd$onButton(long window, MouseButtonInfo button, int action);

	@Invoker("onScroll")
	void mchd$onScroll(long window, double xOffset, double yOffset);
}
