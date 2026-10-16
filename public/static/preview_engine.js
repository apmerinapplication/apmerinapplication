/**
 * AP Merin Services - In-Browser Universal Document Preview Engine
 * Generates high-resolution previews for PDF, Excel, Word, Screenshots, and CSV.
 */

// Configure PDF.js worker
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'static/pdf.worker.min.js';
}

/**
 * Generates preview object for any file format in the browser
 */
async function generateClientDocPreview(fileOrBlob, filename) {
  const fn = (filename || "").toLowerCase();
  const preview = {
    filename: filename || "Document",
    format: "unknown",
    pages: [],
    tables: [],
    text: ""
  };

  try {
    // 1. PDF Files
    if (fn.endsWith('.pdf') || (fileOrBlob.type === 'application/pdf')) {
      preview.format = 'pdf';
      const arrayBuffer = await fileOrBlob.arrayBuffer();
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const numPages = Math.min(pdf.numPages, 10);

      for (let i = 1; i <= numPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.8 }); // 1.8x scale for crisp high-DPI rendering
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({ canvasContext: context, viewport: viewport }).promise;
        preview.pages.push(canvas.toDataURL('image/png'));
      }
      return preview;
    }

    // 2. Images / Screenshots
    if (fileOrBlob.type && fileOrBlob.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif)$/i.test(fn)) {
      preview.format = 'image';
      const base64Url = await fileToBase64(fileOrBlob);
      preview.pages.push(base64Url);
      preview.blobUrl = base64Url;
      return preview;
    }

    // 3. Excel Spreadsheets (.xlsx, .xls)
    if (fn.endsWith('.xlsx') || fn.endsWith('.xls')) {
      preview.format = 'excel';
      const arrayBuffer = await fileOrBlob.arrayBuffer();
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });

      workbook.SheetNames.slice(0, 5).forEach(sheetName => {
        const sheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
        if (rows && rows.length > 0) {
          const cleanRows = rows.filter(r => r && r.length > 0);
          preview.tables.push({
            sheet_name: sheetName,
            headers: cleanRows[0] || [],
            rows: cleanRows.slice(1, 100)
          });
        }
      });
      return preview;
    }

    // 4. Word Documents (.docx)
    if (fn.endsWith('.docx')) {
      preview.format = 'docx';
      const arrayBuffer = await fileOrBlob.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
      preview.text = result.value || "";
      return preview;
    }

    // 5. Raw Text / CSV
    preview.format = 'text';
    if (typeof fileOrBlob === 'string') {
      preview.text = fileOrBlob;
    } else {
      preview.text = await fileOrBlob.text();
    }
    return preview;

  } catch (err) {
    console.warn("Preview generation error:", err);
    preview.format = 'text';
    preview.text = `File loaded: ${filename}`;
    return preview;
  }
}
