#!/usr/bin/env bash
# Build a small offline APK using JDK 11+ and Android SDK build-tools/platform 34.
set -euo pipefail
DEMO_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
: "${ANDROID_SDK_ROOT:?Set ANDROID_SDK_ROOT to your Android SDK directory}"
BUILD_TOOLS="${DARKAUDIT_BUILD_TOOLS:-$ANDROID_SDK_ROOT/build-tools/34.0.0}"
ANDROID_JAR="${DARKAUDIT_ANDROID_JAR:-$ANDROID_SDK_ROOT/platforms/android-34/android.jar}"
BUILD_DIR="$DEMO_DIR/build"
mkdir -p "$BUILD_DIR" "$DEMO_DIR/../assets"
"$BUILD_TOOLS/aapt" package -f -M "$DEMO_DIR/AndroidManifest.xml" -I "$ANDROID_JAR" -F "$BUILD_DIR/resources.apk"
# Disposable local debug signing identity. Never use this key for production.
if [[ ! -f "$BUILD_DIR/demo-debug.keystore" ]]; then
    keytool -genkeypair -keystore "$BUILD_DIR/demo-debug.keystore" -storepass android -keypass android -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 3650 -dname "CN=DarkAudit Demo,O=Test,C=KR" >/dev/null 2>&1
fi
for DEMO_VARIANT in risky partial revised; do
    VARIANT_DIR="$BUILD_DIR/$DEMO_VARIANT"
    mkdir -p "$VARIANT_DIR/classes" "$VARIANT_DIR/dex"
    printf 'package com.darkaudit.demo; final class BuildConfig { static final String VARIANT = "%s"; }\n' "$DEMO_VARIANT" > "$VARIANT_DIR/BuildConfig.java"
    javac -encoding UTF-8 -source 8 -target 8 -bootclasspath "$ANDROID_JAR:$BUILD_TOOLS/core-lambda-stubs.jar" -d "$VARIANT_DIR/classes" "$DEMO_DIR/src/com/darkaudit/demo/MainActivity.java" "$VARIANT_DIR/BuildConfig.java"
    mapfile -t DEMO_CLASSES < <(find "$VARIANT_DIR/classes" -name '*.class' -print)
    "$BUILD_TOOLS/d8" --lib "$ANDROID_JAR" --min-api 23 --output "$VARIANT_DIR/dex" "${DEMO_CLASSES[@]}"
    cp "$BUILD_DIR/resources.apk" "$VARIANT_DIR/unsigned.apk"
    (cd "$VARIANT_DIR/dex" && zip -q -j "$VARIANT_DIR/unsigned.apk" classes.dex)
    "$BUILD_TOOLS/zipalign" -f 4 "$VARIANT_DIR/unsigned.apk" "$VARIANT_DIR/aligned.apk"
    APK_PATH="$DEMO_DIR/../assets/darkaudit-demo-$DEMO_VARIANT.apk"
    "$BUILD_TOOLS/apksigner" sign --ks "$BUILD_DIR/demo-debug.keystore" --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android --out "$APK_PATH" "$VARIANT_DIR/aligned.apk"
    "$BUILD_TOOLS/apksigner" verify --verbose "$APK_PATH"
    printf 'APK: %s\n' "$APK_PATH"
done
cp "$DEMO_DIR/../assets/darkaudit-demo-risky.apk" "$DEMO_DIR/../assets/darkaudit-demo.apk"
cp "$DEMO_DIR/../assets/darkaudit-demo-risky.apk" "$BUILD_DIR/darkaudit-demo.apk"

cp "$DEMO_DIR/../assets/darkaudit-demo-risky.apk" "$DEMO_DIR/../../frontend/public/dark-pattern-demo/darkaudit-demo.apk"
