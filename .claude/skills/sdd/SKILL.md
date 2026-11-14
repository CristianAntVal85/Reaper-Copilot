---
name: sdd
description: Úsala siempre que vayas a cambiar código de Reaper Copilot - elegir la vía (directa, cambio pequeño, spike o hito), planificar una fase en specs/Fn-nombre/, implementar tareas, verificar, hacer commits o validar una fase. También para orquestar los subagentes implementer y reviewer.
---

# Flujo de trabajo de Reaper Copilot

La ceremonia es proporcional al cambio. Hay cuatro vías; elige la más ligera que sirva.

**Antes del andamiaje.** `pnpm check` no existe hasta que cierre la fase 0b (sección 13 del documento maestro). Hasta entonces solo valen la vía de spike y el hito `F0b-andamiaje`, cuya verificación por tarea es el «Hecho cuando» de cada tarea. Las vías directa y de cambio pequeño empiezan después.

## 1. Vías

### Directa (`/quick`)
Para cambios triviales: texto, estilo, un botón, un bug obvio, un renombrado. Sin contrato, puerto ni seguridad de por medio.
- En el hilo principal. Sin plan, sin subagentes, sin revisor, sin tocar documentos.
- Haz el cambio, ejecuta `pnpm check`, commit. Informa en dos líneas.
- Si al empezar resulta que toca más de unos pocos archivos o una frontera, para y propón subir de vía.

### Cambio pequeño (`/feature`)
Para una función o un ajuste con comportamiento nuevo, dentro de un módulo.
- En el hilo principal. Tres líneas de intención (qué, dónde, cómo se comprueba) y sigue sin esperar aprobación, salvo que haya una duda real.
- Prueba primero o junto al cambio. `pnpm check`. Commit. Sin revisor.
- Actualiza `docs/estado.md` solo si cambia el siguiente paso.

### Spike (`/spike`)
Para despejar un riesgo antes de diseñar. Tiempo acotado, código desechable en `spikes/`.
- Resultado: una nota en `specs/spikes/<nombre>.md` con qué se probó, qué pasó, qué se decide y qué queda abierto.
- Sin pruebas ni revisor. El código del spike no se reutiliza sin pasar por otra vía.

### Hito (`/sdd-plan` → `/sdd-implement` → `/sdd-validate`)
Para una fase o una funcionalidad: herramienta nueva, contrato, puerto, puente de Reaper, validación de rutas, API Live.
- Carpeta `specs/Fn-nombre/` con `plan.md` (incluye las tareas).
- **Una sola aprobación:** el usuario aprueba plan y tareas juntos. Después se implementa tarea a tarea sin pedir permiso entre ellas, salvo bloqueo.
- Validación al final, no por tarea.

## 2. Plan de hito (`specs/Fn-nombre/plan.md`)

Una página. Secciones:
1. **Alcance:** qué entra y qué no, con la sección del documento maestro que lo define.
2. **Contexto para el implementador:** los extractos necesarios del documento maestro, copiados aquí (contratos, firmas de puertos, reglas que aplican). El implementador no debería necesitar abrir otros documentos.
3. **Qué cambia, por carpeta.**
4. **Decisiones** con la alternativa descartada, y **riesgos**.
5. **Tareas:** máximo 8, en orden de dependencia, cada una una rebanada vertical que se puede probar.
   ```
   - [ ] **Tn. <Descripción>.**
     - Hecho cuando: <comprobación verificable: prueba, comando, salida esperada>.
   ```
6. **Demostración de la fase:** el guion que prueba el criterio de salida (sección 13 del documento maestro).

Si salen más de 8 tareas, parte la fase por demostración, no por capa técnica.

## 3. Verificación en dos niveles

- **Por tarea:** `pnpm check` (tipos, lint, pruebas de lo afectado). Segundos. Con fakes; sin Reaper ni API.
- **Al cerrar la fase:** `pnpm check:full`, la demostración de la fase y, si la fase toca Reaper, `pnpm test:reaper` en local.

Las pruebas con interfaz (fase 3 en adelante) se revisan en el navegador al cerrar la fase, no en cada tarea.

## 4. Commits y ramas

Única fuente de estas reglas; los demás archivos las citan.
- Rama `fase/Fn-nombre` desde `main` para la vía de hito. Las vías directa y de cambio pequeño van en la rama en curso, o en una rama corta `fix/…` o `feat/…` si se está en `main`.
- **Un commit por tarea**, solo con `pnpm check` en verde. Mensaje en inglés: `<tipo>(<ámbito>): <resumen>`, con tipo `feat|fix|test|docs|chore|refactor`, y la línea `Co-Authored-By` de la atribución vigente.
- Añade archivos por nombre: nunca `git add -A`, y jamás `.env` ni secretos. `.claude/settings.json` lo impone: deniega leer y editar `.env` y `.env.*`, `git add -A` y `git push --force`. La plantilla de variables se llama `env.example`, sin punto, para que no quede bloqueada.
- **Push al cerrar la fase o al abrir la pull request**, no por tarea. Sin `--force`. Un push fallido se comunica; no se reintenta con otras opciones.
- `main` solo recibe fases validadas, por pull request. El CI corre ahí, no en cada commit.

## 5. Revisores

Solo en la vía de hito, una vez, al final.
- `reviewer`: siempre.
- `reviewer-security`: solo si `git diff --stat main...` toca `reaper/bridge/`, `libs/adapters/reaper/`, `libs/adapters/llm-anthropic/`, validación de rutas en `libs/core` o `libs/tools`, `apps/api/`, `deploy/` o archivos `.env*`.
- `reviewer-ui`: solo si toca `apps/web/`.

Máximo 2 vueltas de correcciones. Las observaciones de gravedad baja no bloquean: se anotan en `docs/estado.md` como pendientes.

## 6. Definición de terminado de una fase

1. La demostración de la fase se ejecuta y cumple el criterio de salida.
2. `pnpm check:full` en verde.
3. Cada contrato tocado tiene su prueba.
4. Ninguna regla de `docs/constitution.md` incumplida.
5. Sin secretos ni datos reales en el diff.
6. Documento maestro y `CHANGELOG.md` al día si cambió una decisión.
7. `docs/estado.md` actualizado y dentro de sus 30 líneas.
8. Sin trabajo de otras fases.

## 7. Orquestación con subagentes

Reparto por modelo, para estirar la suscripción: **el modelo caro piensa, Sonnet escribe.**
- **Plan:** en el hilo principal, con el modelo de la sesión (el más capaz disponible), porque planificar exige preguntar al usuario. No hay subagente planificador.
- **Implementación:** con el subagente `implementer` (Sonnet), una llamada por tarea. El hilo principal solo orquesta: lanza la tarea, lee la respuesta y pasa a la siguiente. No relee el código ni repite las verificaciones del implementador.
- **Revisión:** con los subagentes revisores (Sonnet, sección 5); su valor es que no han visto la conversación.
- **Vías directa y de cambio pequeño:** en el hilo principal, pero sus comandos fijan Sonnet en la cabecera.
- Los subagentes no ven la conversación. Pásales: la ruta de `plan.md`, la tarea, las decisiones del usuario y el resultado de la tarea anterior. Con la sección «Contexto para el implementador» no necesitan releer el documento maestro.

## 8. Cambios de alcance

Primero se actualiza `plan.md` (y el documento maestro, si cambia una decisión), se enseña el diff y, con aprobación, se sigue.
