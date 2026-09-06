#!/usr/bin/env bash
# Build a small offline APK using JDK 11+ and Android SDK build-tools/platform 34.
set -euo pipefail
DEMO_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
: "${ANDROID_SDK_ROOT:?Set ANDROID_SDK_ROOT to your Android SDK directory}"
BUILD_TOOLS="${DARKAUDIT_BUILD_TOOLS:-$ANDROID_SDK_ROOT/build-tools/34.0.0}"
ANDROID_JAR="${DARKAUDIT_ANDROID_JAR:-$ANDROID_SDK_ROOT/platforms/android-34/android.jar}"
BUILD_DIR="$DEMO_DIR/build"
mkdir -p "$BUILD_DIR/classes" "$BUILD_DIR/dex"
"$BUILD_TOOLS/aapt" package -f -M "$DEMO_DIR/AndroidManifest.xml" -I "$ANDROID_JAR" -F "$BUILD_DIR/resources.apk"
javac -encoding UTF-8 -source 8 -target 8 -bootclasspath "$ANDROID_JAR:$BUILD_TOOLS/core-lambda-stubs.jar" -d "$BUILD_DIR/classes" "$DEMO_DIR/src/com/darkaudit/demo/MainActivity.java"
mapfile -t DEMO_CLASSES < <(find "$BUILD_DIR/classes" -name '*.class' -print)
"$BUILD_TOOLS/d8" --lib "$ANDROID_JAR" --min-api 23 --output "$BUILD_DIR/dex" "${DEMO_CLASSES[@]}"
cp "$BUILD_DIR/resources.apk" "$BUILD_DIR/unsigned.apk"
(cd "$BUILD_DIR/dex" && zip -q -j "$BUILD_DIR/unsigned.apk" classes.dex)
"$BUILD_TOOLS/zipalign" -f 4 "$BUILD_DIR/unsigned.apk" "$BUILD_DIR/aligned.apk"
# Disposable local debug signing identity. Never use this key for production.
if [[ ! -f "$BUILD_DIR/demo-debug.keystore" ]]; then
    keytool -genkeypair -keystore "$BUILD_DIR/demo-debug.keystore" -storepass android -keypass android -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 3650 -dname "CN=DarkAudit Demo,O=Test,C=KR" >/dev/null 2>&1
fi
"$BUILD_TOOLS/apksigner" sign --ks "$BUILD_DIR/demo-debug.keystore" --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android --out "$BUILD_DIR/darkaudit-demo.apk" "$BUILD_DIR/aligned.apk"
"$BUILD_TOOLS/apksigner" verify --verbose "$BUILD_DIR/darkaudit-demo.apk"
printf 'APK: %s\n' "$BUILD_DIR/darkaudit-demo.apk"
