---
description: SDD · Implementa tareas de un plan aprobado (uso - /sdd-implement F1-mcp-analisis T3, o sin tarea para seguir en orden)
---
Implementa las tareas de `specs/$1/plan.md` siguiendo la skill sdd. Si indico una tarea ($2), solo esa; si no, continúa en orden desde la primera pendiente. No implementes tú: lanza el subagente `implementer` (Sonnet), una llamada por tarea, y pásale la ruta del plan, la tarea, mis decisiones y el resultado de la tarea anterior (sección 7 de la skill). No releas el código que escribe ni repitas su `pnpm check`: fíate de su respuesta y comprueba solo que el commit existe.

Cada tarea, en el implementador:
1. Contrato primero si toca una frontera; prueba primero o junto al cambio.
2. Implementa lo mínimo que cumple el «Hecho cuando».
3. Ejecuta `pnpm check`. Si falla, corrige; no hay commit en rojo.
4. Marca la tarea en `plan.md` y haz el commit (sección 4 de la skill). Sin push.

Sigue con la siguiente sin pedirme permiso. Para solo si el plan es incorrecto o imposible, si falta una decisión mía o si necesitas que haga algo a mano. Al terminar, resume en pocas líneas: tareas hechas, verificaciones y decisiones que el plan no cubría.
