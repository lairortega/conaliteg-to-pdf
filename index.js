const https = require('https');
const http = require('http');
const fs = require('fs');
const readline = require('readline');
const { pipeline } = require('stream');
const { execSync } = require('child_process');
const cluster = require('cluster');
const numCPUs = require('os').cpus().length;
const sanitize = require('sanitize-filename');
const { convert, sizes } = require('image-to-pdf');
const download = require('download');

/**
 * Pregunta al usuario por consola y devuelve la respuesta ingresada.
 */
function askQuestion(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans.trim());
    }));
}

/**
 * Realiza una petición HEAD para verificar si una URL responde con estado 200.
 */
function checkUrlExists(url) {
    return new Promise((resolve) => {
        const client = url.startsWith('https') ? https : http;
        const req = client.request(url, { method: 'HEAD' }, (res) => {
            resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.setTimeout(5000, () => {
            req.destroy();
            resolve(false);
        });
        req.end();
    });
}

/**
 * Descarga un archivo por stream garantizando la escritura completa y mostrando el progreso.
 */
function downloadFile(url, outputPath) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return resolve(downloadFile(res.headers.location, outputPath));
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`Error HTTP ${res.statusCode}: ${res.statusMessage}`));
            }

            const totalBytes = parseInt(res.headers['content-length'], 10) || 0;
            let downloadedBytes = 0;
            const fileStream = fs.createWriteStream(outputPath);

            res.on('data', (chunk) => {
                downloadedBytes += chunk.length;
                if (totalBytes > 0) {
                    const percent = ((downloadedBytes / totalBytes) * 100).toFixed(1);
                    const mb = (downloadedBytes / (1024 * 1024)).toFixed(2);
                    const totalMb = (totalBytes / (1024 * 1024)).toFixed(2);
                    process.stdout.write(`\r[Progreso] ${percent}% (${mb} MB / ${totalMb} MB)`);
                } else {
                    const mb = (downloadedBytes / (1024 * 1024)).toFixed(2);
                    process.stdout.write(`\r[Progreso] ${mb} MB descargados`);
                }
            });

            pipeline(res, fileStream, (err) => {
                if (err) {
                    fs.unlink(outputPath, () => {});
                    return reject(err);
                }
                process.stdout.write('\n');
                console.log(`Descarga finalizada (${(downloadedBytes / (1024 * 1024)).toFixed(2)} MB).`);
                resolve(outputPath);
            });
        });

        req.on('error', (err) => {
            reject(err);
        });
    });
}

/**
 * Obtiene dinámicamente la contraseña del PDF inspeccionando el script del lector (reader.bundle.js).
 */
async function fetchPdfPassword(baseUrl = 'https://libros.conaliteg.gob.mx') {
    try {
        const origin = new URL(baseUrl).origin;
        const bundleUrl = `${origin}/pdf-reader/reader.bundle.js`;
        process.stdout.write('Obteniendo credenciales dinámicamente desde el lector oficial...');

        const response = await fetch(bundleUrl);
        if (!response.ok) {
            process.stdout.write(' [No disponible]\n');
            return null;
        }

        const scriptContent = await response.text();
        // Busca el patrón: password: "..." en el bundle de PDF.js
        const match = scriptContent.match(/password\s*:\s*["']([^"']+)["']/i);
        if (match && match[1]) {
            process.stdout.write(' [OK]\n');
            return match[1];
        }
        process.stdout.write(' [No encontrada]\n');
    } catch (_) {
        process.stdout.write(' [Error al consultar]\n');
    }
    return null;
}

/**
 * Verifica si un archivo PDF contiene diccionario de encriptación (/Encrypt).
 */
function isPdfEncrypted(filePath) {
    try {
        const buffer = fs.readFileSync(filePath);
        return buffer.includes(Buffer.from('/Encrypt'));
    } catch (_) {
        return false;
    }
}

/**
 * Desbloquea el PDF removiendo la contraseña y las restricciones de impresión
 * utilizando la contraseña obtenida dinámicamente y Ghostscript (si está instalado).
 */
async function unlockPdfIfPossible(filePath, sourceUrl) {
    if (!isPdfEncrypted(filePath)) {
        return;
    }

    const password = await fetchPdfPassword(sourceUrl);
    if (!password) {
        console.log('No se pudo obtener la clave dinámica; el archivo PDF se conservará con su protección original.');
        return;
    }

    const tempPath = `${filePath}.temp_locked.pdf`;
    try {
        execSync('which gs', { stdio: 'ignore' });
        fs.renameSync(filePath, tempPath);
        console.log('Desbloqueando documento para permitir impresión y lectura sin contraseña...');
        execSync(`gs -q -dNOPAUSE -dBATCH -sDEVICE=pdfwrite -sPDFPassword="${password}" -sOutputFile="${filePath}" "${tempPath}"`, {
            stdio: 'ignore'
        });
        fs.unlinkSync(tempPath);
        console.log('¡Documento desbloqueado y optimizado con éxito!');
    } catch (_) {
        if (fs.existsSync(tempPath)) {
            fs.renameSync(tempPath, filePath);
        }
        console.log(`Nota: El PDF tiene restricciones CONALITEG. Contraseña detectada: "${password}"`);
    }
}

/**
 * Crea un PDF a partir de una secuencia de imágenes (método clásico).
 */
function createPDFFromImages(bookId, totalPages) {
    const pages = [];
    for (let index = 0; index < totalPages; index++) {
        const paddedIndex = String(index).padStart(3, '0');
        const candidateFile = `./${bookId}/${paddedIndex}.jpg`;
        const candidateFolderFile = `./${bookId}/${paddedIndex}.jpg/${paddedIndex}.jpg`;
        if (fs.existsSync(candidateFile)) {
            pages.push(candidateFile);
        } else if (fs.existsSync(candidateFolderFile)) {
            pages.push(candidateFolderFile);
        }
    }

    if (pages.length === 0) {
        console.error('No se encontraron imágenes válidas para generar el PDF.');
        return;
    }

    console.log(`Concentrando ${pages.length} imágenes en el archivo PDF...`);
    const outputPdf = `${sanitize(bookId)}.pdf`;
    const writeStream = fs.createWriteStream(outputPdf);

    writeStream.on('finish', () => {
        console.log(`¡PDF creado exitosamente: ${outputPdf}!`);
        try {
            fs.rmSync(`${bookId}/`, { recursive: true, force: true });
        } catch (_) {}
    });

    convert(pages, sizes.A4).pipe(writeStream);
}

/**
 * Descargador de imágenes por lotes para cada worker del cluster.
 */
async function downloadImagesWorker(url, bookId, index) {
    while (true) {
        const paddedIndex = String(index).padStart(3, '0');
        const urlToDownload = `${url}${paddedIndex}.jpg`;
        try {
            const destFolder = `${bookId}`;
            await download(urlToDownload, destFolder, {
                filename: `${paddedIndex}.jpg`
            });
            index += numCPUs;
        } catch (e) {
            break;
        }
    }
    process.exit(0);
}

/**
 * Obtiene los niveles hermanos disponibles en la página principal de CONALITEG
 * correspondientes al bloque:
 * body > div.container2.extracted-style-39 > div > div > div:nth-child(1) > div.row > div:nth-child(4)
 */
async function fetchCatalogLevels(homeUrl = 'https://libros.conaliteg.gob.mx/') {
    console.log(`Consultando opciones del catálogo en ${homeUrl}...`);
    const res = await fetch(homeUrl);
    if (!res.ok) {
        throw new Error(`Error al conectar con ${homeUrl} (${res.status}: ${res.statusText})`);
    }
    const html = await res.text();

    const containerIdx = html.indexOf('container2 extracted-style-39');
    if (containerIdx === -1) {
        throw new Error('No se encontró la sección principal del catálogo en la página de inicio.');
    }

    const catalogIdx = html.indexOf('Catálogo de libros', containerIdx);
    const searchFrom = catalogIdx !== -1 ? catalogIdx : containerIdx;

    const rowStart = html.lastIndexOf('<div class="row">', searchFrom);
    const rowEnd = html.indexOf('<!-- id="row" -->', searchFrom);
    const rowChunk = (rowStart !== -1 && rowEnd !== -1)
        ? html.substring(rowStart, rowEnd)
        : html.substring(searchFrom, searchFrom + 3000);

    const regex = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const levels = [];
    let m;
    while ((m = regex.exec(rowChunk)) !== null) {
        const rawHref = m[1];
        const content = m[2];
        const titleMatch = content.match(/<p class="titulo-nivel">([^<]+)<\/p>/i) || content.match(/alt="([^"]+)"/i);
        const title = titleMatch ? titleMatch[1].trim() : rawHref;
        const fullUrl = rawHref.startsWith('http') ? rawHref : new URL(rawHref, homeUrl).href;
        levels.push({ title, url: fullUrl });
    }

    return levels;
}

/**
 * Obtiene los libros disponibles en la página de un nivel seleccionado.
 */
async function fetchBooksFromLevel(levelUrl) {
    const res = await fetch(levelUrl);
    if (!res.ok) {
        throw new Error(`Error al cargar los libros desde ${levelUrl} (${res.status})`);
    }
    const html = await res.text();

    const regex = /<a[^>]*href="([^"]*reader\.html[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    const books = [];
    const seenHrefs = new Set();
    let m;
    while ((m = regex.exec(html)) !== null) {
        const rawHref = m[1];
        if (seenHrefs.has(rawHref)) continue;
        seenHrefs.add(rawHref);

        const inner = m[2];
        const altMatch = inner.match(/alt="([^"]*)"/i);
        let title = altMatch ? altMatch[1].trim() : '';
        if (!title) {
            title = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        }

        const fullHref = rawHref.startsWith('http') ? rawHref : new URL(rawHref, levelUrl).href;

        let clave = '';
        try {
            const parsed = new URL(fullHref);
            clave = parsed.searchParams.get('clave') || '';
        } catch (_) {}

        books.push({
            title: title || clave || 'Libro sin título',
            clave,
            url: fullHref
        });
    }

    return books;
}

/**
 * Detecta el grado escolar de un libro a partir de su título y clave.
 */
function detectGrade(book) {
    const titleLower = (book.title || '').toLowerCase();

    if (titleLower.includes('primer grado') || titleLower.includes('1er grado') || titleLower.includes('primero de secundaria')) return 'Primer Grado';
    if (titleLower.includes('segundo grado') || titleLower.includes('2do grado') || titleLower.includes('segundo de secundaria')) return 'Segundo Grado';
    if (titleLower.includes('tercer grado') || titleLower.includes('3er grado') || titleLower.includes('tercero de secundaria')) return 'Tercer Grado';
    if (titleLower.includes('cuarto grado') || titleLower.includes('4to grado')) return 'Cuarto Grado';
    if (titleLower.includes('quinto grado') || titleLower.includes('5to grado')) return 'Quinto Grado';
    if (titleLower.includes('sexto grado') || titleLower.includes('6to grado')) return 'Sexto Grado';

    const match = (book.clave || '').match(/^[A-Z]([0-9])/);
    if (match) {
        const num = parseInt(match[1], 10);
        switch (num) {
            case 0: return 'Material para Docentes / General';
            case 1: return 'Primer Grado';
            case 2: return 'Segundo Grado';
            case 3: return 'Tercer Grado';
            case 4: return 'Cuarto Grado';
            case 5: return 'Quinto Grado';
            case 6: return 'Sexto Grado';
        }
    }

    if (titleLower.includes('docente') || titleLower.includes('maestra y el maestro') || titleLower.includes('familia')) {
        return 'Material para Docentes / General';
    }

    return 'General / Multigrado';
}

/**
 * Menú interactivo por consola cuando no se proporciona una URL inicial.
 */
async function interactiveMenu() {
    console.log('No se proporcionó URL inicial. Conectando con https://libros.conaliteg.gob.mx/...\n');
    const levels = await fetchCatalogLevels('https://libros.conaliteg.gob.mx/');
    if (levels.length === 0) {
        console.error('No se encontraron niveles educativos disponibles.');
        process.exit(1);
    }

    console.log('Catálogo de libros - Niveles disponibles:');
    levels.forEach((lvl, idx) => {
        console.log(`  [${idx + 1}] ${lvl.title}`);
    });

    let selectedLevel = null;
    while (!selectedLevel) {
        const answer = await askQuestion(`\nSeleccione una opción (1-${levels.length}) o 'q' para salir: `);
        if (answer.toLowerCase() === 'q') {
            console.log('Operación cancelada.');
            process.exit(0);
        }
        const choice = parseInt(answer, 10);
        if (choice >= 1 && choice <= levels.length) {
            selectedLevel = levels[choice - 1];
        } else {
            console.log('Opción inválida. Intente de nuevo.');
        }
    }

    console.log(`\nCargando catálogo de ${selectedLevel.title}...`);
    const books = await fetchBooksFromLevel(selectedLevel.url);
    if (books.length === 0) {
        console.log(`No se encontraron libros disponibles en el catálogo de ${selectedLevel.title}.`);
        process.exit(0);
    }

    // Organizar libros por grado
    const GRADE_ORDER = [
        'Primer Grado',
        'Segundo Grado',
        'Tercer Grado',
        'Cuarto Grado',
        'Quinto Grado',
        'Sexto Grado',
        'Material para Docentes / General',
        'General / Multigrado'
    ];

    const grouped = {};
    for (const b of books) {
        const grade = detectGrade(b);
        if (!grouped[grade]) grouped[grade] = [];
        grouped[grade].push(b);
    }

    const flattenedBooks = [];
    console.log(`\n============================================================`);
    console.log(`  LIBROS DISPONIBLES EN ${selectedLevel.title.toUpperCase()} (${books.length} encontrados)`);
    console.log(`============================================================`);

    for (const grade of GRADE_ORDER) {
        if (!grouped[grade] || grouped[grade].length === 0) continue;
        console.log(`\n------------------------------------------------------------`);
        console.log(`  ● ${grade.toUpperCase()} (${grouped[grade].length} ${grouped[grade].length === 1 ? 'libro' : 'libros'})`);
        console.log(`------------------------------------------------------------`);
        for (const b of grouped[grade]) {
            flattenedBooks.push(b);
            const idx = flattenedBooks.length;
            const claveLabel = b.clave ? ` [${b.clave}]` : '';
            console.log(`  [${String(idx).padStart(2, ' ')}] ${b.title}${claveLabel}`);
        }
    }

    let selectedBook = null;
    while (!selectedBook) {
        const answer = await askQuestion(`\nSeleccione el número del libro a descargar (1-${flattenedBooks.length}) o 'q' para salir: `);
        if (answer.toLowerCase() === 'q') {
            console.log('Operación cancelada.');
            process.exit(0);
        }
        const choice = parseInt(answer, 10);
        if (choice >= 1 && choice <= flattenedBooks.length) {
            selectedBook = flattenedBooks[choice - 1];
        } else {
            console.log('Opción inválida. Intente de nuevo.');
        }
    }

    console.log(`\nLibro seleccionado: ${selectedBook.title}`);
    return selectedBook.url;
}

/**
 * Analiza la URL ingresada y extrae los datos del libro.
 */
function parseBookUrl(rawUrl) {
    try {
        const parsed = new URL(rawUrl);

        // Caso 1: URL directa al archivo PDF
        if (parsed.pathname.endsWith('.pdf')) {
            const fileName = parsed.pathname.split('/').pop();
            const bookId = fileName.replace(/\.pdf$/i, '');
            return {
                type: 'direct_pdf',
                pdfUrl: parsed.href,
                bookId
            };
        }

        // Caso 2: Nuevo visor web basado en PDF.js (reader.html)
        if (parsed.pathname.includes('/pdf-reader/')) {
            const clave = parsed.searchParams.get('clave');
            const ciclo = parsed.searchParams.get('ciclo');
            const nivel = parsed.searchParams.get('nivel');

            if (!clave) {
                throw new Error('La URL del lector no contiene el parámetro obligatorio "clave".');
            }

            const bookId = clave.replace(/\.pdf$/i, '');
            const pdfFileName = `${bookId}.pdf`;

            const pathSegments = ['pdf-reader', 'assets'];
            if (nivel) pathSegments.push(encodeURIComponent(nivel));
            if (ciclo) pathSegments.push(encodeURIComponent(ciclo));
            pathSegments.push(encodeURIComponent(pdfFileName));

            const pdfUrl = `${parsed.origin}/${pathSegments.join('/')}`;
            return {
                type: 'direct_pdf',
                pdfUrl,
                bookId,
                ciclo,
                nivel
            };
        }
    } catch (e) {
        if (e.message && e.message.includes('obligatorio')) throw e;
    }

    // Caso 3: URL clásica de CONALITEG (ej: https://libros.conaliteg.gob.mx/2026/S0LPM.htm)
    const cleanUrl = rawUrl.split('?')[0];
    const parts = cleanUrl.split('/').filter(Boolean);
    const lastPart = parts[parts.length - 1] || '';
    const bookId = lastPart.split('.')[0];
    const bookYear = parts[parts.length - 2];

    return {
        type: 'classic',
        bookId,
        bookYear,
        rawUrl: cleanUrl
    };
}

/**
 * Función principal
 */
const main = async () => {
    // Si es un proceso worker secundario en modo descarga de imágenes
    if (cluster.isWorker) {
        const rawUrl = process.env.BOOK_IMAGES_URL;
        const bookId = process.env.BOOK_ID;
        const workerOffset = cluster.worker.id - 1;
        await downloadImagesWorker(rawUrl, bookId, workerOffset);
        return;
    }

    // Obtener la URL de los argumentos
    const args = process.argv.slice(2);
    let inputUrl = args.join(' ').trim();

    // Si no se proporcionó URL, mostrar el menú interactivo
    if (!inputUrl) {
        inputUrl = await interactiveMenu();
    }

    console.log(`\nProcesando URL: ${inputUrl}`);
    const bookInfo = parseBookUrl(inputUrl);

    // Si ya determinamos que es un PDF directo (del nuevo visor o enlace .pdf)
    if (bookInfo.type === 'direct_pdf') {
        const outputPdf = `${sanitize(bookInfo.bookId)}.pdf`;
        console.log(`Detectado servicio de PDF oficial CONALITEG.`);
        console.log(`Descargando desde: ${bookInfo.pdfUrl}`);
        try {
            await downloadFile(bookInfo.pdfUrl, outputPdf);
            await unlockPdfIfPossible(outputPdf, bookInfo.pdfUrl || inputUrl);
            console.log(`Archivo PDF listo: ${outputPdf}`);
            process.exit(0);
        } catch (err) {
            console.error(`Error al descargar el PDF directo: ${err.message}`);
            process.exit(1);
        }
    }

    // Si es una URL clásica (ej. .../2026/S0LPM.htm o .../2024/S2SAA.htm)
    const { bookId, bookYear } = bookInfo;
    console.log(`Libro ID: ${bookId}, Ciclo: ${bookYear}`);

    // Intentar deducir si existe en el nuevo servicio de PDF directo
    const prefix = bookId.charAt(0).toUpperCase();
    const nivelMap = {
        'S': 'secundaria',
        'P': 'primaria',
        'K': 'preescolar',
        'T': 'telesecundaria'
    };

    const nivelesToCheck = [];
    if (nivelMap[prefix]) nivelesToCheck.push(nivelMap[prefix]);
    ['secundaria', 'primaria', 'preescolar', 'telesecundaria'].forEach(n => {
        if (!nivelesToCheck.includes(n)) nivelesToCheck.push(n);
    });

    console.log('Verificando si el libro está disponible en el nuevo servicio PDF...');
    let foundPdfUrl = null;
    for (const nivel of nivelesToCheck) {
        const candidateUrl = `https://libros.conaliteg.gob.mx/pdf-reader/assets/${nivel}/${bookYear}/${bookId}.pdf`;
        if (await checkUrlExists(candidateUrl)) {
            foundPdfUrl = candidateUrl;
            break;
        }
    }

    if (foundPdfUrl) {
        console.log(`Encontrado PDF en el nuevo servicio: ${foundPdfUrl}`);
        const outputPdf = `${sanitize(bookId)}.pdf`;
        try {
            await downloadFile(foundPdfUrl, outputPdf);
            await unlockPdfIfPossible(outputPdf, foundPdfUrl);
            console.log(`Archivo PDF listo: ${outputPdf}`);
            process.exit(0);
        } catch (err) {
            console.error(`Error al descargar: ${err.message}`);
            process.exit(1);
        }
    }

    // Si no existe como PDF directo, verificar si existe en el servicio clásico de imágenes
    const imagesBaseUrl = `https://libros.conaliteg.gob.mx/${bookYear}/c/${bookId}/`;
    console.log(`Verificando servicio clásico de imágenes en: ${imagesBaseUrl}000.jpg`);

    const imageExists = await checkUrlExists(`${imagesBaseUrl}000.jpg`);
    if (!imageExists) {
        console.error(`No se encontró el libro en el nuevo servicio de PDF ni en el servicio clásico de imágenes.`);
        process.exit(1);
    }

    console.log('Libro encontrado en servicio clásico de imágenes. Iniciando descarga por lotes...');
    fs.mkdirSync(bookId, { recursive: true });

    let workersDone = 0;
    for (let i = 0; i < numCPUs; i++) {
        cluster.fork({
            BOOK_IMAGES_URL: imagesBaseUrl,
            BOOK_ID: bookId
        });
    }

    cluster.on('exit', () => {
        workersDone++;
        if (workersDone === numCPUs) {
            try {
                const files = fs.readdirSync(bookId)
                    .filter(f => f.endsWith('.jpg'))
                    .map(f => parseInt(f.split('.')[0], 10))
                    .filter(n => !isNaN(n));

                if (files.length === 0) {
                    console.error('No se descargaron imágenes.');
                    process.exit(1);
                }

                const maxIndex = Math.max(...files);
                const totalPages = maxIndex + 1;
                createPDFFromImages(bookId, totalPages);
            } catch (err) {
                console.error(`Error al procesar las imágenes: ${err.message}`);
                process.exit(1);
            }
        }
    });
};

main().catch((err) => {
    console.error('Error inesperado:', err);
    process.exit(1);
});