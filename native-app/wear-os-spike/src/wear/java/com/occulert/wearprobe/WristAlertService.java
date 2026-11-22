package com.occulert.wearprobe;

import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.os.VibrationEffect;
import android.os.Vibrator;

import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.WearableListenerService;

public final class WristAlertService extends WearableListenerService {
    static final String RECEIPTS = "parked-wrist-receipt";

    @Override public void onMessageReceived(MessageEvent event) {
        SharedPreferences receipt = getSharedPreferences(RECEIPTS, MODE_PRIVATE);
        long now = System.currentTimeMillis();
        AlertMessage message = AlertMessage.accept(event.getPath(), event.getData(), now,
            receipt.getLong("at", 0));
        if (message == null) return;

        // Save the watermark before the side effect so a restart cannot replay the pulse.
        if (!receipt.edit().putLong("at", message.at).putLong("ageMs", now - message.at)
            .putBoolean("requested", false).commit()) return;
        Vibrator vibrator = getSystemService(Vibrator.class);
        long age = System.currentTimeMillis() - message.at;
        if (vibrator == null || !vibrator.hasVibrator() || age < 0 || age >= AlertMessage.FRESH_MS) return;
        vibrator.vibrate(VibrationEffect.createOneShot(180, VibrationEffect.DEFAULT_AMPLITUDE),
            new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build());
        receipt.edit().putBoolean("requested", true).apply();
    }
}
