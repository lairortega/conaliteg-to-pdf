const { convert, sizes } = require('image-to-pdf');
const fs = require('fs');
const download = require("download");
const sanitize = require("sanitize-filename");

const siteURL = process.argv.pop();
const bookPath = siteURL.split("/");

const bookChunks = bookPath[bookPath.length-1].split(".")
const bookId = bookChunks[0];
const bookYear = bookPath[bookPath.length-2];

fs.mkdir(bookId, () => {});
downloader(`https://libros.conaliteg.gob.mx/${bookYear}/c/${bookId}/`, bookId, 0);

function downloader(url, bookId, index) {
    index = String(index).padStart(3, '0');
    urlToDownload = `${url}${index}.jpg`;
    download(urlToDownload, `${bookId}/${index}.jpg`)
    .then(() => {
        downloader(url, bookId, ++index);
    })
    .catch(() => {
        createPDF(bookId, index);
    })
}

function createPDF(bookId, totalPages) {
    const pages = [];
    for (let index = 0; index < totalPages; index++) {
        file_folder = String(index).padStart(3, '0');
        pages.push(`./${bookId}/${file_folder}.jpg/${file_folder}.jpg`);
    }
    convert(pages, sizes.A4).pipe(fs.createWriteStream(`${sanitize(bookId)}.pdf`));
    fs.rmdirSync(`${sanitize(bookId)}/`, { recursive: true });
}