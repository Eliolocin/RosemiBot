---
title: "Guía de migración segura"
sidebar:
  order: 6
---

Esta traducción se proporciona para tu comodidad. La versión en inglés es la autoritativa.

Cuando ejecutas `git pull` para obtener código nuevo y reinicias TomoriBot, el bot ejecuta automáticamente las migraciones del esquema de la base de datos al arrancar. Esto es poderoso (significa que no tienes que administrar manualmente las actualizaciones de SQL), pero también significa que las operaciones destructivas pueden afectar silenciosamente tus datos. Esta guía te muestra cómo protegerte antes de hacer pull.

## Por qué es importante esto

El ejecutor de migraciones de TomoriBot (en `src/db/migrationRunner.ts`) ejecuta todas las migraciones no aplicadas en orden de versión. Las migraciones son solo hacia adelante: si algo sale mal, el ejecutor no hace una reversión automática. La mayoría de las migraciones son expansiones seguras (nuevas columnas, nuevas tablas), pero según la política de diseño interna (OD-R-6) del proyecto, se permiten operaciones destructivas como `DROP COLUMN` o `DROP TABLE`. Si una migración destructiva se ejecuta sin una copia de seguridad, pierdes datos de forma permanente. En caso de duda, haz una copia de seguridad primero.

## Copias de seguridad de medios de expresión personalizados
<!-- anchor: custom-expression-media-backups -->

Las copias de seguridad de bases de datos conservan metadatos de expresiones personalizadas, membresías de personas y referencias de almacenamiento. No incluyen bytes de medios cargados o importados. Detén el bot antes de realizar una copia de seguridad de la base de datos y los medios juntos. Con almacenamiento local, copie `data/custom-expressions/` y restáurelo en la misma ubicación. Con GCS o S3, haga una copia de seguridad de los objetos `custom-expressions/` de su propiedad y restaure sus claves en el depósito de expresión configurado. Restaure las configuraciones `EXPRESSION_STORAGE_BACKEND` y `EXPRESSION_STORAGE_BUCKET` coincidentes. Cambiar el backend o el depósito por sí solo deja las referencias existentes ilegibles. Las expresiones de enlace se almacenan únicamente como URL y siguen dependiendo de sus hosts externos. Las exportaciones Discord JSON no incluyen registro de expresiones ni archivo multimedia.

## Lista de verificación antes de hacer pull

Sigue estos pasos ANTES de ejecutar `git pull`:

1. **Detén el bot**: apaga el proceso de TomoriBot para que ninguna conexión activa a la base de datos interfiera con la copia de seguridad.
2. **Haz una copia de seguridad de la base de datos y conserva sus claves**: utiliza uno de los dos métodos siguientes. Conserva una copia protegida separada de cada versión de cifrado necesaria para el volcado y prueba la recuperación en una base de datos desechable.
3. **Anota el commit actual**: ejecuta `git rev-parse HEAD` y guarda la salida en caso de que sea necesaria una reversión.
4. **Haz pull y reinicia**: una vez que la copia de seguridad esté de forma segura en el disco, es seguro hacer pull y reiniciar.

### Requisito previo: la extensión `pgvector`

Una copia de seguridad completa es un volcado `pg_dump` en SQL simple (`backupData.ts` ejecuta `pg_dump --clean --if-exists -f`), por lo que contiene la tabla `document_chunks` de tipo `vector` que se utiliza para RAG. El Postgres de destino debe tener la extensión `pgvector` disponible antes de que restaures, o la ejecución de `CREATE EXTENSION IF NOT EXISTS vector` del volcado no se podrá ejecutar y la tabla `document_chunks` no se podrá crear.

Instálala una vez en el host (coincidiendo con la versión principal de tu Postgres), por ejemplo para Postgres 16:

```bash
sudo apt-get install -y postgresql-16-pgvector
```

Confirma que está disponible:

```bash
psql -c "SELECT name, default_version FROM pg_available_extensions WHERE name = 'vector';"
```

Si restauras sin ella:

- El script `restore-backup` del proyecto (y cualquier ejecución de `psql -f` con `ON_ERROR_STOP=1`) se aborta temprano con `extension "vector" is not available` (no se cargan datos). Instala pgvector y vuelve a intentarlo.
- Una ejecución manual de `psql -f` que ignora los errores (`ON_ERROR_STOP=0`) es peor: el comando `COPY public.document_chunks` fallido desincroniza el analizador de entrada de psql, que luego analiza incorrectamente las siguientes filas de datos de `COPY` como SQL (una cascada de `syntax error at or near …`). Esto elimina silenciosamente tablas enteras (observado: `documents` y `llms`), dejando una base de datos parcialmente restaurada que parece intacta pero ha perdido filas. Siempre restaura con `ON_ERROR_STOP=1` para que las fallas salgan a la luz de inmediato.

### Opción A: Usar el script de copia de seguridad del proyecto

TomoriBot incluye dos scripts de copia de seguridad, cada uno apuntando a datos diferentes:

- **`bun run backup`**: esquema completo de la base de datos y volcado de datos (personas, recuerdos, configuraciones, todo).
- **`bun run backup:personas`**: solo ajustes preestablecidos de personas y recuerdos del servidor por persona.

Para una migración segura, usa la copia de seguridad completa:

```bash
bun run backup
```

Esto crea un paquete con marca de tiempo en `backups/` (o tu `TOMORI_BACKUP_DIR` si se anula en `.env`) que contiene toda la base de datos PostgreSQL como un volcado SQL sin formato. El paquete no contiene `.env` ni secretos maestros. Antes de restaurar, aprovisiona las versiones de cifrado correspondientes por separado en la fuente de secretos de destino y detén todas las instancias del bot. Consulta [Copias de seguridad de la base de datos y claves de recuperación](/es-419/self-hosting/maintenance/#database-backups-and-recovery-keys) para conocer el procedimiento completo. Las claves faltantes o incorrectas detienen la restauración antes del SQL destructivo. Los paquetes heredados todavía contienen secretos sin procesar en `config.env`; revísalos en privado y aprovisiona sus claves tú mismo. La restauración nunca copia ese archivo. Para restaurar más tarde, ejecuta:

```bash
bun run restore-backup --latest
```

O restaura desde un paquete específico:

```bash
bun run restore-backup --from backups/backup_2024-01-15_14-30-45
```

### Copias de seguridad automáticas de inicio local

En entornos que no son de producción (`RUN_ENV` no configurado en `production`), TomoriBot también verifica que haya una copia de seguridad de datos completa antes de que se ejecute la inicialización de la base de datos. Crea un paquete automático compatible con `backupData.ts` cuando cualquiera de las condiciones es verdadera:

- la última copia de seguridad de datos completa fue creada por una versión del bot de `package.json` diferente.
- la última copia de seguridad de datos completa tiene al menos `TOMORI_AUTO_BACKUP_INTERVAL_HOURS` de antigüedad (predeterminado: `24`).

Las copias de seguridad automáticas están etiquetadas con `backupType: "automatic"` en `bundle_info.json` y se nombran con un sufijo `_auto`. Los paquetes manuales de `bun run backup` están etiquetados como `manual`; pueden satisfacer la verificación de la copia de seguridad más reciente, pero nunca cuentan para la retención automática. La puerta de inicio mantiene los `TOMORI_AUTO_BACKUP_MAX` paquetes automáticos más nuevos (predeterminado: `5`) y elimina solo los paquetes automáticos más antiguos.

Configura `TOMORI_AUTO_BACKUP_ENABLED=false` en `.env` si necesitas iniciar un bot local o de desarrollo sin esta puerta de seguridad, por ejemplo en una máquina sin `pg_dump`.

### Opción B: `pg_dump` directo

Si prefieres el control manual, usa la utilidad `pg_dump` incorporada de PostgreSQL con las propias variables de entorno de TomoriBot:

```bash
pg_dump \
  -h "$POSTGRES_HOST" \
  -p "$POSTGRES_PORT" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  -F c \
  -f "tomoribot-backup-$(date +%Y%m%d-%H%M%S).dump"
```

Esto guarda un volcado binario de formato personalizado (más compacto que el texto SQL). Las variables de entorno coinciden con tu `.env`:

- `POSTGRES_HOST`: predeterminado `localhost`
- `POSTGRES_PORT`: predeterminado `5432`
- `POSTGRES_USER`: tu usuario de base de datos
- `POSTGRES_DB`: predeterminado `tomodb`

Para restaurar:

```bash
pg_restore \
  -h "$POSTGRES_HOST" \
  -p "$POSTGRES_PORT" \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  tomoribot-backup-20240115-143045.dump
```

Nota: `pg_restore` te pedirá tu contraseña a menos que la configures en un archivo `.pgpass` (el archivo de credenciales incorporado de PostgreSQL).

## Para los colaboradores que implementan a través de CI: la convención `(Checkpoint)`

Si mantienes un fork que se implementa en AWS o GCP a través de los flujos de trabajo en `.github/workflows/deploy-{aws,gcp-legacy}.yml`, esos canales admiten una instantánea previa a la implementación opcional: cuando un mensaje de commit contiene el token literal `(Checkpoint)`, el flujo de trabajo ejecuta `aws rds create-db-snapshot` (o el equivalente de GCP Cloud SQL) antes de que se implemente cualquier código y antes de que el ejecutor de migraciones toque la base de datos en el arranque.

Úsala cuando:

- Estás enviando una migración que elimina una columna, elimina una tabla, altera un tipo de columna, o de otra manera pierde datos (la política de migración destructiva OD-R-6).
- Estás enviando un commit de paquete de lanzamiento que combina varias migraciones y quieres un único punto de reversión.
- No estás seguro de si una migración en cola es segura (en caso de duda, haz un punto de control).

Omítela para las implementaciones de rutina no destructivas (nuevas columnas, nuevos índices, datos de semilla aditivos): la instantánea tiene un costo real y la ruta de rutina no la necesita.

Ejemplo de mensaje de commit:

```
Refactor | Phase 7 closeout (Checkpoint)

Drops the deprecated tomori_configs table after Phase 6 backfill.
Snapshot is required because the migration is destructive.
```

El token `(Checkpoint)` puede aparecer en cualquier lugar en el asunto o el cuerpo; se combina de manera sensible a las mayúsculas contra el mensaje del commit principal. El despacho de flujo de trabajo manual con la entrada de copia de seguridad del flujo de trabajo habilitada es la misma palanca para casos ad-hoc.

## Qué hacer si una migración falla a medias

Si el bot se bloquea o se congela durante la migración:

1. **Detén el bot inmediatamente**: no dejes que vuelva a intentar las migraciones a ciegas.

2. **Revisa los registros**: TomoriBot registra en stdout/stderr por defecto (capturado por tu administrador de procesos o los registros de Docker). Busca un mensaje de error que nombre la migración que falló. Ejemplo de salida:

   ```
   Migration failed: 042_drop_old_column, error: column "old_column" does not exist
   ```

3. **Decide si restaurar**: si el error es irrecuperable (por ejemplo, la migración intentó eliminar una columna que no existe), restaura desde tu copia de seguridad:

   ```bash
   # Option A restore
   bun run restore-backup --latest

   # Or Option B restore
   pg_restore \
     -h "$POSTGRES_HOST" \
     -p "$POSTGRES_PORT" \
     -U "$POSTGRES_USER" \
     -d "$POSTGRES_DB" \
     tomoribot-backup-20240115-143045.dump
   ```

4. **Revierte el código**: vuelve al último commit que funcionaba:

   ```bash
   git reset --hard <previous-commit-hash>
   ```

   Usa el hash que guardaste en el paso 3 de la lista de verificación antes de hacer pull, o encuéntralo con:

   ```bash
   git log --oneline | head -20
   ```

5. **Reporta el error**: abre un problema en [github.com/Bredrumb/TomoriBot/issues](https://github.com/Bredrumb/TomoriBot/issues) con:
   - El nombre del archivo de migración fallido (de los registros)
   - El mensaje de error completo
   - El último hash de commit exitoso
   - Tu sistema operativo, versión de Bun (`bun --version`), y versión de PostgreSQL

## Qué NO es recuperable automáticamente

Según el diseño del proyecto (OD-R-6), las migraciones destructivas no pueden ser revertidas por el ejecutor de migraciones. Ejemplos:

- `DROP COLUMN name_here`: las filas eliminadas se pierden para siempre; ningún script de SQL puede recuperarlas.
- `DROP TABLE old_table`: toda la tabla desaparece.
- Reducción de tipo (por ejemplo, `VARCHAR(255) → VARCHAR(100)`): los valores más largos de 100 caracteres se truncan.

Para estas operaciones, la única recuperación es tu copia de seguridad. Siempre haz una copia de seguridad antes de hacer pull si estás en una versión anterior y se ha enviado una refactorización nueva.

El diseño exclusivo hacia adelante del ejecutor de migraciones es intencional: los archivos de reversión (`.down.sql`) existen para la seguridad del desarrollador durante las pruebas, pero la recuperación de producción utiliza copias de seguridad y sus claves de cifrado retenidas por separado. La reejecución de una migración destructiva no puede recuperar los datos eliminados.

## Probar una rama de función, luego regresar a `main`

Un caso común: alguien te pide que pruebes una rama en tu instalación existente, y quieres saber si revisar la rama, iniciarla y luego cambiar de nuevo a `main` dañará tu base de datos.

Los hechos clave:

- Git y PostgreSQL son mundos separados. `git checkout` solo intercambia archivos en el disco; nunca se conecta a tu base de datos ni la modifica. PostgreSQL almacena el estado de migración aplicada en la tabla `schema_migrations`. Cambiar de rama de git no cambia esa tabla.
- Las migraciones se ejecutan automáticamente en el arranque (a través de `initializeDatabase.ts`), por lo que en el momento en que inicias la rama, sus nuevas migraciones se aplican a la base de datos a la que hayas apuntado.
- El ejecutor hacia adelante nunca hace reversiones automáticas. Cuando regresas a `main`, escanea los archivos en el disco, no encuentra nada pendiente y no hace nada. Las migraciones que aplicó la rama permanecen aplicadas.

Entonces, ¿es seguro? Depende completamente de lo que hicieron las migraciones de la rama:

- **Solo aditivo** (nuevas tablas/nuevas columnas) → seguro. Los nuevos objetos simplemente quedan sin uso; el código de `main` nunca hace referencia a ellos, por lo que no pueden provocar resultados incorrectos ni fallos. Elimina los objetos no utilizados únicamente a través de una migración revisada.
- Destructivo (`DROP`, `RENAME` o `ALTER` en una tabla que `main` aún usa) → no seguro. El cambio de la rama deja varado el código de `main` contra una columna o tabla que ahora no existe o está alterada.

El enfoque más seguro: apunta la rama a una base de datos desechable (una `POSTGRES_DB` separada), para que tus datos reales nunca se toquen. Ya construyes la conexión a partir de las variables `POSTGRES_*`, y `bun run nuke-db` puede restablecer una base de datos de prueba.

### Revertir manualmente una migración de prueba

Si probaste una rama contra tu base de datos real y quieres deshacer sus migraciones después, usa el ejecutor de reversión. A diferencia del ejecutor hacia adelante, nunca se ejecuta automáticamente: la reversión siempre es un acto manual deliberado porque los archivos `.down.sql` suelen tener pérdidas.

```bash
# Preview only (dry run): show what would be rolled back
bun run migrate:down 034          # this migration + every newer applied one
bun run migrate:down --last       # only the most recently applied migration
bun run migrate:down --last=2     # the two most recently applied migrations

# Execute the rollback (runs the .down.sql files, removes schema_migrations rows)
bun run migrate:down 034 --yes
```

El comando ejecuta los archivos `.down.sql` seleccionados en orden de versión descendente (para que los dependientes de una migración se deshagan antes que ella), y luego elimina las filas de `schema_migrations` coincidentes. Sin esas filas, el ejecutor hacia adelante volverá a aplicar las migraciones la próxima vez que inicies una rama que todavía las incluye.

> Ejecútalo mientras aún estés en la rama. La reversión lee `NNN_description.down.sql` del disco. Una vez que haces `git checkout main`, esos archivos desaparecen y la reversión ya no se puede ejecutar. Revierte primero, luego cambia de rama.

> Todavía tiene pérdidas. Revertir `034` aquí ejecuta `DROP TABLE short_term_memories`: cualquier dato creado durante las pruebas se pierde. Eso se espera para una limpieza de prueba, pero nunca ejecutes `migrate:down` contra datos que quieras conservar sin una copia de seguridad.

## Ver también

- [Documentación del esquema de la base de datos](/en/architecture/subsystems/database-schema/) (conoce la estructura de esquema actual)
- [Documentación de Bun](https://bun.sh) (conoce los fundamentos del entorno de ejecución de Bun)
