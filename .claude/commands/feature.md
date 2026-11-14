---
description: Vía de cambio pequeño · una función o ajuste con su prueba (uso - /feature añade el factor de cresta al análisis)
model: claude-sonnet-5-5
---
Cambio pequeño: $ARGUMENTS

Vía de cambio pequeño de la skill sdd, en este hilo y sin subagentes:
1. Dime en tres líneas: qué cambia, en qué archivos y cómo se comprueba. Sigue sin esperar aprobación, salvo que haya una decisión que me corresponda; en ese caso pregunta solo eso.
2. Escribe la prueba primero o junto al cambio. Si toca una frontera, empieza por el esquema zod.
3. Ejecuta `pnpm check`.
4. Commit según la sección 4 de la skill.
5. Resume el resultado. Actualiza `docs/estado.md` solo si cambia el siguiente paso.

Si el cambio crece o toca el puente de Reaper, la validación de rutas o la API Live, para y propón `/sdd-plan`.
