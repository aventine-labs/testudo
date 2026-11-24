// ==============================================================================
// Standalone Zero-Shared-Code Native C++20 + OpenSSL + Z3-Aegis Falsification
// Oracle & ASan/UBSan Structure/Byte-Mutation Fuzzer (AL-DEV-482 & AL-DEV-491)
//
// Replaces legacy Python *_oracle.py scripts per AL-LANG-02 (Aegis-First Mandate).
// Links:
//   1. Z3-proven Aegis 2.0 gate kernel (testudo_spider_parity_gate_kernel.hpp)
//   2. External OpenSSL libcrypto HMAC(EVP_sha256(), ...) reference implementation
// Shares ZERO parser, WebSocket, DOM, Fiber-walking, or header-blinding code
// with TypeScript/JavaScript modules in packages/testudo-js/src/.
// Strict Rule 6: Zero em-dashes and zero en-dashes.
// ==============================================================================

#include <openssl/evp.h>
#include <openssl/hmac.h>

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <map>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

#include "../src/aegis/testudo_spider_parity_gate_kernel.hpp"

namespace {

constexpr const char* kForbiddenRawSecrets[] = {
    "RAW_SUPER_SECRET_COOKIE_99182",
    "sk_live_SUPER_SECRET_FIBER_KEY_777",
    "Bearer_TOP_SECRET_JWT_554433",
};

std::string computeExpectedBlindHashOpenSsl(std::string_view secretVal,
                                            std::string_view salt = "TESTUDO_HEADER_BLIND_V1") {
    unsigned char digest[EVP_MAX_MD_SIZE] = {0};
    unsigned int digestLen = 0;
    const unsigned char* res = HMAC(
        EVP_sha256(),
        salt.data(),
        static_cast<int>(salt.size()),
        reinterpret_cast<const unsigned char*>(secretVal.data()),
        secretVal.size(),
        digest,
        &digestLen
    );
    if (!res || digestLen < 8) {
        return "";
    }
    static constexpr char kHex[] = "0123456789abcdef";
    std::string hex16;
    hex16.reserve(16);
    for (unsigned int i = 0; i < 8; ++i) {
        hex16.push_back(kHex[(digest[i] >> 4) & 0x0F]);
        hex16.push_back(kHex[digest[i] & 0x0F]);
    }
    return hex16;
}

// ==============================================================================
// Minimal Strict RFC 8259 Recursive-Descent JSON Value & Parser (Depth-Bounded)
// ==============================================================================

struct JsonVal {
    enum class Kind { Null, Bool, Int, Str, Arr, Obj };
    Kind kind = Kind::Null;
    bool bVal = false;
    int64_t iVal = 0;
    std::string sVal;
    std::vector<JsonVal> arrVal;
    std::map<std::string, JsonVal> objVal;

    const JsonVal* field(const std::string& key) const {
        if (kind != Kind::Obj) return nullptr;
        auto it = objVal.find(key);
        return it == objVal.end() ? nullptr : &it->second;
    }

    bool getBool(const std::string& key, bool def = false) const {
        const JsonVal* f = field(key);
        return (f && f->kind == Kind::Bool) ? f->bVal : def;
    }

    int64_t getInt(const std::string& key, int64_t def = 0) const {
        const JsonVal* f = field(key);
        return (f && f->kind == Kind::Int) ? f->iVal : def;
    }

    std::string getStr(const std::string& key, const std::string& def = "") const {
        const JsonVal* f = field(key);
        return (f && f->kind == Kind::Str) ? f->sVal : def;
    }
};

class StrictJsonParser {
public:
    explicit StrictJsonParser(std::string_view src) : src_(src), pos_(0) {}

    bool parseRoot(JsonVal& out) {
        skipWs();
        if (!parseValue(out, 0)) return false;
        skipWs();
        return pos_ == src_.size();
    }

private:
    std::string_view src_;
    size_t pos_;

    void skipWs() {
        while (pos_ < src_.size()) {
            char c = src_[pos_];
            if (c == ' ' || c == '\t' || c == '\r' || c == '\n') ++pos_;
            else break;
        }
    }

    bool matchLit(std::string_view lit) {
        if (pos_ + lit.size() > src_.size()) return false;
        if (src_.substr(pos_, lit.size()) != lit) return false;
        pos_ += lit.size();
        return true;
    }

    bool parseString(std::string& out) {
        if (pos_ >= src_.size() || src_[pos_] != '"') return false;
        ++pos_;
        out.clear();
        while (pos_ < src_.size()) {
            char c = src_[pos_++];
            if (c == '"') return true;
            if (static_cast<unsigned char>(c) < 0x20) return false;
            if (c == '\\') {
                if (pos_ >= src_.size()) return false;
                char esc = src_[pos_++];
                switch (esc) {
                    case '"': out.push_back('"'); break;
                    case '\\': out.push_back('\\'); break;
                    case '/': out.push_back('/'); break;
                    case 'b': out.push_back('\b'); break;
                    case 'f': out.push_back('\f'); break;
                    case 'n': out.push_back('\n'); break;
                    case 'r': out.push_back('\r'); break;
                    case 't': out.push_back('\t'); break;
                    case 'u': {
                        if (pos_ + 4 > src_.size()) return false;
                        uint32_t cp = 0;
                        for (int i = 0; i < 4; ++i) {
                            char h = src_[pos_++];
                            cp <<= 4;
                            if (h >= '0' && h <= '9') cp |= static_cast<uint32_t>(h - '0');
                            else if (h >= 'a' && h <= 'f') cp |= static_cast<uint32_t>(h - 'a' + 10);
                            else if (h >= 'A' && h <= 'F') cp |= static_cast<uint32_t>(h - 'A' + 10);
                            else return false;
                        }
                        if (cp < 0x80) out.push_back(static_cast<char>(cp));
                        else if (cp < 0x800) {
                            out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
                            out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
                        } else {
                            out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
                            out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
                            out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
                        }
                        break;
                    }
                    default: return false;
                }
            } else {
                out.push_back(c);
            }
        }
        return false;
    }

    bool parseNumber(JsonVal& out) {
        size_t start = pos_;
        if (pos_ < src_.size() && src_[pos_] == '-') ++pos_;
        if (pos_ >= src_.size() || !std::isdigit(static_cast<unsigned char>(src_[pos_]))) return false;
        while (pos_ < src_.size() && std::isdigit(static_cast<unsigned char>(src_[pos_]))) ++pos_;
        bool isFloat = false;
        if (pos_ < src_.size() && src_[pos_] == '.') {
            isFloat = true;
            ++pos_;
            if (pos_ >= src_.size() || !std::isdigit(static_cast<unsigned char>(src_[pos_]))) return false;
            while (pos_ < src_.size() && std::isdigit(static_cast<unsigned char>(src_[pos_]))) ++pos_;
        }
        if (pos_ < src_.size() && (src_[pos_] == 'e' || src_[pos_] == 'E')) {
            isFloat = true;
            ++pos_;
            if (pos_ < src_.size() && (src_[pos_] == '+' || src_[pos_] == '-')) ++pos_;
            if (pos_ >= src_.size() || !std::isdigit(static_cast<unsigned char>(src_[pos_]))) return false;
            while (pos_ < src_.size() && std::isdigit(static_cast<unsigned char>(src_[pos_]))) ++pos_;
        }
        std::string token(src_.substr(start, pos_ - start));
        out.kind = JsonVal::Kind::Int;
        if (isFloat) {
            out.iVal = static_cast<int64_t>(std::strtod(token.c_str(), nullptr));
        } else {
            out.iVal = std::strtoll(token.c_str(), nullptr, 10);
        }
        return true;
    }

    bool parseValue(JsonVal& out, int depth) {
        if (depth > 48) return false;
        skipWs();
        if (pos_ >= src_.size()) return false;
        char c = src_[pos_];
        if (c == 'n') {
            if (!matchLit("null")) return false;
            out.kind = JsonVal::Kind::Null;
            return true;
        }
        if (c == 't') {
            if (!matchLit("true")) return false;
            out.kind = JsonVal::Kind::Bool;
            out.bVal = true;
            return true;
        }
        if (c == 'f') {
            if (!matchLit("false")) return false;
            out.kind = JsonVal::Kind::Bool;
            out.bVal = false;
            return true;
        }
        if (c == '"') {
            out.kind = JsonVal::Kind::Str;
            return parseString(out.sVal);
        }
        if (c == '-' || std::isdigit(static_cast<unsigned char>(c))) {
            return parseNumber(out);
        }
        if (c == '[') {
            ++pos_;
            out.kind = JsonVal::Kind::Arr;
            out.arrVal.clear();
            skipWs();
            if (pos_ < src_.size() && src_[pos_] == ']') {
                ++pos_;
                return true;
            }
            while (pos_ < src_.size()) {
                JsonVal elem;
                if (!parseValue(elem, depth + 1)) return false;
                out.arrVal.push_back(std::move(elem));
                skipWs();
                if (pos_ < src_.size() && src_[pos_] == ',') {
                    ++pos_;
                    continue;
                }
                if (pos_ < src_.size() && src_[pos_] == ']') {
                    ++pos_;
                    return true;
                }
                return false;
            }
            return false;
        }
        if (c == '{') {
            ++pos_;
            out.kind = JsonVal::Kind::Obj;
            out.objVal.clear();
            skipWs();
            if (pos_ < src_.size() && src_[pos_] == '}') {
                ++pos_;
                return true;
            }
            while (pos_ < src_.size()) {
                skipWs();
                std::string key;
                if (!parseString(key)) return false;
                skipWs();
                if (pos_ >= src_.size() || src_[pos_] != ':') return false;
                ++pos_;
                JsonVal val;
                if (!parseValue(val, depth + 1)) return false;
                out.objVal[std::move(key)] = std::move(val);
                skipWs();
                if (pos_ < src_.size() && src_[pos_] == ',') {
                    ++pos_;
                    continue;
                }
                if (pos_ < src_.size() && src_[pos_] == '}') {
                    ++pos_;
                    return true;
                }
                return false;
            }
            return false;
        }
        return false;
    }
};

struct OracleVerdict {
    bool ok = false;
    int64_t code = -99;
    std::string verdict;
};

const char* mapCodeToErrorName(int64_t code) {
    switch (code) {
        case -1: return "FAIL_PILLAR1_PLAINTEXT_SECRET";
        case -2: return "FAIL_BROWSER_ENGINE_OR_ENCLAVE_ISOLATION";
        case -3: return "FAIL_M2_CLOSED_SHADOW_ENCAPSULATION_OR_PIERCE";
        case -4: return "FAIL_M3_CROSS_ORIGIN_SOP_OR_OOPIF_SPIDER";
        case -5: return "FAIL_M1_UNTRUSTED_GUARD_NOT_PROVEN";
        case -6: return "FAIL_TRUSTED_INPUT_OR_USER_ACTIVATION";
        case -7: return "FAIL_VIRTUAL_WEBAUTHN_PASSKEY";
        case -8: return "FAIL_INTRINSIC_MONKEY_PATCHED";
        case -9: return "FAIL_HTTPONLY_COOKIE_OR_OUT_OF_PROCESS_INTERCEPT";
        case -10: return "FAIL_XRAY_COMPONENT_CHAIN_OR_PROP_REDACTION";
        case -11: return "FAIL_BINARY_PNG_OR_PDF_MAGIC_HEADER";
        case -12: return "FAIL_M5_BRIDGE_ORIGIN_SHIELD";
        default: return "FAIL_MALFORMED_BUNDLE_JSON";
    }
}

OracleVerdict evaluateEvidenceBundle(std::string_view rawJson, bool isBidiMode) {
    uint64_t rawSecretLeaks = 0;
    for (const char* secret : kForbiddenRawSecrets) {
        if (rawJson.find(secret) != std::string_view::npos) {
            ++rawSecretLeaks;
        }
    }

    JsonVal root;
    StrictJsonParser parser(rawJson);
    if (!parser.parseRoot(root) || root.kind != JsonVal::Kind::Obj) {
        if (rawSecretLeaks > 0) {
            return {false, -1, "FAIL_PILLAR1_PLAINTEXT_SECRET"};
        }
        return {false, -99, "FAIL_MALFORMED_BUNDLE_JSON"};
    }

    // Engine & Enclave check (BiDi mode)
    uint64_t engineAndEnclaveOk = 1;
    if (isBidiMode) {
        const JsonVal* meta = root.field("browserMeta");
        std::string ua = meta ? meta->getStr("userAgent") : "";
        bool isGecko = (ua.find("Firefox/") != std::string::npos) && (ua.find("Gecko/") != std::string::npos);
        bool enclaveIso = meta ? meta->getBool("enclaveIsolatedFromMainWorld") : false;
        engineAndEnclaveOk = (isGecko && enclaveIso) ? 1ULL : 0ULL;
    }

    // Test 1: Closed Shadow DOM
    const JsonVal* t1 = root.field("test1ClosedShadow");
    uint64_t closedNullInMain = (t1 && t1->getBool("mainWorldShadowRootWasNull")) ? 1ULL : 0ULL;
    bool statusUnlocked = t1 && (t1->getStr("vaultStatusAfterPierce") == "UNLOCKED:7391");
    bool hasClosedAncestry = false;
    if (t1) {
        const JsonVal* anc = t1->field("closedShadowAncestry");
        if (anc && anc->kind == JsonVal::Kind::Arr) {
            for (const auto& h : anc->arrVal) {
                if (h.getStr("mode") == "closed" && h.getStr("hostId") == "closed-host") {
                    hasClosedAncestry = true;
                    break;
                }
            }
        }
    }
    uint64_t closedPierceOk = (statusUnlocked && hasClosedAncestry) ? 1ULL : 0ULL;

    // Test 2: Cross-Origin OOPIF / Gecko Fission
    const JsonVal* t2 = root.field("test2CrossOriginOopif");
    uint64_t sopBlocked = (t2 && t2->getBool("mainWorldCrossOriginBlocked")) ? 1ULL : 0ULL;
    std::string rootOrigin = t2 ? t2->getStr("rootOrigin") : "";
    std::string childOrigin = t2 ? t2->getStr("childOrigin") : "";
    bool originsDistinct = !rootOrigin.empty() && !childOrigin.empty() && (rootOrigin != childOrigin);
    bool oopifConfirmed = t2 && (t2->getStr("oopifResultText") == "OOPIF_CONFIRMED:90210");
    bool hasOopifLayer = false;
    bool hasShadowLayer = false;
    if (t2) {
        const JsonVal* spider = t2->field("spiderTree");
        const JsonVal* children = spider ? spider->field("children") : nullptr;
        if (children && children->kind == JsonVal::Kind::Arr) {
            for (const auto& ch : children->arrVal) {
                std::string lk = ch.getStr("layerKind");
                if (lk == "cross-origin-oopif") hasOopifLayer = true;
                if (lk == "shadow-root") hasShadowLayer = true;
            }
        }
    }
    uint64_t oopifAndSpiderOk = (originsDistinct && oopifConfirmed && hasOopifLayer && hasShadowLayer) ? 1ULL : 0ULL;

    // Test 3: Trusted Input & Virtual CTAP2 WebAuthn
    const JsonVal* t3 = root.field("test3TrustedAndWebAuthn");
    uint64_t untrustedRej = static_cast<uint64_t>(std::clamp<int64_t>(t3 ? t3->getInt("untrustedRejectedCount") : 0, 0, 100000));
    bool trustedClick = t3 && t3->getBool("trustedApproved") && t3->getBool("lastEventIsTrusted");
    bool trustedType = t3 && (t3->getStr("trustedTypedValue") == "MS-DESK-2026");
    uint64_t trustedClickAndTypeOk = (trustedClick && trustedType) ? 1ULL : 0ULL;
    uint64_t userAct = (t3 && t3->getBool("userActivationWasActive")) ? 1ULL : 0ULL;
    uint64_t credBytes = static_cast<uint64_t>(std::clamp<int64_t>(t3 ? t3->getInt("webauthnCredentialIdLen") : 0, 0, 65536));
    uint64_t virtCreds = static_cast<uint64_t>(std::clamp<int64_t>(t3 ? t3->getInt("virtualCredentialsCount") : 0, 0, 65536));

    // Test 4: Browser Internals, OpenSSL HMAC Cookie Blinding & Out-of-Process Intercept
    const JsonVal* t4 = root.field("test4BrowserInternals");
    uint64_t nativeUntouched = (t4 && t4->getBool("nativeIntrinsicsUntouched")) ? 1ULL : 0ULL;
    uint64_t docCookieEmpty = (t4 && t4->field("documentCookieInPage") &&
                               t4->field("documentCookieInPage")->kind == JsonVal::Kind::Str &&
                               t4->getStr("documentCookieInPage").empty())
                                  ? 1ULL
                                  : 0ULL;
    uint64_t interceptStatus = static_cast<uint64_t>(std::clamp<int64_t>(t4 ? t4->getInt("intercepted429Status") : 0, 0, 65535));
    const std::string expectedHash = computeExpectedBlindHashOpenSsl("RAW_SUPER_SECRET_COOKIE_99182");
    uint64_t cookieHmacMatched = 0;
    if (t4 && !expectedHash.empty()) {
        const JsonVal* cookies = t4->field("observedCookies");
        if (cookies && cookies->kind == JsonVal::Kind::Arr) {
            for (const auto& c : cookies->arrVal) {
                if (c.getStr("name") == "session_secret" &&
                    c.getBool("httpOnly") &&
                    c.getBool("secure") &&
                    c.getStr("blindedValueHash") == expectedHash) {
                    cookieHmacMatched = 1;
                    break;
                }
            }
        }
    }

    // Test 5: X-Ray Component Chain & Redaction (+ PNG/PDF Magic Headers in BiDi mode)
    const JsonVal* t5 = isBidiMode ? root.field("test5XrayAndArtifacts") : root.field("test5XrayReport");
    if (!t5) t5 = root.field("test5XrayReport");
    bool hasTicket = false, hasDesk = false, hasRisk = false, redactedToken = false;
    if (t5) {
        const JsonVal* comps = t5->field("components");
        if (comps && comps->kind == JsonVal::Kind::Arr && !comps->arrVal.empty()) {
            for (const auto& comp : comps->arrVal) {
                std::string nm = comp.getStr("name");
                if (nm == "TradeTicketInput") hasTicket = true;
                if (nm == "InstitutionalOrderDesk") hasDesk = true;
                if (nm == "RiskGuardPanel") hasRisk = true;
            }
            const JsonVal* props0 = comps->arrVal[0].field("sanitizedProps");
            if (props0 && props0->getStr("apiToken") == "[REDACTED_PILLAR1]") {
                redactedToken = true;
            }
        }
    }
    uint64_t xrayOk = (hasTicket && hasDesk && hasRisk && redactedToken) ? 1ULL : 0ULL;

    uint64_t pngPdfOk = 1;
    uint64_t spoofStatus = 403;
    uint64_t mozAccepted = 1;
    if (isBidiMode) {
        pngPdfOk = (t5 && t5->getStr("pngMagicHex") == "89504e47" && t5->getStr("pdfMagicAscii") == "%PDF-") ? 1ULL : 0ULL;
        const JsonVal* t6 = root.field("test6BridgeOriginShield");
        spoofStatus = static_cast<uint64_t>(std::clamp<int64_t>(t6 ? t6->getInt("spoofedOriginStatus") : 0, 0, 65535));
        mozAccepted = (t6 && t6->getBool("mozExtensionAccepted")) ? 1ULL : 0ULL;
    }

    const int64_t rc = Aegis::Quant::testudo_eval_spider_privileged_parity_gate(
        isBidiMode ? 1ULL : 0ULL,
        std::min<uint64_t>(rawSecretLeaks, 100000ULL),
        engineAndEnclaveOk,
        closedNullInMain,
        closedPierceOk,
        sopBlocked,
        oopifAndSpiderOk,
        untrustedRej,
        trustedClickAndTypeOk,
        userAct,
        credBytes,
        virtCreds,
        nativeUntouched,
        docCookieEmpty,
        interceptStatus,
        cookieHmacMatched,
        xrayOk,
        pngPdfOk,
        spoofStatus,
        mozAccepted
    );

    if (rc == 1) {
        return {
            true,
            1,
            isBidiMode ? "ORACLE_VERIFIED_FIREFOX_BIDI_PARITY_CLEAN" : "ORACLE_VERIFIED_ALL_INVARIANTS_CLEAN"
        };
    }
    return {false, rc, mapCodeToErrorName(rc)};
}

std::string buildValidSampleJson(bool isBidiMode, const std::string& cookieHash) {
    std::ostringstream oss;
    oss << "{"
        << "\"browserMeta\":{\"userAgent\":\"Mozilla/5.0 (X11; Linux x86_64; rv:160.0) Gecko/20100101 Firefox/160.0\",\"enclaveIsolatedFromMainWorld\":true},"
        << "\"test1ClosedShadow\":{\"mainWorldShadowRootWasNull\":true,\"vaultStatusAfterPierce\":\"UNLOCKED:7391\",\"closedShadowAncestry\":[{\"hostTag\":\"div\",\"hostId\":\"closed-host\",\"mode\":\"closed\"}]},"
        << "\"test2CrossOriginOopif\":{\"mainWorldCrossOriginBlocked\":true,\"rootOrigin\":\"http://localhost:41001\",\"childOrigin\":\"http://127.0.0.1:41002\",\"oopifResultText\":\"OOPIF_CONFIRMED:90210\",\"spiderTree\":{\"layerKind\":\"root-page\",\"children\":[{\"layerKind\":\"shadow-root\",\"shadowMode\":\"closed\"},{\"layerKind\":\"cross-origin-oopif\"}]}},"
        << "\"test3TrustedAndWebAuthn\":{\"untrustedRejectedCount\":1,\"trustedApproved\":true,\"lastEventIsTrusted\":true,\"userActivationWasActive\":true,\"trustedTypedValue\":\"MS-DESK-2026\",\"webauthnCredentialIdLen\":32,\"virtualCredentialsCount\":1},"
        << "\"test4BrowserInternals\":{\"nativeIntrinsicsUntouched\":true,\"documentCookieInPage\":\"\",\"intercepted429Status\":429,\"observedCookies\":[{\"name\":\"session_secret\",\"httpOnly\":true,\"secure\":true,\"sameSite\":\"Strict\",\"blindedValueHash\":\"" << cookieHash << "\"}]},";
    if (isBidiMode) {
        oss << "\"test5XrayAndArtifacts\":{\"components\":[{\"framework\":\"react\",\"name\":\"TradeTicketInput\",\"sanitizedProps\":{\"symbol\":\"AVNT\",\"apiToken\":\"[REDACTED_PILLAR1]\"}},{\"framework\":\"react\",\"name\":\"InstitutionalOrderDesk\",\"sanitizedProps\":{}},{\"framework\":\"vue\",\"name\":\"RiskGuardPanel\",\"sanitizedProps\":{}}],\"pngMagicHex\":\"89504e47\",\"pdfMagicAscii\":\"%PDF-\"},"
            << "\"test6BridgeOriginShield\":{\"spoofedOriginStatus\":403,\"mozExtensionAccepted\":true}";
    } else {
        oss << "\"test5XrayReport\":{\"components\":[{\"framework\":\"react\",\"name\":\"TradeTicketInput\",\"sanitizedProps\":{\"symbol\":\"MS\",\"apiToken\":\"[REDACTED_PILLAR1]\"}},{\"framework\":\"react\",\"name\":\"InstitutionalOrderDesk\",\"sanitizedProps\":{}},{\"framework\":\"vue\",\"name\":\"RiskGuardPanel\",\"sanitizedProps\":{}}]}";
    }
    oss << "}";
    return oss.str();
}

std::string replaceFirst(std::string s, std::string_view from, std::string_view to) {
    size_t pos = s.find(from);
    if (pos != std::string::npos) {
        s.replace(pos, from.size(), to);
    }
    return s;
}

bool runSelfTestMutantsAndFuzz(bool isBidiMode, std::string& outMsg) {
    const std::string cookieHash = computeExpectedBlindHashOpenSsl("RAW_SUPER_SECRET_COOKIE_99182");
    const std::string base = buildValidSampleJson(isBidiMode, cookieHash);

    auto baseRes = evaluateEvidenceBundle(base, isBidiMode);
    if (!baseRes.ok) {
        outMsg = "Baseline valid sample failed: " + baseRes.verdict;
        return false;
    }

    // Mutant M1: Untrusted click guard not proven
    auto m1 = evaluateEvidenceBundle(replaceFirst(base, "\"untrustedRejectedCount\":1", "\"untrustedRejectedCount\":0"), isBidiMode);
    if (m1.ok || m1.code != -5) {
        outMsg = "Mutant M1 failed to fail closed (-5)";
        return false;
    }

    // Mutant M2: Closed shadow exposed in MAIN world
    auto m2 = evaluateEvidenceBundle(replaceFirst(base, "\"mainWorldShadowRootWasNull\":true", "\"mainWorldShadowRootWasNull\":false"), isBidiMode);
    if (m2.ok || m2.code != -3) {
        outMsg = "Mutant M2 failed to fail closed (-3)";
        return false;
    }

    // Mutant M3: Cross-Origin SOP not enforced
    auto m3 = evaluateEvidenceBundle(replaceFirst(base, "\"mainWorldCrossOriginBlocked\":true", "\"mainWorldCrossOriginBlocked\":false"), isBidiMode);
    if (m3.ok || m3.code != -4) {
        outMsg = "Mutant M3 failed to fail closed (-4)";
        return false;
    }

    // Mutant M4a: Leaked raw Pillar-1 cookie secret
    auto m4a = evaluateEvidenceBundle(replaceFirst(base, cookieHash, "RAW_SUPER_SECRET_COOKIE_99182"), isBidiMode);
    if (m4a.ok || m4a.code != -1) {
        outMsg = "Mutant M4a failed to catch Pillar-1 secret leak (-1)";
        return false;
    }

    // Mutant M4b: Monkey-patched window.fetch intrinsic
    auto m4b = evaluateEvidenceBundle(replaceFirst(base, "\"nativeIntrinsicsUntouched\":true", "\"nativeIntrinsicsUntouched\":false"), isBidiMode);
    if (m4b.ok || m4b.code != -8) {
        outMsg = "Mutant M4b failed to catch monkey-patched intrinsic (-8)";
        return false;
    }

    // Mutant M4c: Leaked Fiber prop secret
    auto m4c = evaluateEvidenceBundle(replaceFirst(base, "[REDACTED_PILLAR1]", "sk_live_SUPER_SECRET_FIBER_KEY_777"), isBidiMode);
    if (m4c.ok || m4c.code != -1) {
        outMsg = "Mutant M4c failed to catch Fiber prop secret leak (-1)";
        return false;
    }

    if (isBidiMode) {
        // Mutant M5: Spoofed web origin accepted by Assistive Bridge
        auto m5 = evaluateEvidenceBundle(replaceFirst(base, "\"spoofedOriginStatus\":403", "\"spoofedOriginStatus\":200"), true);
        if (m5.ok || m5.code != -12) {
            outMsg = "Mutant M5 failed to catch spoofed bridge origin (-12)";
            return false;
        }
    }

    // 256 Seeded ASan+UBSan Structure/Byte-Mutation Fuzz Iterations
    uint64_t rng = 0x9E3779B97F4A7C15ULL;
    auto nextRand = [&]() -> uint64_t {
        rng ^= rng << 13;
        rng ^= rng >> 7;
        rng ^= rng << 17;
        return rng;
    };
    for (int iter = 0; iter < 256; ++iter) {
        std::string mutated = base;
        if (!mutated.empty()) {
            size_t idx = static_cast<size_t>(nextRand() % mutated.size());
            mutated[idx] = static_cast<char>(mutated[idx] ^ static_cast<char>((nextRand() & 0x7E) + 1));
            if ((iter & 3) == 0) {
                mutated.resize(idx);
            }
        }
        (void)evaluateEvidenceBundle(mutated, isBidiMode);
    }

    outMsg = isBidiMode ? "ALL_5_MUTANTS_AND_256_FUZZ_VECTORS_VERIFIED" : "ALL_4_MUTANTS_AND_256_FUZZ_VECTORS_VERIFIED";
    return true;
}

} // namespace

int main(int argc, char** argv) {
    bool isBidiMode = true;
    bool selfTestMutants = false;
    std::string verifyPath;

    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg == "--mode" && i + 1 < argc) {
            std::string m = argv[++i];
            isBidiMode = (m != "cdp");
        } else if (arg == "--self-test-mutants") {
            selfTestMutants = true;
        } else if (arg == "--verify" && i + 1 < argc) {
            verifyPath = argv[++i];
        }
    }

    if (selfTestMutants) {
        std::string msg;
        if (!runSelfTestMutantsAndFuzz(isBidiMode, msg)) {
            std::cout << "{\"ok\":false,\"phase\":\"self-test-mutants\",\"error\":\"" << msg << "\"}\n";
            return 2;
        }
        if (verifyPath.empty()) {
            std::cout << "{\"ok\":true,\"phase\":\"self-test-mutants\",\"verdict\":\"" << msg << "\"}\n";
            return 0;
        }
    }

    if (!verifyPath.empty()) {
        std::ifstream ifs(verifyPath, std::ios::binary);
        if (!ifs) {
            std::cout << "{\"ok\":false,\"verdict\":\"FAIL_UNREADABLE_BUNDLE\"}\n";
            return 1;
        }
        std::string raw((std::istreambuf_iterator<char>(ifs)), std::istreambuf_iterator<char>());
        auto res = evaluateEvidenceBundle(raw, isBidiMode);
        std::cout << "{\"ok\":" << (res.ok ? "true" : "false")
                  << ",\"code\":" << res.code
                  << ",\"verdict\":\"" << res.verdict << "\"}\n";
        return res.ok ? 0 : 1;
    }

    std::cout << "{\"ok\":false,\"error\":\"Usage: testudo-spider-oracle [--mode cdp|bidi] [--self-test-mutants] [--verify <bundle.json>]\"}\n";
    return 1;
}
