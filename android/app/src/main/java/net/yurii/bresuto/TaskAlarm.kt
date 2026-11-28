package net.yurii.bresuto

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import org.json.JSONArray
import org.json.JSONObject

/**
 * タスクの期限の知らせ(2026-11-28 BRESUTO)。画面が、知らせるタスクの一覧 [{id, text, at(ミリ秒)}] を渡すたびに、全部を組み直す。
 * 繰り返しのタスクは、済みにすると画面が次の期限で渡し直す。再起動のあとも BootReceiver から組み直す。
 */
object TaskAlarm {
    const val CHANNEL = "bresuto_task_v1"
    const val EXTRA_TASK = "task"
    private fun prefs(ctx: Context) = ctx.getSharedPreferences("taskalarm", Context.MODE_PRIVATE)
    private fun req(id: String) = 50000 + (id.hashCode() and 0x3fff)

    fun ensureChannel(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            val ch = NotificationChannel(CHANNEL, "タスクの期限", NotificationManager.IMPORTANCE_HIGH)
            ch.description = "タスクの期限の知らせ"
            ch.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
            ch.enableVibration(true)
            nm.createNotificationChannel(ch)
        }
    }
    private fun pending(ctx: Context, id: String, text: String): PendingIntent =
        PendingIntent.getBroadcast(ctx, req(id), Intent(ctx, TaskAlarmReceiver::class.java).putExtra("id", id).putExtra("text", text),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

    /** 一覧を覚えて、全部を組み直す(前に組んだものは消す) */
    fun set(ctx: Context, json: String) {
        prefs(ctx).edit().putString("list", json).apply()
        schedule(ctx)
    }
    fun schedule(ctx: Context) {
        val am = ctx.getSystemService(AlarmManager::class.java)
        val p = prefs(ctx)
        for (old in (p.getString("ids", "") ?: "").split(",").filter { it.isNotEmpty() }) am.cancel(pending(ctx, old, ""))
        val list = try { JSONArray(p.getString("list", "[]")) } catch (_: Exception) { JSONArray() }
        val now = System.currentTimeMillis()
        val ids = mutableListOf<String>()
        for (i in 0 until list.length()) {
            val o: JSONObject = list.optJSONObject(i) ?: continue
            val id = o.optString("id"); val at = o.optLong("at"); val text = o.optString("text")
            if (id.isEmpty() || at <= now) continue
            val pi = pending(ctx, id, text)
            try {
                if (Alarm.canScheduleExact(ctx)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
                else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi)
            } catch (_: SecurityException) { am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi) }
            ids.add(id)
        }
        p.edit().putString("ids", ids.joinToString(",")).apply()
    }
    fun notify(ctx: Context, id: String, text: String) {
        ensureChannel(ctx)
        val open = Intent(ctx, MainActivity::class.java).apply { flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP; putExtra(EXTRA_TASK, id) }
        val pi = PendingIntent.getActivity(ctx, req(id) + 1, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val n = Notification.Builder(ctx, CHANNEL).setSmallIcon(R.drawable.ic_note).setContentTitle("タスクの期限").setContentText(text)
            .setContentIntent(pi).setAutoCancel(true).setCategory(Notification.CATEGORY_REMINDER).build()
        try { ctx.getSystemService(NotificationManager::class.java).notify(req(id), n) } catch (_: SecurityException) { }
    }
}

class TaskAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        TaskAlarm.notify(ctx, intent.getStringExtra("id") ?: return, intent.getStringExtra("text") ?: "")
    }
}
