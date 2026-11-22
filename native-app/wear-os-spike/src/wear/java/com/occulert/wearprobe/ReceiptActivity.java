package com.occulert.wearprobe;

import android.app.Activity;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.TextView;

public final class ReceiptActivity extends Activity implements SharedPreferences.OnSharedPreferenceChangeListener {
    private SharedPreferences receipt;
    private TextView text;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        text = new TextView(this);
        text.setGravity(Gravity.CENTER);
        text.setPadding(24, 12, 24, 12);
        setContentView(text);
        receipt = getSharedPreferences(WristAlertService.RECEIPTS, MODE_PRIVATE);
    }

    @Override protected void onStart() {
        super.onStart();
        receipt.registerOnSharedPreferenceChangeListener(this);
        render();
    }

    @Override protected void onStop() {
        receipt.unregisterOnSharedPreferenceChangeListener(this);
        super.onStop();
    }

    @Override public void onSharedPreferenceChanged(SharedPreferences prefs, String key) {
        render();
    }

    private void render() {
        if (!receipt.contains("at")) {
            text.setText("Waiting for a parked test from the phone.");
            return;
        }
        text.setText("Last receipt\n" + new java.util.Date(receipt.getLong("at", 0)).toLocaleString()
            + "\nArrival age " + receipt.getLong("ageMs", 0) + " ms\n"
            + (receipt.getBoolean("requested", false) ? "Pulse requested" : "No pulse requested"));
    }
}
