# Política de Gestión de Dependencias

**Última actualización:** 2026-04-12  
**Responsable:** Lead Developer / Security Team  
**Contexto:** Post-auditoría OWASP Top 10

---

## 🎯 Objetivo

Mantener las dependencias del proyecto actualizadas y seguras, minimizando la deuda técnica y el riesgo de vulnerabilidades.

---

## 📋 Reglas de Gestión

### 1. Frecuencia de Auditorías

| Tipo | Frecuencia | Herramienta | Acción |
|------|------------|-------------|--------|
| **Automática** | Cada PR | `npm audit` en CI | Bloquea merge si hay vulnerabilidades HIGH/CRITICAL |
| **Semanal** | Lunes | Dependabot / manual | Revisar alertas de seguridad |
| **Mensual** | Primer lunes | `npm audit` completo | Actualizar dependencias minor/patch |
| **Trimestral** | Q1, Q2, Q3, Q4 | `npm audit` + review | Evaluar upgrades major version |

---

### 2. Clasificación de Actualizaciones

#### **Patch Updates** (1.2.3 → 1.2.4)
- ✅ **Acción:** Auto-merge vía Dependabot
- 📅 **Timeline:** Inmediato
- 🧪 **Testing:** CI automático
- 📝 **Ejemplo:** `vitest@3.2.4 → 3.2.5`

#### **Minor Updates** (1.2.0 → 1.3.0)
- ✅ **Acción:** PR manual con changelog review
- 📅 **Timeline:** Dentro de la semana
- 🧪 **Testing:** `npm test` + smoke test manual
- 📝 **Ejemplo:** `next-intl@4.9.1 → 4.10.0`

#### **Major Updates** (1.0.0 → 2.0.0)
- ⚠️ **Acción:** ADR obligatorio + issue de tracking
- 📅 **Timeline:** Planificar en sprint dedicado
- 🧪 **Testing:** Full test suite + E2E + manual QA
- 📝 **Ejemplo:** `next@14.2.35 → next@15.5.15`

---

### 3. Vulnerabilidades de Seguridad

#### **CRITICAL (CVSS 9.0-10.0)**
- 🚨 **Acción:** Fix inmediato (hotfix)
- 📅 **Timeline:** <24 horas
- 🔄 **Proceso:**
  1. Crear rama `hotfix/security-<CVE>`
  2. Aplicar parche o workaround
  3. Tests mínimos viables
  4. Deploy urgente
  5. Post-mortem en 48h

#### **HIGH (CVSS 7.0-8.9)**
- ⚠️ **Acción:** Fix prioritario
- 📅 **Timeline:** <1 semana
- 🔄 **Proceso:**
  1. Evaluar mitigaciones temporales
  2. Crear issue con label `security`
  3. Planificar en sprint actual o siguiente
  4. Si requiere major upgrade: ADR obligatorio

#### **MODERATE (CVSS 4.0-6.9)**
- 📝 **Acción:** Fix en próximo ciclo de updates
- 📅 **Timeline:** <1 mes
- 🔄 **Proceso:** Incluir en update mensual

#### **LOW (CVSS 0.1-3.9)**
- 📋 **Acción:** Tracking pasivo
- 📅 **Timeline:** Próximo major upgrade
- 🔄 **Proceso:** Documentar en issue backlog

---

### 4. Uso de npm Overrides

**Cuando usar overrides:**
- ✅ Dependencia transitiva con vulnerabilidad CRITICAL/HIGH
- ✅ No hay fix disponible en versión superior
- ✅ Override es temporal (documentar con fecha de expiración)

**Cuando NO usar overrides:**
- ❌ Para evitar upgrades major de dependencias directas
- ❌ Como solución permanente
- ❌ Sin documentación de por qué es necesario

**Ejemplo de override documentado:**
```json
{
  "overrides": {
    "serialize-javascript": "^7.0.5",
    "next-pwa": {
      "serialize-javascript": "^7.0.5"
    },
    "@ducanh2912/next-pwa": {
      "serialize-javascript": "^7.0.5",
      "workbox-build": {
        "serialize-javascript": "^7.0.5",
        "@rollup/plugin-terser": {
          "serialize-javascript": "^7.0.5"
        }
      }
    }
  }
}
```

**Documentación requerida para cada override:**
```json
// package.json
{
  "overrides": {
    "serialize-javascript": "^7.0.5"
  },
  "security": {
    "overrides": [
      {
        "package": "serialize-javascript",
        "version": "^7.0.5",
        "reason": "Fix RCE vulnerability GHSA-5c6j-r48x-rmvq (CVSS 8.1)",
        "applied": "2026-04-12",
        "expires": "2026-07-01",
        "review": "Remove when @ducanh2912/next-pwa updates workbox-build"
      }
    ]
  }
}
```

---

### 5. CI/CD Integration

#### GitHub Actions Workflow

```yaml
# .github/workflows/security-audit.yml
name: Security Audit

on:
  schedule:
    - cron: '0 9 * * 1'  # Lunes 9am
  pull_request:
    paths:
      - 'package.json'
      - 'package-lock.json'

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Run security audit
        run: |
          npm audit --audit-level=high
          exit_code=$?
          if [ $exit_code -ne 0 ]; then
            echo "::error::Vulnerabilidades HIGH/CRITICAL detectadas"
            echo "Revisar: docs/security/dependency-policy.md"
            exit 1
          fi
      
      - name: Run tests
        run: npm test
```

#### Husky Pre-Commit Hook

```bash
# .husky/pre-commit
#!/bin/sh
npm audit --audit-level=critical --json | jq '.metadata.vulnerabilities.critical' | grep -q '0' || {
  echo "⛔ CRITICAL vulnerabilities detected!"
  echo "No se puede commitear con vulnerabilidades CRÍTICAS."
  echo "Ejecuta: npm audit fix"
  exit 1
}
```

---

### 6. Documentación de Decisiones

**Todo upgrade major requiere:**
1. ✅ **ADR** (Architecture Decision Record) en `docs/architecture/`
2. ✅ **Issue de tracking** en GitHub con template
3. ✅ **Changelog review** de la dependencia
4. ✅ **Plan de rollback** documentado
5. ✅ **Testing plan** con criterios de aceptación

**Template de ADR:** Ver `docs/architecture/adr-001-nextjs-upgrade-deferral.md`

---

### 7. Dependabot Configuration

```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "09:00"
    open-pull-requests-limit: 10
    commit-message:
      prefix: "deps"
      include: "scope"
    labels:
      - "dependencies"
    versioning-strategy: increase
    groups:
      dev-dependencies:
        patterns:
          - "@vitest/*"
          - "@playwright/*"
          - "vitest-*"
      production-dependencies:
        patterns:
          - "*"
        exclude-patterns:
          - "@vitest/*"
          - "@playwright/*"
          - "vitest-*"
    ignore:
      - dependency-name: "next"
        update-types: ["version-update:semver-major"]
        # Major upgrades require manual ADR and planning
```

---

### 8. Monitoreo Post-Upgrade

**Después de cualquier upgrade:**
- 📊 **24h:** Monitoreo intensivo de Sentry y Axiom
- 📊 **48h:** Revisión de métricas de performance
- 📊 **7 días:** Confirmación de estabilidad
- 📊 **30 días:** Cierre de issue de tracking

**Métricas a monitorear:**
- Error rate (Sentry)
- Response time (Axiom)
- Memory usage (Vercel dashboard)
- Cold start times (Vercel dashboard)
- User complaints (Support tickets)

---

## 📚 Recursos

- [npm audit documentation](https://docs.npmjs.com/cli/commands/npm-audit)
- [Dependabot configuration](https://docs.github.com/en/code-security/dependabot)
- [Semver specification](https://semver.org/)
- [ADR methodology](https://adr.github.io/)

---

## ✅ Checklist de Cumplimiento

- [ ] Dependabot configurado y activo
- [ ] CI incluye `npm audit` en cada PR
- [ ] Husky pre-commit hook bloquea vulnerabilities CRITICAL
- [ ] Override de `serialize-javascript` documentado con fecha de expiración
- [ ] ADR-001 creado para Next.js upgrade deferral
- [ ] Issue de tracking creado en GitHub
- [ ] Política documentada en `docs/security/dependency-policy.md`
- [ ] Equipo conoce el proceso de gestión de vulnerabilidades

---

*Política efectiva desde: 2026-04-12*  
*Próxima revisión: 2026-07-12*
