architectury {
	common("fabric", "neoforge") {
		platformPackage("neoforge", "forge")
	}
}

dependencies {
	add("implementation", libs.fabric.loader)
}
