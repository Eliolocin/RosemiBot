---
title: Monitoreo local con Grafana
sidebar:
  order: 7
---

Supervise su instancia local TomoriBot con paneles de Grafana prediseñados para realizar un seguimiento del uso de la memoria, el tamaño de la caché, el consumo de tokens y el tráfico de comandos.

Inicia TomoriBot y Grafana juntos:

```sh
docker compose -f docker-compose.yaml -f docker/compose.monitor.yaml up -d
```

Este comando:
- Lanza TomoriBot y PostgreSQL (con la base de datos expuesta en el puerto 15432)
- Lanza Grafana en el puerto 3000 con una fuente de datos PostgreSQL preconfigurada
- Aprovisiona el panel de descripción general de TomoriBot
- Conecta todos los servicios en una red interna Docker

Abre Grafana en [http://localhost:3000](http://localhost:3000):
- **Nombre de usuario**: `admin`
- **Contraseña**: configurada a través de `GRAFANA_PASSWORD` en `.env` (el valor predeterminado es `admin` cuando no está configurado)

## El panel aprovisionado

El panel de descripción general de TomoriBot se carga automáticamente sin configuración manual. Sus paneles muestran la memoria del proceso, el recuento de entradas de caché, los errores por hora, el uso de tokens por modelo, la actividad horaria, los comandos principales, las configuraciones regionales del usuario, una nube de emociones y ajustes preestablecidos y modelos activos.

Cada panel consulta tablas estándar presentes en todas las instalaciones, lo que permite que el mismo diseño del panel funcione localmente y en entornos de nube.

Ciertos paneles requieren configuraciones de tiempo de ejecución específicas o soporte de host:

| Panel | Necesidades |
|---|---|
| Memoria de proceso, entradas de caché | Filas `metric_samples` escritas cada `CACHE_METRICS_INTERVAL_MS`. El recopilador se ejecuta solo cuando `RUN_ENV=production`, por lo que una instancia de desarrollo no muestra datos aquí. |
| Errores por hora por tipo | `ERROR_DB_LOGGING_ENABLED` (habilitado por defecto). Una línea plana durante un incidente puede indicar que el disyuntor de la base de datos está abierto en lugar de que los errores hayan cesado. |
| Memoria del host y niveles de intercambio, presión del host (PSI) y tasa de intercambio | Un servidor Linux. Estos dicen `/proc/meminfo`, `/proc/pressure/*`, `/proc/swaps` y `/sys/block/zram0`, por lo que permanecen vacíos en macOS y Windows. La serie zram requiere un dispositivo de intercambio zram configurado; Los hosts sin zram aún informan métricas generales de memoria y presión. |

## Editar y conservar los cambios

Los paneles siguen siendo editables en la interfaz de Grafana para la depuración en vivo. Debido a que los reinicios del contenedor restablecen las ediciones del panel en archivos de disco, exporte el JSON del panel modificado y guárdelo en `docker/grafana/dashboards/` para conservar los cambios.

Para agregar un nuevo panel, coloque su definición JSON en `docker/grafana/dashboards/`. Apunte a la fuente de datos PostgreSQL con el uid fijo `tomoribot-postgres`: las fuentes de datos sin un uid explícito reciben identificadores generados aleatoriamente, lo que hace que los paneles que utilizan uids no coincidentes muestren paneles en blanco.
