# Plan de desarrollo iterativo

Regla de trabajo: cada iteración termina con código o documentación verificable y prueba de aceptación. Duraciones de 1–2 semanas solo orientativas. No desbloquear dependencias por la simple existencia de código.

| Iteración | Meta | Evidencia de salida |
| --- | --- | --- |
| I0 | Especificación, derechos, ediciones, ADR, backlog | Requisitos/contratos revisados y experimento técnico |
| I1 | Geometría y tablero SVG | Pruebas de hexágonos y uso móvil |
| I2 | Servidor, cuentas y sincronización | Dos usuarios autorizados recuperan estado común |
| I3 | Fases, órdenes y mano privada | Turnos sencillos seguros y persistentes |
| I4 | Movimiento legal | Acciones inválidas rechazadas por servidor |
| I5 | Combate inicial y dados | Resolución completa de un subconjunto declarado |
| I6 | Cobertura reglas Ancients básico | Matriz, excepciones y pruebas completas |
| I7 | Escenarios, victoria, historial y correcciones | Partidas completas y trazables |
| I8 | Validación Ancients y despliegue | Aceptación, seguridad y restauración |
| I9 | Motor de reglas Napoleonics | Adaptador y pruebas sin regresiones |
| I10 | Combates y reacciones Napoleonics | Cuadros, artillería, caballería y reglas propias |
| I11 | Escenarios y validación Napoleonics | Básico completo y probado |
| I12+ | Expansiones | Módulos versionados y comprobados |

## Forma de trabajo

Por iteración: definir pequeño incremento vertical → diseñar contrato → implementar → pruebas unitarias y de integración → demostración humana → revisión de errores, decisiones y siguiente backlog. Separar pruebas de reglas (sin interfaz) y de interacción (móvil, dos navegadores). La aceptación exige trazabilidad requisito → regla → prueba.

## Gestión del repositorio

Issues con prefijo [I0], [I1] y siguientes. Relacionar IDs CCW-NNN estables en títulos/cuerpo. Trabajar en ramas, integrar mediante PR y revisar antes de modificar main. Evitar GitHub Actions hasta necesitar CI; pruebas locales reproducibles documentadas.

## Prioridad inmediata

1. Confirmar edición de cajas y erratas.
2. Resolver derechos de distribución de materiales gráficos/textuales.
3. Validar arquitectura con un prototipo mínimo de punta a punta.
4. Implementar geometría y visualización del tablero con datos sintéticos.
