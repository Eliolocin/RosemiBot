---
title: "Estadísticas e información"
sidebar:
  order: 4
---

TomoriBot rastrea las métricas de interacción para que pueda inspeccionar las tendencias de actividad, modelar el uso de tokens, personas populares y llamadas de herramientas, o generar tarjetas de resumen infográficas que se puedan compartir.

## Paneles de texto

Tres comandos abren un panel interactivo con pestañas:

- `/stats personal`: vea sus propias estadísticas de uso.
- `/stats persona`: ver las estadísticas de uso de una persona específica en este servidor.
- `/stats server`: vea estadísticas de todo el servidor de todos los miembros y personas.

Cada panel incluye pestañas para Descripción general, Personas, Modelos y costos, Herramientas y comandos, Expresión, Personas favoritas y Tablas de clasificación.

La mayoría de los subcomandos le permiten especificar una ventana de tiempo (como 7 días, 30 días o todo el tiempo). Las estadísticas personales se pueden limitar al servidor actual o a todos los servidores donde usa TomoriBot.

Los paneles de texto son mensajes públicos duraderos controlados por el invocador. Permanecen interactivos hasta que se descartan o eliminan, y otros miembros no pueden manipular los controles de su panel.

:::note
Los recuentos de tokens reflejan el uso informado por el proveedor cuando están disponibles (una estimación basada en caracteres se utiliza solo para proveedores que omiten métricas de tokens). Las cifras de costos valoran esos tokens según las tarifas de lista del catálogo de modelos, por lo que pueden diferir de su factura real debido al almacenamiento en caché rápido, descuentos de proveedores o cuotas de nivel gratuito.
:::

## Tarjetas de infografía para compartir

Ejecuta `/stats generate` para generar una tarjeta de imagen resumida pulida que puede compartir directamente en el chat:

- **Envoltura personal**: resume tu actividad personal y tus personajes favoritos.
- **Afinidad de persona**: destaca las estadísticas de una persona específica y los principales socios de conversación en este servidor.
- **Tabla de clasificación del servidor**: muestra la actividad en todo el servidor y la clasificación de los miembros.

Los usuarios con su nivel de privacidad establecido en `Completo` en `/personal config` no pueden generar tarjetas de estadísticas personales.

Para obtener detalles sobre cómo se componen y representan las tarjetas, consulte el [subsistema de infografía de estadísticas](/en/architecture/subsystems/stats-infographic/).
