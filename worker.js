// Worker voor zware taken: resizen + JPEG + ZIP
// Laad fflate in de worker
importScripts('https://unpkg.com/fflate@0.8.0/umd/index.js');

const { zipSync } = fflate;

// Afbeelding resizen + converteren naar JPEG
async function convertFileToJpegWithResize(file) {
  // Probeer createImageBitmap + OffscreenCanvas te gebruiken
  if (typeof createImageBitmap === 'function' && typeof OffscreenCanvas !== 'undefined') {
    const bitmap = await createImageBitmap(file);

    const maxSize = 2560; // max breedte/hoogte
    const scale = Math.min(
      maxSize / bitmap.width,
      maxSize / bitmap.height,
      1
    );

    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await canvas.convertToBlob({
      type: 'image/jpeg',
      quality: 0.85
    });

    const buffer = await blob.arrayBuffer();
    return new Uint8Array(buffer);
  }

  // Fallback: geen resize, alleen direct naar JPEG via blob (als die al JPEG is)
  const buffer = await file.arrayBuffer();
  return new Uint8Array(buffer);
}

// Hoofd-functie: maak ZIP(s) in slices
async function generateZipsInWorker({
  steps,
  maxImagesPerZip,
  maxBytesPerZip,
  baseName,
  totalFiles
}) {
  const jpegCache = new Map(); // cache per bronbestand
  let currentMap = {};
  let currentCount = 0;
  let currentBytes = 0;
  let sliceIndex = 0;
  let done = 0;

  async function flushSlice() {
    if (currentCount === 0) return;

    // zipSync map { bestandsnaam: Uint8Array }
    const zipData = zipSync(currentMap, { level: 6 });
    const blob = new Blob([zipData], { type: 'application/zip' });
    const sizeBytes = blob.size;

    // Naamgeving part1 / part2 etc.
    const name =
      sliceIndex === 0 && steps.length === currentCount
        ? `${baseName}.zip`
        : `${baseName}_part${sliceIndex + 1}.zip`;

    self.postMessage(
      {
        type: 'ZIP_SLICE_READY',
        name,
        numImages: currentCount,
        sizeBytes,
        blob
      },
      [blob] // blob transferen i.p.v. kopiëren
    );

    sliceIndex++;
    currentMap = {};
    currentCount = 0;
    currentBytes = 0;
  }

  for (const step of steps) {
    const { file, newName } = step;

    let jpegData = jpegCache.get(file);
    if (!jpegData) {
      jpegData = await convertFileToJpegWithResize(file);
      jpegCache.set(file, jpegData);
    }

    const fileSize = jpegData.length;
    const wouldCount = currentCount + 1;
    const wouldBytes = currentBytes + fileSize;

    if (
      currentCount > 0 &&
      (wouldCount > maxImagesPerZip || wouldBytes > maxBytesPerZip)
    ) {
      await flushSlice();
    }

    currentMap[newName] = jpegData;
    currentCount++;
    currentBytes += fileSize;

    done++;
    if (done === totalFiles || done % 5 === 0) {
      self.postMessage({
        type: 'PROGRESS',
        done,
        total: totalFiles
      });
    }
  }

  await flushSlice();

  self.postMessage({
    type: 'DONE'
  });
}

// Ontvanger in de worker
self.onmessage = async (event) => {
  const data = event.data;
  if (data.type === 'GENERATE_ZIPS') {
    try {
      await generateZipsInWorker(data);
    } catch (err) {
      self.postMessage({
        type: 'ERROR',
        message: err && err.message ? err.message : String(err)
      });
    }
  }
};
