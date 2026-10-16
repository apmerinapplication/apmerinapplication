// Web deployment: Gemini credentials exist only on the authenticated server.
function getApiKey(){return '';}
async function setApiKey(){throw new Error('Configure Gemini in Vercel server settings.');}
async function callGeminiApi(parts, unused='', kind='quote'){
  const authResponse=await fetch('/workflow/api/session');
  const auth=await authResponse.json();
  if(!auth.user)throw new Error('Sign in to the shared dashboard first.');
  const response=await fetch('/workflow/api/worksheet/extract',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':auth.csrf},body:JSON.stringify({parts,kind})});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error||'Extraction failed.');
  return data.items;
}
function getExtractionPrompt(docType = "rfq") {
  let prompt = `
You are an expert marine procurement and quotation document parser.
Extract all ${docType.toUpperCase()} table line items from this document into a structured JSON array.

OUTPUT SCHEMA:
Return a JSON array where each object has:
- item_no (integer: row index 1, 2, 3...)
- item_code (string: part code, article code, stock code, or client item code)
- part_no (string: manufacturer part number, P/N, or drawing number)
- maker_no (string: model number, make, or drawing reference if present)
- impa_code (string: 6-digit marine IMPA / ISSA code if present)
- ref_no (string: position number or requisition reference if present)
- description (string: product name / description without trailing item code)
- remarks (string: any notes or sub-text underneath the item row, e.g. "- INCLUDED IN ITEM NO.4", "EX-STOCK", "LEAD TIME: 2 WEEKS", "MATERIAL: BRONZE")
- quantity (number: numeric quantity ONLY, e.g. 6.00 -> 6, 2.00 -> 2, 1.00 -> 1)
- unit (string: unit code, e.g. "PCS", "PCE", "SET", "EA", "BOX", "ROLL", "DOZ", "PRS", "MTR", "SHT")
`;

  if (docType === "quote") {
    prompt += `
- list_unit_price (number: gross list price per single unit BEFORE discount, e.g. 642.60, 227.35, 33.65)
- discount_percent (number: supplier discount percentage if stated in table/columns e.g. 5 for 5%, 10 for 10%, 0 if none)
- unit_price (number: NET supplier unit cost AFTER applying discount, e.g. if list price is 642.60 with 5% discount, net unit price is 610.47. If total amount for 4 items is 127.87, net unit price is 127.87 / 4 = 31.9675)
- total_amount (number: line total amount after discount, e.g. 610.47, 215.98, 127.87)
- currency (string: 3-letter currency code, e.g. USD, EUR, MYR, SGD)
- is_offer (boolean: true ONLY if supplier explicitly offers an alternative/substitute part)
- offer_text (string: alternative part description if offered)
`;
  }

  prompt += `
CRITICAL TABLE COLUMN MAPPING & EMBEDDED ITEM CODE RULES:
1. EMBEDDED ITEM CODES / IMPA CODES:
   - Many supplier quotations (such as marine store quotes from Singapore/Malaysia/Europe) list 5 to 8 digit IMPA codes or item numbers directly alongside or at the end of the description (e.g. "SPRING CLAMP MOP COMPLETE 174275", "AIR DUSTER LONG NOSE 270613", "DUST MASK DISPOSABLE 50'S/BOX 331130", "HOIST CHAIN SPUR-GEAR 615038", "WATERTIGHT 3 PIN PLUG 792888").
   - Even if there is NO explicit column header titled "Item Code", you MUST extract these numeric part/IMPA codes (e.g. "174275", "270613", "331130", "510491", "614010", "615038", "794395", "650602", "650502", "650126") into the "item_code" field!
   - Remove the item code from "description" so "description" contains only the clean product title (e.g. item_code: "174275", description: "SPRING CLAMP MOP COMPLETE").

2. SUPPLIER DISCOUNTS & NET UNIT PRICES (CRITICAL):
   - If the quotation has a "Disc." or "Discount" column (e.g. 5%, 10%) or states a trade discount:
     a) Extract "discount_percent" (e.g. 5.0).
     b) Extract "list_unit_price" (the price before discount, e.g. 642.60).
     c) Calculate NET "unit_price": list_unit_price * (1 - discount_percent/100) OR divide total line amount by quantity (e.g. for item 4: 127.87 / 4 = 31.9675).
     d) The final "unit_price" MUST reflect the true discounted unit price so that downstream quotation/PO calculations are 100% accurate!

3. ITEM REMARKS & SUB-TEXT:
   - If an item in the supplier quotation or RFQ has a sub-note or remark directly underneath it (e.g. "- INCLUDED IN ITEM NO.4", "INCLUDED IN SET", "LEAD TIME 2 WEEKS", "MADE IN KOREA"), ALWAYS extract this remark into the "remarks" field!

4. COLUMN HEADINGS:
   - "Index", "No.", or "S/NO" -> item_no
   - "Item" or "DESCRIPTION OF TRANSACTIONS" -> description, and embedded part code goes to item_code
   - "Quantity", "Qty", or "Q'ty" -> quantity
   - "Unit" or "UOM" -> unit
   - "Price", "Unit Price", "Rate", or "Cost" -> list_unit_price and unit_price
   - "Disc", "Disc." or "Discount" -> discount_percent
   - "Total", "Amount", "Extended" -> total_amount

5. NESTED ITEM DETAILS & OTHER DETAILS (PART NUMBERS, MAKER, MODEL, ESN):
   - Marine requisitions (e.g. Dinastia Jati, POSH, MISC) frequently feature an 'Item Code' column containing the client's internal inventory code (e.g. "11.02.01.26", "11.02.01.60") AND a nested sub-block titled "Other Details" with:
     Make: Cummins
     Model Number: CUMMINS BT 5.9 D(M)
     Part Number 3918508 (or "Part Number: 3918508" or "P/N: 3918508")
     ESN: 22069924
     Comments: #1 Cylinder
   - You MUST extract:
     * "item_code": The client's stock code from the Item Code column (e.g. "11.02.01.26").
     * "part_no": The manufacturer Part Number from Other Details (e.g. "3918508"). Do NOT leave "part_no" empty!
     * "maker_no": The Make and Model Number if present (e.g. "Cummins CUMMINS BT 5.9 D(M)").
     * "remarks": The remaining details like comments, cylinder, or ESN (e.g. "#1 Cylinder, ESN: 22069924").

6. SUPPLIER QUOTATION P/N HEADERS:
   - When a supplier quotation table has column header "P/N", "PART NO", "PART NUMBER", or "MAKER P/N", extract this value into BOTH "part_no" and "item_code".

Return strictly JSON array.
`;

  return prompt;
}

/**
 * Post-processes items to ensure 5-8 digit IMPA codes are extracted if still in description
 */
function postProcessItems(rawItems) {
  if (!Array.isArray(rawItems)) return [];

  return rawItems.map((item, idx) => {
    let code = (item.item_code || item.part_no || "").toString().trim();
    let partNo = (item.part_no || "").toString().trim();
    let makerNo = (item.maker_no || "").toString().trim();
    let impaCode = (item.impa_code || "").toString().trim();
    let refNo = (item.ref_no || "").toString().trim();
    let desc = (item.description || "").toString().trim();
    let remarks = (item.remarks || "").toString().trim();

    // Check if 5-8 digit IMPA / item code is at the end or embedded in description
    if (!code || /^(none|null|item-?\d+|\d+)$/i.test(code)) {
      const impaMatch = desc.match(/\b([1-8]\d{5,7})\b/);
      if (impaMatch) {
        code = impaMatch[1];
        impaCode = impaCode || code;
        desc = desc.replace(impaMatch[0], '').replace(/\s{2,}/g, ' ').trim();
      }
    }

    // Check if Part Number is embedded in description or remarks (e.g. "Part Number: 3918508" or "P/N: 3918508")
    const mPart = `${desc} ${remarks}`.match(/(?:Part\s*(?:Number|No|#)|P\/N)\s*[:=\s]*([A-Za-z0-9\-\./]+)/i);
    if (mPart && mPart[1]) {
      const pCand = mPart[1].trim();
      if (pCand.length >= 3 && !/^(none|null|parts?)$/i.test(pCand)) {
        if (!partNo || partNo === code) {
          partNo = pCand;
        }
      }
    }

    // Check for Model / Make in remarks if makerNo is empty
    if (!makerNo) {
      const mMaker = remarks.match(/(?:Make|Model(?:\s*Number)?)\s*[:=\s]*([^\n,;]+)/i);
      if (mMaker && mMaker[1]) {
        makerNo = mMaker[1].trim();
      }
    }

    // Clean description: remove leading index numbers like "1.", "2 - "
    desc = desc.replace(/^(\d{1,3}[\.\)\-]\s*)/, '').trim();

    // Extract included in item remarks if embedded in desc
    const inclMatch = desc.match(/(-\s*INCLUDED\s+IN\s+ITEM\s*(?:NO\.?)?\s*\d+|INCLUDED\s+IN\s+ITEM\s*(?:NO\.?)?\s*\d+|INCLUDED\s+IN\s+SET)/i);
    if (inclMatch && !remarks) {
      remarks = inclMatch[1].replace(/^-\s*/, '').trim();
    }

    let listPrice = parseFloat(item.list_unit_price) || 0.0;
    let discPercent = parseFloat(item.discount_percent) || 0.0;
    let unitPrice = parseFloat(item.unit_price) || 0.0;
    let totalAmount = parseFloat(item.total_amount) || 0.0;
    let qty = parseFloat(item.quantity) || 1;

    // If discount was present and listPrice is available but unitPrice wasn't discounted:
    if (discPercent > 0 && listPrice > 0) {
      const calculatedNet = listPrice * (1.0 - discPercent / 100.0);
      if (unitPrice === 0 || Math.abs(unitPrice - listPrice) < 0.001) {
        unitPrice = calculatedNet;
      }
    } else if (totalAmount > 0 && qty > 0 && (unitPrice === 0 || (discPercent > 0 && Math.abs(unitPrice * qty - totalAmount) > 0.05))) {
      unitPrice = totalAmount / qty;
    }

    if (listPrice === 0 && unitPrice > 0) {
      listPrice = (discPercent > 0) ? (unitPrice / (1.0 - discPercent / 100.0)) : unitPrice;
    }

    return {
      item_no: item.item_no || (idx + 1),
      item_code: code,
      part_no: partNo,
      maker_no: makerNo,
      impa_code: impaCode,
      ref_no: refNo,
      description: desc,
      remarks: remarks,
      quantity: qty,
      unit: (item.unit || "PCS").toString().trim().toUpperCase(),
      list_unit_price: listPrice,
      discount_percent: discPercent,
      unit_price: unitPrice,
      total_amount: totalAmount,
      currency: (item.currency || "MYR").toString().trim().toUpperCase(),
      is_offer: Boolean(item.is_offer),
      offer_text: (item.offer_text || "").toString().trim()
    };
  });
}

/**
 * Converts File or Blob to Base64 data URL
 */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = error => reject(error);
    reader.readAsDataURL(file);
  });
}

/**
 * Extracts items from any uploaded file (PDF, Excel, Word, Image) or pasted text
 */
async function parseDocumentWithGemini(fileOrBlob, filename, docType = "rfq") {
  const fn = (filename || "").toLowerCase();
  const promptText = ''; 

  // 1. PDF Documents
  if (fn.endsWith('.pdf') || (fileOrBlob.type === 'application/pdf')) {
    const base64DataUrl = await fileToBase64(fileOrBlob);
    const base64Content = base64DataUrl.split(',')[1];
    
    const parts = [
      {
        inlineData: {
          mimeType: "application/pdf",
          data: base64Content
        }
      },
      {
        text: promptText
      }
    ];

    const rawResult = await callGeminiApi(parts, '', docType);
    return postProcessItems(rawResult);
  }

  // 2. Images / Screenshots
  if (fileOrBlob.type && fileOrBlob.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif)$/i.test(fn)) {
    const base64DataUrl = await fileToBase64(fileOrBlob);
    const mime = fileOrBlob.type || (fn.endsWith('.png') ? 'image/png' : 'image/jpeg');
    const base64Content = base64DataUrl.split(',')[1];

    const parts = [
      {
        inlineData: {
          mimeType: mime,
          data: base64Content
        }
      },
      {
        text: promptText
      }
    ];

    const rawResult = await callGeminiApi(parts, '', docType);
    return postProcessItems(rawResult);
  }

  // 3. Excel Spreadsheets (.xlsx, .xls)
  if (fn.endsWith('.xlsx') || fn.endsWith('.xls')) {
    const arrayBuffer = await fileOrBlob.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    
    // Read all sheets into text/csv format
    let spreadsheetText = "";
    workbook.SheetNames.forEach(sheetName => {
      const sheet = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      if (csv && csv.trim()) {
        spreadsheetText += `\n--- SHEET: ${sheetName} ---\n${csv}\n`;
      }
    });

    const parts = [
      {
        text: `Here is the spreadsheet tabular data:\n${spreadsheetText}\n\n${promptText}`
      }
    ];

    const rawResult = await callGeminiApi(parts, '', docType);
    return postProcessItems(rawResult);
  }

  // 4. Word Documents (.docx)
  if (fn.endsWith('.docx')) {
    const arrayBuffer = await fileOrBlob.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer: arrayBuffer });
    const docText = result.value || "";

    const parts = [
      {
        text: `Here is the Word document content:\n${docText}\n\n${promptText}`
      }
    ];

    const rawResult = await callGeminiApi(parts, '', docType);
    return postProcessItems(rawResult);
  }

  // 5. Raw Text / Pasted Text / CSV
  let text = "";
  if (typeof fileOrBlob === 'string') {
    text = fileOrBlob;
  } else {
    text = await fileOrBlob.text();
  }

  const parts = [
    {
      text: `Here is the pasted text content:\n${text}\n\n${promptText}`
    }
  ];

  const rawResult = await callGeminiApi(parts, '', docType);
  return postProcessItems(rawResult);
}
