package com.occulert.wearprobe;

import android.app.Activity;
import android.os.Bundle;
import android.widget.ArrayAdapter;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.Spinner;
import android.widget.TextView;

import com.google.android.gms.wearable.CapabilityClient;
import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.Wearable;

import org.json.JSONException;

public final class SenderActivity extends Activity {
    private Button send;
    private TextView status;

    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        Spinner levels = new Spinner(this);
        levels.setAdapter(new ArrayAdapter<>(this, android.R.layout.simple_spinner_dropdown_item,
            new String[]{"alert", "watch", "critical", "tracking"}));
        send = new Button(this);
        send.setText("Send parked test pulse");
        status = new TextView(this);
        status.setText("Choose a test alert while parked.");
        content.addView(levels);
        content.addView(send);
        content.addView(status);
        setContentView(content);
        send.setOnClickListener(view -> sendFixture(levels.getSelectedItem().toString()));
    }

    private void sendFixture(String level) {
        send.setEnabled(false);
        status.setText("Finding nearby watch…");
        Wearable.getCapabilityClient(this)
            .getCapability(AlertMessage.CAPABILITY, CapabilityClient.FILTER_REACHABLE)
            .addOnSuccessListener(this, capability -> {
                String destination = null;
                for (Node node : capability.getNodes()) {
                    if (!node.isNearby()) continue;
                    if (destination != null) {
                        finishAttempt("Connect one nearby test watch.");
                        return;
                    }
                    destination = node.getId();
                }
                if (destination == null) {
                    finishAttempt("No nearby watch with the test app.");
                    return;
                }
                try {
                    byte[] data = AlertMessage.parkedFixture(level, System.currentTimeMillis());
                    Wearable.getMessageClient(this).sendMessage(destination, AlertMessage.PATH, data)
                        .addOnSuccessListener(this, id -> finishAttempt("Sent. Check the receipt on the watch."))
                        .addOnFailureListener(this, error -> finishAttempt("Send failed."));
                } catch (JSONException error) {
                    finishAttempt("Could not create the test message.");
                }
            })
            .addOnFailureListener(this, error -> finishAttempt("Watch connection unavailable."));
    }

    private void finishAttempt(String text) {
        status.setText(text);
        send.setEnabled(true);
    }

    @Override protected void onStop() {
        super.onStop();
        // Activity-bound Task listeners detach on stop; allow another manual attempt on return.
        finishAttempt("Ready for a parked test.");
    }
}
