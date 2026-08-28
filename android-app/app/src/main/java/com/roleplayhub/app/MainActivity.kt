package com.roleplayhub.app

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.PowerManager
import android.util.Base64
import android.view.Gravity
import android.view.MenuItem
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.Window
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.PopupMenu
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.app.AlertDialog
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.ArrayDeque
import java.util.Date
import java.util.Locale

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var menuBtn: ImageView
    private var dragged = false
    private var downRawX = 0f
    private var downRawY = 0f
    private var touchSlop = 0
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var handlingBack = false
    private var pendingImageSaveUrl: String? = null
    private var pendingDownload: PendingDownload? = null
    private var savedStatusBarColor = 0
    private var savedNavigationBarColor = 0
    private var isFullscreen = false
    private var pendingSaveFile: PendingSaveFile? = null
    private var pendingBackupStripImages: Boolean? = null
    private val plainBackupReceiver = PlainBackupReceiver()
    private var pendingPlainBackupFiles: List<PlainBackupManager.PlainFile>? = null
    private var wakeLock: PowerManager.WakeLock? = null

    private val imageSavePermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val url = pendingImageSaveUrl
        pendingImageSaveUrl = null
        if (granted && url != null) {
            doSaveImage(url)
        } else if (url != null) {
            Toast.makeText(this, "未授予存储权限，无法保存图片，请在系统设置中开启存储权限", Toast.LENGTH_SHORT).show()
        }
        val saveFile = pendingSaveFile
        pendingSaveFile = null
        if (granted && saveFile != null) {
            doSaveFile(saveFile.base64, saveFile.fileName, saveFile.mimeType)
        } else if (saveFile != null) {
            Toast.makeText(this, "未授予存储权限，无法下载文件", Toast.LENGTH_SHORT).show()
        }
    }

    private val allFilesAccessLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        val url = pendingImageSaveUrl
        if (url != null && hasAllFilesAccess()) {
            pendingImageSaveUrl = null
            doSaveImage(url)
        } else if (url != null) {
            Toast.makeText(this, "未开启“所有文件访问”权限，无法保存图片", Toast.LENGTH_SHORT).show()
        }
        val download = pendingDownload
        if (download != null && hasAllFilesAccess()) {
            pendingDownload = null
            doDownload(download)
        } else if (download != null) {
            Toast.makeText(this, "未开启“所有文件访问”权限，无法下载文件", Toast.LENGTH_SHORT).show()
        }
        val saveFile = pendingSaveFile
        if (saveFile != null && hasAllFilesAccess()) {
            pendingSaveFile = null
            doSaveFile(saveFile.base64, saveFile.fileName, saveFile.mimeType)
        } else if (saveFile != null) {
            Toast.makeText(this, "未开启“所有文件访问”权限，无法下载文件", Toast.LENGTH_SHORT).show()
        }
        val stripImages = pendingBackupStripImages
        if (stripImages != null && hasAllFilesAccess()) {
            pendingBackupStripImages = null
            startPlainBackupExport(stripImages)
        } else if (stripImages != null) {
            pendingBackupStripImages = null
            Toast.makeText(this, "未开启“所有文件访问”权限，无法导出备份", Toast.LENGTH_SHORT).show()
        }
    }

    private val fileChooserLauncher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val callback = filePathCallback ?: return@registerForActivityResult
        filePathCallback = null
        val data = result.data
        if (result.resultCode == Activity.RESULT_OK && data != null) {
            val uris: Array<Uri>? = when {
                data.clipData != null && data.clipData!!.itemCount > 0 -> {
                    val clip = data.clipData!!
                    Array(clip.itemCount) { clip.getItemAt(it).uri }
                }
                data.data != null -> arrayOf(data.data!!)
                else -> null
            }
            if (uris != null) {
                callback.onReceiveValue(uris)
                return@registerForActivityResult
            }
        }
        callback.onReceiveValue(null)
    }

    private val restoreBackup = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri == null) return@registerForActivityResult
        handleBackupRestore(uri)
    }

    private val notifyPermissionLauncher = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WebAssetLoader.initialize(applicationContext)
        webView = WebView(this)
        webView.loadRoleplayContent()
        webView.webViewClient = createRoleplayClient()
        webView.webChromeClient = createChromeClient()
        webView.addJavascriptInterface(RoleplayHubNativeBridge(this), "RoleplayHubNative")
        webView.setDownloadListener { url, _, contentDisposition, mimeType, _ ->
            runOnUiThread {
                if (hasAllFilesAccess()) {
                    doDownload(PendingDownload(url, contentDisposition, mimeType))
                } else {
                    pendingDownload = PendingDownload(url, contentDisposition, mimeType)
                    promptAllFilesAccess(null)
                }
            }
        }
        webView.loadUrl(WebAssetLoader.START_URL)

        val btn = ImageView(this)
        btn.setImageResource(R.drawable.ic_menu_more)
        btn.setBackgroundResource(R.drawable.fab_menu_bg)
        btn.contentDescription = "更多"
        btn.scaleType = ImageView.ScaleType.CENTER
        btn.elevation = 6f * resources.displayMetrics.density
        val lp = FrameLayout.LayoutParams(dp(48), dp(48), Gravity.END or Gravity.BOTTOM)
        lp.setMargins(0, 0, dp(16), dp(120))
        btn.layoutParams = lp
        menuBtn = btn

        val root = FrameLayout(this)
        root.addView(webView, FrameLayout.LayoutParams(-1, -1))
        root.addView(btn)
        setContentView(root)
        window.setBackgroundDrawable(ColorDrawable(Color.parseColor("#f9fafb")))
        setupDraggableButton(btn, root)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (handlingBack) return
                handlingBack = true
                webView.evaluateJavascript("window.RPHubBack ? window.RPHubBack() : false") { result ->
                    handlingBack = false
                    if (result != "true") {
                        isEnabled = false
                        onBackPressedDispatcher.onBackPressed()
                    }
                }
            }
        })

        window.decorView.post {
            if (!hasAllFilesAccess()) {
                promptAllFilesAccess(null)
            }
        }
    }

    private fun createRoleplayClient(): WebViewClient {
        val loader: WebViewAssetLoader = WebAssetLoader.buildLoader(this)
        return object : WebViewClientCompat() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                return loader.shouldInterceptRequest(request.url)
            }
        }
    }

    private fun createChromeClient(): WebChromeClient {
        return object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView,
                callback: ValueCallback<Array<Uri>>,
                fileChooserParams: FileChooserParams
            ): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                return try {
                    val intent = fileChooserParams.createIntent()
                    fileChooserLauncher.launch(intent)
                    true
                } catch (e: Exception) {
                    filePathCallback = null
                    callback.onReceiveValue(null)
                    false
                }
            }
        }
    }

    fun setFullscreen(enabled: Boolean) {
        runOnUiThread {
            isFullscreen = enabled
            val w = window
            webView.setBackgroundColor(Color.parseColor("#f9fafb"))
            if (enabled) {
                savedStatusBarColor = w.statusBarColor
                savedNavigationBarColor = w.navigationBarColor
                w.statusBarColor = 0
                w.navigationBarColor = 0
                applyImmersiveFlags()
            } else {
                w.statusBarColor = savedStatusBarColor
                w.navigationBarColor = savedNavigationBarColor
                w.decorView.systemUiVisibility = 0
            }
            w.decorView.postDelayed({
                webView.requestLayout()
                webView.evaluateJavascript("window.dispatchEvent(new Event('resize'));", null)
            }, 200)
        }
    }

    private fun applyImmersiveFlags() {
        window.decorView.systemUiVisibility = (
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        or View.SYSTEM_UI_FLAG_FULLSCREEN
                        or View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        or View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                        or View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                        or View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                )
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus && isFullscreen) {
            applyImmersiveFlags()
        }
    }

    private fun setupDraggableButton(btn: ImageView, root: FrameLayout) {
        touchSlop = ViewConfiguration.get(this).scaledTouchSlop
        btn.setOnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downRawX = event.rawX
                    downRawY = event.rawY
                    dragged = false
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (!dragged) showMenu()
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = event.rawX - downRawX
                    val dy = event.rawY - downRawY
                    if (Math.abs(dx) > touchSlop || Math.abs(dy) > touchSlop) {
                        dragged = true
                        val lp = btn.layoutParams as FrameLayout.LayoutParams
                        if (lp.gravity != (Gravity.START or Gravity.TOP)) {
                            lp.gravity = Gravity.START or Gravity.TOP
                            lp.leftMargin = btn.left
                            lp.topMargin = btn.top
                            lp.rightMargin = 0
                            lp.bottomMargin = 0
                        }
                        val maxX = maxOf(root.width - btn.width, 0)
                        val maxY = maxOf(root.height - btn.height, 0)
                        lp.leftMargin = (lp.leftMargin + dx.toInt()).coerceIn(0, maxX)
                        lp.topMargin = (lp.topMargin + dy.toInt()).coerceIn(0, maxY)
                        btn.layoutParams = lp
                        downRawX = event.rawX
                        downRawY = event.rawY
                    }
                    true
                }
                else -> true
            }
        }
    }

    private fun showMenu() {
        val popup = PopupMenu(this, menuBtn, Gravity.END)
        popup.menu.add(0, 2, 1, R.string.menu_export)
        popup.menu.add(0, 3, 2, "恢复数据备份")
        popup.menu.add(0, 4, 3, "所有文件管理权限")
        popup.menu.add(0, 5, 4, "电池优化白名单")
        popup.setOnMenuItemClickListener { item: MenuItem ->
            when (item.itemId) {
                2 -> {
                    showExportSubMenu()
                    true
                }
                3 -> {
                    restoreBackup.launch(arrayOf("application/zip", "application/octet-stream", "image/png", "application/json", "application/x-ndjson"))
                    true
                }
                4 -> {
                    if (hasAllFilesAccess()) {
                        openAllFilesAccessSettings()
                    } else {
                        promptAllFilesAccess(null)
                    }
                    true
                }
                5 -> {
                    requestIgnoreBatteryOptimizations()
                    true
                }
                else -> true
            }
        }
        popup.show()
    }

    private fun showExportSubMenu() {
        AlertDialog.Builder(this)
            .setTitle("导出数据备份")
            .setItems(arrayOf("导出完整数据", "导出精简版（聊天记录不含图片）")) { _, which ->
                startPlainBackupExport(stripImages = which == 1)
            }
            .setNegativeButton("取消", null)
            .show()
    }

    private fun startPlainBackupExport(stripImages: Boolean) {
        if (!hasAllFilesAccess()) {
            pendingBackupStripImages = stripImages
            Toast.makeText(this, "需要“所有文件访问”权限才能导出到下载目录", Toast.LENGTH_SHORT).show()
            promptAllFilesAccess(null)
            return
        }
        Toast.makeText(this, "正在准备导出…", Toast.LENGTH_SHORT).show()
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED
        ) {
            notifyPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        BackupExportService.startExport(this)
        webView.evaluateJavascript(
            "window.RPHubPlainBackup && typeof window.RPHubPlainBackup.exportAll === 'function' ? (window.RPHubPlainBackup.exportAll($stripImages), 'ok') : 'unavailable'"
        ) { result ->
            val value = result?.trim()?.trim('"')
            if (value == "unavailable") {
                runOnUiThread {
                    Toast.makeText(this, "页面尚未就绪，请稍后再试", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    fun onBackupProgress(done: Int, total: Int, stage: String) {
        BackupExportService.updateProgress(applicationContext, done, total, stage)
    }

    fun beginPlainBackup(fileCount: Int) {
        plainBackupReceiver.begin(fileCount)
    }

    fun beginPlainBackupFile(path: String, size: Int) {
        plainBackupReceiver.beginFile(path)
    }

    fun addPlainBackupChunk(base64: String) {
        plainBackupReceiver.addChunk(base64)
    }

    fun endPlainBackupFile() {
        plainBackupReceiver.endFile()
    }

    fun finishPlainBackup() {
        val files = plainBackupReceiver.takeFiles()
        if (files.isEmpty()) {
            runOnUiThread { Toast.makeText(this, "没有可导出的数据", Toast.LENGTH_SHORT).show() }
            return
        }
        val stamp = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
        val fileName = "RoleplayHub_backup_" + stamp + ".zip"
        try {
            val downloadDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
            if (!downloadDir.exists() && !downloadDir.mkdirs()) {
                runOnUiThread { Toast.makeText(this, "无法创建下载目录", Toast.LENGTH_SHORT).show() }
                return
            }
            val target = java.io.File(downloadDir, fileName)
            BackupExportService.writeZip(this, files, target.absolutePath)
            runOnUiThread { Toast.makeText(this, "正在写入备份文件：Download/$fileName，进度见通知栏", Toast.LENGTH_LONG).show() }
        } catch (e: Exception) {
            runOnUiThread { Toast.makeText(this, "导出失败：" + (e.message ?: "未知错误"), Toast.LENGTH_SHORT).show() }
        }
    }

    private fun handleBackupRestore(uri: Uri) {
        val resolver = contentResolver
        val mime = resolver.getType(uri) ?: ""
        val name = resolveDisplayName(uri)
        val isZip = mime == "application/zip"
            || mime == "application/octet-stream"
            || name.endsWith(".zip", ignoreCase = true)
        if (isZip) {
            val files = PlainBackupManager.readZip(this, uri)
            if (files == null) {
                Toast.makeText(this, "备份读取失败", Toast.LENGTH_SHORT).show()
                return
            }
            if (PlainBackupManager.isPlainBackupZip(files)) {
                importPlainBackupFiles(files)
            } else {
                val ok = BackupManager.restoreData(this, uri)
                Toast.makeText(this, if (ok) "数据恢复成功，即将刷新页面" else "数据恢复失败", Toast.LENGTH_SHORT).show()
                if (ok) {
                    webView.postDelayed({ webView.reload() }, 400)
                }
            }
            return
        }
        val lowerName = name.lowercase(Locale.ROOT)
        if (lowerName.endsWith(".png") || lowerName.endsWith(".json") || lowerName.endsWith(".jsonl")) {
            val bytes = PlainBackupManager.readUriBytes(this, uri)
            if (bytes == null) {
                Toast.makeText(this, "文件读取失败", Toast.LENGTH_SHORT).show()
                return
            }
            importPlainBackupFiles(listOf(PlainBackupManager.PlainFile(name, bytes)))
        } else {
            Toast.makeText(this, "不支持的文件格式", Toast.LENGTH_SHORT).show()
        }
    }

    private fun importPlainBackupFiles(files: List<PlainBackupManager.PlainFile>) {
        val queue = ArrayDeque<String>()
        queue.add("window.RPHubPlainBackup ? window.RPHubPlainBackup.importBegin(${files.size}) : ''")
        for (file in files) {
            val base64 = PlainBackupManager.encodeBase64(file.bytes)
            val chunkSize = 256 * 1024
            var offset = 0
            while (offset < base64.length) {
                val end = minOf(offset + chunkSize, base64.length)
                val chunk = base64.substring(offset, end)
                val isLast = end >= base64.length
                queue.add(
                    "window.RPHubPlainBackup.importFileChunk(${JSONObject.quote(file.path)}, '$chunk', $isLast)"
                )
                offset = end
            }
        }
        queue.add("window.RPHubPlainBackup.importFinish()")
        drainImportQueue(queue)
    }

    private fun drainImportQueue(queue: ArrayDeque<String>) {
        val js = queue.pollFirst()
        if (js == null) {
            return
        }
        webView.evaluateJavascript(js) { drainImportQueue(queue) }
    }

    private fun resolveDisplayName(uri: Uri): String {
        var result: String? = null
        try {
            contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                if (cursor.moveToFirst()) {
                    val index = cursor.getColumnIndex(android.provider.OpenableColumns.DISPLAY_NAME)
                    if (index >= 0) result = cursor.getString(index)
                }
            }
        } catch (_: Exception) {
        }
        if (result.isNullOrBlank()) {
            result = uri.lastPathSegment
        }
        val name = result?.takeIf { it.isNotBlank() }
        return name ?: "backup"
    }

    fun requestSaveImage(url: String) {
        runOnUiThread {
            if (hasAllFilesAccess()) {
                doSaveImage(url)
            } else {
                promptAllFilesAccess(url)
            }
        }
    }

    fun requestSaveFile(base64: String, fileName: String, mimeType: String) {
        runOnUiThread {
            if (hasAllFilesAccess()) {
                doSaveFile(base64, fileName, mimeType)
            } else {
                pendingSaveFile = PendingSaveFile(base64, fileName, mimeType)
                promptAllFilesAccess(null)
            }
        }
    }

    private fun doSaveFile(base64: String, fileName: String, mimeType: String) {
        FileDownloader.saveBase64(base64, fileName, mimeType) { _, message ->
            runOnUiThread { Toast.makeText(this, message, Toast.LENGTH_SHORT).show() }
        }
    }

    private fun hasAllFilesAccess(): Boolean {
        return if (Build.VERSION.SDK_INT >= 30) {
            Environment.isExternalStorageManager()
        } else {
            ContextCompat.checkSelfPermission(this, Manifest.permission.WRITE_EXTERNAL_STORAGE) == android.content.pm.PackageManager.PERMISSION_GRANTED
        }
    }

    private fun promptAllFilesAccess(pendingUrl: String?) {
        if (pendingUrl != null) {
            pendingImageSaveUrl = pendingUrl
        }
        if (Build.VERSION.SDK_INT >= 30) {
            openAllFilesAccessSettings()
        } else {
            imageSavePermission.launch(Manifest.permission.WRITE_EXTERNAL_STORAGE)
        }
    }

    private fun openAllFilesAccessSettings() {
        try {
            val intent = Intent("android.settings.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION", Uri.parse("package:" + packageName))
            allFilesAccessLauncher.launch(intent)
        } catch (e: Exception) {
            try {
                allFilesAccessLauncher.launch(Intent("android.settings.MANAGE_ALL_FILES_ACCESS_PERMISSION"))
            } catch (e2: Exception) {
                Toast.makeText(this, "无法打开系统设置", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun doSaveImage(url: String) {
        ImageSaver.saveImageFromUrl(url, this) { _, message ->
            runOnUiThread { Toast.makeText(this, message, Toast.LENGTH_SHORT).show() }
        }
    }

    private fun doDownload(pending: PendingDownload) {
        try {
            val fileName = FileDownloader.resolveFileName(pending.url, pending.contentDisposition, pending.mimeType)
            DownloadService.start(this, pending.url, fileName, pending.mimeType)
            Toast.makeText(this, "开始下载：$fileName", Toast.LENGTH_SHORT).show()
            if (Build.VERSION.SDK_INT >= 33 &&
                ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED
            ) {
                notifyPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        } catch (e: Exception) {
            Toast.makeText(this, "下载失败：" + (e.message ?: "未知错误"), Toast.LENGTH_SHORT).show()
        }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    fun isIgnoringBatteryOptimizations(): Boolean {
        val powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager
        return powerManager?.isIgnoringBatteryOptimizations(packageName) ?: false
    }

    fun requestIgnoreBatteryOptimizations() {
        if (Build.VERSION.SDK_INT < 23) return
        if (isIgnoringBatteryOptimizations()) {
            Toast.makeText(this, "已在电池优化白名单中", Toast.LENGTH_SHORT).show()
            return
        }
        try {
            val intent = Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                data = Uri.parse("package:$packageName")
            }
            startActivity(intent)
        } catch (e: Exception) {
            Toast.makeText(this, "无法打开电池优化设置", Toast.LENGTH_SHORT).show()
        }
    }

    private var wakeLockRefCount = 0

    fun requestWakeLock() {
        val powerManager = getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return
        if (wakeLock == null) {
            wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "RoleplayHub:GenerationWakeLock").apply {
                setReferenceCounted(false)
            }
        }
        wakeLockRefCount++
        wakeLock?.takeIf { !it.isHeld }?.acquire(30 * 60 * 1000L)
    }

    fun releaseWakeLock() {
        if (wakeLockRefCount > 0) wakeLockRefCount--
        if (wakeLockRefCount <= 0) {
            wakeLockRefCount = 0
            wakeLock?.takeIf { it.isHeld }?.release()
        }
    }

    override fun onDestroy() {
        webView.destroy()
        super.onDestroy()
    }

    data class PendingDownload(val url: String, val contentDisposition: String?, val mimeType: String?)

    data class PendingSaveFile(val base64: String, val fileName: String, val mimeType: String)

    class PlainBackupReceiver {
        private val files = mutableListOf<PlainBackupManager.PlainFile>()
        private var currentName = ""
        private val buffer = StringBuilder()

        fun begin(fileCount: Int) {
            files.clear()
            currentName = ""
            buffer.setLength(0)
        }

        fun beginFile(path: String) {
            currentName = path
            buffer.setLength(0)
        }

        fun addChunk(base64: String) {
            buffer.append(base64)
        }

        fun endFile() {
            if (currentName.isNotBlank()) {
                val bytes = Base64.decode(buffer.toString(), Base64.DEFAULT)
                files.add(PlainBackupManager.PlainFile(currentName, bytes))
            }
            buffer.setLength(0)
        }

        fun takeFiles(): List<PlainBackupManager.PlainFile> = files.toList()
    }
}
