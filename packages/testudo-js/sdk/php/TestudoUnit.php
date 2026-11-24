<?php
declare(strict_types=1);

/**
 * Testudo Polyglot Crucible v1.1 - Zero-Dependency Idiomatic PHP 8+ SDK
 * File: packages/testudo-js/sdk/php/TestudoUnit.php
 * Strict Rule 6: Zero em-dashes and zero en-dashes.
 */

final class TestudoUnit
{
    private static function classifyType(mixed $val): string
    {
        if ($val === null) return 'null';
        if (is_bool($val)) return 'boolean';
        if (is_int($val) || is_float($val)) return 'number';
        if (is_string($val)) return 'string';
        if (is_array($val) && array_is_list($val)) return 'array';
        return 'object';
    }

    public static function verifyBackendCassette(array $cassette, array $payload): int
    {
        $reqMask = (int)($cassette['requiredFieldMask'] ?? 0);
        $emittedMask = 0;
        $mismatches = 0;
        foreach (($cassette['fields'] ?? []) as $f) {
            $name = (string)$f['name'];
            $bit = 1 << (int)$f['bitIndex'];
            if (array_key_exists($name, $payload)) {
                $emittedMask |= $bit;
                if (self::classifyType($payload[$name]) !== $f['type']) {
                    $mismatches++;
                }
            }
        }
        if (($reqMask & $emittedMask) !== $reqMask || $mismatches > 0) {
            return -9861;
        }
        return 1;
    }

    public static function assertCurrencyCents(int $actualCents, int $expectedCents, int $tolCents = 1): void
    {
        if (abs($actualCents - $expectedCents) > $tolCents) {
            throw new RuntimeException("Currency mismatch: {$actualCents} vs {$expectedCents} cents");
        }
    }

    public static function runCase(string $suite, string $name, bool $cassetteVerified, callable $fn): bool
    {
        $t0 = hrtime(true);
        $ok = true;
        $assertions = 1;
        $err = null;
        try {
            $res = $fn();
            if (is_int($res)) {
                $assertions = $res;
            }
        } catch (Throwable $ex) {
            $ok = false;
            $err = $ex->getMessage();
        }
        $durUs = max(1, intdiv(hrtime(true) - $t0, 1000));
        $rec = [
            'twep' => 1,
            'lang' => 'php',
            'tier' => 'unit',
            'suite' => $suite,
            'name' => $name,
            'ok' => $ok,
            'durationUs' => $durUs,
            'assertions' => $assertions,
            'cassetteVerified' => $cassetteVerified,
        ];
        if ($err !== null) {
            $rec['error'] = $err;
        }
        fwrite(STDOUT, json_encode($rec, JSON_UNESCAPED_SLASHES) . PHP_EOL);
        return $ok;
    }
}
