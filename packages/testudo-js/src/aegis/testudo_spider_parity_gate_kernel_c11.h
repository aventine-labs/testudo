/* ==========================================================================
 * AEGIS STAGE-2 C11 SHARED-MEMORY & SPSC HEADER (bin/aegisc v2.2.0)
 * Source File: testudo_spider_parity_gate_kernel.aeg
 * ABI Schema SHA-256: 9e7fa101a34af8616134220dc401b1553b60843d67401c1708856a92d8b186c0
 * Strict Rule 6: Zero em-dashes and zero en-dashes.
 * ========================================================================== */

#ifndef AEGIS_C11_TESTUDO_SPIDER_PARITY_GATE_KERNEL_H_INCLUDED
#define AEGIS_C11_TESTUDO_SPIDER_PARITY_GATE_KERNEL_H_INCLUDED

#include <stdint.h>
#include <stddef.h>
#include <stdbool.h>
#include <stdlib.h>
#include <limits.h>
#ifndef __cplusplus
#include <stdatomic.h>
#endif

#define AEGIS_ABI_SCHEMA_HASH_TESTUDO_SPIDER_PARITY_GATE_KERNEL "9e7fa101a34af8616134220dc401b1553b60843d67401c1708856a92d8b186c0"

#ifndef AEGIS_C11_CHECKED_RUNTIME_GUARD
#define AEGIS_C11_CHECKED_RUNTIME_GUARD
static inline void aegis_c11_trap(void) { abort(); }
static inline int64_t aegis_c11_add_i64(int64_t a, int64_t b) {
    int64_t r = 0;
    if (__builtin_add_overflow(a, b, &r)) { aegis_c11_trap(); }
    return r;
}
static inline uint64_t aegis_c11_add_u64(uint64_t a, uint64_t b) {
    uint64_t r = 0;
    if (__builtin_add_overflow(a, b, &r)) { aegis_c11_trap(); }
    return r;
}
static inline int64_t aegis_c11_sub_i64(int64_t a, int64_t b) {
    int64_t r = 0;
    if (__builtin_sub_overflow(a, b, &r)) { aegis_c11_trap(); }
    return r;
}
static inline uint64_t aegis_c11_sub_u64(uint64_t a, uint64_t b) {
    uint64_t r = 0;
    if (__builtin_sub_overflow(a, b, &r)) { aegis_c11_trap(); }
    return r;
}
static inline int64_t aegis_c11_mul_i64(int64_t a, int64_t b) {
    int64_t r = 0;
    if (__builtin_mul_overflow(a, b, &r)) { aegis_c11_trap(); }
    return r;
}
static inline uint64_t aegis_c11_mul_u64(uint64_t a, uint64_t b) {
    uint64_t r = 0;
    if (__builtin_mul_overflow(a, b, &r)) { aegis_c11_trap(); }
    return r;
}
static inline int64_t aegis_c11_neg_i64(int64_t a) {
    int64_t r = 0;
    if (__builtin_sub_overflow((int64_t)0, a, &r)) { aegis_c11_trap(); }
    return r;
}
static inline int64_t aegis_c11_div_i64(int64_t a, int64_t b) {
    if (b == 0 || (a == INT64_MIN && b == -1)) { aegis_c11_trap(); }
    return a / b;
}
static inline uint64_t aegis_c11_div_u64(uint64_t a, uint64_t b) {
    if (b == 0ULL) { aegis_c11_trap(); }
    return a / b;
}
static inline int64_t aegis_c11_rem_i64(int64_t a, int64_t b) {
    if (b == 0 || (a == INT64_MIN && b == -1)) { aegis_c11_trap(); }
    return a % b;
}
static inline uint64_t aegis_c11_rem_u64(uint64_t a, uint64_t b) {
    if (b == 0ULL) { aegis_c11_trap(); }
    return a % b;
}
static inline int64_t aegis_c11_shl_i64(int64_t a, int64_t b, bool b_signed) {
    if ((b_signed && b < 0) || (uint64_t)b >= 64ULL) { aegis_c11_trap(); }
    return (int64_t)((uint64_t)a << (unsigned int)b);
}
static inline uint64_t aegis_c11_shl_u64(uint64_t a, uint64_t b, bool b_signed) {
    if ((b_signed && (int64_t)b < 0) || b >= 64ULL) { aegis_c11_trap(); }
    return a << (unsigned int)b;
}
static inline int64_t aegis_c11_shr_i64(int64_t a, int64_t b, bool b_signed) {
    if ((b_signed && b < 0) || (uint64_t)b >= 64ULL) { aegis_c11_trap(); }
    return a >> (unsigned int)b;
}
static inline uint64_t aegis_c11_shr_u64(uint64_t a, uint64_t b, bool b_signed) {
    if ((b_signed && (int64_t)b < 0) || b >= 64ULL) { aegis_c11_trap(); }
    return a >> (unsigned int)b;
}
static inline int64_t aegis_c11_cast_s(int64_t v, bool src_signed, int64_t smin, int64_t smax) {
    if (!src_signed) {
        if ((uint64_t)v > (uint64_t)smax) { aegis_c11_trap(); }
        return v;
    }
    if (v < smin || v > smax) { aegis_c11_trap(); }
    return v;
}
static inline uint64_t aegis_c11_cast_u(uint64_t v, bool src_signed, uint64_t umax) {
    if (src_signed && (int64_t)v < 0) { aegis_c11_trap(); }
    if (v > umax) { aegis_c11_trap(); }
    return v;
}
static inline int64_t aegis_c11_abs_i64(int64_t x) {
    if (x == INT64_MIN) { aegis_c11_trap(); }
    return x < 0 ? -x : x;
}
static inline int64_t aegis_c11_min_i64(int64_t a, int64_t b) { return a < b ? a : b; }
static inline int64_t aegis_c11_max_i64(int64_t a, int64_t b) { return a > b ? a : b; }
static inline int64_t aegis_c11_clamp_i64(int64_t x, int64_t lo, int64_t hi) {
    if (lo > hi) { aegis_c11_trap(); }
    return x < lo ? lo : (x > hi ? hi : x);
}
static inline uint32_t aegis_c11_rotl_u32(uint32_t x, uint32_t r) {
    unsigned int s = r & 31u;
    return s == 0u ? x : ((x << s) | (x >> (32u - s)));
}
static inline uint32_t aegis_c11_rotr_u32(uint32_t x, uint32_t r) {
    unsigned int s = r & 31u;
    return s == 0u ? x : ((x >> s) | (x << (32u - s)));
}
static inline uint64_t aegis_c11_rotl_u64(uint64_t x, uint64_t r) {
    unsigned int s = (unsigned int)(r & 63ULL);
    return s == 0u ? x : ((x << s) | (x >> (64u - s)));
}
static inline uint64_t aegis_c11_rotr_u64(uint64_t x, uint64_t r) {
    unsigned int s = (unsigned int)(r & 63ULL);
    return s == 0u ? x : ((x >> s) | (x << (64u - s)));
}
static inline uint64_t aegis_c11_commit_fnv1a_64(uint64_t u) {
    uint64_t h = 0xcbf29ce484222325ULL;
    for (int i = 0; i < 8; ++i) {
        h = (h ^ ((u >> (i * 8)) & 0xffULL)) * 0x100000001b3ULL;
    }
    return h;
}
static inline uint64_t aegis_c11_isqrt_u64(uint64_t n) {
    if (n < 2ULL) { return n; }
    uint64_t op = n, res = 0ULL, one = 1ULL << 62;
    while (one > op) { one >>= 2; }
    while (one != 0ULL) {
        if (op >= res + one) {
            op -= res + one;
            res = (res >> 1) + one;
        } else {
            res >>= 1;
        }
        one >>= 2;
    }
    return res;
}
#if defined(__SIZEOF_INT128__)
__extension__ typedef __int128 aegis_c11_i128;
static inline int64_t aegis_c11_mul_div_i64(int64_t a, int64_t b, int64_t d) {
    if (d == 0) { aegis_c11_trap(); }
    aegis_c11_i128 q = ((aegis_c11_i128)a * (aegis_c11_i128)b) / (aegis_c11_i128)d;
    if (q < (aegis_c11_i128)INT64_MIN || q > (aegis_c11_i128)INT64_MAX) { aegis_c11_trap(); }
    return (int64_t)q;
}
static inline int64_t aegis_c11_mul_div_round_i64(int64_t a, int64_t b, int64_t d) {
    if (d == 0) { aegis_c11_trap(); }
    aegis_c11_i128 prod = (aegis_c11_i128)a * (aegis_c11_i128)b;
    aegis_c11_i128 q = prod / (aegis_c11_i128)d;
    aegis_c11_i128 rem = prod % (aegis_c11_i128)d;
    aegis_c11_i128 abs_rem2 = (rem < 0 ? -rem : rem) * 2;
    aegis_c11_i128 abs_d = d < 0 ? -(aegis_c11_i128)d : (aegis_c11_i128)d;
    if (abs_rem2 >= abs_d) {
        if ((prod > 0 && d > 0) || (prod < 0 && d < 0)) {
            q += 1;
        } else if (prod != 0) {
            q -= 1;
        }
    }
    if (q < (aegis_c11_i128)INT64_MIN || q > (aegis_c11_i128)INT64_MAX) { aegis_c11_trap(); }
    return (int64_t)q;
}
#else
static inline int64_t aegis_c11_mul_div_i64(int64_t a, int64_t b, int64_t d) {
    return aegis_c11_div_i64(aegis_c11_mul_i64(a, b), d);
}
static inline int64_t aegis_c11_mul_div_round_i64(int64_t a, int64_t b, int64_t d) {
    return aegis_c11_div_i64(aegis_c11_mul_i64(a, b), d);
}
#endif
static inline uint64_t aegis_c11_assert_eq(int64_t a, int64_t b) {
    if (a != b) { aegis_c11_trap(); }
    return 1ULL;
}
#endif /* AEGIS_C11_CHECKED_RUNTIME_GUARD */


#ifdef __cplusplus
#define AEGIS_C11_ALIGNAS(n) alignas(n)
#else
#define AEGIS_C11_ALIGNAS(n) _Alignas(n)
#endif

typedef struct TestudoSpiderParityAuditFrame64 {
    AEGIS_C11_ALIGNAS(64) uint32_t magic_u32;
    uint32_t mode_u32;
    int64_t verdict_code_i64;
    uint64_t cookie_hmac_lo64;
    uint64_t bundle_sha256_lo64;
    uint64_t untrusted_rejected_u64;
    uint64_t webauthn_cred_bytes_u64;
    uint32_t wire_status_u32;
    uint32_t spoof_status_u32;
    uint64_t flags_bitmask_u64;
} TestudoSpiderParityAuditFrame64;
#ifndef __cplusplus
_Static_assert(sizeof(TestudoSpiderParityAuditFrame64) == 64, "TestudoSpiderParityAuditFrame64 slot size mismatch");
#endif

static inline int64_t testudo_eval_spider_privileged_parity_gate(uint64_t is_bidi_mode, uint64_t raw_secret_leaks_count, uint64_t engine_and_enclave_ok, uint64_t closed_shadow_null_in_main, uint64_t closed_shadow_pierce_ok, uint64_t cross_origin_sop_blocked, uint64_t oopif_and_spider_ok, uint64_t untrusted_rejected_count, uint64_t trusted_click_and_type_ok, uint64_t user_activation_active, uint64_t webauthn_cred_id_bytes, uint64_t virtual_creds_count, uint64_t native_intrinsics_untouched, uint64_t doc_cookie_empty, uint64_t intercepted_status_code, uint64_t httponly_cookie_hmac_matched, uint64_t xray_chain_and_redaction_ok, uint64_t png_and_pdf_magic_ok, uint64_t spoofed_origin_status_code, uint64_t moz_extension_accepted) {
    (void)is_bidi_mode;
    (void)raw_secret_leaks_count;
    (void)engine_and_enclave_ok;
    (void)closed_shadow_null_in_main;
    (void)closed_shadow_pierce_ok;
    (void)cross_origin_sop_blocked;
    (void)oopif_and_spider_ok;
    (void)untrusted_rejected_count;
    (void)trusted_click_and_type_ok;
    (void)user_activation_active;
    (void)webauthn_cred_id_bytes;
    (void)virtual_creds_count;
    (void)native_intrinsics_untouched;
    (void)doc_cookie_empty;
    (void)intercepted_status_code;
    (void)httponly_cookie_hmac_matched;
    (void)xray_chain_and_redaction_ok;
    (void)png_and_pdf_magic_ok;
    (void)spoofed_origin_status_code;
    (void)moz_extension_accepted;
    if ((((uint64_t)(raw_secret_leaks_count)) > ((uint64_t)(0LL)))) {
        return ((int64_t)(aegis_c11_neg_i64((int64_t)(1LL))));
    }
    if (((((uint64_t)(is_bidi_mode)) == ((uint64_t)(1LL))) && (((uint64_t)(engine_and_enclave_ok)) == ((uint64_t)(0LL))))) {
        return ((int64_t)(aegis_c11_neg_i64((int64_t)(2LL))));
    }
    if (((((uint64_t)(closed_shadow_null_in_main)) == ((uint64_t)(0LL))) || (((uint64_t)(closed_shadow_pierce_ok)) == ((uint64_t)(0LL))))) {
        return ((int64_t)(aegis_c11_neg_i64((int64_t)(3LL))));
    }
    if (((((uint64_t)(cross_origin_sop_blocked)) == ((uint64_t)(0LL))) || (((uint64_t)(oopif_and_spider_ok)) == ((uint64_t)(0LL))))) {
        return ((int64_t)(aegis_c11_neg_i64((int64_t)(4LL))));
    }
    if ((((uint64_t)(untrusted_rejected_count)) < ((uint64_t)(1LL)))) {
        return ((int64_t)(aegis_c11_neg_i64((int64_t)(5LL))));
    }
    if (((((uint64_t)(trusted_click_and_type_ok)) == ((uint64_t)(0LL))) || (((uint64_t)(user_activation_active)) == ((uint64_t)(0LL))))) {
        return ((int64_t)(aegis_c11_neg_i64((int64_t)(6LL))));
    }
    if (((((uint64_t)(webauthn_cred_id_bytes)) < ((uint64_t)(16LL))) || (((uint64_t)(virtual_creds_count)) < ((uint64_t)(1LL))))) {
        return ((int64_t)(aegis_c11_neg_i64((int64_t)(7LL))));
    }
    if ((((uint64_t)(native_intrinsics_untouched)) == ((uint64_t)(0LL)))) {
        return ((int64_t)(aegis_c11_neg_i64((int64_t)(8LL))));
    }
    if ((((((uint64_t)(doc_cookie_empty)) == ((uint64_t)(0LL))) || (((uint64_t)(intercepted_status_code)) != ((uint64_t)(429LL)))) || (((uint64_t)(httponly_cookie_hmac_matched)) == ((uint64_t)(0LL))))) {
        return ((int64_t)(aegis_c11_neg_i64((int64_t)(9LL))));
    }
    if ((((uint64_t)(xray_chain_and_redaction_ok)) == ((uint64_t)(0LL)))) {
        return ((int64_t)(aegis_c11_neg_i64((int64_t)(10LL))));
    }
    if (((((uint64_t)(is_bidi_mode)) == ((uint64_t)(1LL))) && (((uint64_t)(png_and_pdf_magic_ok)) == ((uint64_t)(0LL))))) {
        return ((int64_t)(aegis_c11_neg_i64((int64_t)(11LL))));
    }
    if (((((uint64_t)(is_bidi_mode)) == ((uint64_t)(1LL))) && ((((uint64_t)(spoofed_origin_status_code)) != ((uint64_t)(403LL))) || (((uint64_t)(moz_extension_accepted)) == ((uint64_t)(0LL)))))) {
        return ((int64_t)(aegis_c11_neg_i64((int64_t)(12LL))));
    }
    return ((int64_t)(1LL));
    return (int64_t)0;
}

#endif /* AEGIS_C11_TESTUDO_SPIDER_PARITY_GATE_KERNEL_H_INCLUDED */
