# conaliteg-to-pdf

Utilidad para descargar libros de texto de CONALITEG en formato PDF.

## Características
- **Modo interactivo**: Al ejecutar sin argumentos (`node index.js`), consulta directamente la portada oficial `https://libros.conaliteg.gob.mx/` y muestra un menú interactivo con los niveles disponibles (Preescolar, Primaria, Secundaria, Telesecundaria) y sus libros para seleccionarlos por consola.
- **Descarga directa del PDF oficial**: Obtiene el PDF original en calidad máxima vectorial en segundos, sin pérdida de resolución.
- **Desbloqueo automático**: Obtiene dinámicamente las credenciales de lectura y elimina las restricciones de copia e impresión con Ghostscript.
- **Soporte para múltiples formatos de URL**: Acepta la URL del visor web (`reader.html`), el enlace directo `.pdf` o las URLs clásicas (`.htm`).
- **Retrocompatibilidad**: Para libros de ciclos anteriores que todavía usan imágenes por páginas (`/c/{bookId}/000.jpg`), mantiene el flujo de descarga concurrente y unión con `image-to-pdf`.

## Uso

### 1. Modo Interactivo (sin argumentos)
Simplemente ejecuta:
```bash
node index.js
```
El script mostrará las opciones disponibles extraídas del catálogo oficial para que selecciones el nivel y el libro deseado con el teclado.

### 2. Modo Directo (pasando URL)
```bash
node index.js "<url>"
```

> **Nota:** Se recomienda colocar la URL entre comillas dobles (`"..."`) para evitar que el símbolo `&` sea interpretado por la consola.

#### Ejemplos
- **Nuevo visor web CONALITEG:**
  ```bash
  node index.js "https://libros.conaliteg.gob.mx/pdf-reader/reader.html?nivel=secundaria&ciclo=2026&clave=S0LPM"
  ```
- **Enlace directo al PDF:**
  ```bash
  node index.js "https://libros.conaliteg.gob.mx/pdf-reader/assets/secundaria/2026/S0LPM.pdf"
  ```
- **Enlace clásico (.htm):**
  ```bash
  node index.js "https://libros.conaliteg.gob.mx/2026/S0LPM.htm"
  node index.js "https://libros.conaliteg.gob.mx/2024/S2SAA.htm"
  ```
