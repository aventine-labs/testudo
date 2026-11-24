// Testudo Polyglot Crucible v1.1 - Zero-Dependency Idiomatic Java 21+ SDK
// File: packages/testudo-js/sdk/java/TestudoUnit.java
// Strict Rule 6: Zero em-dashes and zero en-dashes.

import java.util.List;
import java.util.Map;
import java.util.function.LongPredicate;

public final class TestudoUnit {
    public record ContractField(String name, int bitIndex, String type, boolean requiredByFrontend) {}

    private static String classifyJavaType(Object val) {
        if (val == null) return "null";
        if (val instanceof Boolean) return "boolean";
        if (val instanceof Number) return "number";
        if (val instanceof String) return "string";
        if (val instanceof List<?>) return "array";
        return "object";
    }

    public static int verifyBackendCassette(int requiredMask, List<ContractField> fields, Map<String, Object> payload) {
        int emittedMask = 0;
        int mismatches = 0;
        for (ContractField f : fields) {
            if (payload.containsKey(f.name())) {
                emittedMask |= (1 << f.bitIndex());
                if (!classifyJavaType(payload.get(f.name())).equals(f.type())) {
                    mismatches++;
                }
            }
        }
        if ((requiredMask & emittedMask) != requiredMask || mismatches > 0) {
            return -9861;
        }
        return 1;
    }

    public static void assertCurrencyCents(long actualCents, long expectedCents, long tolCents) {
        if (Math.abs(actualCents - expectedCents) > tolCents) {
            throw new AssertionError("Currency mismatch: " + actualCents + " vs " + expectedCents);
        }
    }

    public static int propLong(long minVal, long maxVal, int runs, LongPredicate pred) {
        long state = 0x517CC1B727220A95L;
        long span = Math.max(1L, maxVal - minVal + 1L);
        long[] edges = new long[]{0L, 1L, -1L, minVal, maxVal};
        int count = 0;
        for (long e : edges) {
            if (e >= minVal && e <= maxVal) {
                count++;
                if (!pred.test(e)) throw new AssertionError("Property falsified on edge " + e);
            }
        }
        while (count < runs) {
            state ^= (state << 13);
            state ^= (state >>> 7);
            state ^= (state << 17);
            long sample = minVal + Long.remainderUnsigned(state, span);
            count++;
            if (!pred.test(sample)) throw new AssertionError("Property falsified on sample " + sample);
        }
        return count;
    }

    @FunctionalInterface
    public interface CaseBody {
        int execute() throws Exception;
    }

    public static boolean runCase(String suite, String name, boolean cassetteVerified, CaseBody body) {
        long t0 = System.nanoTime();
        boolean ok = true;
        int assertions = 1;
        String err = null;
        try {
            assertions = body.execute();
        } catch (Throwable ex) {
            ok = false;
            err = ex.getMessage() == null ? ex.toString() : ex.getMessage().replace("\"", "\\\"");
        }
        long durUs = Math.max(1L, (System.nanoTime() - t0) / 1000L);
        StringBuilder sb = new StringBuilder(192);
        sb.append("{\"twep\":1,\"lang\":\"java\",\"tier\":\"unit\",\"suite\":\"").append(suite)
          .append("\",\"name\":\"").append(name)
          .append("\",\"ok\":").append(ok)
          .append(",\"durationUs\":").append(durUs)
          .append(",\"assertions\":").append(assertions)
          .append(",\"cassetteVerified\":").append(cassetteVerified);
        if (err != null) {
            sb.append(",\"error\":\"").append(err).append("\"");
        }
        sb.append("}");
        System.out.println(sb.toString());
        return ok;
    }
}
