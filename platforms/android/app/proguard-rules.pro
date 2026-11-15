# Keep WebView JS/interface classes intact if minification is enabled later.
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
