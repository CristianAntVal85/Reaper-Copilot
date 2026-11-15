# F0b-andamiaje: plan

Rama: `fase/F0b-andamiaje`. Fecha: 2026-11-15.

## 1. Alcance

Fila «0b. Andamiaje» de la sección 13 del documento maestro: monorepo Nx con pnpm, `libs/core` vacía con una prueba, `pnpm check` y `pnpm check:full`, paquete Python con `pytest` y CI ajustado.

**Entra:** la base del workspace, una librería `core` mínima, lint con la regla de dependencias, los dos comandos de verificación, el esqueleto de `python/analysis` y el CI.

**No entra** (es de la fase 1 o posteriores): `libs/tools`, adaptadores, `libs/testing`, zod, el SDK de MCP, librosa y demás dependencias de análisis, `apps/`, `.mcp.json`, `pnpm test:reaper`.

## 2. Contexto para el implementador

**Entorno (comprobado en los spikes).** WSL con Ubuntu 24.04. Node 24.21 (nvm). `pnpm` solo existe a través de Corepack y pide confirmación para descargarse: usa `corepack enable` y `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`. Python 3.12.3 con `venv` disponible. No hay `ffmpeg` ni `uv`. Versiones publicadas al planificar: nx 24.0.6, typescript 7.0.2, vitest 5.1.0, eslint 10.15.0, typescript-eslint 8.72.2, pnpm 12.21.0.

**Dependencias aprobadas para esta fase** (constitución, regla 10: cualquier otra requiere aprobación explícita; ninguna con licencia AGPL): `nx`, `@nx/eslint-plugin`, `typescript`, `vitest`, `eslint`, `@eslint/js`, `typescript-eslint`, `@types/node`; en Python, `pytest`.

**Estructura objetivo** (documento maestro, sección 6.3). Solo se crea lo marcado con `*`:

```
apps/            mcp-server, api, web
libs/
  core/ *        dominio puro: tipos, puertos, Task, errores
  tools/  agent/  adapters/  testing/
python/analysis/ *   paquete Python + CLI + tests
reaper/  evals/  deploy/  docs/  specs/  spikes/
```

**Regla de dependencias:** `core` ← `tools` ← `agent` ← `apps`. Los adaptadores solo dependen de `core`.

**Constitución, regla 6:** `libs/core` no importa NestJS, Angular, Reaper, Python ni SDKs de terceros. En esta fase se impone con lint: `core` no puede importar ningún paquete externo ni otra librería del workspace.

**Comandos que hay que dejar funcionando** (`CLAUDE.md`):

- `pnpm check`: tipos, lint y pruebas unitarias de lo afectado. Debe tardar segundos.
- `pnpm check:full`: lo anterior en todo el repositorio, más las pruebas de Python (y, cuando existan, las de contrato).

**Verificación por tarea en esta fase.** `pnpm check` no existe hasta T4: hasta entonces la verificación es el «Hecho cuando» de la tarea. Desde T4, además, `pnpm check` en verde.

**Commits** (skill `sdd`, sección 4). Un commit por tarea, en la rama `fase/F0b-andamiaje`, sin push. Mensaje en inglés `<tipo>(<ámbito>): <resumen>` con tipo `feat|fix|test|docs|chore|refactor`, terminado con la línea `Co-Authored-By` vigente. Añade archivos por nombre; nunca `git add -A`. Marca la casilla de la tarea en este archivo dentro del mismo commit.

**Idioma.** Código, identificadores y commits en inglés. Documentos en español. Comentarios solo cuando el motivo no es obvio. El autor está aprendiendo TypeScript: configuración explícita y corta antes que generada.

**No toques** `spikes/` ni `specs/spikes/`: son el registro de la fase 0. El código de los spikes no se reutiliza.

## 3. Qué cambia, por carpeta

| Ruta | Cambio |
|---|---|
| raíz | `package.json` (privado, `packageManager`, `engines`, scripts), `pnpm-workspace.yaml`, `nx.json`, `tsconfig.base.json`, `eslint.config.mjs`, `.nvmrc`, `.gitignore` |
| `libs/core/` | `package.json`, `tsconfig.json`, `src/index.ts`, una prueba |
| `python/analysis/` | `pyproject.toml`, paquete `analysis` con `__main__.py`, una prueba |
| `.github/workflows/ci.yml` | Un solo job con Node y Python que ejecuta `pnpm check:full` |
| `.claude/` | Permisos para los comandos nuevos; se retira el aviso «antes del andamiaje» |
| `CLAUDE.md`, `docs/` | Comandos ya existentes; Node 24 en la sección 14.1; estado e historial |

## 4. Decisiones y riesgos

| Decisión | Alternativa descartada |
|---|---|
| pnpm a través de Corepack, versión fijada en `packageManager` | npm: obligaba a renombrar los comandos en todo el flujo |
| Node 24, fijado en `.nvmrc` y en el CI | «Node 20 o superior» del documento maestro: Node 20 está fuera de soporte |
| ESLint con `@nx/enforce-module-boundaries` y Vitest | Biome: no puede imponer los límites entre librerías |
| Cada proyecto declara sus tareas (`typecheck`, `lint`, `test`) como scripts en su `package.json`; Nx solo las orquesta y las cachea | Plugins de Nx con tareas inferidas: menos archivos, pero oculta qué se ejecuta |
| Librerías como paquetes del workspace (`@reaper-copilot/core`), ESM, TypeScript estricto | Alias en `tsconfig` con `paths`: no funciona igual en ejecución |
| Python con `venv` + `pip` y `pyproject.toml`; entorno en `python/analysis/.venv` | `uv`: una herramienta más que instalar a mano |
| Sin Nx Cloud | — |
| Un solo job de CI con Node y Python | Dos jobs: `check:full` necesita los dos lenguajes |

Riesgos:

- **TypeScript 7 puede no ser compatible aún con `typescript-eslint` 8 o con Nx.** Si no lo es, se fija la última versión de TypeScript que ambos admitan y se anota. No se sustituye el linter.
- **Corepack pide confirmación interactiva** y bloquea en el CI y en subagentes: usar `COREPACK_ENABLE_DOWNLOAD_PROMPT=0`.
- **`nx affected` necesita una base con la que comparar.** En local, `main`; estando en `main`, el commit anterior. El CI usa `check:full`, que no depende de eso.
- El CI solo se puede comprobar con la pull request abierta: se verifica al cerrar la fase.

## 5. Tareas

- [x] **T1. Base del workspace.** `package.json` raíz, `pnpm-workspace.yaml` (`libs/*`, `libs/adapters/*`, `apps/*`), `nx.json` con caché para `typecheck`, `lint` y `test`, `tsconfig.base.json` estricto, `.nvmrc` y entradas nuevas en `.gitignore`.
  - Hecho cuando: en un clon limpio, `corepack enable && pnpm install` termina sin errores ni avisos de dependencias sin resolver, y `pnpm nx --version` responde.
- [x] **T2. `libs/core` con una prueba.** Paquete `@reaper-copilot/core` con `src/index.ts` que exporta `SCHEMA_VERSION = 1`, su prueba con Vitest y los scripts `typecheck` y `test`.
  - Hecho cuando: `pnpm nx run-many -t typecheck test` pasa con 1 prueba, y cambiar el valor esperado en la prueba lo hace fallar.
- [x] **T3. Lint y regla de dependencias.** `eslint.config.mjs` con `typescript-eslint` y `@nx/enforce-module-boundaries`; etiquetas `scope:core`, `scope:tools`, `scope:agent`, `scope:adapter`, `scope:app` con las restricciones de la sección 2; `core` no admite ningún import externo. Script `lint` en `core`.
  - Hecho cuando: `pnpm nx run-many -t lint` pasa, y añadir temporalmente `import 'node:fs'` o `import 'zod'` en `libs/core/src/index.ts` lo hace fallar con el mensaje de la regla (incluye la salida en la respuesta y retira el import).
- [ ] **T4. `pnpm check` y `pnpm check:full`.** Scripts en la raíz: `check` ejecuta `typecheck`, `lint` y `test` de lo afectado respecto a `main`; `check:full` los ejecuta en todos los proyectos.
  - Hecho cuando: ambos pasan; `pnpm check` tarda menos de 10 s con la caché caliente; con una prueba rota, los dos devuelven código de salida distinto de cero.
- [ ] **T5. Esqueleto de `python/analysis`.** `pyproject.toml` (paquete `analysis`, Python 3.11 o superior, extra `dev` con `pytest`), `__main__.py` que responde a `python -m analysis --version` y una prueba. Scripts raíz `py:setup` (crea `python/analysis/.venv` e instala con `pip install -e ".[dev]"`) y `py:test`; `check:full` incluye `py:test`.
  - Hecho cuando: `pnpm py:setup && pnpm py:test` pasa con 1 prueba, `pnpm check:full` ejecuta también las pruebas de Python, y `pnpm check` sigue sin necesitar Python.
- [ ] **T6. CI.** `ci.yml` con un solo job: Node 24, pnpm por Corepack con caché, Python 3.12, `pnpm install --frozen-lockfile`, `pnpm py:setup`, `pnpm check:full`. Se mantiene: solo en pull requests y en `main`, cancelación de ejecuciones anteriores, permisos de solo lectura.
  - Hecho cuando: el YAML es válido y los pasos del job, ejecutados en local en ese orden sobre un clon limpio, terminan en verde. El verde en GitHub se comprueba en la demostración.
- [ ] **T7. Documentación y permisos.** `CLAUDE.md`: quitar «a crear en la fase 0b» y el aviso de que los comandos no existen; añadir `pnpm py:setup`. Skill `sdd`: quitar el párrafo «Antes del andamiaje». `.claude/settings.json`: permitir `pnpm nx`, `pnpm py:setup` y `pnpm py:test`. Documento maestro, sección 14.1: Node 24, pnpm, ESLint y Vitest, con su entrada en `CHANGELOG.md`. `docs/estado.md` al día.
  - Hecho cuando: no queda ninguna mención a comandos «a crear» en `CLAUDE.md` ni en `.claude/`, `docs/estado.md` tiene 30 líneas o menos y `pnpm check:full` pasa.

## 6. Demostración de la fase

Criterio de salida (sección 13): `pnpm check` y `pnpm check:full` en verde en local y el CI en verde en una pull request.

1. En un clon limpio de la rama: `corepack enable && pnpm install && pnpm py:setup`.
2. `pnpm check` y `pnpm check:full`: los dos en verde; anotar lo que tardan.
3. Romper la prueba de `core`: los dos en rojo. Deshacer el cambio.
4. Añadir un import externo en `core`: `pnpm check` en rojo por lint. Deshacer el cambio.
5. Push y pull request a `main`: el CI termina en verde.
