import org.gradle.api.component.AdhocComponentWithVariants
import org.gradle.api.tasks.bundling.Jar

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

configurations.named("compileClasspath") {
	extendsFrom(common)
}
configurations.named("runtimeClasspath") {
	extendsFrom(common)
}
configurations.named("developmentNeoForge") {
	extendsFrom(common)
}

dependencies {
	"neoForge"(libs.neoforge)
	common(project(path = ":common")) {
		isTransitive = false
	}
	shadowCommon(project(path = ":common", configuration = "transformProductionNeoForge")) {
		isTransitive = false
	}
}

tasks.jar {
	archiveClassifier.set("raw")
}

tasks.shadowJar {
	configurations = listOf(shadowCommon)
	archiveClassifier.set("")
	destinationDirectory.set(rootProject.layout.buildDirectory.dir("libs"))
	exclude("architectury.common.json")
}

tasks.assemble {
	dependsOn(tasks.shadowJar)
}

components.getByName<AdhocComponentWithVariants>("java") {
	withVariantsFromConfiguration(configurations["shadowRuntimeElements"]) {
		skip()
	}
}
