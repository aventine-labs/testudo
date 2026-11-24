# frozen_string_literal: true

# Testudo Polyglot Crucible v1.1 - Zero-Dependency Idiomatic Ruby SDK
# File: packages/testudo-js/sdk/ruby/testudo_unit.rb
# Strict Rule 6: Zero em-dashes and zero en-dashes.

require "json"

module TestudoUnit
  module_function

  def classify_type(val)
    return "null" if val.nil?
    return "boolean" if val == true || val == false
    return "number" if val.is_a?(Numeric)
    return "string" if val.is_a?(String)
    return "array" if val.is_a?(Array)

    "object"
  end

  def verify_backend_cassette(cassette, payload)
    req_mask = Integer(cassette["requiredFieldMask"] || 0)
    emitted_mask = 0
    mismatches = 0
    (cassette["fields"] || []).each do |f|
      name = f["name"]
      bit = 1 << Integer(f["bitIndex"])
      if payload.key?(name)
        emitted_mask |= bit
        mismatches += 1 if classify_type(payload[name]) != f["type"]
      end
    end
    return -9861 if (req_mask & emitted_mask) != req_mask || mismatches.positive?

    1
  end

  def run_case(suite, name, cassette_verified: false)
    t0 = Process.clock_gettime(Process::CLOCK_MONOTONIC, :microsecond)
    ok = true
    assertions = 1
    err = nil
    begin
      res = yield
      assertions = res if res.is_a?(Integer)
    rescue StandardError => e
      ok = false
      err = e.message
    end
    dur_us = [1, Process.clock_gettime(Process::CLOCK_MONOTONIC, :microsecond) - t0].max
    rec = {
      twep: 1,
      lang: "ruby",
      tier: "unit",
      suite: suite,
      name: name,
      ok: ok,
      durationUs: dur_us,
      assertions: assertions,
      cassetteVerified: cassette_verified
    }
    rec[:error] = err unless err.nil?
    $stdout.puts(JSON.generate(rec))
    ok
  end
end
