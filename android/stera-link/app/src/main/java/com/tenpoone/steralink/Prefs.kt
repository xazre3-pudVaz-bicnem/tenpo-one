package com.tenpoone.steralink

import android.content.Context
import android.content.SharedPreferences

/**
 * 端末に残す設定（サーバー・リンクコード）と、送れていない決済結果。
 * 結果はお金が動いたあとの大事なデータなので、サーバーへ送れるまで消さない。
 */
class Prefs(context: Context) {
    private val p: SharedPreferences = context.getSharedPreferences("stera-link", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = p.getString("serverUrl", DEFAULT_SERVER) ?: DEFAULT_SERVER
        set(v) = p.edit().putString("serverUrl", v).apply()

    var linkCode: String
        get() = p.getString("linkCode", "") ?: ""
        set(v) = p.edit().putString("linkCode", v).apply()

    var connected: Boolean
        get() = p.getBoolean("connected", false)
        set(v) = p.edit().putBoolean("connected", v).apply()

    var practiceMode: Boolean
        get() = p.getBoolean("practiceMode", false)
        set(v) = p.edit().putBoolean("practiceMode", v).apply()

    /** 決済アプリを呼んだ依頼（戻ってくるまで）。JSON の文字列 */
    var currentRequest: String?
        get() = p.getString("currentRequest", null)
        set(v) = p.edit().putString("currentRequest", v).apply()

    /** サーバーへ送れていない結果（POST の本文）。JSON の文字列 */
    var pendingResult: String?
        get() = p.getString("pendingResult", null)
        set(v) = p.edit().putString("pendingResult", v).apply()

    companion object {
        const val DEFAULT_SERVER = "https://www.tenpo-one.com"
    }
}
