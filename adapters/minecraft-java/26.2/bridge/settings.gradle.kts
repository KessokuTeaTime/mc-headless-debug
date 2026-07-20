pluginManagement {
	repositories {
		maven("https://maven.fabricmc.net/")
		maven("https://maven.architectury.dev/")
		maven("https://maven.neoforged.net/releases/")
		gradlePluginPortal()
	}
}

rootProject.name = "mchd-minecraft-java-26.2"

include("common")
include("fabric")
include("neoforge")
