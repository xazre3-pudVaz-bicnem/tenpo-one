package com.tenpoone.steralink

/** 支払種別（PaymentType）の表示名。lib/stera.ts STERA_PAYMENT_TYPES と同じ */
object PaymentTypes {
    private val labels = mapOf(
        "01" to "クレジット",
        "02-01" to "iD",
        "02-02" to "交通系IC",
        "02-03" to "楽天Edy",
        "02-04" to "WAON",
        "02-05" to "nanaco",
        "02-06" to "QUICPay",
        "02-07" to "PiTaPa",
        "03" to "QRコード決済",
    )

    fun label(code: String): String = labels[code] ?: code

    fun transactionLabel(type: String): String = when (type) {
        "1" -> "売上"
        "2" -> "取消"
        "3" -> "返品"
        else -> type
    }

    fun yen(amount: String): String {
        val n = amount.toLongOrNull() ?: return amount
        return "¥" + String.format("%,d", n)
    }
}
