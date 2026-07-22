import net.fabricmc.loom.api.LoomGradleExtensionAPI
import org.gradle.api.plugins.BasePluginExtension
import org.gradle.api.plugins.JavaPluginExtension
import org.gradle.api.tasks.bundling.Jar
import org.gradle.language.jvm.tasks.ProcessResources

plugins {
    base
    alias(libs.plugins.architectury)
    alias(libs.plugins.architectury.loom) apply false
    alias(libs.plugins.shadow) apply false
}

val rootLibs = libs
val bridgeVersion = libs.versions.bridge.get()
val minecraftVersion = libs.versions.minecraft.get()
val javaVersion = libs.versions.java.get().toInt()

group = libs.versions.maven.group.get()
version = bridgeVersion

base {
    archivesName.set(libs.versions.archives.name.get())
}

architectury {
    minecraft = minecraftVersion
}

subprojects {
    apply(plugin = "java-library")
    apply(plugin = "architectury-plugin")
    apply(plugin = "dev.architectury.loom")

    group = rootProject.group
    version = "$bridgeVersion-${project.name}.$minecraftVersion"

    extensions.configure<BasePluginExtension> {
        archivesName.set(rootLibs.versions.archives.name.get())
    }

    repositories {
        mavenCentral()
        maven("https://maven.neoforged.net/releases/")
    }


    dependencies {
        add("minecraft", rootLibs.minecraft)
        add("mappings", project.extensions.getByType<LoomGradleExtensionAPI>().officialMojangMappings())
    }

    extensions.configure<JavaPluginExtension> {
        toolchain.languageVersion.set(JavaLanguageVersion.of(javaVersion))
        withSourcesJar()
    }

    tasks.withType<JavaCompile>().configureEach {
        options.encoding = "UTF-8"
        options.release.set(javaVersion)
    }

    tasks.withType<ProcessResources>().configureEach {
        inputs.property("version", bridgeVersion)
        filesMatching(listOf("fabric.mod.json", "META-INF/neoforge.mods.toml")) {
            expand("version" to bridgeVersion)
        }
    }

    tasks.named<Jar>("jar") {
        manifest {
            attributes["Implementation-Version"] = bridgeVersion
        }
    }
}

tasks.named("build") {
    dependsOn(subprojects.map { "${it.path}:build" })
}
