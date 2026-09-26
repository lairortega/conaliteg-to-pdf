# conaliteg-to-pdf

Utilidad para descargar libros de texto de CONALITEG en formato PDF.

## Novedades y Compatibilidad
CONALITEG actualizó su plataforma a un lector basado en PDF oficial (`pdf-reader`). Este script ahora:
- **Descarga directa del PDF oficial**: Obtiene el PDF original en calidad máxima vectorial y en segundos, sin pérdida de resolución ni necesidad de recomprimir imágenes.
- **Soporte para múltiples formatos de URL**: Acepta la URL del visor web (`reader.html`), el enlace directo `.pdf` o las URLs clásicas (`.htm`).
- **Retrocompatibilidad**: Para libros de ciclos anteriores donde aún se usa el esquema de imágenes por páginas (`/c/{bookId}/000.jpg`), el script mantiene el flujo de descarga paralela con cluster y conversión a PDF.

## Uso

```bash
node index.js "<url>"
```

> **Nota:** Se recomienda colocar la URL entre comillas dobles (`"..."`) para evitar que el símbolo `&` sea interpretado por la consola.

### Ejemplos

1. **Nuevo visor web CONALITEG (capturado desde el navegador):**
   ```bash
   node index.js "https://libros.conaliteg.gob.mx/pdf-reader/reader.html?nivel=secundaria&ciclo=2026&clave=S0LPM"
   ```

2. **Enlace directo al PDF:**
   ```bash
   node index.js "https://libros.conaliteg.gob.mx/pdf-reader/assets/secundaria/2026/S0LPM.pdf"
   ```

3. **Enlace clásico (.htm):**
   ```bash
   node index.js "https://libros.conaliteg.gob.mx/2026/S0LPM.htm"
   # o libros de ciclos anteriores:
   node index.js "https://libros.conaliteg.gob.mx/2024/S2SAA.htm"
   ```
