// Testudo Polyglot Crucible v1.1 - Zero-Dependency Idiomatic Rust SDK
// File: packages/testudo-js/sdk/rust/testudo_unit.rs
// Strict Rule 6: Zero em-dashes and zero en-dashes.

use std::time::Instant;

pub struct ContractField<'a> {
    pub name: &'a str,
    pub bit_index: u32,
    pub field_type: &'a str,
    pub required_by_frontend: bool,
}

pub fn verify_backend_cassette(
    required_mask: u32,
    fields: &[ContractField<'_>],
    emitted_fields: &[(&str, &str)],
) -> i32 {
    let mut emitted_mask: u32 = 0;
    let mut type_mismatches: u32 = 0;

    for f in fields {
        for (k, actual_type) in emitted_fields {
            if *k == f.name {
                emitted_mask |= 1u32 << f.bit_index;
                if *actual_type != f.field_type {
                    type_mismatches += 1;
                }
            }
        }
    }

    if (required_mask & emitted_mask) != required_mask || type_mismatches > 0 {
        return -9861;
    }
    1
}

pub fn assert_currency_cents(actual_cents: i64, expected_cents: i64, tol_cents: i64) -> Result<(), String> {
    let diff = (actual_cents - expected_cents).abs();
    if diff > tol_cents {
        return Err(format!(
            "Currency mismatch: actual {} cents vs expected {} cents",
            actual_cents, expected_cents
        ));
    }
    Ok(())
}

pub fn prop_i64<F>(min_val: i64, max_val: i64, runs: usize, mut pred: F) -> Result<usize, String>
where
    F: FnMut(i64) -> bool,
{
    let mut state: u64 = 0x517CC1B727220A95;
    let span = ((max_val - min_val + 1).max(1)) as u64;
    let edges = [0, 1, -1, min_val, max_val];
    let mut count = 0usize;

    for &e in &edges {
        if e >= min_val && e <= max_val {
            count += 1;
            if !pred(e) {
                return Err(format!("Property falsified on edge input {}", e));
            }
        }
    }

    while count < runs {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        let sample = min_val + ((state % span) as i64);
        count += 1;
        if !pred(sample) {
            return Err(format!("Property falsified on sampled input {}", sample));
        }
    }
    Ok(count)
}

pub struct Suite<'a> {
    pub name: &'a str,
    failed: usize,
}

impl<'a> Suite<'a> {
    pub fn new(name: &'a str) -> Self {
        Self { name, failed: 0 }
    }

    pub fn case<F>(&mut self, case_name: &str, cassette_verified: bool, f: F)
    where
        F: FnOnce() -> Result<usize, String>,
    {
        let t0 = Instant::now();
        match f() {
            Ok(assertions) => {
                let us = t0.elapsed().as_micros().max(1);
                println!(
                    "{{\"twep\":1,\"lang\":\"rust\",\"tier\":\"unit\",\"suite\":\"{}\",\"name\":\"{}\",\"ok\":true,\"durationUs\":{},\"assertions\":{},\"cassetteVerified\":{}}}",
                    self.name, case_name, us, assertions, cassette_verified
                );
            }
            Err(err) => {
                self.failed += 1;
                let us = t0.elapsed().as_micros().max(1);
                let clean = err.replace('"', "\\\"");
                println!(
                    "{{\"twep\":1,\"lang\":\"rust\",\"tier\":\"unit\",\"suite\":\"{}\",\"name\":\"{}\",\"ok\":false,\"durationUs\":{},\"assertions\":1,\"error\":\"{}\"}}",
                    self.name, case_name, us, clean
                );
            }
        }
    }

    pub fn exit_code(&self) -> i32 {
        if self.failed > 0 { 1 } else { 0 }
    }
}
