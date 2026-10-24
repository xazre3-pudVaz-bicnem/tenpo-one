package com.tenpoone.steralink

import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * TENPO ONE のサーバー（app/api/stera/[code]/route.ts）とのやりとり。
 *   GET  /api/stera/<リンクコード>?v=<アプリの版>  … 生きている印＋待っている依頼を1件
 *   POST /api/stera/<リンクコード>  { id, outcome, resultCode, extras }  … 決済アプリの結果
 * 認証はリンクコードだけ（設定 ＞ 決済・端末 で発行。12文字）。
 * ネットワークは呼ぶ側がバックグラウンドのスレッドで動かす。
 */
object SteraApi {
    /** レジからの決済依頼（Intent の extras はすべて文字列：公開仕様） */
    data class PaymentRequest(
        val id: String,
        val transactionMode: String,
        val transactionType: String,
        val amount: String,
        val tax: String,
        val paymentType: String,
        val slipNumber: String,
    ) {
        fun toJson(): JSONObject = JSONObject()
            .put("id", id)
            .put("transactionMode", transactionMode)
            .put("transactionType", transactionType)
            .put("amount", amount)
            .put("tax", tax)
            .put("paymentType", paymentType)
            .put("slipNumber", slipNumber)

        companion object {
            fun fromJson(o: JSONObject): PaymentRequest = PaymentRequest(
                id = o.getString("id"),
                transactionMode = o.optString("transactionMode", "1"),
                transactionType = o.optString("transactionType", "1"),
                amount = o.optString("amount", ""),
                tax = o.optString("tax", "0"),
                paymentType = o.optString("paymentType", "01"),
                slipNumber = o.optString("slipNumber", "00001"),
            )
        }
    }

    sealed class PollResult {
        data class Ok(val terminalName: String, val storeName: String?, val request: PaymentRequest?) : PollResult()
        /** リンクコードが違う・端末が停止/削除（404 TERMINAL_NOT_FOUND） */
        object NotFound : PollResult()
        data class Error(val message: String) : PollResult()
    }

    sealed class PostResult {
        data class Ok(val status: String?) : PostResult()
        /** サーバーに届いたが受け付けられなかった（依頼が無いなど）。送り直しても変わらない */
        data class Rejected(val error: String) : PostResult()
        /** 届かなかった。あとで送り直す */
        data class Error(val message: String) : PostResult()
    }

    /** リンクコードの形をそろえる（大文字・区切りを取る）。lib/stera.ts normalizeLinkCode と同じ */
    private const val ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

    fun normalizeLinkCode(input: String): String? {
        val s = input.uppercase().filter { it.isLetterOrDigit() }
        if (s.length != 12) return null
        if (s.any { !ALPHABET.contains(it) }) return null
        return s
    }

    fun formatLinkCode(code: String): String = code.chunked(4).joinToString("-")

    fun normalizeServer(input: String): String {
        var s = input.trim().trimEnd('/')
        if (s.isEmpty()) s = Prefs.DEFAULT_SERVER
        if (!s.startsWith("http://") && !s.startsWith("https://")) s = "https://$s"
        return s
    }

    fun poll(server: String, code: String, appVersion: String): PollResult {
        val url = URL("$server/api/stera/$code?v=${URLEncoder.encode(appVersion, "UTF-8")}")
        return try {
            val conn = open(url, "GET")
            val status = conn.responseCode
            val body = readBody(conn)
            if (status == 404) return PollResult.NotFound
            if (status !in 200..299) return PollResult.Error("HTTP $status")
            val o = JSONObject(body)
            if (!o.optBoolean("ok", false)) {
                return if (o.optString("error") == "TERMINAL_NOT_FOUND") PollResult.NotFound else PollResult.Error(o.optString("error", "NG"))
            }
            val t = o.optJSONObject("terminal")
            val reqObj = if (o.isNull("request")) null else o.optJSONObject("request")
            PollResult.Ok(
                terminalName = t?.optString("name", "") ?: "",
                storeName = t?.let { if (it.isNull("storeName")) null else it.optString("storeName") },
                request = reqObj?.let { PaymentRequest.fromJson(it) },
            )
        } catch (e: Exception) {
            PollResult.Error(e.message ?: e.javaClass.simpleName)
        }
    }

    fun postResult(server: String, code: String, body: JSONObject): PostResult {
        val url = URL("$server/api/stera/$code")
        return try {
            val conn = open(url, "POST")
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            conn.doOutput = true
            conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val status = conn.responseCode
            val text = readBody(conn)
            val o = try { JSONObject(text) } catch (_: Exception) { JSONObject() }
            when {
                status in 200..299 && o.optBoolean("ok", false) -> PostResult.Ok(o.optString("status", null))
                status == 400 || status == 404 -> PostResult.Rejected(o.optString("error", "HTTP $status"))
                else -> PostResult.Error("HTTP $status")
            }
        } catch (e: Exception) {
            PostResult.Error(e.message ?: e.javaClass.simpleName)
        }
    }

    private fun open(url: URL, method: String): HttpURLConnection {
        val conn = url.openConnection() as HttpURLConnection
        conn.requestMethod = method
        conn.connectTimeout = 8000
        conn.readTimeout = 12000
        conn.useCaches = false
        conn.setRequestProperty("Accept", "application/json")
        conn.setRequestProperty("Cache-Control", "no-store")
        return conn
    }

    private fun readBody(conn: HttpURLConnection): String {
        val stream = if (conn.responseCode in 200..299) conn.inputStream else (conn.errorStream ?: return "")
        return BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { it.readText() }
    }
}
