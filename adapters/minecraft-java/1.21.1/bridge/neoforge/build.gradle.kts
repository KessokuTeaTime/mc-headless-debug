import org.gradle.api.component.AdhocComponentWithVariants

plugins {
    alias(libs.plugins.shadow)
}

architectury {
    platformSetupLoomIde()
    neoForge()
}

val common by configurations.creating
val shadowCommon by configurations.creating

repositories {
    maven("https://maven.neoforged.net/releases/")
}

configurations.named("compileClasspath") { extendsFrom(common) }
configurations.named("runtimeClasspath") { extendsFrom(common) }
configurations.named("developmentNeoForge") { extendsFrom(common) }

dependencies {
    add("compileOnly", "net.neoforged:neoforge:${libs.versions.neoforge.get()}:universal")
    add("compileOnly", "net.neoforged.fancymodloader:loader:4.0.43")
    common(project(path = ":common")) { isTransitive = false }
    shadowCommon(project(path = ":common", configuration = "transformProductionNeoForge")) {
        isTransitive = false
    }
}

tasks.jar { archiveClassifier.set("raw") }
tasks.shadowJar {
    configurations = listOf(shadowCommon)
    archiveClassifier.set("")
    destinationDirectory.set(rootProject.layout.buildDirectory.dir("libs"))
    exclude("architectury.common.json")
}
tasks.assemble { dependsOn(tasks.shadowJar) }
tasks.remapJar { enabled = false }

components.getByName<AdhocComponentWithVariants>("java") {
    withVariantsFromConfiguration(configurations["shadowRuntimeElements"]) { skip() }
}
