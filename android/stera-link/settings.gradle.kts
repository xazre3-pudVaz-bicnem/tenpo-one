pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
        // Maven Central の写し（Maven Central が混んでいるときの予備）
        maven { url = uri("https://maven-central.storage-download.googleapis.com/maven2/") }
    }
}
rootProject.name = "TenpoOneSteraLink"
include(":app")
