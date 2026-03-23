const { convert, sizes } = require('image-to-pdf');
const fs = require('fs');
const download = require("download");
const sanitize = require("sanitize-filename");

const cluster = require('cluster');
const numCPUs = require('os').cpus().length;

function createPDF(bookId, totalPages) {
    const pages = [];
    for (let index = 0; index < totalPages; index++) {
        const file_folder = String(index).padStart(3, '0');
        pages.push(`./${bookId}/${file_folder}.jpg/${file_folder}.jpg`);
    }
    convert(pages, sizes.A4).pipe(fs.createWriteStream(`${sanitize(bookId)}.pdf`));
    fs.rmdirSync(`${bookId}/`, { recursive: true });
}

const run = async () => {
    const siteURL = process.argv.pop();
    const bookPath = siteURL.split("/");

    const bookChunks = bookPath[bookPath.length-1].split(".")
    const bookId = bookChunks[0];
    const bookYear = bookPath[bookPath.length-2];

    await downloader(`https://libros.conaliteg.gob.mx/${bookYear}/c/${bookId}/`, bookId, cluster.worker.id - 1);
}

async function downloader(url, bookId, index) {
    while (true) {
        const paddedIndex = String(index).padStart(3, '0');
        const urlToDownload = `${url}${paddedIndex}.jpg`;
        try {
            // console.info(`Downloading ${urlToDownload}`);
            await download(urlToDownload, `${bookId}/${paddedIndex}.jpg`);
            index += numCPUs;
        } catch (e) {
            break;
        }
    }
    process.exit(0);
}

// console.log("Numero de cpus", numCPUs);
if (cluster.isPrimary) {
    // console.log(`Master ${process.pid} is running`);
    const siteURL = process.argv[process.argv.length - 1];
    const bookPath = siteURL.split("/");
    const bookChunks = bookPath[bookPath.length-1].split(".")
    const bookId = bookChunks[0];
    fs.mkdirSync(bookId, { recursive: true });
    let workersDone = 0;
    for (let i = 0; i < numCPUs; i++) {
        // console.log("Creando nuevo proceso");
        cluster.fork();
    }
    cluster.on('exit', (worker, code, signal) => {
        // console.log(`worker ${worker.process.pid} died`);
        workersDone++;
        if (workersDone === numCPUs) {
            const files = fs.readdirSync(bookId).filter(f => f.endsWith('.jpg')).map(f => parseInt(f.split('.')[0]));
            const maxIndex = Math.max(...files);
            const totalPages = maxIndex + 1;
            createPDF(bookId, totalPages);
        }
    });
} else {
    // console.log(`Hilo ${cluster.worker.id}: "Running: run(${numCPUs}, ${cluster.worker.id})"`);
    (async () => { await run(); })();
}