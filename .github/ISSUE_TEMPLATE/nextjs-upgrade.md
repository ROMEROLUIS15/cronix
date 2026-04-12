---
name:  Next.js Framework Upgrade
about: Track major framework version upgrade (e.g., Next.js 14 → 15)
title: '[UPGRADE] Next.js 14 → 15'
labels: ['dependencies', 'breaking-change', 'security']
assignees: ''
---

## 📋 Upgrade Overview

**Current Version:** Next.js 14.2.35  
**Target Version:** Next.js ^15.5.15  
**Reason:** Security vulnerabilities (CVSS 7.5 DoS) + framework improvements  
**ADR:** [docs/architecture/adr-001-nextjs-upgrade-deferral.md](../../docs/architecture/adr-001-nextjs-upgrade-deferral.md)

---

## 🎯 Impact Assessment

### Breaking Changes
- [ ] React 18 → React 19 migration
- [ ] App Router API changes
- [ ] Server Components behavior changes
- [ ] Image optimization changes
- [ ] Metadata API changes

### Dependencies to Update
- [ ] `next` → `^15.5.15`
- [ ] `react` → `^19`
- [ ] `react-dom` → `^19`
- [ ] `next-intl` → latest compatible
- [ ] `@sentry/nextjs` → latest compatible
- [ ] `@ducanh2912/next-pwa` → verify compatibility
- [ ] Other Next.js-related packages

### Testing Requirements
- [ ] Unit tests (vitest) — 100% pass
- [ ] E2E tests (Playwright) — 100% pass
- [ ] Manual testing of critical flows:
  - [ ] Authentication (login/logout/passkeys)
  - [ ] WhatsApp webhook processing
  - [ ] Appointment booking/cancellation
  - [ ] Voice assistant functionality
  - [ ] PWA installation and offline mode
  - [ ] Dashboard data loading
  - [ ] Image optimization

---

## 📅 Timeline

**Target Sprint:** Q2 2026 (May-June)  
**Estimated Effort:** 4-6 weeks  
**Risk Level:** High (breaking changes)

### Phases
1. **Preparation** (Week 1-2): Dependency audit, breaking change analysis
2. **Implementation** (Week 3-4): Upgrade packages, fix incompatibilities
3. **Testing** (Week 5-6): Full test suite, manual QA, staging deploy
4. **Release** (Week 7-8): Production deploy, monitoring

---

## ✅ Acceptance Criteria

- [ ] `npm audit` returns 0 vulnerabilities
- [ ] All unit tests pass (375/375)
- [ ] All E2E tests pass
- [ ] No regression in production (48h monitoring)
- [ ] Performance within 5% of current baseline
- [ ] Security headers still working (CSP, HSTS, etc.)
- [ ] PWA functionality verified
- [ ] WhatsApp webhook still processing messages

---

## 🚨 Rollback Plan

If issues are detected post-deploy:

1. **Immediate:** Revert to previous commit in Git
2. **Vercel:** Use deployment rollback feature
3. **Database:** No schema changes expected (safe)
4. **Monitoring:** Sentry + Axiom alerts for 48h

---

## 📝 Notes

- See ADR-001 for detailed decision rationale
- Current mitigations (rate limiting, Vercel DDoS protection) remain active
- Upgrade should be done in dedicated branch: `feat/nextjs-15-upgrade`
- Canary deployment recommended (10% → 50% → 100%)

---

## 🔗 References

- [Next.js 15 Migration Guide](https://nextjs.org/docs/app/building-your-application/upgrading/version-15)
- [React 19 Upgrade Guide](https://react.dev/blog/2024/04/25/react-19)
- [npm audit report](../../SECURITY_FINAL_REPORT.md)
