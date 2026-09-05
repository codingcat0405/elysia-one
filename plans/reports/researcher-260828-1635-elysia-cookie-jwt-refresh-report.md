# Elysia Cookie + JWT Refresh Token Integration Report

## 1. Elysia Native Cookie API (^1.4.29)

### Reading Cookies
- Access via `cookie.tokenName.value` in context (reactive object) — [Elysia Cookie Tutorial](https://elysiajs.com/tutorial/patterns/cookie/)
- In macros with `resolve()`, read from `cookie` context parameter same way: `resolve({ cookie })` then `cookie.access_token.value`

### Setting Cookies
Two patterns supported:
```typescript
// Pattern A: Direct property + .set()
cookie.access_token.value = tokenString
cookie.access_token.httpOnly = true
cookie.access_token.set({ 
  secure: true, 
  sameSite: 'lax', 
  maxAge: 900,      // 15 min for access token
  path: '/' 
})

// Pattern B: Bulk .set()
cookie.access_token.set({
  value: tokenString,
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  maxAge: 900,
  path: '/'
})
```
Both work in route handlers and macro `resolve()` — [Cookie Tutorial](https://elysiajs.com/tutorial/patterns/cookie/), [Elysia 1.2 Blog](https://elysiajs.com/blog/elysia-12)

### Removing Cookies
- Call `cookie.tokenName.remove()` or `cookie.tokenName.set({ maxAge: 0 })`
- Clears from response — [Cookie API](https://elysiajs.com/patterns/cookie)

### Cookie Signing (Optional)
- Configure globally: `new Elysia({ cookie: { secrets: ["secret1", "secret2"] } })`
- Elysia uses first secret to sign, rest to verify (supports rotation)
- Plain unsigned cookies (just JWT as value) fine if you trust the JWT signature itself — no secondary cookie-level signing required
- [elysia-cookie README](https://github.com/elysiajs/elysia-cookie/blob/main/README.md)

**⚠️ Known issue:** Cookie type inference lost when macro defines both cookie schema AND resolve function — [Issue #1375](https://github.com/elysiajs/elysia/issues/1375). Workaround: inline cookie schema in route, or cast.

---

## 2. @elysiajs/cors ^1.4.2 for Credentialed Cross-Origin

### Required Config
```typescript
cors({
  origin: "http://localhost:3001",  // Must be explicit string/array/regex when credentials: true
  credentials: true                   // Required for browser to send/receive httpOnly cookies
})
```

**Critical:** origin cannot be `true` or `*` when `credentials: true` — [CORS Plugin Docs](https://elysiajs.com/plugins/cors), [GitHub README](https://github.com/elysiajs/elysia-cors/blob/main/README.md)

### Why Required
Browser enforces: if server responds with `Access-Control-Allow-Credentials: true`, origin must be explicit and request origin must match. Enables httpOnly cookie transmission across `localhost:3001` (client) ↔ `localhost:3000` (api) — [MDN Access-Control-Allow-Credentials](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Allow-Credentials)

---

## 3. @elysia/eden Treaty Client ^1.4.10

### Config for Cross-Origin Cookies
```typescript
const client = treaty<App>("http://localhost:3000", {
  fetch: { credentials: 'include' },
  headers: () => ({ /* your headers */ })
})
```

Combines `fetch` and `headers` in same config object — [Eden Treaty Config Docs](https://elysiajs.com/eden/treaty/config)

**Note:** Internally passes `{ credentials: 'include' }` to all fetch calls, equivalent to manual `fetch(url, { credentials: 'include' })`

**Known limitation:** [Issue #126](https://github.com/elysiajs/eden/issues/126) reports cookies don't persist across consecutive requests in some setups — verify with real traffic or file an Eden issue if occurs.

---

## 4. JWT Double-Token Rotation Best Practice

### Secret Separation
✅ **Yes, use different secrets** for access vs refresh JWT:
- Access token signed with `JWT_SECRET_ACCESS`
- Refresh token signed with `JWT_SECRET_REFRESH`
- Prevents token type confusion if access token leaked; attacker cannot use it as refresh token

Source: [OWASP OAuth2 Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html), [APIsec JWT Guide](https://www.apisec.ai/blog/jwt-security-vulnerabilities-prevention), [Jsonic Best Practices](https://jsonic.io/guides/jwt-best-practices)

### Timings (OWASP Recommended)
- **Access token:** 5–15 min expiry
- **Refresh token:** 7–30 days expiry
- **Rotation:** Issue new pair on every `/auth/refresh` call; invalidate old refresh token immediately

### Stateless Rotation Pattern (No DB Required)
Issue new access + refresh on each refresh call; no DB needed if using JWT `iat` (issued-at) claim to detect reuse of same family. Simpler than family tracking — [Refresh Token Rotation Guide](https://www.descope.com/blog/post/refresh-token-rotation)

---

## Unresolved Questions

1. **Cookie signing overhead:** Should we enable Elysia's built-in cookie signing layer, or rely solely on JWT signature? (Trade: extra MAC vs simplicity; current approach—unsigned cookie containing signed JWT—is safe but unusual.)
2. **Production CORS origin:** Will `origin: process.env.CLIENT_URL` (string read at startup) work, or does CORS plugin require compile-time constant? (Affects dynamic env handling.)
3. **Refresh token revocation:** For stateless refresh (no DB), how to handle emergency token revocation without adding a blocklist DB? (Out of scope here but worth planning.)

---

## Sources
- [Elysia Cookie Tutorial](https://elysiajs.com/tutorial/patterns/cookie/)
- [Elysia 1.2 Release Blog](https://elysiajs.com/blog/elysia-12)
- [Elysia Macro Pattern](https://elysiajs.com/tutorial/patterns/macro/)
- [CORS Plugin Docs](https://elysiajs.com/plugins/cors)
- [Eden Treaty Config](https://elysiajs.com/eden/treaty/config)
- [GitHub elysia-cors](https://github.com/elysiajs/elysia-cors/blob/main/README.md)
- [GitHub eden Issue #126](https://github.com/elysiajs/eden/issues/126)
- [OWASP OAuth2 Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/OAuth2_Cheat_Sheet.html)
- [APIsec JWT Security Guide](https://www.apisec.ai/blog/jwt-security-vulnerabilities-prevention)
- [Descope Refresh Token Rotation](https://www.descope.com/blog/post/refresh-token-rotation)
- [Jsonic JWT Best Practices](https://jsonic.io/guides/jwt-best-practices)
- [MDN Access-Control-Allow-Credentials](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Access-Control-Allow-Credentials)
