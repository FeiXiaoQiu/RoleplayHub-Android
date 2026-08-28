package com.roleplayhub.app

import android.content.Context
import android.media.MediaScannerConnection
import android.os.Environment
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale

object ImageSaver {

    private const val DIR_NAME = "RPHub"
    private const val NOMEDIA_CONTENT = "/storage/emulated/0/Download/RPHub"

    fun saveImageFromUrl(url: String, context: android.content.Context, onResult: (Boolean, String) -> Unit) {
        Thread {
            try {
                val downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                val dir = File(downloadsDir, DIR_NAME)
                if (!dir.exists() && !dir.mkdirs()) {
                    throw Exception("无法创建下载目录")
                }
                try {
                    val nomedia = File(dir, ".nomedia")
                    if (!nomedia.exists()) {
                        nomedia.writeText(NOMEDIA_CONTENT)
                    }
                } catch (e: Exception) {
                    // 忽略 .nomedia 写入失败
                }
                val (bytes, mime) = when {
                    url.startsWith("data:") -> parseDataUrl(url)
                    else -> download(url)
                }
                val name = "roleplayhub_" + System.currentTimeMillis() + "." + extensionForMime(mime)
                val file = File(dir, name)
                file.writeBytes(bytes)
                MediaScannerConnection.scanFile(context, arrayOf(file.absolutePath), arrayOf(mime), null)
                onResult(true, "图片已保存到 Download/RPHub")
            } catch (e: Exception) {
                onResult(false, "保存失败：" + (e.message ?: "未知错误"))
            }
        }.start()
    }

    private fun parseDataUrl(url: String): Pair<ByteArray, String> {
        val commaIndex = url.indexOf(',')
        if (commaIndex < 0) throw IllegalArgumentException("Data URL 格式错误")
        val header = url.substring(0, commaIndex)
        val base64Flag = ";base64"
        val isBase64 = header.contains(base64Flag, ignoreCase = true)
        if (!isBase64) throw IllegalArgumentException("只支持 base64 Data URL")
        val mime = header.substringAfter("data:", "").substringBefore(";").trim().takeIf { it.isNotEmpty() } ?: "image/png"
        val data = url.substring(commaIndex + 1)
        val bytes = android.util.Base64.decode(data, android.util.Base64.DEFAULT)
        return Pair(bytes, mime)
    }

    private fun download(url: String): Pair<ByteArray, String> {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = 15000
        connection.readTimeout = 60000
        connection.instanceFollowRedirects = true
        connection.useCaches = false
        try {
            val contentType = connection.contentType
            val mime = contentType?.substringBefore(';')?.trim()?.takeIf { it.startsWith("image/") } ?: "image/png"
            connection.inputStream.use { input ->
                return Pair(input.readBytes(), mime)
            }
        } finally {
            connection.disconnect()
        }
    }

    private fun extensionForMime(mime: String): String {
        return when (mime.toLowerCase(Locale.ROOT)) {
            "image/jpeg", "image/jpg" -> "jpg"
            "image/gif" -> "gif"
            "image/webp" -> "webp"
            else -> "png"
        }
    }
}
