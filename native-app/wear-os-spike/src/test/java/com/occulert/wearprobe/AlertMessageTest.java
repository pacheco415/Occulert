package com.occulert.wearprobe;

import org.json.JSONObject;
import org.junit.Test;
import java.nio.charset.StandardCharsets;
import static org.junit.Assert.*;

public class AlertMessageTest {
    private static final long AT = 1_700_000_000_000L;
    private static final String PATH = "/occulert-alert";

    @Test public void senderUsesIphoneContractAndReceiverAcceptsEachCue() throws Exception {
        for (String level : new String[]{"tracking", "watch", "alert", "critical"}) {
            byte[] bytes = AlertMessage.parkedFixture(level, AT);
            JSONObject wire = new JSONObject(new String(bytes, StandardCharsets.UTF_8));
            assertEquals(4, wire.length());
            assertEquals("occulert-alert", wire.getString("type"));
            assertEquals(level, wire.getString("level"));
            assertEquals(0.25, wire.getDouble("perclos"), 0);
            assertEquals(AT, wire.getLong("at"));
            assertEquals(AT, AlertMessage.accept(PATH, bytes, AT, 0).at);
            assertEquals(AT, AlertMessage.accept(PATH, bytes, AT + 1999, AT - 1).at);
        }
    }

    @Test public void staleFutureDuplicateAndReorderedMessagesAreSilent() throws Exception {
        byte[] data = AlertMessage.parkedFixture("critical", AT);
        assertNull(AlertMessage.accept(PATH, data, AT + 2000, 0));
        assertNull(AlertMessage.accept(PATH, data, AT - 1, 0));
        assertNull(AlertMessage.accept(PATH, data, AT, AT));
        assertNull(AlertMessage.accept(PATH, data, AT + 20, AT + 10));
    }

    @Test public void rejectsMalformedStatusAndNonCueInputs() throws Exception {
        byte[] good = AlertMessage.parkedFixture("alert", AT);
        assertNull(AlertMessage.accept("/occulert-status", good, AT, 0));
        assertNull(AlertMessage.accept(PATH, new byte[513], AT, 0));
        assertNull(AlertMessage.accept(PATH, null, AT, 0));
        assertNull(AlertMessage.accept(PATH, "{".getBytes(StandardCharsets.UTF_8), AT, 0));
        for (Object[] invalid : new Object[][]{
            {"type", "occulert-status"}, {"level", "none"}, {"level", 1}, {"extra", 1},
            {"at", String.valueOf(AT)}, {"at", AT - 0.5}, {"at", -1},
            {"perclos", "0.25"}, {"perclos", -0.01}, {"perclos", 1.01}, {"level", null}
        }) {
            JSONObject body = new JSONObject(new String(good, StandardCharsets.UTF_8));
            body.put((String) invalid[0], invalid[1]);
            assertNull(AlertMessage.accept(PATH, body.toString().getBytes(StandardCharsets.UTF_8), AT, 0));
        }
    }
}
