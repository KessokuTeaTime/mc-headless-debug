package dev.mchd.bridge.mixin;

import net.minecraft.client.MouseHandler;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Invoker;

@Mixin(MouseHandler.class)
public interface MouseHandlerInvoker {
    @Invoker("onMove")
    void mchd$onMove(long window, double x, double y);

    @Invoker("onPress")
    void mchd$onPress(long window, int button, int action, int modifiers);

    @Invoker("onScroll")
    void mchd$onScroll(long window, double xOffset, double yOffset);
}
