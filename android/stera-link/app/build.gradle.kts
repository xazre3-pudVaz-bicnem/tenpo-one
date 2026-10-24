/**
 * TENPO ONE 連携（stera terminal 用アプリ）
 *
 * stera terminal standard は Android 8.1（API 27）、stera terminal mobile は Android 10（API 29）
 * （stera developers「アプリ開発のための環境構築」）。minSdk 27 / targetSdk 29 にそろえる。
 * 依存は AndroidX の最小限だけ（Google Play 開発者サービスは使わない）。
 */
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.tenpoone.steralink"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.tenpoone.steralink"
        minSdk = 27
        targetSdk = 29
        // stera market の登録は「バージョン名」「バージョン表示名」が要る。更新のたびに両方を上げる
        versionCode = 1
        versionName = "1.0.0"
    }

    buildTypes {
        release {
            // 署名は stera developers「アプリ配信のための署名」の手順で、自社の keystore だけで行う（ストア署名は付けない）
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        // BuildConfig.VERSION_NAME をサーバーへ送る（?v=）
        buildConfig = true
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("androidx.core:core-ktx:1.12.0")
}
