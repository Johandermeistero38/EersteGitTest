// === UI ELEMENTEN PAKKEN ===
const colorsTableBody = document.getElementById('colors-table-body');
const addColorBtn = document.getElementById('add-color-btn');
const colorsError = document.getElementById('colors-error');

const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const fileTable = document.getElementById('file-table');
const fileTableBody = document.getElementById('file-table-body');
const fileCounter = document.getElementById('file-counter');
const filesError = document.getElementById('files-error');

const generateBtn = document.getElementById('generate-btn');
const summaryInfo = document.getElementById('summary-info');
const zipNameInput = document.getElementById('zip-name');

const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');

const colorDialogBackdrop = document.getElementById('color-dialog-backdrop');
const colorDialogSelect = document.getElementById('color-dialog-select');
const colorDialogNewSection = document.getElementById('color-dialog-new-section');
const colorDialogNewName = document.getElementById('color-dialog-new-name');
const colorDialogNewAsins = document.getElementById('color-dialog-new-asins');
const colorDialogError = document.getElementById('color-dialog-error');
const colorDialogCancel = document.getElementById('color-dialog-cancel');
const colorDialogConfirm = document.getElementById('color-dialog-confirm');
const colorDialogCountText = document.getElementById('color-dialog-count-text');

const zipDownloadSection = document.getElementById('zip-download-section');
const zipTableBody = document.getElementById('zip-table-body');
const downloadAllBtn = document.getElementById('download-all-btn');

// === STATE ===
let colorSets = [];
let uploadedFiles = [];
let pendingBatchFileIds = [];
let generatedZips = [];

const colorNameRegex = /^[A-Za-z ]+$/;
const MAX_IMAGES_PER_ZIP = 950;
const MAX_BYTES_PER_ZIP = 950 * 1024 * 1024; // 950 MB

let isDirty = false;
let isGenerating = false;
let finalMessageEl = null;

// === WEB WORKER ===
let zipWorker = null;

function initWorker() {
  if (window.Worker) {
    zipWorker = new Worker('worker.js');

    zipWorker.onmessage = (e) => {
      const data = e.data;
      switch (data.type) {
        case 'PROGRESS':
          updateProgress(data.done, data.total);
          break;

        case 'ZIP_SLICE_READY': {
          const { name, numImages, sizeBytes, blob } = data;
          const url = URL.createObjectURL(blob);
          generatedZips.push({ name, url, sizeBytes, numImages });
          updateZipListUI();
          break;
        }

        case 'DONE':
          finishProgress();
          isGenerating = false;
          generateBtn.textContent = 'Genereer ZIP met hernoemde afbeeldingen';
          markClean();
          updateSummary();
          updateGenerateButtonState();
          break;

        case 'ERROR':
          filesError.innerHTML =
            `<strong>ZIP fout (worker):</strong><br>${data.message || 'Onbekende fout'}`;
          filesError.style.display = 'block';
          isGenerating = false;
          generateBtn.textContent = 'Genereer ZIP met hernoemde afbeeldingen';
          updateGenerateButtonState();
          break;
      }
    };
  } else {
    alert('Je browser ondersteunt geen Web Workers; prestatie kan minder zijn.');
  }
}

// === HULPFUNCTIES ===

function updateGenerateButtonState() {
  if (isGenerating) {
    generateBtn.disabled = true;
    return;
  }
  generateBtn.disabled = !isDirty;
}

function markDirty() {
  isDirty = true;
  updateGenerateButtonState();
}

function markClean() {
  isDirty = false;
  updateGenerateButtonState();
}

function parseAsins(text) {
  return (text || '')
    .split(/[\s,;]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function getColorById(id) {
  return colorSets.find(c => c.id === id) || null;
}

function countTotalGeneratedFiles() {
  let count = 0;
  for (const file of uploadedFiles) {
    const color = getColorById(file.colorId);
    if (!color) continue;
    const asins = parseAsins(color.asinsText);
    count += asins.length;
  }
  return count;
}

function updateSummary() {
  const numColors = colorSets.length;
  const numFiles = uploadedFiles.length;
  const totalFiles = countTotalGeneratedFiles();

  if (!numColors && !numFiles) {
    summaryInfo.textContent = 'Nog geen kleuren of afbeeldingen toegevoegd.';
    return;
  }

  summaryInfo.textContent =
    `Kleuren: ${numColors} | Afbeeldingen: ${numFiles} | Geschatte totaalbestanden: ${totalFiles}`;
}

function resetErrors() {
  colorsError.style.display = 'none';
  colorsError.textContent = '';
  filesError.style.display = 'none';
  filesError.textContent = '';
}

function resetProgress() {
  progressContainer.style.display = 'none';
  progressContainer.style.opacity = 1;
  progressBar.style.width = '0%';
  progressText.textContent = '';
}

function removeFinalMessage() {
  if (finalMessageEl && finalMessageEl.parentElement) {
    finalMessageEl.parentElement.removeChild(finalMessageEl);
  }
}

function startProgress(total) {
  removeFinalMessage();
  progressContainer.style.display = 'block';
  progressContainer.style.opacity = 1;
  progressBar.style.width = '0%';
  progressText.textContent = `Start met genereren (${total} bestanden)...`;
}

function updateProgress(done, total) {
  if (!total) return;
  const pct = Math.min(100, Math.round((done / total) * 100));
  progressBar.style.width = pct + '%';
  progressText.textContent = `Bezig met genereren: ${done}/${total} bestanden (${pct}%)`;
}

function showFinalMessage() {
  if (!finalMessageEl) {
    finalMessageEl = document.createElement('div');
    finalMessageEl.id = 'generation-done-message';
    finalMessageEl.style.marginTop = '8px';
    finalMessageEl.style.fontSize = '14px';
    finalMessageEl.style.color = '#10b981';
  }
  finalMessageEl.textContent = '✔ Genereren voltooid – ZIP-bestanden zijn klaar om te downloaden.';

  const parent = progressContainer.parentElement;
  if (parent && !finalMessageEl.isConnected) {
    parent.appendChild(finalMessageEl);
  }

  if (generatedZips.length) {
    zipDownloadSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function finishProgress() {
  progressText.textContent = 'Genereren voltooid. ZIP-bestand(en) worden klaargezet...';
  progressBar.style.width = '100%';

  setTimeout(() => {
    progressContainer.style.opacity = 0;
    setTimeout(() => {
      progressContainer.style.display = 'none';
      progressContainer.style.opacity = 1;
      showFinalMessage();
    }, 350);
  }, 1200);
}

// === KLEUREN ===

function addColorRow(initial = { name: '', asinsText: '' }) {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  colorSets.push({ id, name: initial.name, asinsText: initial.asinsText });
  markDirty();
  renderColorTable();
}

function renderColorTable() {
  colorsTableBody.innerHTML = '';

  if (colorSets.length === 0) {
    colorsTableBody.innerHTML = `
      <tr>
        <td colspan="3" style="font-size:13px; color:#6b7280; padding:12px 10px;">
          Nog geen kleuren toegevoegd. Klik op <strong>"Kleur toevoegen"</strong> om te beginnen.
        </td>
      </tr>
    `;
  } else {
    colorSets.forEach((color, index) => {
      const tr = document.createElement('tr');

      const tdName = document.createElement('td');
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'color-name-input';
      nameInput.placeholder = 'Bijv. Zwart';
      nameInput.value = color.name;
      const nameError = document.createElement('div');
      nameError.className = 'helper-text';
      nameError.style.color = '#b91c1c';
      nameError.style.display = 'none';

      function validateName() {
        const value = nameInput.value.trim();
        colorSets[index].name = value;
        if (!value) {
          nameInput.classList.add('invalid');
          nameError.textContent = 'Kleurnaam is verplicht.';
          nameError.style.display = 'block';
          return false;
        }
        if (!colorNameRegex.test(value)) {
          nameInput.classList.add('invalid');
          nameError.textContent = 'Alleen letters en spaties toegestaan.';
          nameError.style.display = 'block';
          return false;
        }
        nameInput.classList.remove('invalid');
        nameError.style.display = 'none';
        return true;
      }

      nameInput.addEventListener('input', () => {
        validateName();
        markDirty();
        renderFileTable();
        updateSummary();
      });

      tdName.appendChild(nameInput);
      tdName.appendChild(nameError);

      const tdAsins = document.createElement('td');
      const ta = document.createElement('textarea');
      ta.className = 'color-asins-textarea';
      ta.placeholder = 'ASIN\'s voor deze kleur...';
      ta.value = color.asinsText || '';
      ta.addEventListener('input', () => {
        colorSets[index].asinsText = ta.value;
        markDirty();
        updateSummary();
      });
      tdAsins.appendChild(ta);

      const tdAction = document.createElement('td');
      const btnRemove = document.createElement('button');
      btnRemove.className = 'btn-small btn-danger';
      btnRemove.type = 'button';
      btnRemove.textContent = 'Verwijder';
      btnRemove.addEventListener('click', () => {
        const removedId = colorSets[index].id;
        colorSets.splice(index, 1);

        uploadedFiles = uploadedFiles.map(f =>
          f.colorId === removedId ? { ...f, colorId: '' } : f
        );

        markDirty();
        renderColorTable();
        renderFileTable();
        updateSummary();
      });
      tdAction.appendChild(btnRemove);

      tr.appendChild(tdName);
      tr.appendChild(tdAsins);
      tr.appendChild(tdAction);

      colorsTableBody.appendChild(tr);

      validateName();
    });
  }

  colorsError.style.display = 'none';
  updateSummary();
}

addColorBtn.addEventListener('click', () => addColorRow());

// === BESTANDEN ===

function autoSuffixForIndex(batchSize, index) {
  if (batchSize === 1) return 'MAIN';
  if (batchSize === 2) return index === 0 ? 'MAIN' : 'SWCH';
  if (index === 0) return 'MAIN';
  if (index === batchSize - 1) return 'SWCH';
  const ptNum = Math.min(index, 9);
  return 'PT' + String(ptNum).padStart(2, '0');
}

function assignSuffixesForBatch(batchItems) {
  const n = batchItems.length;
  batchItems.forEach((item, idx) => {
    item.suffix = autoSuffixForIndex(n, idx);
  });
}

function handleFiles(files) {
  resetErrors();
  const fileArray = Array.from(files);
  const newBatchItems = [];

  fileArray.forEach(file => {
    if (!file.type.startsWith('image/')) return;
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const previewUrl = URL.createObjectURL(file);

    const obj = {
      id,
      file,
      suffix: '',
      previewUrl,
      colorId: ''
    };
    uploadedFiles.push(obj);
    newBatchItems.push(obj);
  });

  if (newBatchItems.length > 0) {
    assignSuffixesForBatch(newBatchItems);
    markDirty();
  }

  renderFileTable();

  if (newBatchItems.length === 0) return;
  openColorDialog(newBatchItems.map(f => f.id));
}

function renderFileTable() {
  fileTableBody.innerHTML = '';

  if (uploadedFiles.length === 0) {
    fileTable.style.display = 'none';
    fileCounter.style.display = 'none';
    updateSummary();
    return;
  }

  fileTable.style.display = 'table';
  fileCounter.style.display = 'block';
  fileCounter.textContent =
    `Aantal geüploade afbeeldingen: ${uploadedFiles.length}. Selecteer een rol en kleur per afbeelding.`;

  const suffixOptions = [
    'MAIN', 'SWCH',
    'PT01', 'PT02', 'PT03', 'PT04', 'PT05', 'PT06', 'PT07', 'PT08', 'PT09'
  ];

  uploadedFiles.forEach((item, index) => {
    const tr = document.createElement('tr');

    const tdPreview = document.createElement('td');
    const img = document.createElement('img');
    img.className = 'file-preview';
    img.src = item.previewUrl;
    img.alt = item.file.name;
    tdPreview.appendChild(img);

    const tdSuffix = document.createElement('td');
    const selectRole = document.createElement('select');
    suffixOptions.forEach(opt => {
      const optionEl = document.createElement('option');
      optionEl.value = opt;
      optionEl.textContent = opt;
      if (opt === item.suffix) optionEl.selected = true;
      selectRole.appendChild(optionEl);
    });
    selectRole.addEventListener('change', (e) => {
      uploadedFiles[index].suffix = e.target.value;
      markDirty();
      updateSummary();
    });
    tdSuffix.appendChild(selectRole);

    const tdColor = document.createElement('td');
    const selectColor = document.createElement('select');
    selectColor.className = 'color-select';

    const placeholderOpt = document.createElement('option');
    placeholderOpt.value = '';
    placeholderOpt.textContent = '— Kies kleur —';
    selectColor.appendChild(placeholderOpt);

    colorSets.forEach(color => {
      const validName = color.name && colorNameRegex.test(color.name);
      if (!validName) return;
      const opt = document.createElement('option');
      opt.value = color.id;
      opt.textContent = color.name;
      if (item.colorId === color.id) opt.selected = true;
      selectColor.appendChild(opt);
    });

    if (!item.colorId) {
      selectColor.classList.add('invalid');
    }

    selectColor.addEventListener('change', (e) => {
      uploadedFiles[index].colorId = e.target.value;
      if (!e.target.value) {
        selectColor.classList.add('invalid');
      } else {
        selectColor.classList.remove('invalid');
      }
      markDirty();
      updateSummary();
    });

    tdColor.appendChild(selectColor);

    const tdName = document.createElement('td');
    tdName.textContent = item.file.name;

    const tdAction = document.createElement('td');
    const btnRemove = document.createElement('button');
    btnRemove.className = 'btn-small btn-danger';
    btnRemove.type = 'button';
    btnRemove.textContent = 'Verwijder';
    btnRemove.addEventListener('click', () => {
      URL.revokeObjectURL(item.previewUrl);
      uploadedFiles.splice(index, 1);
      markDirty();
      renderFileTable();
      updateSummary();
    });
    tdAction.appendChild(btnRemove);

    tr.appendChild(tdPreview);
    tr.appendChild(tdSuffix);
    tr.appendChild(tdColor);
    tr.appendChild(tdName);
    tr.appendChild(tdAction);

    fileTableBody.appendChild(tr);
  });

  filesError.style.display = 'none';
  updateSummary();
}

// Dropzone events
dropzone.addEventListener('click', () => fileInput.click());
dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropzone.classList.add('dragover');
});
dropzone.addEventListener('dragleave', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
});
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropzone.classList.remove('dragover');
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    handleFiles(e.dataTransfer.files);
  }
});

fileInput.addEventListener('change', (e) => {
  if (e.target.files) {
    handleFiles(e.target.files);
    fileInput.value = '';
  }
});

zipNameInput.addEventListener('input', () => {
  markDirty();
});

// === KLEUR-DIALOOG ===

function openColorDialog(fileIds) {
  pendingBatchFileIds = fileIds.slice();
  colorDialogError.style.display = 'none';
  colorDialogNewSection.style.display = 'none';
  colorDialogNewName.value = '';
  colorDialogNewAsins.value = '';

  const count = fileIds.length;
  colorDialogCountText.textContent =
    `Je hebt zojuist ${count} afbeelding${count > 1 ? 'en' : ''} geüpload zonder gekozen kleur.`;

  colorDialogSelect.innerHTML = '';

  const existingColors = colorSets.filter(c => c.name && colorNameRegex.test(c.name));

  if (existingColors.length > 0) {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '— Kies bestaande kleur —';
    colorDialogSelect.appendChild(placeholder);

    existingColors.forEach(color => {
      const opt = document.createElement('option');
      opt.value = color.id;
      opt.textContent = color.name;
      colorDialogSelect.appendChild(opt);
    });

    const separator = document.createElement('option');
    separator.disabled = true;
    separator.textContent = '──────────';
    separator.value = '__sep__';
    colorDialogSelect.appendChild(separator);
  }

  const newOpt = document.createElement('option');
  newOpt.value = '__new__';
  newOpt.textContent = '+ Nieuwe kleur toevoegen';
  colorDialogSelect.appendChild(newOpt);

  if (existingColors.length === 0) {
    colorDialogSelect.value = '__new__';
    colorDialogNewSection.style.display = 'block';
  } else {
    colorDialogSelect.value = '';
    colorDialogNewSection.style.display = 'none';
  }

  colorDialogBackdrop.style.display = 'flex';
}

colorDialogSelect.addEventListener('change', () => {
  const value = colorDialogSelect.value;
  colorDialogError.style.display = 'none';

  if (value === '__new__') {
    colorDialogNewSection.style.display = 'block';
  } else if (value === '__sep__') {
    colorDialogSelect.value = '';
    colorDialogNewSection.style.display = 'none';
  } else {
    colorDialogNewSection.style.display = 'none';
  }
});

colorDialogCancel.addEventListener('click', () => {
  colorDialogBackdrop.style.display = 'none';
  pendingBatchFileIds = [];
});

colorDialogConfirm.addEventListener('click', () => {
  colorDialogError.style.display = 'none';
  const value = colorDialogSelect.value;

  if (!value) {
    colorDialogError.textContent = 'Kies een bestaande kleur of voeg een nieuwe toe.';
    colorDialogError.style.display = 'block';
    return;
  }

  let chosenColorId = null;

  if (value === '__new__') {
    const name = colorDialogNewName.value.trim();
    const asinsText = colorDialogNewAsins.value;

    if (!name) {
      colorDialogError.textContent = 'Kleurnaam is verplicht.';
      colorDialogError.style.display = 'block';
      return;
    }
    if (!colorNameRegex.test(name)) {
      colorDialogError.textContent = 'Kleurnaam mag alleen letters en spaties bevatten.';
      colorDialogError.style.display = 'block';
      return;
    }
    const asins = parseAsins(asinsText);
    if (asins.length === 0) {
      colorDialogError.textContent = 'Voer minimaal één ASIN in voor de nieuwe kleur.';
      colorDialogError.style.display = 'block';
      return;
    }

    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    colorSets.push({ id, name, asinsText });
    chosenColorId = id;

    renderColorTable();
  } else if (value === '__sep__') {
    colorDialogError.textContent = 'Kies een geldige kleur.';
    colorDialogError.style.display = 'block';
    return;
  } else {
    chosenColorId = value;
  }

  if (!chosenColorId) {
    colorDialogError.textContent = 'Er ging iets mis bij het kiezen van de kleur.';
    colorDialogError.style.display = 'block';
    return;
  }

  for (const fid of pendingBatchFileIds) {
    const file = uploadedFiles.find(f => f.id === fid);
    if (file) file.colorId = chosenColorId;
  }

  colorDialogBackdrop.style.display = 'none';
  pendingBatchFileIds = [];

  markDirty();
  renderFileTable();
  updateSummary();
});

// === VALIDATIE & GENERATION PLAN ===

function validateBeforeGenerate() {
  if (colorSets.length === 0) {
    colorsError.textContent = 'Voeg minimaal één kleur met ASIN\'s toe.';
    colorsError.style.display = 'block';
    return false;
  }
  colorsError.style.display = 'none';

  const usedColorIds = new Set(uploadedFiles.map(f => f.colorId).filter(Boolean));
  for (const color of colorSets) {
    if (!usedColorIds.has(color.id)) continue;

    if (!color.name || !colorNameRegex.test(color.name)) {
      colorsError.textContent = `Kleur "${color.name || '(leeg)'}" heeft een ongeldige naam.`;
      colorsError.style.display = 'block';
      return false;
    }
    const asins = parseAsins(color.asinsText);
    if (asins.length === 0) {
      colorsError.textContent = `Kleur "${color.name}" heeft geen ASIN's.`;
      colorsError.style.display = 'block';
      return false;
    }
  }
  colorsError.style.display = 'none';

  if (uploadedFiles.length === 0) {
    filesError.textContent = 'Upload minimaal één afbeelding.';
    filesError.style.display = 'block';
    return false;
  }

  for (let i = 0; i < uploadedFiles.length; i++) {
    const file = uploadedFiles[i];
    if (!file.colorId) {
      filesError.textContent = 'Selecteer voor elke afbeelding een kleur.';
      filesError.style.display = 'block';
      const selects = document.querySelectorAll('.color-select');
      if (selects[i]) selects[i].classList.add('invalid');
      return false;
    }
    const color = getColorById(file.colorId);
    if (!color) {
      filesError.textContent = 'Een van de geselecteerde kleuren bestaat niet meer.';
      filesError.style.display = 'block';
      return false;
    }
    if (parseAsins(color.asinsText).length === 0) {
      filesError.textContent = `Kleur "${color.name}" heeft geen ASIN's.`;
      filesError.style.display = 'block';
      return false;
    }
  }

  filesError.style.display = 'none';
  return true;
}

function buildGenerationPlan() {
  const colorAsinsById = {};
  colorSets.forEach(color => {
    colorAsinsById[color.id] = parseAsins(color.asinsText);
  });

  const filenameMap = new Map();
  const duplicates = [];
  const plan = [];

  for (const item of uploadedFiles) {
    const color = getColorById(item.colorId);
    if (!color) continue;
    const asins = colorAsinsById[color.id] || [];
    const suffix = item.suffix.toUpperCase();

    for (const asin of asins) {
      const asinTrimmed = asin.trim();
      if (!asinTrimmed) continue;

      const newName = `${asinTrimmed}.${suffix}.jpg`;
      const step = {
        item,
        color,
        asin: asinTrimmed,
        newName
      };

      plan.push(step);

      const existing = filenameMap.get(newName);
      if (existing) {
        duplicates.push({ newName, first: existing, second: step });
      } else {
        filenameMap.set(newName, step);
      }
    }
  }

  if (plan.length === 0) {
    filesError.textContent =
      'Er zijn geen bestanden om te genereren. Controleer kleuren, ASIN\'s en afbeeldingen.';
    filesError.style.display = 'block';
    return null;
  }

  if (duplicates.length > 0) {
    let msg = 'Er zijn dubbele bestandsnamen gedetecteerd. Iedere combinatie van ASIN + rol (suffix) moet uniek zijn.<br><br>';
    const maxShow = Math.min(duplicates.length, 10);
    for (let i = 0; i < maxShow; i++) {
      const d = duplicates[i];
      msg += `• <strong>${d.newName}</strong><br>`;
      msg += `&nbsp;&nbsp;- Kleur 1: ${d.first.color.name}, bestand: ${d.first.item.file.name}<br>`;
      msg += `&nbsp;&nbsp;- Kleur 2: ${d.second.color.name}, bestand: ${d.second.item.file.name}<br>`;
    }
    if (duplicates.length > maxShow) {
      msg += `<br>... en nog ${duplicates.length - maxShow} andere duplicaten.`;
    }

    filesError.innerHTML = msg;
    filesError.style.display = 'block';
    return null;
  }

  return { plan, totalFiles: plan.length };
}

// === ZIP UI ===

function formatBytes(bytes) {
  if (bytes == null || isNaN(bytes)) return '';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return gb.toFixed(2) + ' GB';
  const mb = bytes / (1024 * 1024);
  return mb.toFixed(1) + ' MB';
}

function updateZipListUI() {
  zipTableBody.innerHTML = '';

  if (!generatedZips.length) {
    zipDownloadSection.style.display = 'none';
    downloadAllBtn.disabled = true;
    return;
  }

  zipDownloadSection.style.display = 'block';
  downloadAllBtn.disabled = false;

  generatedZips.forEach((zip, index) => {
    const tr = document.createElement('tr');

    const tdName = document.createElement('td');
    tdName.innerHTML = `<strong>${zip.name}</strong>`;
    tr.appendChild(tdName);

    const tdCount = document.createElement('td');
    tdCount.textContent = zip.numImages != null ? `${zip.numImages}` : '–';
    tr.appendChild(tdCount);

    const tdSize = document.createElement('td');
    tdSize.textContent = zip.sizeBytes != null ? formatBytes(zip.sizeBytes) : '–';
    tr.appendChild(tdSize);

    const tdActions = document.createElement('td');
    const btnDownload = document.createElement('button');
    btnDownload.className = 'btn-small';
    btnDownload.style.background = '#2563eb';
    btnDownload.style.color = '#ffffff';
    btnDownload.type = 'button';
    btnDownload.textContent = 'Download';
    btnDownload.addEventListener('click', () => downloadZipAt(index));

    const btnDelete = document.createElement('button');
    btnDelete.className = 'btn-small btn-danger';
    btnDelete.type = 'button';
    btnDelete.textContent = 'Verwijder';
    btnDelete.style.marginLeft = '6px';
    btnDelete.addEventListener('click', () => deleteZipAt(index));

    tdActions.appendChild(btnDownload);
    tdActions.appendChild(btnDelete);
    tr.appendChild(tdActions);

    zipTableBody.appendChild(tr);
  });
}

function downloadZipAt(index) {
  const zip = generatedZips[index];
  if (!zip) return;
  const a = document.createElement('a');
  a.href = zip.url;
  a.download = zip.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function deleteZipAt(index) {
  const zip = generatedZips[index];
  if (!zip) return;
  try {
    URL.revokeObjectURL(zip.url);
  } catch (e) {}
  generatedZips.splice(index, 1);
  updateZipListUI();
}

function clearGeneratedZips() {
  generatedZips.forEach(z => {
    try {
      URL.revokeObjectURL(z.url);
    } catch (e) {}
  });
  generatedZips = [];
  updateZipListUI();
}

downloadAllBtn.addEventListener('click', () => {
  for (let i = 0; i < generatedZips.length; i++) {
    downloadZipAt(i);
  }
});

// === GENERATE BUTTON ===

generateBtn.addEventListener('click', () => {
  if (isGenerating || !isDirty) return;

  resetErrors();
  resetProgress();
  clearGeneratedZips();

  if (!validateBeforeGenerate()) {
    updateGenerateButtonState();
    return;
  }

  const planData = buildGenerationPlan();
  if (!planData) {
    updateGenerateButtonState();
    return;
  }

  if (!zipWorker) {
    filesError.textContent = 'Background worker is niet beschikbaar. Vernieuw de pagina en probeer opnieuw.';
    filesError.style.display = 'block';
    return;
  }

  const { plan, totalFiles } = planData;

  isGenerating = true;
  updateGenerateButtonState();

  generateBtn.textContent = 'Bezig met genereren...';
  startProgress(totalFiles);

  let baseName = zipNameInput.value.trim();
  if (!baseName) baseName = 'amazon-images-per-afbeelding';

  // ✔ AANGEPAST: worker-cache gebruiken via sourceId
  const stepsForWorker = plan.map(step => ({
    newName: step.newName,
    file: step.item.file,
    sourceId: step.item.id     // <-- BELANGRIJK!
  }));

  zipWorker.postMessage({
    type: 'GENERATE_ZIPS',
    steps: stepsForWorker,
    maxImagesPerZip: MAX_IMAGES_PER_ZIP,
    maxBytesPerZip: MAX_BYTES_PER_ZIP,
    baseName,
    totalFiles
  });
});

// === INIT ===
renderColorTable();
updateSummary();
updateGenerateButtonState();
initWorker();
