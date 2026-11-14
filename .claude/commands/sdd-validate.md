---
description: SDD · Valida una fase contra la definición de terminado (uso - /sdd-validate F1-mcp-analisis)
---
NO arregles nada. Usa la skill sdd. Valida la fase $1:
1. Ejecuta `pnpm check:full` y la demostración descrita en `specs/$1/plan.md`.
2. Mira `git diff --stat main...` y decide qué revisores aplican según la sección 5 de la skill. Lanza `reviewer` siempre, y `reviewer-security` o `reviewer-ui` solo si el diff toca sus rutas. Dime cuáles lanzas y por qué.
3. Reúne los veredictos.

Termina con VEREDICTO: APROBADO o CAMBIOS NECESARIOS, con la lista de hallazgos por gravedad. Si está aprobado, indica los pasos de cierre: push de la rama, pull request, `docs/estado.md` y `CHANGELOG.md`.
