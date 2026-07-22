architectury {
    common("fabric", "neoforge") {
        platformPackage("neoforge", "forge")
    }
}
val sharedBridge = rootProject.file("../../26.2/bridge/common/src/main/java/dev/mchd/bridge")

sourceSets {
    main {
        java.setSrcDirs(listOf("src/main/java"))
    }
}

tasks.compileJava {
    source(
        sharedBridge.resolve("BridgeRpcException.java"),
        sharedBridge.resolve("BridgeServer.java"),
        sharedBridge.resolve("MchdBridge.java")
    )
}

dependencies {
    add("compileOnly", libs.fabric.loader)
    add("compileOnly", "net.fabricmc:sponge-mixin:0.16.5+mixin.0.8.7")
}
