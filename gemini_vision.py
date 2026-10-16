import os
import io
import json
import time
import base64
import re
import pymupdf  # fitz
from PIL import Image

# Global Client Storage
_GENAI_CLIENT = None
_CURRENT_API_KEY = None

def get_api_key():
    global _CURRENT_API_KEY
    if _CURRENT_API_KEY is not None:
        return _CURRENT_API_KEY
    key = os.environ.get('GEMINI_API_KEY', '').strip()
    if not key:
        path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
        if os.path.exists(path):
            with open(path, encoding='utf-8') as source:
                for line in source:
                    if line.startswith('GEMINI_API_KEY='):
                        key = line.split('=', 1)[1].strip()
                        break
    return key


def set_api_key(new_key):
    global _CURRENT_API_KEY, _GENAI_CLIENT
    key = new_key.strip()
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    lines = []
    if os.path.exists(path):
        with open(path, encoding='utf-8') as source:
            lines = source.read().splitlines()
    lines = [line for line in lines if not line.startswith('GEMINI_API_KEY=')]
    lines.append('GEMINI_API_KEY=' + key)
    with open(path, 'w', encoding='utf-8') as target:
        target.write('\n'.join(lines) + '\n')
    _CURRENT_API_KEY = key
    _GENAI_CLIENT = None
    os.environ['GEMINI_API_KEY'] = key
    return True


def get_genai_client():
    global _GENAI_CLIENT
    if _GENAI_CLIENT is not None:
        return _GENAI_CLIENT
    
    api_key = get_api_key()
    if not api_key:
        return None
        
    try:
        from google import genai
        _GENAI_CLIENT = genai.Client(api_key=api_key)
        return _GENAI_CLIENT
    except Exception as e:
        print(f"Failed to initialize google.genai Client: {e}")
        return None

def extract_with_gemini(contents, doc_type="rfq"):
    """
    Calls Gemini Flash Vision with structured JSON output schema, embedded item code detection, and remarks capture.
    """
    client = get_genai_client()
    if not client:
        return None
        
    prompt = f"""
You are an expert marine procurement and quotation document parser.
Extract all {doc_type.upper()} table line items from this document into a structured JSON array.

OUTPUT SCHEMA:
Return a JSON array where each object has:
- item_no (integer: row index 1, 2, 3...)
- item_code (string: item identifier, stock code, or item code if present)
- part_no (string: part number, manufacturer P/N, or drawing number)
- maker_no (string: model number, maker's reference, or drawing/plan reference if present)
- impa_code (string: 6-digit marine IMPA / ISSA code if present, e.g. "7915453" or "IMPA-7915453")
- ref_no (string: position number or requisition reference, e.g. "Pos 1" or "26R-0113-1")
- description (string: product name / description without the trailing item code)
- remarks (string: any notes or sub-text underneath the item row, e.g. "- INCLUDED IN ITEM NO.4", "EX-STOCK", "LEAD TIME: 2 WEEKS", "MATERIAL: BRONZE")
- quantity (number: numeric quantity ONLY, e.g. 6.00 -> 6, 2.00 -> 2, 1.00 -> 1)
- unit (string: unit code, e.g. "PCS", "PCE", "SET", "EA", "BOX", "ROLL", "DOZ", "PRS", "MTR", "SHT")
"""
    if doc_type == "quote":
        prompt += """
- list_unit_price (number: gross list price per single unit BEFORE discount, e.g. 642.60, 227.35, 33.65)
- discount_percent (number: supplier discount percentage if stated in table/columns e.g. 5 for 5%, 10 for 10%, 0 if none)
- unit_price (number: NET supplier unit cost AFTER applying discount, e.g. if list price is 642.60 with 5% discount, net unit price is 610.47. If total amount for 4 items is 127.87, net unit price is 127.87 / 4 = 31.9675)
- total_amount (number: line total amount after discount, e.g. 610.47, 215.98, 127.87)
- currency (string: 3-letter currency code, e.g. USD, EUR, MYR, SGD)
- is_offer (boolean: true ONLY if supplier explicitly offers an alternative/substitute part)
- offer_text (string: alternative part description if offered)
"""
    prompt += """
CRITICAL TABLE COLUMN MAPPING & EMBEDDED ITEM CODE RULES:
1. **EMBEDDED ITEM CODES / IMPA CODES (VERY IMPORTANT)**:
   - Many supplier quotations (such as marine store quotes from Singapore/Malaysia/Europe) list 5 to 8 digit IMPA codes or item numbers directly alongside or at the end of the description (e.g. `SPRING CLAMP MOP COMPLETE 174275`, `AIR DUSTER LONG NOSE 270613`, `DUST MASK DISPOSABLE 50'S/BOX 331130`, `HOIST CHAIN SPUR-GEAR 615038`, `WATERTIGHT 3 PIN PLUG 792888`, `GLOVES PLASTIC 190132`).
   - Even if there is NO explicit column header titled "Item Code", you MUST extract these numeric part/IMPA codes (e.g. "174275", "270613", "331130", "510491", "614010", "615038", "794395", "650602", "650502", "650126") into the `item_code` field!
   - Remove the item code from `description` so `description` contains only the clean product title (e.g. `item_code: "174275"`, `description: "SPRING CLAMP MOP COMPLETE"`).

2. **SUPPLIER DISCOUNTS & NET UNIT PRICES (CRITICAL)**:
   - If the supplier quotation has a "Disc." or "Discount" column (e.g. 5%, 10%) or mentions a trade discount:
     a) Extract `discount_percent` (e.g. 5.0).
     b) Extract `list_unit_price` (the list price before discount, e.g. 642.60).
     c) Calculate NET `unit_price`: `list_unit_price * (1 - discount_percent/100)` OR divide total line amount by quantity (e.g. for item 4: 127.87 / 4 = 31.9675).
     d) The final `unit_price` MUST reflect the true discounted unit price so that downstream quotation/PO calculations are 100% accurate!

3. **ITEM REMARKS & SUB-TEXT**:
   - If an item in the supplier quotation or RFQ has a sub-note or remark directly underneath it (e.g. "- INCLUDED IN ITEM NO.4", "INCLUDED IN SET", "LEAD TIME 2 WEEKS", "MADE IN KOREA"), ALWAYS extract this remark into the "remarks" field!

4. **COLUMN HEADINGS**:
   - If a column is titled "Index", "No.", or "S/NO", it is the ROW INDEX (`item_no`).
   - If a column is titled "Item" or "DESCRIPTION OF TRANSACTIONS", it is the PRODUCT DESCRIPTION (`description`), and any embedded part code should go to `item_code`.
   - If a column is titled "Quantity" or "QTY/PACK", extract the numeric amount into `quantity` and the unit (e.g. PCS, BOX, DOZ, PRS, MTR, SHT) into `unit`.
   - If a column is titled "U/PRICE", "Unit Price", or "Price", it is `list_unit_price` and `unit_price`.
   - If a column is titled "Disc", "Disc." or "Discount", it is `discount_percent`.
   - If a column is titled "Total", "Amount", or "Extended", it is `total_amount`.

5. **NESTED ITEM DETAILS & OTHER DETAILS (PART NUMBERS, MAKER, MODEL, ESN)**:
   - Marine requisitions (e.g. Dinastia Jati, POSH, MISC) frequently feature an 'Item Code' column containing the client's internal inventory code (e.g. `11.02.01.26`, `11.02.01.60`) AND a nested sub-block titled "Other Details" with:
     Make: Cummins
     Model Number: CUMMINS BT 5.9 D(M)
     Part Number 3918508 (or "Part Number: 3918508" or "P/N: 3918508")
     ESN: 22069924
     Comments: #1 Cylinder
   - You MUST extract:
     * `item_code`: The client's stock code from the Item Code column (e.g. `11.02.01.26`).
     * `part_no`: The manufacturer Part Number from Other Details (e.g. `3918508`). Do NOT leave `part_no` empty!
     * `maker_no`: The Make and Model Number if present (e.g. `Cummins CUMMINS BT 5.9 D(M)`).
     * `remarks`: The remaining details like comments, cylinder, or ESN (e.g. `#1 Cylinder, ESN: 22069924`).

6. **SUPPLIER QUOTATION P/N HEADERS**:
   - When a supplier quotation table has column header `P/N`, `PART NO`, `PART NUMBER`, or `MAKER P/N`, extract this value into BOTH `part_no` and `item_code`.

7. **WHAT NEVER TO DO**:
   - NEVER put quantity or unit values (e.g. "6.00 PCE", "2.00 PCE", "1.00 PCE") into `item_code`.
   - Keep `item_code`, `description`, `remarks`, `quantity`, and `unit` strictly separated.

8. Output MUST be ONLY valid JSON array.
"""
    
    models = ['gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.7-flash', 'gemini-2.5-flash', 'gemini-flash-latest']
    from google.genai import types
    
    for model_name in models:
        for attempt in range(2):
            try:
                full_contents = list(contents) + [prompt]
                res = client.models.generate_content(
                    model=model_name,
                    contents=full_contents,
                    config=types.GenerateContentConfig(response_mime_type="application/json")
                )
                if res and res.text:
                    data = json.loads(res.text)
                    if isinstance(data, dict) and 'items' in data:
                        data = data['items']
                    if isinstance(data, list):
                        cleaned_items = []
                        for idx, raw_it in enumerate(data, 1):
                            it = dict(raw_it)
                            it_code = str(it.get('item_code') or '').strip()
                            it_part = str(it.get('part_no') or '').strip()
                            it_maker = str(it.get('maker_no') or '').strip()
                            it_impa = str(it.get('impa_code') or '').strip()
                            it_desc = str(it.get('description') or '').strip()
                            it_remarks = str(it.get('remarks') or '').strip()
                            it_unit = str(it.get('unit') or 'PCS').strip()
                            
                            # Clean erroneous quantity/unit strings from item_code if any
                            if re.match(r'^\d+(\.\d+)?\s*(PCE|PCS|SET|EA|PC|UNITS?)$', it_code, re.IGNORECASE):
                                match = re.match(r'^(\d+(?:\.\d+)?)\s*(PCE|PCS|SET|EA|PC|UNITS?)$', it_code, re.IGNORECASE)
                                if 'quantity' not in it or it.get('quantity') is None:
                                    it['quantity'] = float(match.group(1))
                                if not it_unit or it_unit == 'PCS':
                                    it['unit'] = match.group(2).upper()
                                it_code = ''
                                
                            # If item_code is empty, check if part_no has it
                            if not it_code and it_part:
                                it_code = it_part
                                
                            # If item_code is still empty, check if description ends with a 5-8 digit IMPA/Item code
                            if not it_code and re.search(r'\b(\d{5,8})\b', it_desc):
                                code_match = re.search(r'\b(\d{5,8})\b', it_desc)
                                it_code = code_match.group(1)
                                it_impa = it_impa or it_code
                                it_desc = re.sub(r'\s*\b' + it_code + r'\b\s*', ' ', it_desc).strip()

                            # If part_no not extracted or identical to item_code, check description & remarks
                            if not it_part or it_part == it_code:
                                m_part = re.search(r'(?:Part\s*(?:Number|No|#)|P/N)\s*[:=\s]*([A-Za-z0-9\-\./]+)', f"{it_desc} {it_remarks}", re.IGNORECASE)
                                if m_part:
                                    cand = m_part.group(1).strip()
                                    if len(cand) >= 3 and cand.lower() not in ['none', 'null', 'part', 'parts']:
                                        it_part = cand

                            # If maker_no empty, check remarks for Make / Model
                            if not it_maker:
                                m_maker = re.search(r'(?:Make|Model(?:\s*Number)?)\s*[:=\s]*([^\n,;]+)', it_remarks, re.IGNORECASE)
                                if m_maker:
                                    it_maker = m_maker.group(1).strip()

                            # Discount calculations
                            list_price = float(it.get('list_unit_price') or 0.0)
                            disc_percent = float(it.get('discount_percent') or 0.0)
                            unit_price = float(it.get('unit_price') or 0.0)
                            total_amount = float(it.get('total_amount') or 0.0)
                            qty = float(it.get('quantity') or 1.0)

                            if disc_percent > 0 and list_price > 0:
                                calculated_net = list_price * (1.0 - disc_percent / 100.0)
                                if unit_price == 0.0 or abs(unit_price - list_price) < 0.001:
                                    unit_price = calculated_net
                            elif total_amount > 0 and qty > 0 and (unit_price == 0.0 or (disc_percent > 0 and abs(unit_price * qty - total_amount) > 0.05)):
                                unit_price = total_amount / qty

                            if list_price == 0.0 and unit_price > 0:
                                list_price = (unit_price / (1.0 - disc_percent / 100.0)) if disc_percent > 0 else unit_price
                                
                            it['item_code'] = it_code
                            it['part_no'] = it_part
                            it['maker_no'] = it_maker
                            it['impa_code'] = it_impa
                            it['item_no'] = it.get('item_no') or idx
                            it['description'] = it_desc
                            it['remarks'] = it_remarks
                            
                            # Safe quantity conversion
                            raw_qty = it.get('quantity')
                            if raw_qty is None or raw_qty == '':
                                it['quantity'] = 1.0
                            else:
                                try:
                                    it['quantity'] = float(str(raw_qty).replace(',', ''))
                                except Exception:
                                    it['quantity'] = 1.0
                                    
                            it['unit'] = it.get('unit') or 'PCS'
                            
                            if doc_type == 'quote':
                                raw_price = it.get('unit_price')
                                if raw_price is None or raw_price == '':
                                    it['unit_price'] = 0.0
                                else:
                                    try:
                                        it['unit_price'] = float(str(raw_price).replace(',', ''))
                                    except Exception:
                                        it['unit_price'] = 0.0
                                        
                                it['currency'] = str(it.get('currency') or 'MYR').upper()
                                it['is_offer'] = bool(it.get('is_offer', False))
                                it['offer_text'] = str(it.get('offer_text') or '').strip()
                                
                            cleaned_items.append(it)
                        return cleaned_items
            except Exception as e:
                print(f"Gemini error on {model_name} (attempt {attempt+1}): {e}")
                time.sleep(1)
                
    return None

def parse_rfq_gemini(file_bytes, filename=""):
    """
    Parses RFQ file using Gemini Flash Vision AI.
    """
    images = []
    filename_lower = filename.lower()
    
    if filename_lower.endswith('.pdf'):
        doc = pymupdf.open(stream=file_bytes, filetype="pdf")
        for page in doc:
            pix = page.get_pixmap(dpi=150)
            images.append(Image.open(io.BytesIO(pix.tobytes("png"))))
    elif any(filename_lower.endswith(ext) for ext in ['.png', '.jpg', '.jpeg', '.webp', '.bmp']):
        images.append(Image.open(io.BytesIO(file_bytes)))
    elif filename_lower.endswith('.xlsx') or filename_lower.endswith('.xls'):
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
        sheet = wb.active
        rows_text = []
        for r in sheet.iter_rows(values_only=True):
            if any(r):
                rows_text.append("\t".join([str(c) if c is not None else "" for c in r]))
        text_content = "\n".join(rows_text)
        return extract_with_gemini([text_content], doc_type="rfq")
    elif filename_lower.endswith('.docx') or filename_lower.endswith('.doc'):
        import docx
        doc = docx.Document(io.BytesIO(file_bytes))
        full_text = []
        for p in doc.paragraphs:
            if p.text.strip():
                full_text.append(p.text)
        for table in doc.tables:
            for row in table.rows:
                row_data = [cell.text.strip() for cell in row.cells]
                if any(row_data):
                    full_text.append("\t".join(row_data))
        text_content = "\n".join(full_text)
        return extract_with_gemini([text_content], doc_type="rfq")
    else:
        try:
            images.append(Image.open(io.BytesIO(file_bytes)))
        except Exception:
            return None
            
    if images:
        return extract_with_gemini(images, doc_type="rfq")
    return None

def parse_quote_gemini(file_bytes, filename=""):
    """
    Parses Supplier Quotation file using Gemini Flash Vision AI.
    """
    images = []
    filename_lower = filename.lower()
    
    if filename_lower.endswith('.pdf'):
        doc = pymupdf.open(stream=file_bytes, filetype="pdf")
        for page in doc:
            pix = page.get_pixmap(dpi=150)
            images.append(Image.open(io.BytesIO(pix.tobytes("png"))))
    elif any(filename_lower.endswith(ext) for ext in ['.png', '.jpg', '.jpeg', '.webp', '.bmp']):
        images.append(Image.open(io.BytesIO(file_bytes)))
    elif filename_lower.endswith('.xlsx') or filename_lower.endswith('.xls'):
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), data_only=True)
        sheet = wb.active
        rows_text = []
        for r in sheet.iter_rows(values_only=True):
            if any(r):
                rows_text.append("\t".join([str(c) if c is not None else "" for c in r]))
        text_content = "\n".join(rows_text)
        return extract_with_gemini([text_content], doc_type="quote")
    elif filename_lower.endswith('.docx') or filename_lower.endswith('.doc'):
        import docx
        doc = docx.Document(io.BytesIO(file_bytes))
        full_text = []
        for p in doc.paragraphs:
            if p.text.strip():
                full_text.append(p.text)
        for table in doc.tables:
            for row in table.rows:
                row_data = [cell.text.strip() for cell in row.cells]
                if any(row_data):
                    full_text.append("\t".join(row_data))
        text_content = "\n".join(full_text)
        return extract_with_gemini([text_content], doc_type="quote")
    else:
        try:
            images.append(Image.open(io.BytesIO(file_bytes)))
        except Exception:
            return None
            
    if images:
        return extract_with_gemini(images, doc_type="quote")
    return None

def parse_image_base64_gemini(base64_str, doc_type="rfq"):
    """
    Parses a base64 screenshot from clipboard.
    """
    if ',' in base64_str:
        base64_str = base64_str.split(',', 1)[1]
    raw_bytes = base64.b64decode(base64_str)
    img = Image.open(io.BytesIO(raw_bytes))
    return extract_with_gemini([img], doc_type=doc_type)

def parse_text_gemini(text_content, doc_type="rfq"):
    """
    Parses pasted raw text or email body using Gemini AI.
    """
    return extract_with_gemini([text_content], doc_type=doc_type)
