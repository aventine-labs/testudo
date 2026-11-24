// ==============================================================================
// Testudo Polyglot Crucible v1.1 - Zero-Dependency Idiomatic C++20 Single-Header SDK
// File: packages/testudo-js/sdk/cpp/testudo_unit.hpp
// Strict Rule 6: Zero em-dashes and zero en-dashes.
// ==============================================================================

#ifndef TESTUDO_POLYGLOT_CPP20_UNIT_HPP_INCLUDED
#define TESTUDO_POLYGLOT_CPP20_UNIT_HPP_INCLUDED

#include <chrono>
#include <cmath>
#include <cstdint>
#include <functional>
#include <iostream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace testudo {

struct ContractField {
  std::string name;
  uint32_t bit_index;
  std::string type;
  bool required_by_frontend;
};

inline int verify_backend_cassette(
    uint32_t required_mask,
    const std::vector<ContractField>& fields,
    const std::vector<std::pair<std::string, std::string>>& emitted_fields
) {
  uint32_t emitted_mask = 0;
  uint32_t mismatches = 0;
  for (const auto& f : fields) {
    for (const auto& kv : emitted_fields) {
      if (kv.first == f.name) {
        emitted_mask |= (1u << f.bit_index);
        if (kv.second != f.type) ++mismatches;
      }
    }
  }
  if ((required_mask & emitted_mask) != required_mask || mismatches > 0) {
    return -9861;
  }
  return 1;
}

class Suite {
 public:
  explicit Suite(std::string suite_name) : suite_name_(std::move(suite_name)) {}

  void assert_true(bool cond, const std::string& msg = "Assertion failed") {
    ++assertions_;
    if (!cond) throw std::runtime_error(msg);
  }

  void assert_currency_cents(int64_t actual_cents, int64_t expected_cents, int64_t tol = 1) {
    ++assertions_;
    if (std::llabs(actual_cents - expected_cents) > tol) {
      throw std::runtime_error("Currency mismatch in cents");
    }
  }

  void prop_int64(int64_t min_v, int64_t max_v, size_t runs, const std::function<bool(int64_t)>& pred) {
    uint64_t state = 0x517CC1B727220A95ULL;
    const uint64_t span = static_cast<uint64_t>(std::max<int64_t>(1, max_v - min_v + 1));
    const int64_t edges[5] = {0, 1, -1, min_v, max_v};
    size_t count = 0;
    for (int64_t e : edges) {
      if (e >= min_v && e <= max_v) {
        ++assertions_;
        ++count;
        if (!pred(e)) throw std::runtime_error("Property falsified on edge value");
      }
    }
    while (count < runs) {
      state ^= state << 13;
      state ^= state >> 7;
      state ^= state << 17;
      int64_t sample = min_v + static_cast<int64_t>(state % span);
      ++assertions_;
      ++count;
      if (!pred(sample)) throw std::runtime_error("Property falsified on sampled value");
    }
  }

  void add(const std::string& name, std::function<void()> fn, bool cassette_verified = false) {
    cases_.push_back({name, std::move(fn), cassette_verified});
  }

  int run() {
    int failed = 0;
    for (auto& c : cases_) {
      size_t before = assertions_;
      auto t0 = std::chrono::steady_clock::now();
      bool ok = true;
      std::string err;
      try {
        c.fn();
      } catch (const std::exception& ex) {
        ok = false;
        err = ex.what();
      }
      auto dur_us = std::max<int64_t>(
          1,
          std::chrono::duration_cast<std::chrono::microseconds>(
              std::chrono::steady_clock::now() - t0
          ).count()
      );
      if (!ok) ++failed;
      std::cout << "{\"twep\":1,\"lang\":\"cpp\",\"tier\":\"unit\",\"suite\":\"" << suite_name_
                << "\",\"name\":\"" << c.name << "\",\"ok\":" << (ok ? "true" : "false")
                << ",\"durationUs\":" << dur_us
                << ",\"assertions\":" << (assertions_ - before)
                << ",\"cassetteVerified\":" << (c.cassette_verified ? "true" : "false");
      if (!ok) {
        std::cout << ",\"error\":\"" << err << "\"";
      }
      std::cout << "}\n";
    }
    return failed > 0 ? 1 : 0;
  }

 private:
  struct CaseEntry {
    std::string name;
    std::function<void()> fn;
    bool cassette_verified;
  };
  std::string suite_name_;
  size_t assertions_ = 0;
  std::vector<CaseEntry> cases_;
};

}  // namespace testudo

#define TESTUDO_ASSERT(cond) suite.assert_true((cond), #cond)
#define TESTUDO_ASSERT_EQ(a, b) suite.assert_true(((a) == (b)), #a " == " #b)

#endif  // TESTUDO_POLYGLOT_CPP20_UNIT_HPP_INCLUDED
