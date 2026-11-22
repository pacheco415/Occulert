package com.occulert.wearprobe;

import org.json.JSONException;
import org.json.JSONObject;

import java.nio.charset.StandardCharsets;

// JSON transport of the four fields sent by native-app/lib/watchBridge.ts.
final class AlertMessage {
    static final String PATH = "/occulert-alert";
    static final String CAPABILITY = "occulert_parked_wrist_test";
    static final long FRESH_MS = 2_000;
    final long at;

    private AlertMessage(long at) {
        this.at = at;
    }

    static byte[] parkedFixture(String level, long at) throws JSONException {
        return new JSONObject().put("type", "occulert-alert").put("level", level)
            .put("perclos", 0.25).put("at", at).toString().getBytes(StandardCharsets.UTF_8);
    }

    static AlertMessage accept(String path, byte[] data, long now, long lastAt) {
        if (!PATH.equals(path) || data == null || data.length == 0 || data.length > 512) return null;
        try {
            JSONObject body = new JSONObject(new String(data, StandardCharsets.UTF_8));
            if (body.length() != 4 || !"occulert-alert".equals(body.opt("type"))) return null;
            Object level = body.opt("level");
            if (!"watch".equals(level) && !"tracking".equals(level)
                && !"alert".equals(level) && !"critical".equals(level)) return null;
            if (!(body.opt("perclos") instanceof Number) || !(body.opt("at") instanceof Number)) {
                return null;
            }
            double perclos = ((Number) body.get("perclos")).doubleValue();
            Number timestamp = (Number) body.get("at");
            long at = timestamp.longValue();
            if (!Double.isFinite(perclos) || perclos < 0 || perclos > 1
                || timestamp.doubleValue() != at || at <= 0 || at <= lastAt
                || at > now || now - at >= FRESH_MS) return null;
            return new AlertMessage(at);
        } catch (JSONException ignored) {
            return null;
        }
    }
}
