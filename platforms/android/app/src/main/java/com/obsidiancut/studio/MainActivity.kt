package com.obsidiancut.studio

import android.annotation.SuppressLint
import android.app.AlertDialog
import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.text.InputType
import android.view.Menu
import android.view.MenuItem
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.webkit.WebViewAssetLoader
import java.util.Locale

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var assetLoader: WebViewAssetLoader
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val callback = filePathCallback ?: return@registerForActivityResult
        filePathCallback = null

        val data = result.data
        if (result.resultCode != RESULT_OK || data == null) {
            callback.onReceiveValue(null)
            return@registerForActivityResult
        }

        val uris = mutableListOf<Uri>()
        val clipData = data.clipData
        if (clipData != null) {
            for (i in 0 until clipData.itemCount) {
                clipData.getItemAt(i)?.uri?.let { uris.add(it) }
            }
        } else {
            data.data?.let { uris.add(it) }
        }
        callback.onReceiveValue(if (uris.isNotEmpty()) uris.toTypedArray() else null)
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webView = WebView(this)
        setContentView(webView)

        assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/", createWwwPathHandler())
            .build()

        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.allowFileAccess = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
        settings.loadWithOverviewMode = true
        settings.useWideViewPort = true

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? {
                return assetLoader.shouldInterceptRequest(request.url)
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                this@MainActivity.filePathCallback?.onReceiveValue(null)
                this@MainActivity.filePathCallback = filePathCallback

                val intent = Intent(Intent.ACTION_GET_CONTENT).apply {
                    addCategory(Intent.CATEGORY_OPENABLE)
                    type = "*/*"
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                    putExtra(
                        Intent.EXTRA_MIME_TYPES,
                        arrayOf("image/*", "video/*", "audio/*", "application/json")
                    )
                }

                return try {
                    fileChooserLauncher.launch(Intent.createChooser(intent, "Select Media Files"))
                    true
                } catch (_: Exception) {
                    this@MainActivity.filePathCallback = null
                    Toast.makeText(
                        this@MainActivity,
                        "Unable to open file picker",
                        Toast.LENGTH_SHORT
                    ).show()
                    false
                }
            }
        }

        webView.setDownloadListener { url, userAgent, contentDisposition, mimeType, _ ->
            if (url.startsWith("http://") || url.startsWith("https://")) {
                val request = DownloadManager.Request(Uri.parse(url)).apply {
                    setMimeType(mimeType)
                    addRequestHeader("User-Agent", userAgent)
                    setDescription("Downloading Obsidian Cut export")
                    val fileName = URLUtil.guessFileName(url, contentDisposition, mimeType)
                    setTitle(fileName)
                    setNotificationVisibility(
                        DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED
                    )
                    setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName)
                }
                val dm = getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
                dm.enqueue(request)
                Toast.makeText(this, "Downloading to Downloads folder...", Toast.LENGTH_SHORT).show()
            } else {
                Toast.makeText(
                    this,
                    "Connect to your PC Obsidian Cut server to download rendered exports",
                    Toast.LENGTH_LONG
                ).show()
            }
        }

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack()
                } else {
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            }
        })

        loadPreferredEntry()
    }

    private fun loadPreferredEntry() {
        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        val savedServer = prefs.getString(KEY_SERVER_URL, null)?.trim()
        if (!savedServer.isNullOrEmpty()) {
            supportActionBar?.subtitle = "LAN: $savedServer"
            webView.loadUrl(savedServer)
        } else {
            supportActionBar?.subtitle = "Offline Studio UI"
            webView.loadUrl(LOCAL_BUNDLE_URL)
        }
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menu.add(0, MENU_CONNECT_LAN, 0, "Connect PC / LAN Backend")
        menu.add(0, MENU_USE_LOCAL, 1, "Use Bundled Studio UI")
        menu.add(0, MENU_RELOAD, 2, "Reload Studio")
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        return when (item.itemId) {
            MENU_CONNECT_LAN -> {
                promptServerUrl()
                true
            }
            MENU_USE_LOCAL -> {
                getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                    .edit()
                    .remove(KEY_SERVER_URL)
                    .apply()
                loadPreferredEntry()
                true
            }
            MENU_RELOAD -> {
                webView.reload()
                true
            }
            else -> super.onOptionsItemSelected(item)
        }
    }

    private fun promptServerUrl() {
        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
        val current = prefs.getString(KEY_SERVER_URL, "http://192.168.1.100:3000") ?: ""

        val input = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            setText(current)
            hint = "http://192.168.1.100:3000"
        }

        AlertDialog.Builder(this)
            .setTitle("Connect Obsidian Cut Desktop Server")
            .setMessage(
                "Enter your Windows/Linux Obsidian Cut address on the same Wi-Fi (e.g. http://192.168.1.50:3000) to enable full FFmpeg exports from Android."
            )
            .setView(input)
            .setPositiveButton("Connect") { _, _ ->
                val url = input.text.toString().trim().trimEnd('/')
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    prefs.edit().putString(KEY_SERVER_URL, url).apply()
                    loadPreferredEntry()
                } else {
                    Toast.makeText(
                        this,
                        "Enter a valid http:// or https:// URL",
                        Toast.LENGTH_SHORT
                    ).show()
                }
            }
            .setNeutralButton("Use Local UI") { _, _ ->
                prefs.edit().remove(KEY_SERVER_URL).apply()
                loadPreferredEntry()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun createWwwPathHandler(): WebViewAssetLoader.PathHandler {
        return WebViewAssetLoader.PathHandler { path ->
            val cleanPath = if (path.isEmpty() || path == "/") "index.html" else path.trimStart('/')
            val assetPath = "www/$cleanPath"
            try {
                val stream = assets.open(assetPath)
                WebResourceResponse(guessMimeType(cleanPath), "UTF-8", stream)
            } catch (_: Exception) {
                if (!cleanPath.contains('.')) {
                    try {
                        WebResourceResponse("text/html", "UTF-8", assets.open("www/index.html"))
                    } catch (_: Exception) {
                        null
                    }
                } else {
                    null
                }
            }
        }
    }

    private fun guessMimeType(path: String): String {
        val lower = path.lowercase(Locale.US)
        return when {
            lower.endsWith(".html") -> "text/html"
            lower.endsWith(".js") || lower.endsWith(".mjs") -> "application/javascript"
            lower.endsWith(".css") -> "text/css"
            lower.endsWith(".json") -> "application/json"
            lower.endsWith(".svg") -> "image/svg+xml"
            lower.endsWith(".png") -> "image/png"
            lower.endsWith(".jpg") || lower.endsWith(".jpeg") -> "image/jpeg"
            lower.endsWith(".webp") -> "image/webp"
            lower.endsWith(".gif") -> "image/gif"
            lower.endsWith(".woff2") -> "font/woff2"
            lower.endsWith(".woff") -> "font/woff"
            lower.endsWith(".wasm") -> "application/wasm"
            lower.endsWith(".mp3") -> "audio/mpeg"
            lower.endsWith(".wav") -> "audio/wav"
            lower.endsWith(".mp4") -> "video/mp4"
            else -> "application/octet-stream"
        }
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    companion object {
        private const val PREFS_NAME = "obsidian_cut_prefs"
        private const val KEY_SERVER_URL = "server_url"
        private const val LOCAL_BUNDLE_URL = "https://appassets.androidplatform.net/index.html"
        private const val MENU_CONNECT_LAN = 1001
        private const val MENU_USE_LOCAL = 1002
        private const val MENU_RELOAD = 1003
    }
}
