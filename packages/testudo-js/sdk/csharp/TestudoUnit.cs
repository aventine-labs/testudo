// Testudo Polyglot Crucible v1.1 - Zero-Dependency Idiomatic C# / .NET SDK
// File: packages/testudo-js/sdk/csharp/TestudoUnit.cs
// Strict Rule 6: Zero em-dashes and zero en-dashes.

using System;
using System.Collections.Generic;
using System.Diagnostics;

namespace Aventine.Testudo
{
    public sealed record ContractField(string Name, int BitIndex, string Type, bool RequiredByFrontend);

    public static class TestudoUnit
    {
        private static string ClassifyType(object? v)
        {
            if (v is null) return "null";
            if (v is bool) return "boolean";
            if (v is int or long or float or double or decimal) return "number";
            if (v is string) return "string";
            if (v is System.Collections.IList) return "array";
            return "object";
        }

        public static int VerifyBackendCassette(
            int requiredMask,
            IReadOnlyList<ContractField> fields,
            IReadOnlyDictionary<string, object?> payload)
        {
            int emittedMask = 0;
            int mismatches = 0;
            foreach (var f in fields)
            {
                if (payload.TryGetValue(f.Name, out var val))
                {
                    emittedMask |= (1 << f.BitIndex);
                    if (ClassifyType(val) != f.Type) mismatches++;
                }
            }
            return ((requiredMask & emittedMask) != requiredMask || mismatches > 0) ? -9861 : 1;
        }

        public static bool RunCase(string suite, string name, bool cassetteVerified, Func<int> body)
        {
            var sw = Stopwatch.StartNew();
            bool ok = true;
            int assertions = 1;
            string? err = null;
            try
            {
                assertions = body();
            }
            catch (Exception ex)
            {
                ok = false;
                err = ex.Message.Replace("\"", "\\\"");
            }
            sw.Stop();
            long durUs = Math.Max(1L, (sw.ElapsedTicks * 1_000_000L) / Stopwatch.Frequency);
            string errField = err is null ? "" : $",\"error\":\"{err}\"";
            Console.WriteLine(
                $"{{\"twep\":1,\"lang\":\"csharp\",\"tier\":\"unit\",\"suite\":\"{suite}\",\"name\":\"{name}\",\"ok\":{(ok ? "true" : "false")},\"durationUs\":{durUs},\"assertions\":{assertions},\"cassetteVerified\":{(cassetteVerified ? "true" : "false")}{errField}}}"
            );
            return ok;
        }
    }
}
