package dev.mchd.bridge.mixin;

import net.minecraft.client.KeyboardHandler;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Invoker;

@Mixin(KeyboardHandler.class)
public interface KeyboardHandlerInvoker {
    @Invoker("charTyped")
    void mchd$charTyped(long window, int codepoint, int modifiers);
}
