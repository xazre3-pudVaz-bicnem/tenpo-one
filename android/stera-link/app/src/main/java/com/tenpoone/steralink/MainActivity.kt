package com.tenpoone.steralink

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.ArrayDeque
import java.util.Date
import java.util.Locale
import java.util.concurrent.Executors

/**
 * TENPO ONE 連携（stera terminal 用）
 *
 * しくみ（lib/stera.ts の冒頭と同じ）:
 *   1. レジ（iPad）で「stera で決済」→ サーバーの stera_payment_requests に1行
 *   2. このアプリが /api/stera/<リンクコード> を 1〜2 秒ごとに見て受け取り、
 *      stera 標準の決済アプリを Intent で呼ぶ（stera developers「決済アプリと連携する」）
 *   3. 決済アプリの結果を /api/stera/<リンクコード> に POST → レジが会計を確定してドロアを開く
 *
 * 守ること:
 *   - 結果は必ずサーバーへ届ける（届くまで Prefs.pendingResult に残して送り直す。お金が動いている）
 *   - 同じ依頼で決済アプリを2回呼ばない（サーバーが queued→sent にして1回しか渡さない。こちらは受け取ったら即 Intent）
 *   - 成功の判定は厳しめ（ErrorCode が空 かつ resultCode が SUCCESS のときだけ）。失敗側に倒す
 */
class MainActivity : AppCompatActivity() {

    private lateinit var prefs: Prefs
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private val clock = SimpleDateFormat("HH:mm:ss", Locale.JAPAN)
    private val logLines = ArrayDeque<String>()

    private lateinit var statusText: TextView
    private lateinit var detailText: TextView
    private lateinit var requestCard: View
    private lateinit var requestAmount: TextView
    private lateinit var requestType: TextView
    private lateinit var linkCodeInput: EditText
    private lateinit var serverInput: EditText
    private lateinit var practiceMode: CheckBox
    private lateinit var connectButton: Button
    private lateinit var logText: TextView

    /** つないでいる間 true（画面が前にあるとき回る） */
    private var polling = false
    /** 通信中（二重に呼ばない） */
    private var inFlight = false
    /** 決済アプリを呼んで戻ってくるまで true */
    private var paying = false

    private val tick = Runnable { tick() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        prefs = Prefs(this)

        statusText = findViewById(R.id.statusText)
        detailText = findViewById(R.id.detailText)
        requestCard = findViewById(R.id.requestCard)
        requestAmount = findViewById(R.id.requestAmount)
        requestType = findViewById(R.id.requestType)
        linkCodeInput = findViewById(R.id.linkCode)
        serverInput = findViewById(R.id.serverUrl)
        practiceMode = findViewById(R.id.practiceMode)
        connectButton = findViewById(R.id.connectButton)
        logText = findViewById(R.id.logText)
        findViewById<TextView>(R.id.versionText).text = getString(R.string.version_fmt, BuildConfig.VERSION_NAME)

        linkCodeInput.setText(SteraApi.formatLinkCode(prefs.linkCode))
        serverInput.setText(prefs.serverUrl)
        practiceMode.isChecked = prefs.practiceMode
        practiceMode.setOnCheckedChangeListener { _, on -> prefs.practiceMode = on }
        connectButton.setOnClickListener { if (prefs.connected) disconnect() else connect() }
        applyConnectedUi()
    }

    override fun onResume() {
        super.onResume()
        // 決済アプリを呼んだまま結果が戻らなかった（アプリが落ちた・端末の再起動）
        // → お金が動いたか分からないので「失敗」としてレジへ返し、記録に残す。端末の決済アプリの取引履歴で確認する
        val lost = prefs.currentRequest
        if (lost != null && !paying) {
            prefs.currentRequest = null
            val id = try { JSONObject(lost).getString("id") } catch (_: Exception) { null }
            if (id != null) {
                log("結果が取れませんでした（アプリが再起動）。決済アプリの取引履歴を確認してください")
                queueResult(id, "FAIL", null, mapOf("ErrorCode" to "LOST_RESULT"))
            }
        }
        if (prefs.connected) startPolling()
    }

    override fun onPause() {
        super.onPause()
        stopPolling()
    }

    override fun onDestroy() {
        super.onDestroy()
        io.shutdownNow()
    }

    // MARK: - つなぐ・切る

    private fun connect() {
        val code = SteraApi.normalizeLinkCode(linkCodeInput.text.toString())
        if (code == null) {
            setStatus("リンクコードは12文字です（0・O・1・I は使いません）", R.color.red)
            return
        }
        prefs.linkCode = code
        prefs.serverUrl = SteraApi.normalizeServer(serverInput.text.toString())
        prefs.connected = true
        linkCodeInput.setText(SteraApi.formatLinkCode(code))
        serverInput.setText(prefs.serverUrl)
        applyConnectedUi()
        setStatus(getString(R.string.status_connecting), R.color.ink2)
        log("つなぎます ${prefs.serverUrl} / ${SteraApi.formatLinkCode(code)}")
        startPolling()
    }

    private fun disconnect() {
        prefs.connected = false
        stopPolling()
        applyConnectedUi()
        setStatus(getString(R.string.status_idle), R.color.charcoal)
        detailText.text = ""
        log("切りました")
    }

    private fun applyConnectedUi() {
        val on = prefs.connected
        connectButton.text = getString(if (on) R.string.disconnect else R.string.connect)
        linkCodeInput.isEnabled = !on
        serverInput.isEnabled = !on
    }

    // MARK: - ポーリング

    private fun startPolling() {
        if (polling) return
        polling = true
        main.removeCallbacks(tick)
        main.post(tick)
    }

    private fun stopPolling() {
        polling = false
        main.removeCallbacks(tick)
    }

    private fun schedule(delayMs: Long) {
        main.removeCallbacks(tick)
        if (polling) main.postDelayed(tick, delayMs)
    }

    private fun tick() {
        if (!polling || inFlight || paying) return
        val server = prefs.serverUrl
        val code = prefs.linkCode
        if (code.isEmpty()) { disconnect(); return }
        inFlight = true

        // 送れていない結果があれば、それを先に（新しい依頼より優先。お金が動いている）
        val pending = prefs.pendingResult
        if (pending != null) {
            setStatus(getString(R.string.status_sending), R.color.ink2)
            io.execute {
                val r = SteraApi.postResult(server, code, JSONObject(pending))
                main.post { inFlight = false; handlePostResult(r) }
            }
            return
        }

        io.execute {
            val r = SteraApi.poll(server, code, BuildConfig.VERSION_NAME)
            main.post { inFlight = false; handlePoll(r) }
        }
    }

    private fun handlePoll(r: SteraApi.PollResult) {
        if (!polling) return
        when (r) {
            is SteraApi.PollResult.Ok -> {
                detailText.text = listOfNotNull(r.storeName, r.terminalName.ifEmpty { null }).joinToString(" · ")
                val req = r.request
                if (req != null) {
                    log("会計を受け取りました ${PaymentTypes.yen(req.amount)} ${PaymentTypes.label(req.paymentType)}")
                    startPayment(req)
                } else {
                    setStatus(getString(R.string.status_waiting), R.color.green)
                    schedule(1500)
                }
            }
            SteraApi.PollResult.NotFound -> {
                setStatus(getString(R.string.status_not_found), R.color.red)
                schedule(5000)
            }
            is SteraApi.PollResult.Error -> {
                setStatus(getString(R.string.status_offline), R.color.amber)
                detailText.text = r.message
                schedule(3000)
            }
        }
    }

    // MARK: - 決済アプリ（公開仕様：stera developers「決済アプリと連携する」）

    private fun startPayment(req: SteraApi.PaymentRequest) {
        paying = true
        prefs.currentRequest = req.toJson().toString()
        requestAmount.text = PaymentTypes.yen(req.amount)
        requestType.text = "${PaymentTypes.label(req.paymentType)} · ${PaymentTypes.transactionLabel(req.transactionType)} · 伝票 ${req.slipNumber}"
        requestCard.visibility = View.VISIBLE
        setStatus(getString(R.string.status_paying), R.color.terracotta)

        val intent = Intent().setClassName(PAYMENT_PACKAGE, PAYMENT_ACTIVITY)
        // 練習モード（テスト用）はアプリ側のチェックで上書きできる。通常はサーバーの値（"1"）
        intent.putExtra("TransactionMode", if (prefs.practiceMode) "2" else req.transactionMode)
        intent.putExtra("TransactionType", req.transactionType)
        intent.putExtra("Amount", req.amount)
        intent.putExtra("Tax", req.tax)
        intent.putExtra("PaymentType", req.paymentType)
        intent.putExtra("SlipNumber", req.slipNumber)
        try {
            @Suppress("DEPRECATION")
            startActivityForResult(intent, REQ_PAYMENT)
        } catch (e: ActivityNotFoundException) {
            paying = false
            prefs.currentRequest = null
            requestCard.visibility = View.GONE
            setStatus(getString(R.string.status_no_payment_app), R.color.red)
            log("決済アプリが見つかりません")
            queueResult(req.id, "FAIL", null, mapOf("ErrorCode" to "NO_PAYMENT_APP"))
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_PAYMENT) return
        paying = false
        requestCard.visibility = View.GONE

        val current = prefs.currentRequest
        prefs.currentRequest = null
        val id = try { current?.let { JSONObject(it).getString("id") } } catch (_: Exception) { null }
        if (id == null) {
            log("戻りました（依頼が分かりません）resultCode=$resultCode")
            return
        }

        val extras = HashMap<String, String>()
        data?.extras?.let { b ->
            for (k in b.keySet()) {
                val v = b.get(k) ?: continue
                extras[k] = v.toString()
            }
        }
        val outcome = outcomeOf(resultCode, extras)
        log("決済アプリから戻りました $outcome resultCode=$resultCode PaymentType=${extras["PaymentType"] ?: "-"} ErrorCode=${extras["ErrorCode"] ?: "-"}")
        queueResult(id, outcome, resultCode, extras)
    }

    /**
     * 成功は「ErrorCode が空 かつ resultCode が SUCCESS」のときだけ。それ以外は失敗側に倒す
     * （レジが成功と受け取ると会計を確定してドロアを開くため、取れていないお金を成功にしない）。
     * サーバーは resultCode と extras をそのまま記録するので、実機で値を見て RESULT_* を合わせること。
     */
    private fun outcomeOf(resultCode: Int, extras: Map<String, String>): String {
        val errorCode = extras["ErrorCode"] ?: ""
        if (errorCode.isNotEmpty()) return "FAIL"
        return when (resultCode) {
            RESULT_SUCCESS -> "SUCCESS"
            RESULT_CANCEL -> "CANCEL"
            else -> "FAIL"
        }
    }

    // MARK: - 結果をレジへ

    private fun queueResult(id: String, outcome: String, resultCode: Int?, extras: Map<String, String>) {
        val body = JSONObject()
            .put("id", id)
            .put("outcome", outcome)
            .put("resultCode", resultCode ?: JSONObject.NULL)
            .put("extras", JSONObject(extras as Map<*, *>))
        prefs.pendingResult = body.toString()
        setStatus(getString(R.string.status_sending), R.color.ink2)
        if (polling) schedule(0)
    }

    private fun handlePostResult(r: SteraApi.PostResult) {
        when (r) {
            is SteraApi.PostResult.Ok -> {
                prefs.pendingResult = null
                log("結果をレジへ送りました（${r.status ?: "ok"}）")
                setStatus(getString(R.string.status_waiting), R.color.green)
                schedule(500)
            }
            is SteraApi.PostResult.Rejected -> {
                // 依頼が見つからない等：送り直しても変わらないので捨てる（記録には残す）
                prefs.pendingResult = null
                log("レジが結果を受け付けませんでした: ${r.error}")
                setStatus(getString(R.string.status_waiting), R.color.amber)
                schedule(1500)
            }
            is SteraApi.PostResult.Error -> {
                setStatus(getString(R.string.status_result_pending), R.color.amber)
                detailText.text = r.message
                schedule(3000)
            }
        }
    }

    // MARK: - 表示

    private fun setStatus(text: String, colorRes: Int) {
        statusText.text = text
        statusText.setTextColor(getColor(colorRes))
    }

    private fun log(line: String) {
        logLines.addFirst("${clock.format(Date())} $line")
        while (logLines.size > 8) logLines.removeLast()
        logText.text = logLines.joinToString("\n")
    }

    companion object {
        private const val REQ_PAYMENT = 2
        private const val PAYMENT_PACKAGE = "com.panasonic.smartpayment.android.salesmenu"
        private const val PAYMENT_ACTIVITY = "com.panasonic.smartpayment.android.salesmenu.MainActivity"

        /**
         * 決済アプリの resultCode（stera developers のサンプルは MainActivity.SUCCESS / FAIL / CANCEL と比べるが、
         * 公開ページに値が無い）。Android の標準値を仮に置く。実機（検証用端末）で確認して直す。
         */
        private const val RESULT_SUCCESS = Activity.RESULT_OK          // -1
        private const val RESULT_CANCEL = Activity.RESULT_CANCELED     // 0
    }
}
