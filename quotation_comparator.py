import os
import sys
import io
import re
import ssl
import json
import time
import base64
import email
import hashlib
import imaplib
from email.header import decode_header
from datetime import datetime
from bs4 import BeautifulSoup
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
import pymupdf

from gemini_vision import get_api_key, get_genai_client
from extractor import parse_pdf, parse_excel, parse_raw_text, detect_currency

# Supported image types for manual quotes (scans), but we ignore icons/signatures
VALID_IMAGE_EXTS = {'.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tiff'}
SIGNATURE_IGNORE_PATTERNS = [
    r'attachedfile\d*\.(png|jpe?g|gif)',
    r'image\d{3}\.(png|jpe?g|gif)',
    r'outlook-[a-z0-9\-_]+\.(png|jpe?g|gif)',
    r'logo\w*\.(png|jpe?g|gif)',
    r'signature\w*\.(png|jpe?g|gif)',
    r'icon\w*\.(png|jpe?g|gif)',
    r'badge\w*\.(png|jpe?g|gif)',
    r'facebook|twitter|linkedin|instagram|wechat|whatsapp|youtube'
]

# AI Models priority order (fast active endpoints)
GEMINI_MODELS = ['gemini-3.5-flash-lite', 'gemini-2.5-flash']

USD_BASE_RATES = {
    'USD': 1.0000,
    'MYR': 4.4500,
    'EUR': 0.9200,
    'SGD': 1.3400,
    'GBP': 0.7850,
    'AUD': 1.5200,
    'JPY': 154.5000,
    'CNY': 7.2300,
    'AED': 3.6725
}


def decode_mime_words(s):
    """Safely decodes RFC 2047 encoded MIME header strings."""
    if not s:
        return ""
    try:
        decoded_fragments = decode_header(s)
        pieces = []
        for text, charset in decoded_fragments:
            if isinstance(text, bytes):
                enc = charset or 'utf-8'
                try:
                    pieces.append(text.decode(enc, errors='ignore'))
                except Exception:
                    pieces.append(text.decode('latin-1', errors='ignore'))
            else:
                pieces.append(str(text))
        return " ".join(pieces).strip()
    except Exception:
        return str(s)


def clean_email_body(raw_text_or_html, is_html=False):
    """
    Strips quoted message chains (Reply history) and standard email disclaimer footers.
    Isolates only the fresh reply text from the supplier.
    """
    if not raw_text_or_html:
        return ""

    text = raw_text_or_html
    if is_html:
        try:
            soup = BeautifulSoup(raw_text_or_html, "html.parser")
            for s in soup(["script", "style", "blockquote"]):
                s.decompose()
            text = soup.get_text(separator="\n")
        except Exception:
            text = str(raw_text_or_html)

    lines = text.splitlines()
    clean_lines = []
    
    reply_break_regex = re.compile(
        r'^(-{3,}\s*Original Message\s*-{3,}|'
        r'From:\s*.+Sent:\s*.+|'
        r'On\s+.+wrote:\s*$|'
        r'________________________________|'
        r'--\s*$)',
        re.IGNORECASE
    )

    for line in lines:
        stripped = line.strip()
        if reply_break_regex.search(stripped):
            break
        if stripped:
            clean_lines.append(stripped)
        elif clean_lines and clean_lines[-1] != "":
            clean_lines.append("")

    return "\n".join(clean_lines).strip()


def is_signature_or_noise(filename, file_bytes):
    """
    Detects if an attachment is an inline signature graphic, logo, or social icon.
    """
    fn = filename.lower()
    size = len(file_bytes)

    ext = os.path.splitext(fn)[1]
    if ext in ['.pdf', '.xlsx', '.xls', '.docx', '.doc', '.csv', '.txt']:
        return False

    if size < 25000:
        return True

    for pat in SIGNATURE_IGNORE_PATTERNS:
        if re.search(pat, fn, re.IGNORECASE):
            if size < 150000:
                return True

    return False


def get_default_email_config():
    """Loads email settings from email_automation/config.json."""
    config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "email_automation", "config.json")
    if os.path.exists(config_path):
        try:
            with open(config_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[Warning] Failed to read email config.json: {e}")
    return {}


def detect_regret_or_pending(text):
    """
    Detects whether an email body represents a supplier regret/decline or pending acknowledgment.
    """
    if not text:
        return None, ""
    t_lower = text.lower()
    
    regret_patterns = [
        r'\bout\s*of\s*(?:our\s*)?product\s*range\b',
        r'\bunable\s*to\s*quote\b',
        r'\bcannot\s*quote\b',
        r'\bnot\s*(?:able|in\s*a\s*position)\s*to\s*quote\b',
        r'\bregret\s*to\s*inform\b',
        r'\bdecline\s*to\s*quote\b',
        r'\bno\s*offer\b',
        r'\bdo\s*not\s*supply\b',
        r'\bnot\s*within\s*(?:our\s*)?scope\b'
    ]
    for pat in regret_patterns:
        if re.search(pat, t_lower):
            return "REGRET", "Supplier declined to quote (Product out of range / Unable to quote)"

    pending_patterns = [
        r'\breceipt\s*confirmation\b',
        r'\bon\s*check\b',
        r'\bunder\s*check\b',
        r'\bwill\s*reply\s*with\s*(?:the\s*)?quotation\b',
        r'\bwill\s*send\s*(?:our\s*)?(?:quotation|quote|offer)\b',
        r'\bworking\s*on\s*your\s*inquiry\b'
    ]
    for pat in pending_patterns:
        if re.search(pat, t_lower):
            return "PENDING", "Receipt acknowledged (Quotation pending from supplier)"

    return None, ""


def generate_source_preview_data(doc_bytes=None, filename="", email_info=None):
    """
    Generates rich visual preview data for a quote source:
    - PDF / Image: converts pages to base64 images for interactive inspection.
    - Excel: returns sheet table data.
    - Email: returns clean formatted email fields and message body.
    """
    if doc_bytes and filename:
        fn_lower = filename.lower()
        if fn_lower.endswith('.pdf'):
            pages = []
            try:
                doc = pymupdf.open(stream=doc_bytes, filetype="pdf")
                for i in range(min(len(doc), 6)):
                    pix = doc[i].get_pixmap(dpi=150)
                    b64 = base64.b64encode(pix.tobytes("png")).decode('ascii')
                    pages.append(f"data:image/png;base64,{b64}")
            except Exception as e:
                print(f"[Warning] PDF preview generation error: {e}")
            b64_raw = base64.b64encode(doc_bytes).decode('ascii')
            res_dict = {
                "preview_type": "document",
                "preview_format": "pdf",
                "preview_filename": filename,
                "preview_pages": pages,
                "base64": b64_raw,
                "mime_type": "application/pdf",
                "data_url": f"data:application/pdf;base64,{b64_raw}",
                "size": len(doc_bytes),
                "size_kb": round(len(doc_bytes) / 1024, 1)
            }
            if email_info:
                res_dict["email_data"] = {
                    "from": email_info.get("from", ""),
                    "sender_name": email_info.get("sender_name", ""),
                    "sender_email": email_info.get("sender_email", ""),
                    "to": email_info.get("to", ""),
                    "cc": email_info.get("cc", ""),
                    "date": email_info.get("date", ""),
                    "subject": email_info.get("subject", ""),
                    "body": email_info.get("body_text", "") or email_info.get("body", ""),
                    "body_text": email_info.get("body_text", "") or email_info.get("body", ""),
                    "html_body": email_info.get("html_body", ""),
                    "html_body_resolved": email_info.get("html_body_resolved", ""),
                    "images": email_info.get("images", []),
                    "documents": email_info.get("documents", [])
                }
            return res_dict
        elif any(fn_lower.endswith(ext) for ext in ['.png', '.jpg', '.jpeg', '.webp']):
            mime = "image/png" if fn_lower.endswith('.png') else "image/jpeg"
            b64 = base64.b64encode(doc_bytes).decode('ascii')
            res_dict = {
                "preview_type": "document",
                "preview_format": "image",
                "preview_filename": filename,
                "preview_pages": [f"data:{mime};base64,{b64}"],
                "base64": b64,
                "mime_type": mime,
                "data_url": f"data:{mime};base64,{b64}",
                "size": len(doc_bytes),
                "size_kb": round(len(doc_bytes) / 1024, 1)
            }
            if email_info:
                res_dict["email_data"] = {
                    "from": email_info.get("from", ""),
                    "sender_name": email_info.get("sender_name", ""),
                    "sender_email": email_info.get("sender_email", ""),
                    "to": email_info.get("to", ""),
                    "cc": email_info.get("cc", ""),
                    "date": email_info.get("date", ""),
                    "subject": email_info.get("subject", ""),
                    "body": email_info.get("body_text", "") or email_info.get("body", ""),
                    "body_text": email_info.get("body_text", "") or email_info.get("body", ""),
                    "html_body": email_info.get("html_body", ""),
                    "html_body_resolved": email_info.get("html_body_resolved", ""),
                    "images": email_info.get("images", []),
                    "documents": email_info.get("documents", [])
                }
            return res_dict
        elif fn_lower.endswith(('.xlsx', '.xls', '.csv')):
            b64_raw = base64.b64encode(doc_bytes).decode('ascii')
            mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" if fn_lower.endswith('.xlsx') else ("application/vnd.ms-excel" if fn_lower.endswith('.xls') else "text/csv")
            preview_tables = []
            try:
                from app import generate_doc_previews
                p_data = generate_doc_previews(doc_bytes, filename)
                preview_tables = p_data.get("tables", [])
            except Exception:
                pass
            res_dict = {
                "preview_type": "document",
                "preview_format": "excel",
                "preview_filename": filename,
                "base64": b64_raw,
                "mime_type": mime,
                "data_url": f"data:{mime};base64,{b64_raw}",
                "size": len(doc_bytes),
                "size_kb": round(len(doc_bytes) / 1024, 1),
                "preview_tables": preview_tables
            }
            if email_info:
                res_dict["email_data"] = {
                    "from": email_info.get("from", ""),
                    "sender_name": email_info.get("sender_name", ""),
                    "sender_email": email_info.get("sender_email", ""),
                    "to": email_info.get("to", ""),
                    "cc": email_info.get("cc", ""),
                    "date": email_info.get("date", ""),
                    "subject": email_info.get("subject", ""),
                    "body": email_info.get("body_text", "") or email_info.get("body", ""),
                    "body_text": email_info.get("body_text", "") or email_info.get("body", ""),
                    "html_body": email_info.get("html_body", ""),
                    "html_body_resolved": email_info.get("html_body_resolved", ""),
                    "images": email_info.get("images", []),
                    "documents": email_info.get("documents", [])
                }
            return res_dict

    if email_info:
        return {
            "preview_type": "email",
            "preview_format": "email",
            "preview_filename": "Email Message",
            "email_data": {
                "from": email_info.get("from", ""),
                "sender_name": email_info.get("sender_name", ""),
                "sender_email": email_info.get("sender_email", ""),
                "to": email_info.get("to", ""),
                "cc": email_info.get("cc", ""),
                "date": email_info.get("date", ""),
                "subject": email_info.get("subject", ""),
                "body": email_info.get("body_text", "") or email_info.get("body", ""),
                "body_text": email_info.get("body_text", "") or email_info.get("body", ""),
                "html_body": email_info.get("html_body", ""),
                "html_body_resolved": email_info.get("html_body_resolved", ""),
                "images": email_info.get("images", []),
                "documents": email_info.get("documents", []),
                "rich_attachments": email_info.get("rich_attachments", [])
            }
        }

    return {"preview_type": "none"}


def extract_rfq_fingerprint(query_str):
    """
    Extracts high-entropy distinctive RFQ tokens (requisition numbers, reference codes,
    vessel identifiers, and composite equipment phrases) while strictly excluding generic
    engine makers and procurement words.
    """
    if not query_str:
        return {
            "ref_raw": "", "ref_norm": "", "ref_num": "", "req_codes": [],
            "vessel_tokens": [], "vessel_prefix": "", "slash_norm": "",
            "equip_words": [], "composite_phrases": [], "raw_query": "",
            "has_specific_id": False
        }
    
    clean = re.sub(r'[\r\n\t"]', '', str(query_str)).strip()
    
    # 1. Reference in brackets or parentheses e.g. (Jt6/Req/Sp/E/Shp/26/0 048) or (JM TBH / RN 26R-0113)
    ref_match = re.search(r'[\(\[]\s*([^()\[\]\n\r]+?)\s*[\)\]]', clean)
    ref_raw = ref_match.group(1).strip() if ref_match else ""
    ref_norm = re.sub(r'[^a-zA-Z0-9]', '', ref_raw).lower() if ref_raw else ""
    
    # 2. Extract Requisition Codes (e.g. 26R-0113, 26-0048, 2026-I004, RN 26R-0113)
    req_codes = []
    for m in re.finditer(r'\b(?:RN\s*[-/:]?\s*)?([0-9]{2,4}[A-Za-z]?\s*[-/]\s*[0-9]{3,6}(?:\s*[-/]\s*[0-9]+)?)\b', clean, re.IGNORECASE):
        norm_code = re.sub(r'[^a-zA-Z0-9]', '', m.group(1)).lower()
        if norm_code and norm_code not in req_codes:
            req_codes.append(norm_code)

    # 3. Specific numeric requisition or reference numbers e.g. 0048, 0113, 120355, 267272
    ref_nums = []
    for m in re.finditer(r'\b0*(\d{3,7})\b', clean):
        n = m.group(1)
        if n and n not in ref_nums:
            ref_nums.append(n)
    
    # Main ref num (prefer number from inside reference brackets if present)
    num_match = re.search(r'\b0*(\d{3,6})\b', ref_raw) if ref_raw else None
    if not num_match and ref_raw:
        # Check if ref_raw has a code like 26R-0113
        sub_num = re.search(r'[-/]\s*0*(\d{3,6})\b', ref_raw)
        ref_num = sub_num.group(1) if sub_num else ""
    else:
        ref_num = num_match.group(1) if num_match else (ref_nums[0] if ref_nums else "")
    if ref_num and ref_num not in ref_nums:
        ref_nums.append(ref_num)

    # 4. External reference numbers (e.g. BST-120355, ARM-107)
    ext_refs = re.findall(r'\b([A-Za-z]{2,5}\s*[-/]\s*\d{4,8})\b', clean)
    for er in ext_refs:
        norm_er = re.sub(r'[^a-zA-Z0-9]', '', er).lower()
        if norm_er and norm_er not in req_codes:
            req_codes.append(norm_er)

    # 5. Vessel / Requisition Name Tokens (e.g. JM TBH, MV JM Tabah, JT6, JT8, JT9, DNST JT)
    vessel_tokens = []
    v_matches = re.findall(r'\b(JM\s+[A-Za-z0-9]+|MV\s+[A-Za-z0-9\s]+|JT\d+|DNST\s+JT|ARM-?[eE]?-?\d+)\b', clean, re.IGNORECASE)
    for vm in v_matches:
        v_norm = re.sub(r'[^a-zA-Z0-9]', '', vm).lower()
        if v_norm and v_norm not in vessel_tokens:
            vessel_tokens.append(v_norm)

    vessel_prefix = vessel_tokens[0] if vessel_tokens else ""
    if not vessel_prefix and ref_raw:
        vp_match = re.match(r'^([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)', ref_raw)
        if vp_match and len(vp_match.group(1)) >= 2:
            vessel_prefix = vp_match.group(1).lower()
            if vessel_prefix not in vessel_tokens:
                vessel_tokens.append(vessel_prefix)

    # Slashed reference pattern e.g. Jt6/Req/Sp/E/Shp/26/0 or ARM-e-107/2026-I004
    slash_match = re.search(r'\b([A-Za-z0-9\-]{3,}(?:/[A-Za-z0-9\-]+)+)\b', clean)
    slash_ref = slash_match.group(1).strip() if slash_match else ""
    slash_norm = re.sub(r'[^a-zA-Z0-9]', '', slash_ref).lower() if slash_ref else ""

    STOP_WORDS = {
        'RFQ', 'FOR', 'AND', 'THE', 'COOL', 'PUMP', 'SHIP', 'VESSEL', 'ENGINE',
        'CUMMINS', 'YANMAR', 'CATERPILLAR', 'WARTSILA', 'MAN', 'MITSUBISHI', 'VOLVO',
        'DAIHATSU', 'PERKINS', 'DETROIT', 'MAK', 'BERGEN', 'HYUNDAI', 'SULZER',
        'DEUTZ', 'SCANIA', 'MTU', 'ABC', 'WEICHAI', 'KOHLER', 'DOOSAN', 'ISUZU',
        'GENSET', 'PARTS', 'SPARE', 'SPARES', 'SUPPLY', 'REQ', 'INQUIRY', 'ENQUIRY',
        'QUOTATION', 'TENDER', 'OFFER', 'COMPLETE', 'ORDER', 'MAIL', 'EMAIL', 'RE', 'FWD'
    }
    
    words = [w for w in re.sub(r'[\(\)\[\]"\'\:\,\;\-\/]', ' ', clean).split() if len(w) >= 3 and w.upper() not in STOP_WORDS]
    
    composite_phrases = []
    if len(words) >= 2:
        for i in range(len(words) - 1):
            composite_phrases.append(f"{words[i]} {words[i+1]}".lower())

    has_specific_id = bool(ref_norm or req_codes or ref_nums or slash_norm)

    return {
        "ref_raw": ref_raw,
        "ref_norm": ref_norm,
        "ref_num": ref_num,
        "ref_nums": ref_nums,
        "req_codes": req_codes,
        "vessel_tokens": vessel_tokens,
        "vessel_prefix": vessel_prefix,
        "slash_norm": slash_norm,
        "equip_words": [w.lower() for w in words],
        "composite_phrases": composite_phrases,
        "raw_query": clean,
        "has_specific_id": has_specific_id
    }


def is_email_relevant_to_rfq(email_obj, fp):
    """
    Validates whether an email belongs to the specific RFQ inquiry being analyzed.
    Guarantees zero false positives across mailboxes with identical equipment inquiries.
    """
    if not fp or not fp.get("has_specific_id") and not fp.get("equip_words"):
        return True, "No fingerprint filters active"
        
    subj = email_obj.get("subject", "") or ""
    norm_subj = re.sub(r'[^a-zA-Z0-9]', '', subj).lower()
    body = email_obj.get("body", "") or ""
    norm_body = re.sub(r'[^a-zA-Z0-9]', '', body[:3000]).lower()

    # 1. Vessel conflict check (e.g. inquiry is for JT6, email mentions JT9 or JT8; or inquiry is for JM TBH and email mentions JM AMAN)
    if fp.get("vessel_tokens"):
        target_vessels = fp["vessel_tokens"]
        # Find vessel patterns in email subject
        email_vessels = re.findall(r'\b(jm\s+[a-z0-9]+|mv\s+[a-z0-9\s]+|jt\d+|dnst\s+jt|arm-?[a-z0-9\-]+)\b', subj, re.IGNORECASE)
        for ev in email_vessels:
            norm_ev = re.sub(r'[^a-zA-Z0-9]', '', ev).lower()
            if norm_ev and not any(tv in norm_ev or norm_ev in tv for tv in target_vessels):
                return False, f"Conflicting vessel identifier in subject: {ev}"

    # 2. Match on Requisition Code (e.g. 26R-0113 or RN 26R-0113 or 26-0048)
    for rc in fp.get("req_codes", []):
        if len(rc) >= 5:
            if rc in norm_subj or rc in norm_body:
                return True, f"Matched requisition code {rc}"

    # 3. Match on Full Reference String (e.g. Jt6/Req/Sp/E/Shp/26/0 048)
    if fp.get("ref_norm") and len(fp["ref_norm"]) >= 6:
        if fp["ref_norm"] in norm_subj or fp["ref_norm"] in norm_body:
            return True, "Matched ref_norm in subject/body"

    # 4. Match on Slashed Reference Code (e.g. ARM-e-107)
    if fp.get("slash_norm") and len(fp["slash_norm"]) >= 6:
        if fp["slash_norm"] in norm_subj or fp["slash_norm"] in norm_body:
            return True, "Matched slash_norm in subject/body"

    # 5. Match on Numeric Requisition / Reference Number (e.g. 0048, 0113, 120355)
    # When accompanied by vessel token or matching subject context
    for num in fp.get("ref_nums", []):
        if len(num) >= 4 and num in norm_subj:
            # Check for conflict with another requisition number
            other_reqs = re.findall(r'\b(?:RN\s*[-/:]?\s*)?([0-9]{2,4}[A-Za-z]?\s*[-/]\s*[0-9]{3,6})\b', subj, re.IGNORECASE)
            if other_reqs:
                other_norms = [re.sub(r'[^a-zA-Z0-9]', '', o).lower() for o in other_reqs]
                has_own_req = any(rc in o or o in rc for rc in fp.get("req_codes", []) for o in other_norms)
                if not has_own_req:
                    return False, f"Subject contains different requisition: {other_reqs}"
            return True, f"Matched distinctive number {num} in subject"

    # 6. Strict Gate: If inquiry specifies a requisition/reference number or code,
    # generic equipment words ALONE must NOT match without the requisition number!
    if fp.get("has_specific_id"):
        return False, "Email did not match specific requisition or reference code"

    # 7. Fallback for pure keyword queries (when no requisition number exists in query)
    equip_words = fp.get("equip_words", [])
    if equip_words:
        matched_equip = [w for w in equip_words if w in norm_subj]
        if len(equip_words) >= 2 and len(matched_equip) >= 2:
            return True, f"Matched equipment words {matched_equip}"

    return False, "Subject and body did not match RFQ reference or equipment"


def search_imap_emails(subject_query, config=None, max_results=20):
    """
    Searches mailbox via IMAP for emails matching the RFQ subject query.
    Scans INBOX as well as sent folders ('From AP Merin', 'Sent Items') to capture
    both supplier responses and AP Merin's original baseline RFQ inquiry.
    Uses high-precision query fingerprinting to prevent cross-contamination across different RFQs.
    """
    cfg = config or get_default_email_config()
    host = cfg.get("imap_host") or cfg.get("smtp_host", "smtppro47.mschosting.network")
    username = cfg.get("username", "")
    password = cfg.get("password", "")

    if not username or not password:
        raise ValueError("IMAP email credentials are missing. Please configure them in Email Automation Settings.")

    context = ssl.create_default_context()
    context.check_hostname = False
    context.verify_mode = ssl.CERT_NONE

    mail = imaplib.IMAP4_SSL(host, 993, ssl_context=context, timeout=50)
    mail.login(username, password)

    results = []
    seen_ids = set()
    clean_query = re.sub(r'[\r\n\t"]', '', subject_query).strip()

    folders_to_check = ["INBOX", "From AP Merin", "Sent Items"]

    # Smart search term extraction with precision fingerprint
    fp = extract_rfq_fingerprint(subject_query)
    search_candidates = []

    # 1. Full reference code e.g. Jt6/Req/Sp/E/Shp/26/0 048 or ARM-e-107/2026-I004
    if fp.get("ref_raw"):
        search_candidates.append(fp["ref_raw"])
        no_space_ref = fp["ref_raw"].replace(" ", "")
        if no_space_ref != fp["ref_raw"] and no_space_ref not in search_candidates:
            search_candidates.append(no_space_ref)

    # 2. Combined vessel prefix + requisition number e.g. JT6 0048 or 0 048
    if fp.get("vessel_prefix") and fp.get("ref_num"):
        cand_v = f"{fp['vessel_prefix']} {fp['ref_num']}"
        if cand_v not in search_candidates:
            search_candidates.append(cand_v)

    # 3. Slashed reference code e.g. ARM-e-107
    code_match = re.search(r'\b([A-Za-z0-9\-]{3,}(?:/[A-Za-z0-9\-]+)+)\b', clean_query)
    if code_match and code_match.group(1) not in search_candidates:
        search_candidates.append(code_match.group(1))

    prefix_match = re.search(r'\b([A-Za-z]{2,5}-?[eE]?-\d{2,4})\b', clean_query)
    if prefix_match and prefix_match.group(1) not in search_candidates:
        search_candidates.append(prefix_match.group(1))

    # 4. Composite equipment phrases (at least 2 distinctive words, e.g. "Injector Fuel Supply Tube")
    if fp.get("equip_words") and len(fp["equip_words"]) >= 2:
        top_equip = " ".join(fp["equip_words"][:3])
        if top_equip not in search_candidates:
            search_candidates.append(top_equip)

    # 5. Full simplified query without punctuation
    simplified_query = re.sub(r'[\(\)\[\]"\'\:\,\;]', ' ', clean_query).strip()
    if simplified_query and simplified_query not in search_candidates:
        search_candidates.append(simplified_query)

    try:
        for fld in folders_to_check:
            try:
                mailbox_name = f'"{fld}"' if ' ' in fld else fld
                status, _ = mail.select(mailbox_name, readonly=True)
                if status != 'OK':
                    continue

                matched_msg_ids = set()

                # 1. FAST CLIENT-SIDE DECODED HEADER SCAN (Catches Base64/Quoted-Printable RFC2047 subjects)
                try:
                    status_all, data_all = mail.search(None, 'ALL')
                    if status_all == 'OK' and data_all and data_all[0]:
                        all_folder_ids = data_all[0].split()
                        # Inspect the latest 200 messages in this folder
                        scan_batch = all_folder_ids[-200:] if len(all_folder_ids) > 200 else all_folder_ids
                        if scan_batch:
                            first_seq = scan_batch[0].decode('ascii', errors='ignore')
                            last_seq = scan_batch[-1].decode('ascii', errors='ignore')
                            f_st, f_data = mail.fetch(f"{first_seq}:{last_seq}", '(BODY.PEEK[HEADER.FIELDS (SUBJECT FROM DATE)])')
                            if f_st == 'OK' and f_data:
                                for item in f_data:
                                    if isinstance(item, tuple) and len(item) > 1:
                                        m_seq = re.match(rb'^(\d+)\s+', item[0])
                                        if not m_seq:
                                            continue
                                        cur_seq = m_seq.group(1)
                                        hdr_msg = email.message_from_bytes(item[1])
                                        dec_sub = decode_mime_words(hdr_msg.get('Subject', ''))
                                        norm_sub = re.sub(r'[^a-zA-Z0-9]', '', dec_sub).lower()
                                        
                                        # Match against candidates and verify relevance
                                        for cand in search_candidates:
                                            cand_norm = re.sub(r'[^a-zA-Z0-9]', '', cand).lower()
                                            if len(cand_norm) >= 3 and (cand_norm in norm_sub or (len(cand_norm) > 10 and norm_sub in cand_norm)):
                                                is_rel, _ = is_email_relevant_to_rfq({"subject": dec_sub}, fp)
                                                if is_rel:
                                                    matched_msg_ids.add(cur_seq)
                                                    break
                except Exception as e_fast:
                    print(f"[Info] Fast decoded header scan notice in {fld}: {e_fast}")

                # 2. SERVER-SIDE SEARCH FALLBACK (For older messages beyond the latest 200)
                for term in search_candidates[:4]:
                    try:
                        clean_term = re.sub(r'[\r\n\t"]', '', term).strip()
                        if not clean_term or len(clean_term) < 3:
                            continue
                        status, data = mail.search(None, 'SUBJECT', f'"{clean_term}"')
                        if status == 'OK' and data[0]:
                            for mid in data[0].split():
                                matched_msg_ids.add(mid)
                        # Try without quotes
                        status, data = mail.search(None, 'SUBJECT', clean_term)
                        if status == 'OK' and data[0]:
                            for mid in data[0].split():
                                matched_msg_ids.add(mid)
                    except Exception:
                        continue

                msg_ids = sorted(list(matched_msg_ids), key=lambda x: int(x) if x.isdigit() else 0)

                if fld in ["From AP Merin", "Sent Items"]:
                    # In sent folders, the earliest messages are the initial outgoing RFQ inquiry broadcasted to suppliers,
                    # while the latest messages are recent follow-ups or replies. We must include BOTH!
                    if len(msg_ids) <= 30:
                        fetch_ids = list(msg_ids)
                    else:
                        earliest = msg_ids[:15]
                        latest = msg_ids[-15:]
                        seen_mids = set()
                        fetch_ids = []
                        for m in earliest + latest:
                            if m not in seen_mids:
                                seen_mids.add(m)
                                fetch_ids.append(m)
                else:
                    fetch_limit = max(max_results, 25)
                    fetch_ids = msg_ids[-fetch_limit:] if len(msg_ids) > fetch_limit else list(msg_ids)

                fetch_ids.reverse()

                for mid in fetch_ids:
                    key = (fld, mid)
                    if key in seen_ids:
                        continue
                    seen_ids.add(key)
                    try:
                        status, msg_data = mail.fetch(mid, '(RFC822)')
                        if status == 'OK' and msg_data and msg_data[0]:
                            results.append(msg_data[0][1])
                    except Exception as ex:
                        print(f"[Warning] Failed fetching email ID {mid} in {fld}: {ex}")
            except Exception as e:
                print(f"[Info] Error searching folder {fld}: {e}")
                try:
                    mail = imaplib.IMAP4_SSL(host, 993, ssl_context=context, timeout=50)
                    mail.login(username, password)
                except Exception:
                    pass

    finally:
        try:
            mail.logout()
        except Exception:
            pass

    return results


def search_outlook_desktop_emails(subject_query, max_results=20, mailbox_user=None):
    """
    Searches Microsoft Outlook Desktop (win32com) if running locally on Windows.
    Searches user's store (if mailbox_user matches an Outlook account) as well as default Inbox and Sent Items.
    """
    if sys.platform != 'win32':
        return []

    results = []
    try:
        import pythoncom
        import win32com.client
        pythoncom.CoInitialize()
        outlook = win32com.client.Dispatch("Outlook.Application")
        namespace = outlook.GetNamespace("MAPI")
        
        folders_to_check = []

        # 1. Search user-specific mailbox store if specified
        if mailbox_user:
            mb_clean = mailbox_user.lower().strip()
            try:
                for i in range(1, namespace.Folders.Count + 1):
                    fld = namespace.Folders.Item(i)
                    if mb_clean in fld.Name.lower():
                        for sub_f in fld.Folders:
                            sn = sub_f.Name.lower()
                            if "inbox" in sn or "sent" in sn:
                                folders_to_check.append(sub_f)
            except Exception:
                pass

        # 2. Add default Inbox & Sent Items
        try:
            folders_to_check.append(namespace.GetDefaultFolder(6)) # 6 = olFolderInbox
            folders_to_check.append(namespace.GetDefaultFolder(5)) # 5 = olFolderSentMail
        except Exception:
            pass

        clean_query = subject_query.replace("'", "''").strip()
        filter_str = f"@SQL=\"urn:schemas:httpmail:subject\" LIKE '%{clean_query}%'"

        for folder in folders_to_check:
            try:
                matched_items = folder.Items.Restrict(filter_str)
                matched_items.Sort("[ReceivedTime]", True)

                count = 0
                for item in matched_items:
                    if count >= max_results:
                        break
                    try:
                        sender_name = str(getattr(item, "SenderName", ""))
                        sender_email = str(getattr(item, "SenderEmailAddress", ""))
                        to_recip = str(getattr(item, "To", ""))
                        cc_recip = str(getattr(item, "CC", ""))
                        subject = str(getattr(item, "Subject", ""))
                        body = str(getattr(item, "Body", ""))
                        html_body = str(getattr(item, "HTMLBody", ""))
                        received_time = str(getattr(item, "ReceivedTime", ""))

                        clean_name, clean_email = extract_sender_identity(f"{sender_name} <{sender_email}>", body)

                        attachments = []
                        rich_attachments = []
                        documents = []
                        images = []
                        cid_map = {}

                        if hasattr(item, "Attachments"):
                            for att_idx in range(1, item.Attachments.Count + 1):
                                att = item.Attachments.Item(att_idx)
                                att_name = att.FileName
                                import tempfile
                                tmp_path = os.path.join(tempfile.gettempdir(), f"apm_att_{att_idx}_{att_name}")
                                att.SaveAsFile(tmp_path)
                                with open(tmp_path, "rb") as f:
                                    att_bytes = f.read()
                                try:
                                    os.remove(tmp_path)
                                except Exception:
                                    pass
                                attachments.append((att_name, att_bytes))

                                cid_val = ""
                                try:
                                    cid_val = str(att.PropertyAccessor.GetProperty("http://schemas.microsoft.com/mapi/proptag/0x3712001F") or "").strip('<> \r\n')
                                except Exception:
                                    pass

                                is_img = any(att_name.lower().endswith(ext) for ext in ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'])
                                is_pdf = att_name.lower().endswith('.pdf')
                                is_excel = any(att_name.lower().endswith(ext) for ext in ['.xlsx', '.xls', '.csv'])
                                is_doc = any(att_name.lower().endswith(ext) for ext in ['.docx', '.doc'])

                                eff_ct = 'application/octet-stream'
                                if is_img:
                                    eff_ct = 'image/png' if att_name.lower().endswith('.png') else ('image/jpeg' if att_name.lower().endswith(('.jpg', '.jpeg')) else 'image/png')
                                elif is_pdf:
                                    eff_ct = 'application/pdf'
                                elif is_excel:
                                    eff_ct = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                                elif is_doc:
                                    eff_ct = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

                                # Lightweight metadata for Stage 1 discovery (prevents multi-megabyte JSON bloat and WebView2 Out-of-Memory crashes)
                                # Full binaries and preview pages are fetched on-demand via /api/comparator/fetch-quote-doc
                                data_uri = None
                                if is_img and (cid_val or len(att_bytes) < 250000):
                                    b64_str = base64.b64encode(att_bytes).decode('ascii')
                                    data_uri = f"data:{eff_ct};base64,{b64_str}"

                                if is_img and att_bytes:
                                    if cid_val:
                                        cid_map[cid_val] = data_uri
                                        cid_map[f"cid:{cid_val}"] = data_uri
                                    cid_map[att_name] = data_uri
                                    cid_map[att_name.lower()] = data_uri
                                    img_rec = {
                                        "filename": att_name,
                                        "content_id": cid_val,
                                        "content_type": eff_ct,
                                        "size": len(att_bytes),
                                        "size_kb": round(len(att_bytes) / 1024, 1),
                                        "data_url": data_uri,
                                        "is_inline": bool(cid_val)
                                    }
                                    images.append(img_rec)

                                doc_rec = {
                                    "filename": att_name,
                                    "size": len(att_bytes),
                                    "size_kb": round(len(att_bytes) / 1024, 1),
                                    "content_type": eff_ct,
                                    "is_image": is_img,
                                    "is_pdf": is_pdf,
                                    "is_excel": is_excel,
                                    "is_doc": is_doc,
                                    "data_url": None,
                                    "base64": None,
                                    "preview_pages": []
                                }
                                rich_attachments.append(doc_rec)
                                if not is_img:
                                    documents.append(doc_rec)

                        html_body_resolved = html_body
                        if html_body and cid_map:
                            def _replace_cid_out(m):
                                cid = m.group(1).strip('<> \r\n')
                                if cid in cid_map:
                                    return f'src="{cid_map[cid]}"'
                                if f"cid:{cid}" in cid_map:
                                    return f'src="{cid_map[f"cid:{cid}"]}"'
                                if cid.lower() in cid_map:
                                    return f'src="{cid_map[cid.lower()]}"'
                                return m.group(0)
                            html_body_resolved = re.sub(r'src=["\']cid:([^"\']+)["\']', _replace_cid_out, html_body, flags=re.IGNORECASE)

                        results.append({
                            "from": f"{clean_name} <{clean_email}>",
                            "sender_name": clean_name,
                            "sender_email": clean_email,
                            "to": to_recip,
                            "cc": cc_recip,
                            "subject": subject,
                            "date": received_time,
                            "body": body,
                            "html_body": html_body,
                            "html_body_resolved": html_body_resolved,
                            "images": images,
                            "documents": documents,
                            "rich_attachments": rich_attachments,
                            "attachments": attachments
                        })
                        count += 1
                    except Exception as e:
                        print(f"[Warning] Error parsing Outlook item: {e}")
            except Exception as fe:
                print(f"[Info] Error reading Outlook folder: {fe}")

    except Exception as e:
        print(f"[Info] Outlook COM not available or not running: {e}")

    return results


def extract_sender_identity(sender_raw, body_text=""):
    """
    Extracts the clean sender name and email from the From header, strictly ignoring CC/BCC.
    If From header has a generic account (e.g. sales02@, project@), checks email body sign-off
    (e.g. "Best regards, Kirthana") to identify the actual person who sent it.
    """
    sender_raw = str(sender_raw or "").strip()
    sender_email = sender_raw
    sender_name = sender_raw

    email_match = re.search(r'<([^>]+)>', sender_raw)
    if email_match:
        sender_email = email_match.group(1).strip()
        sender_name = sender_raw.split('<')[0].strip().strip('"\'')
    elif '@' in sender_raw:
        sender_email = sender_raw.strip()
        sender_name = sender_raw.split('@')[0].strip()

    generic_names = ['sales02', 'sales', 'project', 'admin', 'info', 'procurement', 'operations', 'order', 'quotation']
    is_generic = not sender_name or any(sender_name.lower().strip() == g for g in generic_names) or '@' in sender_name

    if body_text and is_generic:
        signoff_patterns = [
            r'(?:best regards|warm regards|with regards|regards|sincerely|thanks and regards|thanks & regards)[,\s\r\n]+([A-Za-z][A-Za-z\s]{1,30})(?:\r?\n|$)',
            r'(?:from|signed):?\s*([A-Za-z][A-Za-z\s]{1,30})(?:\r?\n|$)'
        ]
        for p in signoff_patterns:
            m = re.search(p, body_text, re.IGNORECASE)
            if m:
                cand = m.group(1).split('\n')[0].strip()
                cand_lower = cand.lower()
                if len(cand) >= 2 and cand_lower not in ['ap merin', 'ap merin services', 'sales team', 'procurement team', 'sir', 'madam', 'dear']:
                    sender_name = cand.title()
                    break

    return sender_name or sender_email, sender_email


def parse_rfc822_email(raw_bytes):
    """
    Parses a raw RFC822 MIME byte message into a clean dictionary.
    Captures From (clean sender, ignoring CC), To, CC, Date, Subject, Attachments,
    and resolves inline CID image references into base64 data URLs for authentic rendering.
    """
    msg = email.message_from_bytes(raw_bytes)
    
    sender_raw = decode_mime_words(msg.get('From', ''))
    subject_raw = decode_mime_words(msg.get('Subject', ''))
    date_raw = decode_mime_words(msg.get('Date', ''))
    to_raw = decode_mime_words(msg.get('To', ''))
    cc_raw = decode_mime_words(msg.get('Cc', ''))
    message_id = msg.get('Message-ID', '').strip()
    in_reply_to = msg.get('In-Reply-To', '').strip()

    body_text = ""
    body_html = ""
    attachments = []
    rich_attachments = []
    documents = []
    images = []
    cid_map = {}

    for part in msg.walk():
        content_type = part.get_content_type()
        content_disposition = str(part.get('Content-Disposition', ''))
        content_id = (part.get('Content-ID') or '').strip('<> \r\n')
        raw_filename = part.get_filename()
        filename = decode_mime_words(raw_filename) if raw_filename else ''
        payload = part.get_payload(decode=True) or b''

        is_img = (
            content_type.startswith('image/') or 
            (filename and any(filename.lower().endswith(ext) for ext in ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']))
        )
        is_pdf = filename.lower().endswith('.pdf') if filename else False
        is_excel = any(filename.lower().endswith(ext) for ext in ['.xlsx', '.xls', '.csv']) if filename else False
        is_doc = any(filename.lower().endswith(ext) for ext in ['.docx', '.doc']) if filename else False

        eff_ct = content_type
        if is_img:
            if filename and filename.lower().endswith(('.jpg', '.jpeg')):
                eff_ct = 'image/jpeg'
            elif filename and filename.lower().endswith('.png'):
                eff_ct = 'image/png'
            elif filename and filename.lower().endswith('.gif'):
                eff_ct = 'image/gif'
            elif filename and filename.lower().endswith('.webp'):
                eff_ct = 'image/webp'
            elif filename and filename.lower().endswith('.svg'):
                eff_ct = 'image/svg+xml'
            elif not eff_ct or not eff_ct.startswith('image/'):
                eff_ct = 'image/png'
        elif is_pdf:
            eff_ct = 'application/pdf'
        elif is_excel:
            eff_ct = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        elif is_doc:
            eff_ct = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

        # Lightweight metadata for Stage 1 discovery (prevents multi-megabyte JSON bloat and WebView2 Out-of-Memory crashes)
        # Full binaries and preview pages are fetched on-demand via /api/comparator/fetch-quote-doc
        data_uri = None
        if is_img and (content_id or len(payload) < 250000):
            b64_str = base64.b64encode(payload).decode('ascii')
            data_uri = f"data:{eff_ct};base64,{b64_str}"

        if is_img and payload:
            if content_id:
                cid_map[content_id] = data_uri
                cid_map[f"cid:{content_id}"] = data_uri
            if filename:
                cid_map[filename] = data_uri
                cid_map[filename.lower()] = data_uri

            img_rec = {
                "filename": filename or f"image_{len(images)+1}.png",
                "content_id": content_id,
                "content_type": eff_ct,
                "size": len(payload),
                "size_kb": round(len(payload) / 1024, 1),
                "data_url": data_uri,
                "is_inline": bool(content_id)
            }
            images.append(img_rec)

        if filename:
            attachments.append((filename, payload))
            doc_rec = {
                "filename": filename,
                "size": len(payload),
                "size_kb": round(len(payload) / 1024, 1),
                "content_type": eff_ct,
                "is_image": is_img,
                "is_pdf": is_pdf,
                "is_excel": is_excel,
                "is_doc": is_doc,
                "data_url": None,
                "base64": None,
                "preview_pages": []
            }
            rich_attachments.append(doc_rec)
            if not is_img:
                documents.append(doc_rec)

        elif content_type == 'text/plain' and 'attachment' not in content_disposition.lower():
            charset = part.get_content_charset() or 'utf-8'
            try:
                body_text += payload.decode(charset, errors='ignore') + "\n"
            except Exception:
                body_text += payload.decode('latin-1', errors='ignore') + "\n"
        elif content_type == 'text/html' and 'attachment' not in content_disposition.lower():
            charset = part.get_content_charset() or 'utf-8'
            try:
                body_html += payload.decode(charset, errors='ignore') + "\n"
            except Exception:
                body_html += payload.decode('latin-1', errors='ignore') + "\n"

    # Resolve inline cid references in HTML body
    html_body_resolved = body_html
    if body_html and cid_map:
        def _replace_cid(m):
            cid = m.group(1).strip('<> \r\n')
            if cid in cid_map:
                return f'src="{cid_map[cid]}"'
            if f"cid:{cid}" in cid_map:
                return f'src="{cid_map[f"cid:{cid}"]}"'
            cid_lower = cid.lower()
            if cid_lower in cid_map:
                return f'src="{cid_map[cid_lower]}"'
            return m.group(0)

        html_body_resolved = re.sub(r'src=["\']cid:([^"\']+)["\']', _replace_cid, body_html, flags=re.IGNORECASE)

    if not body_text.strip() and body_html.strip():
        body_text = clean_email_body(body_html, is_html=True)
    else:
        body_text = clean_email_body(body_text, is_html=False)

    sender_name, sender_email = extract_sender_identity(sender_raw, body_text)

    return {
        "from": sender_raw,
        "sender_name": sender_name,
        "sender_email": sender_email,
        "to": to_raw,
        "cc": cc_raw,
        "message_id": message_id,
        "in_reply_to": in_reply_to,
        "subject": subject_raw,
        "date": date_raw,
        "body": body_text,
        "html_body": body_html,
        "html_body_resolved": html_body_resolved,
        "images": images,
        "documents": documents,
        "rich_attachments": rich_attachments,
        "attachments": attachments
    }


def smart_deduplicate_and_organize(emails, user_email="project@apmerinservices.com.my"):
    """
    Separates outgoing baseline RFQ emails from supplier reply emails.
    Deduplicates attachments using SHA-256 hashes and groups replies by supplier.
    """
    seen_attachment_hashes = set()
    total_raw_attachments = 0
    duplicate_attachments_removed = 0
    signature_images_filtered = 0

    user_email_lower = user_email.lower().strip()
    suppliers_dict = {}
    outgoing_rfq_emails = []

    for em in emails:
        sender_email = em.get("sender_email", "").lower().strip()
        sender_name = em.get("sender_name", "").strip()
        if (not sender_email or not sender_name) and em.get("from"):
            extracted_name, extracted_email = extract_sender_identity(em.get("from", ""), em.get("body", ""))
            if not sender_name:
                sender_name = extracted_name
            if not sender_email:
                sender_email = extracted_email.lower().strip()
        if not sender_name:
            sender_name = sender_email
        
        # Identify outgoing messages sent by AP Merin
        is_outgoing = (
            "apmerinservices" in sender_email or 
            (user_email_lower and user_email_lower in sender_email) or
            "sales02@" in sender_email or
            "suga@" in sender_email or
            "sharrvendran@" in sender_email
        )

        if is_outgoing:
            outgoing_rfq_emails.append(em)
            continue

        # Supplier reply grouping
        domain = sender_email.split('@')[1] if '@' in sender_email else sender_email
        supplier_key = domain

        if supplier_key not in suppliers_dict:
            suppliers_dict[supplier_key] = {
                "supplier_key": supplier_key,
                "sender_name": sender_name,
                "sender_email": sender_email,
                "from": em.get("from", ""),
                "subject": em.get("subject", ""),
                "dates": [em.get("date", "")],
                "email_bodies": [],
                "raw_emails": [],
                "attachments": []
            }
        else:
            suppliers_dict[supplier_key]["dates"].append(em.get("date", ""))

        clean_body = em.get("body", "").strip()
        if clean_body:
            suppliers_dict[supplier_key]["email_bodies"].append(clean_body)

        suppliers_dict[supplier_key]["raw_emails"].append(em)

        for filename, file_bytes in em.get("attachments", []):
            total_raw_attachments += 1
            
            if is_signature_or_noise(filename, file_bytes):
                signature_images_filtered += 1
                continue

            file_hash = hashlib.sha256(file_bytes).hexdigest()
            if file_hash in seen_attachment_hashes:
                duplicate_attachments_removed += 1
                continue

            seen_attachment_hashes.add(file_hash)
            suppliers_dict[supplier_key]["attachments"].append({
                "filename": filename,
                "bytes": file_bytes,
                "hash": file_hash,
                "size": len(file_bytes)
            })

    stats = {
        "total_emails_found": len(emails),
        "total_raw_attachments": total_raw_attachments,
        "duplicate_attachments_removed": duplicate_attachments_removed,
        "signature_images_filtered": signature_images_filtered,
        "unique_valid_attachments": len(seen_attachment_hashes),
        "suppliers_found": len(suppliers_dict),
        "estimated_tokens_saved": (duplicate_attachments_removed * 2500) + (signature_images_filtered * 1800)
    }

    return list(suppliers_dict.values()), stats, outgoing_rfq_emails


def find_initial_rfq_email(outgoing_emails, all_emails=None, target_rfq_query=None):
    """
    Identifies AP Merin's authentic original outgoing RFQ inquiry email sent to suppliers.
    Strictly filters out:
    - Subject lines starting with 'RE:' or 'FW:'
    - Messages with acknowledgment text ("The quotation has been well received", "well received")
    Prioritizes earliest inquiry messages with attachments/images or RFQ keywords.
    """
    candidates = []
    pool = list(outgoing_emails or [])

    if target_rfq_query:
        fp = extract_rfq_fingerprint(target_rfq_query)
        rel_pool = [em for em in pool if is_email_relevant_to_rfq(em, fp)[0]]
        if rel_pool:
            pool = rel_pool

    ACK_PHRASES = [
        'well received',
        'the quotation has been well received',
        'quotation has been received',
        'thank you for your quotation',
        'received with thanks',
        'thanks for the quote',
        'we have received your quotation',
        'acknowledged with thanks'
    ]

    for em in pool:
        subj = (em.get('subject') or '').strip()
        body = (em.get('body') or '').strip().lower()
        
        is_reply = bool(re.match(r'^(?:re|fwd?)\s*:\s*', subj, re.IGNORECASE))
        body_start = body[:400]
        is_ack = any(phrase in body_start for phrase in ACK_PHRASES)

        score = 0
        if not is_reply:
            score += 1000
        if not is_ack:
            score += 500
        
        if re.search(r'\b(?:rfq|inquiry|enquiry|quotation request|please quote|tender)\b', subj, re.IGNORECASE):
            score += 200
        if re.search(r'\b(?:please advise|please quote|please provide your best quote|please send quotation)\b', body, re.IGNORECASE):
            score += 200

        has_imgs = len(em.get('images', [])) > 0
        has_atts = len(em.get('attachments', [])) > 0
        if has_imgs or has_atts:
            score += 100

        candidates.append((score, em))

    from email.utils import parsedate_to_datetime
    from datetime import datetime as dt
    def _get_dt(em):
        d_str = em.get('date', '')
        try:
            return parsedate_to_datetime(d_str) if d_str else dt.max
        except Exception:
            return dt.max

    if candidates:
        top_tier = [c for c in candidates if c[0] >= 1500]
        if top_tier:
            top_tier.sort(key=lambda x: _get_dt(x[1]))
            return top_tier[0][1]

        second_tier = [c for c in candidates if c[0] >= 1000]
        if second_tier:
            second_tier.sort(key=lambda x: _get_dt(x[1]))
            return second_tier[0][1]

        candidates.sort(key=lambda x: (-x[0], _get_dt(x[1])))
        return candidates[0][1]

    if all_emails:
        apm_candidates = []
        for em in all_emails:
            s_email = (em.get("sender_email") or "").lower()
            if "apmerinservices" in s_email or "sales02@" in s_email or "project@" in s_email:
                subj = (em.get('subject') or '').strip()
                is_reply = bool(re.match(r'^(?:re|fwd?)\s*:\s*', subj, re.IGNORECASE))
                body = (em.get('body') or '').strip().lower()
                is_ack = any(phrase in body[:400] for phrase in ACK_PHRASES)
                if not is_reply and not is_ack:
                    apm_candidates.append(em)
        if apm_candidates:
            if target_rfq_query:
                fp = extract_rfq_fingerprint(target_rfq_query)
                rel_apm = [em for em in apm_candidates if is_email_relevant_to_rfq(em, fp)[0]]
                if rel_apm:
                    apm_candidates = rel_apm
            apm_candidates.sort(key=_get_dt)
            return apm_candidates[0]

    return None


def analyze_email_threads_and_lifecycle(emails, mailbox_user="project@apmerinservices.com.my", target_rfq_query=None):
    """
    Performs comprehensive thread lifecycle analysis for Stage 1 (Email Discovery & Review):
    1. Identifies the initial outgoing RFQ email sent by AP Merin (ignoring CC).
    2. Identifies internal AP Merin staff follow-ups / replies, flagging when someone different replied.
    3. Categorizes each supplier's communication lifecycle:
       - QUOTE_ATTACHED: Quotation document (.pdf, .xlsx, .docx) received
       - QUOTE_BODY: Commercial offer provided directly in email text
       - REGRET: Supplier declined / product out of range
       - PENDING_AP_MERIN: Supplier requested technical clarification (pending action on AP Merin)
       - PENDING_SUPPLIER: Supplier acknowledged receipt; offer in progress
    4. Formats all discovered emails and attachments for interactive inspection.
    """
    # Precision gating: if a target RFQ query is provided, drop emails from unrelated RFQs
    if target_rfq_query:
        fp = extract_rfq_fingerprint(target_rfq_query)
        rel_emails = [em for em in emails if is_email_relevant_to_rfq(em, fp)[0]]
        if rel_emails:
            emails = rel_emails

    supplier_pkgs, dedup_stats, outgoing_emails = smart_deduplicate_and_organize(emails, user_email=mailbox_user)

    # 1. Identify Initial Outgoing RFQ and Initial Sender
    initial_rfq_info = {
        "sender_name": "Procurement Dept",
        "sender_email": mailbox_user,
        "date": "",
        "subject": "",
        "recipients": "",
        "internal_replies": []
    }

    if outgoing_emails:
        initial_out = find_initial_rfq_email(outgoing_emails, emails, target_rfq_query=target_rfq_query)
        if not initial_out:
            try:
                from email.utils import parsedate_to_datetime
                from datetime import datetime as dt
                sorted_outgoing = sorted(
                    outgoing_emails,
                    key=lambda x: parsedate_to_datetime(x.get('date', '')) if x.get('date') else dt.min
                )
                initial_out = sorted_outgoing[0]
            except Exception:
                initial_out = outgoing_emails[-1]

        init_name, init_email = extract_sender_identity(initial_out.get('from', ''), initial_out.get('body', ''))
        initial_rfq_info["sender_name"] = init_name
        initial_rfq_info["sender_email"] = init_email
        initial_rfq_info["date"] = initial_out.get("date", "")
        initial_rfq_info["subject"] = initial_out.get("subject", "")
        initial_rfq_info["recipients"] = initial_out.get("to", "")
        initial_rfq_info["from"] = initial_out.get("from", "")
        initial_rfq_info["to"] = initial_out.get("to", "")
        initial_rfq_info["cc"] = initial_out.get("cc", "")
        initial_rfq_info["body_text"] = initial_out.get("body", "")
        initial_rfq_info["html_body"] = initial_out.get("html_body", "")
        initial_rfq_info["html_body_resolved"] = initial_out.get("html_body_resolved", "")
        initial_rfq_info["images"] = initial_out.get("images", [])
        initial_rfq_info["documents"] = initial_out.get("documents", [])
        initial_rfq_info["rich_attachments"] = initial_out.get("rich_attachments", [])

        # Check for internal follow-ups from AP Merin
        for out_em in outgoing_emails:
            if out_em == initial_out:
                continue
            rep_name, rep_email = extract_sender_identity(out_em.get('from', ''), out_em.get('body', ''))
            is_diff = (rep_name.lower() != init_name.lower() or rep_email.lower() != init_email.lower())
            initial_rfq_info["internal_replies"].append({
                "sender_name": rep_name,
                "sender_email": rep_email,
                "date": out_em.get("date", ""),
                "subject": out_em.get("subject", ""),
                "is_different_sender": is_diff,
                "summary": f"Follow-up reply sent by {rep_name} ({rep_email})" + (" (Different from initial RFQ sender)" if is_diff else "")
            })

    # Fallback if outgoing folder was unreachable or returned no outgoing emails: inspect quoted threads in replies
    if not outgoing_emails or initial_rfq_info["sender_name"] in ["Procurement Dept", mailbox_user]:
        for em in emails:
            body = em.get("body", "")
            m_apm = re.search(r'From:\s*([^\r\n]*?(?:apmerinservices\.com\.my|sales02@|project@)[^\r\n]*)', body, re.IGNORECASE)
            if m_apm:
                from_str = m_apm.group(1).strip()
                m_name, m_email = extract_sender_identity(from_str, body)
                if m_name and m_name.lower() not in ["procurement dept", mailbox_user.lower()]:
                    initial_rfq_info["sender_name"] = m_name
                    initial_rfq_info["sender_email"] = m_email
                    m_dt = re.search(r'(?:Date|Sent):\s*([^\r\n]+)', body[m_apm.start():], re.IGNORECASE)
                    if m_dt:
                        initial_rfq_info["date"] = m_dt.group(1).strip()
                    m_sb = re.search(r'Subject:\s*([^\r\n]+)', body[m_apm.start():], re.IGNORECASE)
                    if m_sb:
                        initial_rfq_info["subject"] = m_sb.group(1).strip()
                    m_to = re.search(r'To:\s*([^\r\n]+)', body[m_apm.start():], re.IGNORECASE)
                    if m_to:
                        initial_rfq_info["recipients"] = m_to.group(1).strip()
                    break

    # 2. Categorize Supplier Lifecycle
    supplier_threads = []
    supplier_clarification_patterns = [
        r'please advise', r'please clarify', r'please confirm', r'require more information',
        r'can you provide', r'which model', r'serial no', r'drawing', r'voltage',
        r'maker name', r'delivery port', r'maker serial', r'send photo', r'kindly advise',
        r'need more details', r'need your confirmation', r'please specify'
    ]

    for s_idx, pkg in enumerate(supplier_pkgs):
        s_name = pkg.get("sender_name") or pkg.get("supplier_key")
        s_email = pkg.get("sender_email", "")
        s_key = pkg.get("supplier_key", "")
        combined_body = "\n\n".join(pkg.get("email_bodies", []))
        atts = pkg.get("attachments", [])

        quote_docs = [a for a in atts if a["filename"].lower().endswith(('.pdf', '.xlsx', '.xls', '.docx', '.doc'))]
        reg_type, reg_msg = detect_regret_or_pending(combined_body)

        status = "PENDING_SUPPLIER"
        status_badge = "⏳ Pending Supplier Offer"
        status_color = "slate"
        status_notes = "Receipt acknowledged; awaiting quotation."
        is_pending_apmerin = False
        is_regret = False
        is_pending_quote = True

        if quote_docs:
            status = "QUOTE_ATTACHED"
            doc_names = ", ".join([f"{a['filename']} ({round(a['size']/1024, 1)} KB)" for a in quote_docs])
            status_badge = "✅ Quotation Document Attached"
            status_color = "emerald"
            status_notes = f"Attached: {doc_names}"
            is_pending_quote = False
        elif reg_type == "REGRET":
            status = "REGRET"
            status_badge = "❌ Regret / Declined"
            status_color = "rose"
            status_notes = reg_msg or "Supplier unable to quote / out of scope."
            is_regret = True
            is_pending_quote = False
        else:
            # Check if supplier asked for technical clarification
            matched_q = None
            for pat in supplier_clarification_patterns:
                m = re.search(pat, combined_body, re.IGNORECASE)
                if m:
                    matched_q = m.group(0)
                    break
            
            if matched_q:
                status = "PENDING_AP_MERIN"
                status_badge = "⚠️ Action Pending on AP Merin"
                status_color = "amber"
                status_notes = f"Supplier requested clarification (e.g. '{matched_q}'). Awaiting reply from AP Merin."
                is_pending_apmerin = True
                is_pending_quote = False
            elif reg_type == "PENDING":
                status = "PENDING_SUPPLIER"
                status_badge = "⏳ Pending Supplier Offer"
                status_color = "slate"
                status_notes = reg_msg or "Receipt acknowledged; preparing quotation offer."
            else:
                # Check for pricing numbers in text
                if re.search(r'(?:usd|eur|myr|sgd|rm|\$|€)\s*\d+[\d,.]*', combined_body, re.IGNORECASE):
                    status = "QUOTE_BODY"
                    status_badge = "✅ Quotation in Email Body"
                    status_color = "blue"
                    status_notes = "Commercial quote figures provided in email message text."
                    is_pending_quote = False

        # Communication timeline
        timeline = []
        if initial_rfq_info.get("sender_name") and initial_rfq_info.get("date"):
            timeline.append({
                "step": 1,
                "action": "Initial RFQ Sent",
                "actor": f"{initial_rfq_info['sender_name']} ({initial_rfq_info['sender_email']})",
                "date": initial_rfq_info["date"],
                "badge": "Sent Out"
            })
        
        for rep in initial_rfq_info.get("internal_replies", []):
            timeline.append({
                "step": len(timeline) + 1,
                "action": "Internal Clarification / Follow-up",
                "actor": f"{rep['sender_name']} ({rep['sender_email']})",
                "date": rep.get("date", ""),
                "badge": "Internal Reply",
                "is_different_sender": rep.get("is_different_sender", False)
            })

        for d_idx, d_str in enumerate(pkg.get("dates", [])):
            timeline.append({
                "step": len(timeline) + 1,
                "action": f"Supplier Response #{d_idx+1}: {status_badge}",
                "actor": f"{s_name} ({s_email})",
                "date": d_str,
                "badge": "Reply"
            })

        # Format individual authentic supplier email replies
        supplier_email_records = []
        for em_item in pkg.get("raw_emails", []):
            supplier_email_records.append({
                "from": em_item.get("from", "") or f"{s_name} <{s_email}>",
                "sender_name": em_item.get("sender_name", "") or s_name,
                "sender_email": em_item.get("sender_email", "") or s_email,
                "to": em_item.get("to", ""),
                "cc": em_item.get("cc", ""),
                "date": em_item.get("date", ""),
                "subject": em_item.get("subject", "") or pkg.get("subject", ""),
                "body": em_item.get("body", "").strip(),
                "body_text": em_item.get("body", "").strip(),
                "html_body": em_item.get("html_body", ""),
                "html_body_resolved": em_item.get("html_body_resolved", ""),
                "images": em_item.get("images", []),
                "documents": em_item.get("documents", []),
                "rich_attachments": em_item.get("rich_attachments", [])
            })
        
        if not supplier_email_records:
            supplier_email_records.append({
                "from": pkg.get("from", "") or f"{s_name} <{s_email}>",
                "sender_name": s_name,
                "sender_email": s_email,
                "to": "",
                "cc": "",
                "date": pkg.get("dates", [""])[-1] if pkg.get("dates") else "",
                "subject": pkg.get("subject", ""),
                "body": combined_body,
                "body_text": combined_body,
                "html_body": "",
                "html_body_resolved": "",
                "images": [],
                "documents": [],
                "rich_attachments": []
            })

        # Format attached quote documents with preview pages
        quote_document_records = []
        for qd in quote_docs:
            p_data = generate_source_preview_data(doc_bytes=qd["bytes"], filename=qd["filename"], email_info=None)
            quote_document_records.append({
                "filename": qd["filename"],
                "size_kb": round(qd["size"] / 1024, 1),
                "size": qd["size"],
                "preview_format": p_data.get("preview_format", "pdf"),
                "preview_pages": p_data.get("preview_pages", []),
                "base64": p_data.get("base64", ""),
                "data_url": p_data.get("data_url", "")
            })

        supplier_threads.append({
            "supplier_index": s_idx,
            "supplier_key": s_key,
            "supplier_name": s_name,
            "sender_name": s_name,
            "supplier_email": s_email,
            "sender_email": s_email,
            "from": pkg.get("from", ""),
            "subject": pkg.get("subject", ""),
            "status": status,
            "status_badge": status_badge,
            "status_label": status_badge,
            "status_color": status_color,
            "status_notes": status_notes,
            "is_pending_apmerin": is_pending_apmerin,
            "is_regret": is_regret,
            "is_pending_quote": is_pending_quote,
            "quote_docs_count": len(quote_docs),
            "quote_documents": quote_document_records,
            "emails": supplier_email_records,
            "attachments": [
                {
                    "filename": a["filename"],
                    "size_kb": round(a["size"] / 1024, 1),
                    "is_quote_doc": a["filename"].lower().endswith(('.pdf', '.xlsx', '.xls', '.docx', '.doc')),
                    "is_image": any(a["filename"].lower().endswith(ext) for ext in VALID_IMAGE_EXTS)
                }
                for a in atts
            ],
            "timeline": timeline,
            "latest_date": pkg.get("dates", [""])[-1] if pkg.get("dates") else ""
        })

    # 3. Format all individual discovered emails
    discovered_emails = []
    for em_idx, em in enumerate(emails):
        s_email = em.get("sender_email", "").lower()
        is_out = ("apmerinservices" in s_email or "sales02@" in s_email or "project@" in s_email)
        
        valid_atts = []
        for fn, fb in em.get("attachments", []):
            if not is_signature_or_noise(fn, fb):
                valid_atts.append({
                    "filename": fn,
                    "size_kb": round(len(fb) / 1024, 1),
                    "is_document": fn.lower().endswith(('.pdf', '.xlsx', '.xls', '.docx')),
                    "is_image": any(fn.lower().endswith(ext) for ext in VALID_IMAGE_EXTS)
                })

        discovered_emails.append({
            "email_id": em_idx,
            "direction": "outgoing" if is_out else "incoming",
            "direction_label": "Sent by AP Merin" if is_out else "Incoming Supplier Reply",
            "sender_name": em.get("sender_name", ""),
            "sender_email": em.get("sender_email", ""),
            "from": em.get("from", ""),
            "to": em.get("to", ""),
            "cc": em.get("cc", ""),
            "date": em.get("date", ""),
            "subject": em.get("subject", ""),
            "snippet": (em.get("body", "").strip()[:180] + "...") if len(em.get("body", "").strip()) > 180 else em.get("body", "").strip(),
            "body_full": em.get("body", ""),
            "body_text": em.get("body", ""),
            "html_body": em.get("html_body", ""),
            "html_body_resolved": em.get("html_body_resolved", ""),
            "images": em.get("images", []),
            "documents": em.get("documents", []),
            "rich_attachments": em.get("rich_attachments", []),
            "attachments": valid_atts
        })

    return {
        "initial_rfq": initial_rfq_info,
        "supplier_threads": supplier_threads,
        "discovered_emails": discovered_emails,
        "dedup_stats": dedup_stats,
        "total_emails_found": len(emails),
        "total_suppliers_found": len(supplier_threads)
    }


def extract_baseline_rfq(outgoing_emails=None, uploaded_baseline_doc=None, gemini_key=None, all_emails=None):
    """
    Extracts the master baseline RFQ items that AP Merin requested from suppliers.
    Returns metadata (vessel, IMO, maker, model) and the master list of requested items.
    Captures both Client/Our Part No and Maker's No for dual-identifier cross-matching.
    """
    client = get_genai_client() if gemini_key else None
    
    prompt = """
You are an expert marine procurement specialist analyzing an outgoing RFQ (Request for Quotation) document sent to suppliers.
Extract the inquiry metadata and the table of requested items into a clean JSON structure.

CRITICAL EXTRACTION RULES FOR MARINE PARTS:
1. Marine RFQ tables often list dual identifiers:
   - "Our Part No." or Requisition Item No / Item Code (e.g. "601.052.02/00057" or "11.02.01.26")
   - "Maker's No." or OEM Part No / Part Number (e.g. "2750001" or "3918508")
   - "Drawing No." (e.g. "Z159733")
   - In requisitions with an "Item Code" column and an "Other Details" block (Make, Model Number, Part Number, ESN):
     Extract the manufacturer Part Number into `part_no` and `maker_no`, and extract the client Item Code into `our_part_no`.
   ALWAYS extract both: put the Maker's No / Part Number in `maker_no` and `part_no`, and put the Requisition/Client Code in `our_part_no`.
2. Extract clean product descriptions into `description` (e.g. "WORM GEARING", "FLUSHING BUSH", "PRESSURE SPRING", "O-RING").
3. Numeric quantity only into `quantity`.
4. Unit into `unit` (e.g. "PCE", "PCS", "SET").

OUTPUT JSON SCHEMA:
{
  "vessel_name": "Vessel Name (e.g. JM SUTERA 8, AFRA MARE)",
  "imo_number": "IMO number if present",
  "rfq_number": "Inquiry or RFQ number (e.g. RN 26-0011)",
  "maker": "Equipment manufacturer (e.g. BOLL & KIRCH, DAIHATSU)",
  "model": "Equipment model (e.g. 8DKM28EL)",
  "items": [
    {
      "item_no": 1,
      "part_no": "Maker Part No or Primary Part No (e.g. 2750001)",
      "maker_no": "Maker Part No if specified (e.g. 2750001)",
      "our_part_no": "Client Requisition Part No if specified (e.g. 601.052.02/00057)",
      "drawing_no": "Drawing No if specified (e.g. Z159733)",
      "description": "Product Description (e.g. WORM GEARING)",
      "quantity": 1.0,
      "unit": "PCE / PCS / SET"
    }
  ]
}
Return ONLY valid JSON.
"""

    def parse_baseline_doc(fn, fb):
        if not client or not fb:
            return None
        from google.genai import types
        fn_lower = fn.lower()
        contents = []

        if fn_lower.endswith('.pdf'):
            try:
                doc = pymupdf.open(stream=fb, filetype="pdf")
                text = "".join([p.get_text() + "\n" for p in doc])
                if len(text.strip()) > 150:
                    contents.append(f"RFQ INQUIRY PDF TEXT:\n{text[:16000]}")
                else:
                    for p in range(min(len(doc), 4)):
                        pix = doc[p].get_pixmap(dpi=150)
                        contents.append(types.Part.from_bytes(data=pix.tobytes("png"), mime_type="image/png"))
            except Exception as pe:
                print(f"[Warning] PDF text extraction error: {pe}")
                return None
        elif any(fn_lower.endswith(ext) for ext in VALID_IMAGE_EXTS):
            mime = "image/png" if fn_lower.endswith('.png') else "image/jpeg"
            contents.append(types.Part.from_bytes(data=fb, mime_type=mime))
        else:
            return None

        if contents:
            contents.append(prompt)
            for m in GEMINI_MODELS:
                try:
                    res = client.models.generate_content(
                        model=m,
                        contents=contents,
                        config=types.GenerateContentConfig(response_mime_type="application/json")
                    )
                    if res and res.text:
                        data = json.loads(res.text)
                        if data.get('items') and len(data['items']) > 0:
                            data['preview'] = generate_source_preview_data(doc_bytes=fb, filename=fn)
                            return data
                except Exception as ex:
                    print(f"[Info] Gemini baseline attempt failed with {m}: {ex}")
                    continue
        return None

    # Identify authentic initial RFQ inquiry email
    initial_em = find_initial_rfq_email(outgoing_emails, all_emails)
    baseline_email_record = None
    if initial_em:
        s_name, s_email = extract_sender_identity(initial_em.get('from', ''), initial_em.get('body', ''))
        baseline_email_record = {
            "sender_name": s_name,
            "sender_email": s_email,
            "from": initial_em.get('from', ''),
            "to": initial_em.get('to', ''),
            "cc": initial_em.get('cc', ''),
            "date": initial_em.get('date', ''),
            "subject": initial_em.get('subject', ''),
            "body_text": initial_em.get('body', ''),
            "html_body": initial_em.get('html_body', ''),
            "html_body_resolved": initial_em.get('html_body_resolved', ''),
            "images": initial_em.get('images', []),
            "documents": initial_em.get('documents', []),
            "rich_attachments": initial_em.get('rich_attachments', [])
        }

    # 1. If user uploaded a baseline document manually
    if uploaded_baseline_doc:
        fn, fb = uploaded_baseline_doc
        parsed = parse_baseline_doc(fn, fb)
        if parsed:
            if baseline_email_record:
                parsed['baseline_email'] = baseline_email_record
            return parsed

    # 2. Search attachments strictly across outgoing RFQ emails (never supplier reply attachments)
    candidate_attachments = []
    pool = []
    if initial_em:
        pool.append(initial_em)
    for em in (outgoing_emails or []):
        if em not in pool:
            pool.append(em)

    for em in pool:
        for fn, fb in em.get("attachments", []):
            fn_lower = fn.lower()
            sz = len(fb)
            if sz < 10000:
                continue

            # Prioritize attachments:
            score = 0
            if fn_lower.endswith('.pdf'):
                score += 300
            elif any(fn_lower.endswith(ext) for ext in VALID_IMAGE_EXTS):
                score += 250

            if any(k in fn_lower for k in ['rfq', 'inquiry', 'rn', 'req', 'order', 'filter', 'pump', 'engine', '1788']):
                score += 150
            if any(k in fn_lower for k in ['signature', 'logo', 'footer']):
                score -= 200

            candidate_attachments.append((score, fn, fb, em))

    # Sort descending by score
    candidate_attachments.sort(key=lambda x: x[0], reverse=True)

    # Try parsing the top candidate documents
    for score, fn, fb, em in candidate_attachments[:4]:
        parsed = parse_baseline_doc(fn, fb)
        if parsed and parsed.get('items'):
            parsed['baseline_email'] = baseline_email_record or {
                "sender_name": em.get('sender_name', ''),
                "sender_email": em.get('sender_email', ''),
                "from": em.get('from', ''),
                "to": em.get('to', ''),
                "cc": em.get('cc', ''),
                "date": em.get('date', ''),
                "subject": em.get('subject', ''),
                "body_text": em.get('body', ''),
                "html_body": em.get('html_body', ''),
                "html_body_resolved": em.get('html_body_resolved', ''),
                "images": em.get('images', []),
                "documents": em.get('documents', []),
                "rich_attachments": em.get('rich_attachments', [])
            }
            return parsed

    # 3. If no attachment had items or no attachment present, but we have the initial RFQ email:
    if baseline_email_record:
        return {
            "vessel_name": "",
            "rfq_number": baseline_email_record.get("subject", ""),
            "maker": "",
            "model": "",
            "items": [],
            "baseline_email": baseline_email_record
        }

    return None


def extract_single_quote_with_gemini(doc_bytes=None, filename="", email_text=""):
    """
    Calls Gemini AI to extract commercial line items and terms.
    Strictly instructs the model NOT to extract company addresses, disclaimers, or signature text.
    """
    client = get_genai_client()
    if not client:
        return None

    prompt = """
You are an expert marine procurement specialist analyzing a supplier's quotation response.
Extract all quoted commercial line items and quotation terms into a structured JSON object.

CRITICAL INSTRUCTIONS:
1. Extract ONLY commercial products/parts offered for sale with a positive price.
2. DO NOT extract company addresses, phone/fax numbers, email disclaimers, greeting lines, or signature blocks as line items.
3. If an item has no price or is not a product, ignore it.

CORE COMPARISON FACTORS TO EXTRACT:
1. **PRICE & CURRENCY**:
   - `unit_price`: Net price per unit in quoted currency.
   - `total_amount`: Total price for the line item.
   - `currency`: 3-letter currency code (e.g. USD, EUR, MYR, SGD).
2. **LEAD TIME**:
   - `lead_time`: Delivery lead time (e.g. "In Stock", "10 Days", "2-3 Weeks"). If unstated, use "TBA".
3. **CONDITION & AUTHENTICITY**:
   - `condition`: EXACTLY one of: "Original", "OEM", "Replacement".
   - CRITICAL RULES FOR CONDITION:
     * "Original": Use this when the quotation states "Genuine", "Original", "Maker Genuine", "Authentic", or when the supplier quotes maker part numbers without stating it is an aftermarket copy. IN MARINE PROCUREMENT, QUOTING MAKER EQUIPMENT DEFAULTS TO ORIGINAL UNLESS EXPLICITLY STATED AS AFTERMARKET/COPY.
     * "OEM": Use this if stated as OEM / Original Equipment Manufacturer specification.
     * "Replacement": ONLY use "Replacement" if the quotation explicitly marks the specific line item or remark as "aftermarket", "replacement", "non-genuine", "substitute", or "copy".
     * STRICT NEGATIVE RULE: DO NOT classify items as "Replacement" based on company letterhead/footer marketing text (such as "supplies replacement parts for..."). Ignore footer boilerplate text!
     * DO NOT classify phrases like "Reliable parts", "European origin", or "Subject to prior sales" as "Replacement".
   - `origin_notes`: Exact words used by supplier regarding origin (e.g. "Genuine parts", "OEM", "Original").

OUTPUT JSON SCHEMA:
{
  "supplier_name": "Supplier Company Name (The SELLING company). CRITICAL: DO NOT use 'AP Merin' or 'AP Merin Services' as supplier name, because AP Merin is the BUYER/CUSTOMER.",
  "quotation_no": "Quote Reference Number or N/A",
  "currency": "USD / EUR / MYR / SGD",
  "payment_terms": "e.g. Net 30 days, Prepayment",
  "delivery_terms": "e.g. Ex-Works Singapore, FOB Port",
  "general_lead_time": "Global lead time if stated",
  "items": [
    {
      "item_no": 1,
      "item_code": "Part number or IMPA code",
      "description": "Product title and specification",
      "quantity": 1.0,
      "unit": "PCS / SET / EA",
      "unit_price": 100.00,
      "total_amount": 100.00,
      "currency": "USD",
      "lead_time": "Ex-Stock / 2 Weeks",
      "condition": "Original / OEM / Replacement",
      "origin_notes": "Exact wording from quotation",
      "remarks": "Any notes or limitations"
    }
  ]
}
Return ONLY valid JSON.
"""

    from google.genai import types

    contents = []
    # If text document or email body ONLY
    if email_text and not doc_bytes:
        contents.append(f"SUPPLIER EMAIL MESSAGE:\n{email_text}")
    elif doc_bytes:
        fn_lower = filename.lower()
        if fn_lower.endswith('.pdf'):
            doc = pymupdf.open(stream=doc_bytes, filetype="pdf")
            extracted_text = "".join([p.get_text() + "\n" for p in doc])
            
            if len(extracted_text.strip()) > 150:
                contents.append(f"SUPPLIER QUOTATION PDF TEXT ({filename}):\n{extracted_text[:12000]}")
            else:
                for p_idx in range(min(len(doc), 4)):
                    pix = doc[p_idx].get_pixmap(dpi=150)
                    contents.append(types.Part.from_bytes(data=pix.tobytes("png"), mime_type="image/png"))
        elif any(fn_lower.endswith(ext) for ext in VALID_IMAGE_EXTS):
            mime = "image/png" if fn_lower.endswith('.png') else "image/jpeg"
            contents.append(types.Part.from_bytes(data=doc_bytes, mime_type=mime))
        elif fn_lower.endswith('.xlsx') or fn_lower.endswith('.xls'):
            wb = openpyxl.load_workbook(io.BytesIO(doc_bytes), data_only=True)
            sheet_text = ""
            for sname in wb.sheetnames[:3]:
                ws = wb[sname]
                for r in ws.iter_rows(values_only=True):
                    if any(r):
                        sheet_text += "\t".join([str(c) if c is not None else "" for c in r]) + "\n"
            contents.append(f"SUPPLIER QUOTATION SPREADSHEET ({filename}):\n{sheet_text[:12000]}")

    if not contents:
        return None

    contents.append(prompt)

    for model_name in GEMINI_MODELS:
        try:
            res = client.models.generate_content(
                model=model_name,
                contents=contents,
                config=types.GenerateContentConfig(response_mime_type="application/json")
            )
            if res and res.text:
                parsed = json.loads(res.text)
                if isinstance(parsed, dict) and 'items' in parsed:
                    # Filter out any non-price items
                    parsed['items'] = [it for it in parsed['items'] if float(it.get('unit_price') or 0.0) > 0]
                    if parsed['items']:
                        return parsed
        except Exception as ex:
            print(f"[Info] Gemini comparator extraction model {model_name} error: {ex}")
            continue

    return None


def extract_single_quote_local_fallback(doc_bytes=None, filename="", email_text="", sender_name=""):
    """
    Rule-based local fallback when Gemini is offline.
    """
    raw_text = email_text or ""
    currency = "USD"

    if doc_bytes:
        fn_lower = filename.lower()
        if fn_lower.endswith('.pdf'):
            items, curr = parse_pdf(doc_bytes)
            if items:
                for it in items:
                    it_text = f"{it.get('description', '')} {it.get('remarks', '')}"
                    it['lead_time'] = detect_lead_time(it_text)
                    it['condition'], it['origin_notes'] = detect_condition(it_text)
                return {
                    "supplier_name": sender_name or "Supplier",
                    "quotation_no": filename,
                    "currency": curr or "USD",
                    "items": [it for it in items if float(it.get('unit_price') or 0) > 0]
                }
        elif fn_lower.endswith('.xlsx') or fn_lower.endswith('.xls'):
            items = parse_excel(doc_bytes)
            if items:
                for it in items:
                    it_text = f"{it.get('description', '')} {it.get('remarks', '')}"
                    it['lead_time'] = detect_lead_time(it_text)
                    it['condition'], it['origin_notes'] = detect_condition(it_text)
                return {
                    "supplier_name": sender_name or "Supplier",
                    "quotation_no": filename,
                    "currency": items[0].get('currency') or "USD",
                    "items": [it for it in items if float(it.get('unit_price') or 0) > 0]
                }

    if raw_text:
        items, curr = parse_raw_text(raw_text)
        items = [it for it in items if float(it.get('unit_price') or 0) > 0]
        if items:
            for it in items:
                it_text = f"{it.get('description', '')} {it.get('remarks', '')} {raw_text}"
                it['lead_time'] = detect_lead_time(it_text)
                it['condition'], it['origin_notes'] = detect_condition(it_text)
            return {
                "supplier_name": sender_name or "Supplier",
                "quotation_no": "Email Quote",
                "currency": curr or "USD",
                "items": items
            }

    return None


def detect_lead_time(text):
    """Detects delivery lead times such as 'Ex-Stock', '3 Days', '2-3 Weeks'."""
    if not text:
        return "TBA"
    t_lower = text.lower()
    
    if re.search(r'\b(in\s*stock|ex[- ]?stock|ready\s*stock|prompt|immediate)\b', t_lower):
        return "Ex-Stock"
    
    match_weeks = re.search(r'(\d+[\s\-]*(?:to|\-)?[\s\-]*\d*)\s*(?:working\s*)?weeks?', t_lower)
    if match_weeks:
        return f"{match_weeks.group(1).strip()} Weeks"
        
    match_days = re.search(r'(\d+[\s\-]*(?:to|\-)?[\s\-]*\d*)\s*(?:working\s*)?days?', t_lower)
    if match_days:
        return f"{match_days.group(1).strip()} Days"
        
    match_months = re.search(r'(\d+[\s\-]*(?:to|\-)?[\s\-]*\d*)\s*months?', t_lower)
    if match_months:
        return f"{match_months.group(1).strip()} Months"

    return "TBA"


def detect_condition(text):
    """Categorizes part condition: Original / Genuine vs OEM vs Replacement."""
    if not text:
        return "Original", "Maker Standard"
    t_lower = text.lower()

    # Explicit replacement / aftermarket / copy
    if re.search(r'\b(aftermarket|non-genuine|copy|substitute)\b', t_lower):
        return "Replacement", "Replacement / Aftermarket"
    elif re.search(r'\b(reconditioned|re-con|used|overhauled)\b', t_lower):
        return "Replacement", "Reconditioned"
    elif re.search(r'\breplacement\b', t_lower) and not re.search(r'\b(supplies replacement parts for|replacement parts for)\b', t_lower):
        return "Replacement", "Replacement"
    elif re.search(r'\b(oem|original equipment manufacturer)\b', t_lower):
        return "OEM", "OEM Specification"
    elif re.search(r'\b(genuine|original|maker genuine|authentic|maker|new genuine)\b', t_lower):
        return "Original", "Genuine / Original"

    # Default in marine procurement when quoting against maker part numbers: Original
    return "Original", "Maker Standard"


def process_supplier_package(supplier_pkg, gemini_key=None):
    """
    Extracts quote data from a deduplicated supplier package.
    Strictly follows attachment priority: if valid quotation attachments exist,
    extracts ONLY from attachments.
    If no attachments exist, detects Regret or Pending messages to avoid noise items.
    Generates preview data for source inspection.
    """
    supplier_name = supplier_pkg.get("sender_name") or supplier_pkg.get("supplier_key")
    combined_body = "\n\n".join(supplier_pkg.get("email_bodies", []))
    attachments = supplier_pkg.get("attachments", [])

    first_raw = supplier_pkg.get("raw_emails", [{}])[0] if supplier_pkg.get("raw_emails") else {}
    email_info = {
        "from": supplier_pkg.get("from", "") or first_raw.get("from", ""),
        "sender_name": supplier_name,
        "sender_email": supplier_pkg.get("sender_email", "") or first_raw.get("sender_email", ""),
        "to": first_raw.get("to", ""),
        "cc": first_raw.get("cc", ""),
        "date": supplier_pkg.get("dates", [""])[0] if supplier_pkg.get("dates") else first_raw.get("date", ""),
        "subject": supplier_pkg.get("subject", "") or first_raw.get("subject", ""),
        "body": combined_body or first_raw.get("body", ""),
        "body_text": combined_body or first_raw.get("body", ""),
        "html_body": first_raw.get("html_body", ""),
        "html_body_resolved": first_raw.get("html_body_resolved", ""),
        "images": first_raw.get("images", []),
        "documents": first_raw.get("documents", []),
        "rich_attachments": first_raw.get("rich_attachments", [])
    }

    quote_result = None

    # Filter for genuine quote documents
    quote_docs = [att for att in attachments if att["filename"].lower().endswith(('.pdf', '.xlsx', '.xls', '.docx', '.doc'))]
    if not quote_docs:
        # Also check large images if no documents exist
        quote_docs = [att for att in attachments if any(att["filename"].lower().endswith(ext) for ext in VALID_IMAGE_EXTS) and att["size"] > 40000]

    # 1. ATTACHMENT PRIORITY: If attachments exist, extract strictly from attachment
    for att in quote_docs:
        fn = att["filename"]
        fb = att["bytes"]
        
        # Try Gemini
        if gemini_key:
            try:
                res = extract_single_quote_with_gemini(doc_bytes=fb, filename=fn)
                if res and res.get("items"):
                    quote_result = res
                    quote_result["source_type"] = "Attachment"
                    quote_result["source_file"] = fn
                    quote_result["source_preview"] = generate_source_preview_data(doc_bytes=fb, filename=fn, email_info=email_info)
                    break
            except Exception as e:
                print(f"[Warning] Gemini attachment extraction failed for {fn}: {e}")

        # Local Fallback
        if not quote_result:
            res_local = extract_single_quote_local_fallback(doc_bytes=fb, filename=fn, sender_name=supplier_name)
            if res_local and res_local.get("items"):
                quote_result = res_local
                quote_result["source_type"] = "Attachment"
                quote_result["source_file"] = fn
                quote_result["source_preview"] = generate_source_preview_data(doc_bytes=fb, filename=fn, email_info=email_info)
                break

    # 2. If NO quote document attachment exists, inspect email body
    if not quote_result:
        # Check for Regret / Decline
        regret_type, regret_msg = detect_regret_or_pending(combined_body)
        if regret_type == "REGRET":
            return {
                "supplier_key": supplier_pkg.get("supplier_key", ""),
                "supplier_name": supplier_name,
                "supplier_email": supplier_pkg.get("sender_email", ""),
                "quotation_no": "Regret / Out of Scope",
                "currency": "USD",
                "items": [],
                "is_regret": True,
                "status_label": "Regret / Declined",
                "status_notes": regret_msg,
                "source_type": "Email Body",
                "source_file": "Email Message",
                "source_preview": generate_source_preview_data(email_info=email_info),
                "email_data": email_info,
                "raw_emails": supplier_pkg.get("raw_emails", [])
            }
        elif regret_type == "PENDING":
            return {
                "supplier_key": supplier_pkg.get("supplier_key", ""),
                "supplier_name": supplier_name,
                "supplier_email": supplier_pkg.get("sender_email", ""),
                "quotation_no": "Receipt Acknowledged",
                "currency": "USD",
                "items": [],
                "is_pending": True,
                "status_label": "Pending Quote",
                "status_notes": regret_msg,
                "source_type": "Email Body",
                "source_file": "Email Message",
                "source_preview": generate_source_preview_data(email_info=email_info),
                "email_data": email_info,
                "raw_emails": supplier_pkg.get("raw_emails", [])
            }

        # If actual quotation in body (and no attachments were present)
        if combined_body.strip():
            if gemini_key:
                try:
                    res = extract_single_quote_with_gemini(email_text=combined_body)
                    if res and res.get("items"):
                        quote_result = res
                        quote_result["source_type"] = "Email Body"
                        quote_result["source_file"] = "Email Message"
                        quote_result["source_preview"] = generate_source_preview_data(email_info=email_info)
                except Exception as e:
                    print(f"[Warning] Gemini email body extraction failed: {e}")

            if not quote_result:
                res_local = extract_single_quote_local_fallback(email_text=combined_body, sender_name=supplier_name)
                if res_local and res_local.get("items"):
                    quote_result = res_local
                    quote_result["source_type"] = "Email Body"
                    quote_result["source_file"] = "Email Message"
                    quote_result["source_preview"] = generate_source_preview_data(email_info=email_info)

    if not quote_result:
        return None

    extracted_s_name = (quote_result.get("supplier_name") or "").strip()
    if not extracted_s_name or extracted_s_name.lower() == "supplier" or "ap merin" in extracted_s_name.lower() or "apmerin" in extracted_s_name.lower():
        quote_result["supplier_name"] = supplier_name
    quote_result["supplier_email"] = supplier_pkg.get("sender_email", "")
    quote_result["supplier_key"] = supplier_pkg.get("supplier_key", "")
    quote_result["email_data"] = email_info
    quote_result["raw_emails"] = supplier_pkg.get("raw_emails", [])

    return quote_result


def normalize_part_code(code_str):
    """Normalizes part codes for matching (e.g. '003' -> '3', '020' -> '20', stripping punctuation)."""
    if not code_str:
        return ""
    s = re.sub(r'[^A-Za-z0-9]', '', str(code_str)).upper()
    if s.isdigit():
        return str(int(s))
    return s


def compile_side_by_side_comparison(supplier_quotes, target_currency="MYR", fx_rates=None, baseline_rfq=None, initial_rfq=None):
    """
    Compiles quotes from multiple suppliers into a unified side-by-side comparison matrix.
    When baseline_rfq is provided:
    - Master rows are established directly from requested baseline items.
    - Matches each supplier offer to the corresponding baseline item.
    - Reports compliance (e.g. 6/6 Quoted 100%, or Regret, or Missing items).
    - Highlights lowest price and fastest delivery per item.
    """
    if not supplier_quotes:
        return {
            "success": False,
            "error": "No valid supplier quotations extracted."
        }

    rates = fx_rates or {
        'USD': 1.0000,
        'MYR': 4.4500,
        'EUR': 0.9200,
        'SGD': 1.3400,
        'GBP': 0.7850,
        'JPY': 154.5000,
        'CNY': 7.2300,
        'AED': 3.6725
    }

    def convert_currency(amount, from_curr, to_curr):
        if not amount or amount <= 0:
            return 0.0
        from_c = (from_curr or 'USD').upper()
        to_c = (to_curr or 'MYR').upper()
        if from_c == to_c:
            return round(float(amount), 2)
        
        from_rate = rates.get(from_c, 1.0)
        to_rate = rates.get(to_c, 1.0)
        usd_val = float(amount) / from_rate
        target_val = usd_val * to_rate
        return round(target_val, 2)

    def extract_item_identifiers(item):
        p_code = str(item.get('part_no') or item.get('item_code') or '').strip()
        item_code_raw = str(item.get('item_code') or '').strip()
        desc = str(item.get('description') or '').strip()
        remarks = str(item.get('remarks') or '').strip()
        item_no_str = str(item.get('item_no') or '').strip()
        
        # Check embedded patterns in description or remarks
        maker_m = re.search(r'MAKER(?:\'S)?\s*NO[\.\:]*\s*([A-Za-z0-9\-\_]+)', desc, re.IGNORECASE)
        drawing_m = re.search(r'DRAWING\s*NO[\.\:]*\s*([A-Za-z0-9\-\_]+)', desc, re.IGNORECASE)
        our_part_m = re.search(r'OUR\s*PART\s*NO[\.\:]*\s*([A-Za-z0-9\.\/\-\_]+)', desc, re.IGNORECASE)
        part_m = re.search(r'(?:Part\s*(?:Number|No|#)|P/N)\s*[:=\s]*([A-Za-z0-9\-\./]+)', f"{desc} {remarks}", re.IGNORECASE)
        
        maker_no = str(item.get('maker_no') or (maker_m.group(1) if maker_m else '')).strip()
        drawing_no = str(item.get('drawing_no') or (drawing_m.group(1) if drawing_m else '')).strip()
        our_part_no = str(item.get('our_part_no') or (our_part_m.group(1) if our_part_m else '')).strip()
        extracted_part = str(part_m.group(1) if part_m else '').strip()
        
        codes = set()
        for c in [p_code, item_code_raw, maker_no, drawing_no, our_part_no, extracted_part]:
            if c:
                norm = normalize_part_code(c)
                if norm and len(norm) >= 3:
                    codes.add(norm)
                    
        # Clean description for token comparison
        clean_desc = desc
        for pat in [
            r'MAKERS?[\.\:]*[^\,\n]+',
            r'MAKER(?:\'S)?\s*NO[\.\:]*[^\,\n]+',
            r'DRAWING\s*NO[\.\:]*[^\,\n]+',
            r'OUR\s*PART\s*NO[\.\:]*[^\,\n]+',
            r'COMPONENT[\.\:]*[^\,\n]+'
        ]:
            clean_desc = re.sub(pat, ' ', clean_desc, flags=re.IGNORECASE)
            
        ignore_words = {'THE', 'AND', 'FOR', 'PART', 'PARTS', 'ITEM', 'ITEMS', 'PCS', 'PCE', 'SET', 'EA', 'MAKERS', 'MAKER', 'COMPONENT'}
        desc_words = {w.upper() for w in re.findall(r'\b[A-Za-z0-9]{3,}\b', clean_desc) if w.upper() not in ignore_words}
        
        item_idx = None
        if item_no_str and item_no_str.isdigit():
            item_idx = int(item_no_str)
            
        is_freight = (p_code.upper() in ['FRT', 'FREIGHT', 'COURIER']) or any(k in desc.upper() for k in ['PACKING & COURIER', 'FREIGHT CHARGES', 'COURIER COST', 'SHIPPING COST'])

        return {
            "codes": codes,
            "maker_no": normalize_part_code(maker_no) if maker_no else "",
            "drawing_no": normalize_part_code(drawing_no) if drawing_no else "",
            "our_part_no": normalize_part_code(our_part_no) if our_part_no else "",
            "desc_words": desc_words,
            "item_idx": item_idx,
            "raw_desc": clean_desc.strip(),
            "is_freight": is_freight
        }

    def compute_match_score(u_info, q_info):
        # Freight items should never match equipment items
        if u_info.get("is_freight") or q_info.get("is_freight"):
            return 0

        # Tier 1: Exact code match across dual identifiers (e.g. maker_no or requisition code)
        common_codes = u_info["codes"].intersection(q_info["codes"])
        if common_codes:
            return 1000 + len(common_codes) * 50

        # Tier 2: Maker's No matches exactly
        if u_info["maker_no"] and q_info["maker_no"] and u_info["maker_no"] == q_info["maker_no"]:
            return 950

        # Tier 3: Our Part No matches exactly
        if u_info["our_part_no"] and q_info["our_part_no"] and u_info["our_part_no"] == q_info["our_part_no"]:
            return 950

        # Tier 4: Same sequential line number (item_no) AND description word overlap
        if u_info["item_idx"] is not None and q_info["item_idx"] is not None and u_info["item_idx"] == q_info["item_idx"]:
            overlap = u_info["desc_words"].intersection(q_info["desc_words"])
            if overlap or not u_info["desc_words"]:
                return 800 + len(overlap) * 20

        # Tier 5: Pure description keyword overlap
        overlap = u_info["desc_words"].intersection(q_info["desc_words"])
        if len(overlap) >= 2:
            return 500 + len(overlap) * 30
        if len(overlap) == 1 and (len(u_info["desc_words"]) <= 2 or len(q_info["desc_words"]) <= 2):
            return 200

        return 0

    # 1. Establish Master Items
    unified_items = []
    baseline_items = baseline_rfq.get('items', []) if baseline_rfq else []

    if baseline_items:
        for idx, b_it in enumerate(baseline_items):
            p_code = str(b_it.get('our_part_no') or b_it.get('maker_no') or b_it.get('part_no') or b_it.get('item_no') or '').strip()
            desc = str(b_it.get('description') or '').strip()
            qty = float(b_it.get('quantity') or 1.0)
            unit = str(b_it.get('unit') or 'PCS').strip()

            entry = {
                "item_index": idx + 1,
                "item_code": p_code,
                "part_no": str(b_it.get('maker_no') or b_it.get('part_no') or p_code).strip(),
                "maker_no": str(b_it.get('maker_no') or '').strip(),
                "our_part_no": str(b_it.get('our_part_no') or '').strip(),
                "drawing_no": str(b_it.get('drawing_no') or '').strip(),
                "description": desc,
                "quantity": qty,
                "unit": unit,
                "is_baseline": True,
                "supplier_offers": {}
            }
            entry["_info"] = extract_item_identifiers(entry)
            unified_items.append(entry)
    else:
        # Fallback: Group by items seen in quotes using multi-key matching
        for s_idx, s_quote in enumerate(supplier_quotes):
            for it in s_quote.get('items', []):
                q_info = extract_item_identifiers(it)
                if q_info.get("is_freight"):
                    continue

                best_existing = None
                best_s = 0
                for ex in unified_items:
                    score = compute_match_score(ex["_info"], q_info)
                    if score > best_s and score >= 800:
                        best_s = score
                        best_existing = ex

                if not best_existing:
                    p_code = str(it.get('part_no') or it.get('item_code') or '').strip()
                    desc = str(it.get('description') or '').strip()
                    entry = {
                        "item_index": len(unified_items) + 1,
                        "item_code": p_code,
                        "part_no": p_code,
                        "maker_no": q_info.get('maker_no', ''),
                        "our_part_no": q_info.get('our_part_no', ''),
                        "drawing_no": q_info.get('drawing_no', ''),
                        "description": desc,
                        "quantity": float(it.get('quantity') or 1.0),
                        "unit": it.get('unit', 'PCS'),
                        "is_baseline": False,
                        "supplier_offers": {}
                    }
                    entry["_info"] = extract_item_identifiers(entry)
                    unified_items.append(entry)

    # 2. Match Supplier Offers to Master Items
    alternative_items = []

    for s_idx, s_quote in enumerate(supplier_quotes):
        if s_quote.get('is_regret') or s_quote.get('is_pending'):
            continue

        s_currency = s_quote.get('currency', 'USD')
        matched_quote_items = set()

        for u_entry in unified_items:
            u_info = u_entry["_info"]
            best_match = None
            best_score = 0

            for q_idx, it in enumerate(s_quote.get('items', [])):
                if q_idx in matched_quote_items:
                    continue

                q_info = extract_item_identifiers(it)
                score = compute_match_score(u_info, q_info)

                if score > best_score and score >= 200:
                    best_score = score
                    best_match = (q_idx, it)

            if best_match:
                q_idx, it = best_match
                matched_quote_items.add(q_idx)

                unit_p = float(it.get('unit_price') or 0.0)
                item_curr = it.get('currency') or s_currency
                conv_price = convert_currency(unit_p, item_curr, target_currency)
                total_conv = round(conv_price * u_entry['quantity'], 2)

                lead_t = it.get('lead_time') or s_quote.get('general_lead_time') or "TBA"
                cond = it.get('condition') or "Original"
                origin_n = it.get('origin_notes') or ""

                u_entry['supplier_offers'][s_idx] = {
                    "unit_price_raw": unit_p,
                    "currency_raw": item_curr,
                    "unit_price_converted": conv_price,
                    "total_price_converted": total_conv,
                    "lead_time": lead_t,
                    "condition": cond,
                    "origin_notes": origin_n,
                    "remarks": it.get('remarks', ''),
                    "raw_item_desc": it.get('description', '')
                }

        # Check for alternative/unmatched items offered by supplier
        for q_idx, it in enumerate(s_quote.get('items', [])):
            if q_idx not in matched_quote_items:
                q_info = extract_item_identifiers(it)
                unit_p = float(it.get('unit_price') or 0.0)
                if unit_p > 0:
                    item_curr = it.get('currency') or s_currency
                    conv_price = convert_currency(unit_p, item_curr, target_currency)
                    qty = float(it.get('quantity') or 1.0)
                    total_conv = round(conv_price * qty, 2)
                    
                    alt_entry = {
                        "supplier_index": s_idx,
                        "supplier_name": s_quote.get("supplier_name"),
                        "item_code": it.get('part_no') or it.get('item_code') or '',
                        "description": it.get('description', ''),
                        "quantity": qty,
                        "unit": it.get('unit', 'PCS'),
                        "unit_price_raw": unit_p,
                        "currency_raw": item_curr,
                        "unit_price_converted": conv_price,
                        "total_price_converted": total_conv,
                        "lead_time": it.get('lead_time') or s_quote.get('general_lead_time') or "TBA",
                        "condition": it.get('condition') or "Original",
                        "origin_notes": it.get('origin_notes', ''),
                        "is_freight": q_info.get("is_freight", False)
                    }
                    alternative_items.append(alt_entry)

    # Clean up internal temporary _info key from unified_items before serialization
    for u_entry in unified_items:
        u_entry.pop('_info', None)

    # 3. Identify Lowest Price and Fastest Delivery per line item
    def lead_time_to_days(lt_str):
        if not lt_str:
            return 9999
        lt = str(lt_str).lower()
        if 'stock' in lt or 'immediate' in lt or 'prompt' in lt:
            return 0
        match_days = re.search(r'(\d+)\s*d', lt)
        if match_days:
            return int(match_days.group(1))
        match_weeks = re.search(r'(\d+)\s*w', lt)
        if match_weeks:
            return int(match_weeks.group(1)) * 7
        match_num = re.search(r'(\d+)', lt)
        if match_num:
            return int(match_num.group(1))
        return 9999

    for entry in unified_items:
        offers = entry['supplier_offers']
        if not offers:
            continue

        valid_prices = [(s_idx, off['unit_price_converted']) for s_idx, off in offers.items() if off['unit_price_converted'] > 0]
        if valid_prices:
            min_s_idx, min_p = min(valid_prices, key=lambda x: x[1])
            entry['lowest_price_supplier'] = min_s_idx
            entry['lowest_unit_price'] = min_p

        valid_lead = [(s_idx, lead_time_to_days(off['lead_time'])) for s_idx, off in offers.items()]
        if valid_lead:
            fastest_s_idx, min_days = min(valid_lead, key=lambda x: x[1])
            entry['fastest_delivery_supplier'] = fastest_s_idx

    # 4. Build Supplier Summaries with Baseline Compliance Verification
    total_baseline_count = len(unified_items)
    supplier_summaries = []

    for s_idx, s_quote in enumerate(supplier_quotes):
        is_regret = s_quote.get("is_regret", False)
        is_pending = s_quote.get("is_pending", False)

        if is_regret:
            supplier_summaries.append({
                "supplier_index": s_idx,
                "supplier_name": s_quote.get("supplier_name", f"Supplier {s_idx+1}"),
                "supplier_email": s_quote.get("supplier_email", ""),
                "quotation_no": "Regret / Out of Scope",
                "currency_original": s_quote.get("currency", "USD"),
                "total_converted": 0.0,
                "target_currency": target_currency,
                "quoted_items_count": 0,
                "total_items_rfq": total_baseline_count,
                "compliance_percent": 0,
                "compliance_status": "Regret / Declined",
                "missing_items": [it['description'] for it in unified_items],
                "is_regret": True,
                "is_pending": False,
                "best_lead_time": "N/A",
                "source_file": s_quote.get("source_file", "Email Message"),
                "source_type": s_quote.get("source_type", "Email Body"),
                "source_preview": s_quote.get("source_preview", {}),
                "email_data": s_quote.get("email_data") or (s_quote.get("source_preview", {}).get("email_data")) or {},
                "supplier_key": s_quote.get("supplier_key", ""),
                "raw_emails": s_quote.get("raw_emails", [])
            })
            continue

        if is_pending:
            supplier_summaries.append({
                "supplier_index": s_idx,
                "supplier_name": s_quote.get("supplier_name", f"Supplier {s_idx+1}"),
                "supplier_email": s_quote.get("supplier_email", ""),
                "quotation_no": "Receipt Acknowledged",
                "currency_original": s_quote.get("currency", "USD"),
                "total_converted": 0.0,
                "target_currency": target_currency,
                "quoted_items_count": 0,
                "total_items_rfq": total_baseline_count,
                "compliance_percent": 0,
                "compliance_status": "Pending Quote",
                "missing_items": [it['description'] for it in unified_items],
                "is_regret": False,
                "is_pending": True,
                "best_lead_time": "Pending",
                "source_file": s_quote.get("source_file", "Email Message"),
                "source_type": s_quote.get("source_type", "Email Body"),
                "source_preview": s_quote.get("source_preview", {}),
                "email_data": s_quote.get("email_data") or (s_quote.get("source_preview", {}).get("email_data")) or {},
                "supplier_key": s_quote.get("supplier_key", ""),
                "raw_emails": s_quote.get("raw_emails", [])
            })
            continue

        total_val = 0.0
        quoted_items_count = 0
        original_count = 0
        oem_count = 0
        replacement_count = 0
        best_lead_time = "TBA"
        min_days = 9999
        missing_items = []

        for entry in unified_items:
            if s_idx in entry['supplier_offers']:
                off = entry['supplier_offers'][s_idx]
                if off['unit_price_converted'] > 0:
                    total_val += off['total_price_converted']
                    quoted_items_count += 1
                
                cond = off['condition']
                if cond == 'Original':
                    original_count += 1
                elif cond == 'OEM':
                    oem_count += 1
                elif cond == 'Replacement':
                    replacement_count += 1

                days = lead_time_to_days(off['lead_time'])
                if days < min_days:
                    min_days = days
                    best_lead_time = off['lead_time']
            else:
                missing_items.append(entry['description'])

        comp_pct = round((quoted_items_count / total_baseline_count * 100)) if total_baseline_count > 0 else 100
        comp_status = f"{quoted_items_count}/{total_baseline_count} Quoted ({comp_pct}%)"

        supplier_summaries.append({
            "supplier_index": s_idx,
            "supplier_name": s_quote.get("supplier_name", f"Supplier {s_idx+1}"),
            "supplier_email": s_quote.get("supplier_email", ""),
            "quotation_no": s_quote.get("quotation_no", ""),
            "currency_original": s_quote.get("currency", "USD"),
            "total_converted": round(total_val, 2),
            "target_currency": target_currency,
            "quoted_items_count": quoted_items_count,
            "total_items_rfq": total_baseline_count,
            "compliance_percent": comp_pct,
            "compliance_status": comp_status,
            "missing_items": missing_items,
            "is_regret": False,
            "is_pending": False,
            "original_items_count": original_count,
            "oem_items_count": oem_count,
            "replacement_items_count": replacement_count,
            "best_lead_time": best_lead_time,
            "payment_terms": s_quote.get("payment_terms", ""),
            "delivery_terms": s_quote.get("delivery_terms", ""),
            "source_file": s_quote.get("source_file", ""),
            "source_type": s_quote.get("source_type", "Attachment"),
            "source_preview": s_quote.get("source_preview", {}),
            "email_data": s_quote.get("email_data") or (s_quote.get("source_preview", {}).get("email_data")) or {},
            "supplier_key": s_quote.get("supplier_key", ""),
            "raw_emails": s_quote.get("raw_emails", [])
        })

    valid_totals = [(s['supplier_index'], s['total_converted']) for s in supplier_summaries if s['total_converted'] > 0]
    overall_best_price_supplier = min(valid_totals, key=lambda x: x[1])[0] if valid_totals else None

    for s in supplier_summaries:
        s['is_overall_best_price'] = (s['supplier_index'] == overall_best_price_supplier)

    return {
        "success": True,
        "target_currency": target_currency,
        "total_rfq_items": len(unified_items),
        "supplier_count": len(supplier_quotes),
        "baseline_rfq": baseline_rfq or {},
        "initial_rfq": initial_rfq or (baseline_rfq.get("baseline_email") if baseline_rfq else {}) or {},
        "suppliers": supplier_summaries,
        "comparison_matrix": unified_items,
        "alternative_items": alternative_items
    }


def export_comparison_to_excel(comparison_result):
    """
    Generates an Excel comparison report with baseline RFQ header,
    side-by-side columns per supplier, Lowest Price highlights, and condition badges.
    """
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Quotation Comparison"

    NAVY_DARK = "0F172A"
    WHITE = "FFFFFF"
    SUPPLIER_COLORS = ["1E3A8A", "065F46", "581C87", "9A3412", "155E75"]
    GREEN_LIGHT = "DCFCE7"
    GREEN_DARK = "166534"
    PURPLE_LIGHT = "F3E8FF"
    PURPLE_DARK = "6B21A8"
    AMBER_LIGHT = "FEF3C7"
    AMBER_DARK = "92400E"
    GRAY_BORDER = "CBD5E1"
    ROSE_LIGHT = "FFE4E6"
    ROSE_DARK = "9F1239"

    thin_border = Border(
        left=Side(style='thin', color=GRAY_BORDER),
        right=Side(style='thin', color=GRAY_BORDER),
        top=Side(style='thin', color=GRAY_BORDER),
        bottom=Side(style='thin', color=GRAY_BORDER)
    )

    # 1. Main Title
    ws.merge_cells('A1:J1')
    title_cell = ws['A1']
    title_cell.value = "AP MERIN SERVICES SDN BHD — QUOTATION COMPARISON REPORT"
    title_cell.font = Font(name="Calibri", size=14, bold=True, color=WHITE)
    title_cell.fill = PatternFill(start_color=NAVY_DARK, end_color=NAVY_DARK, fill_type="solid")
    title_cell.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 32

    # 2. Metadata / Baseline row
    target_curr = comparison_result.get("target_currency", "MYR")
    baseline = comparison_result.get("baseline_rfq", {})
    now_str = datetime.now().strftime("%d-%b-%Y %H:%M")
    
    meta_info = f"Generated: {now_str}  |  Base Currency: {target_curr}"
    if baseline.get("vessel_name"):
        meta_info += f"  |  Vessel: {baseline['vessel_name']}"
    if baseline.get("maker") or baseline.get("model"):
        meta_info += f"  |  Equipment: {baseline.get('maker', '')} {baseline.get('model', '')}"

    ws['A2'] = meta_info
    ws['A2'].font = Font(name="Calibri", size=10, italic=True, color="64748B")
    ws.row_dimensions[2].height = 20

    # 3. Setup Headers
    fixed_headers = ["#", "Part / Item No", "Description", "Req Qty", "Unit"]
    suppliers = comparison_result.get("suppliers", [])
    matrix = comparison_result.get("comparison_matrix", [])

    curr_col = 6
    ws.row_dimensions[4].height = 28
    ws.row_dimensions[5].height = 24

    for s_idx, s in enumerate(suppliers):
        s_name = s.get("supplier_name", f"Supplier {s_idx+1}")
        s_curr = s.get("currency_original", target_curr)
        comp_status = s.get("compliance_status", "")
        color = SUPPLIER_COLORS[s_idx % len(SUPPLIER_COLORS)]
        
        start_col_letter = get_column_letter(curr_col)
        end_col_letter = get_column_letter(curr_col + 3)
        ws.merge_cells(f"{start_col_letter}4:{end_col_letter}4")
        
        super_cell = ws[f"{start_col_letter}4"]
        super_cell.value = f"{s_name} ({s_curr}) — {comp_status}"
        super_cell.font = Font(name="Calibri", size=10, bold=True, color=WHITE)
        super_cell.fill = PatternFill(start_color=color, end_color=color, fill_type="solid")
        super_cell.alignment = Alignment(horizontal="center", vertical="center")

        sub_headers = [f"Unit Price ({target_curr})", f"Total ({target_curr})", "Lead Time", "Condition"]
        for sh_idx, sh in enumerate(sub_headers):
            c_letter = get_column_letter(curr_col + sh_idx)
            sub_cell = ws[f"{c_letter}5"]
            sub_cell.value = sh
            sub_cell.font = Font(name="Calibri", size=9, bold=True, color=WHITE)
            sub_cell.fill = PatternFill(start_color=color, end_color=color, fill_type="solid")
            sub_cell.alignment = Alignment(horizontal="center", vertical="center")
            sub_cell.border = thin_border

        curr_col += 4

    for idx, fh in enumerate(fixed_headers, 1):
        c_letter = get_column_letter(idx)
        cell = ws[f"{c_letter}5"]
        cell.value = fh
        cell.font = Font(name="Calibri", size=10, bold=True, color=WHITE)
        cell.fill = PatternFill(start_color="334155", end_color="334155", fill_type="solid")
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = thin_border

    # 4. Fill Matrix Rows
    start_data_row = 6
    for row_idx, item in enumerate(matrix, start_data_row):
        ws.row_dimensions[row_idx].height = 20
        ws[f"A{row_idx}"] = item.get("item_index", row_idx - 5)
        ws[f"B{row_idx}"] = item.get("part_no") or item.get("item_code", "")
        ws[f"C{row_idx}"] = item.get("description", "")
        ws[f"D{row_idx}"] = item.get("quantity", 1)
        ws[f"E{row_idx}"] = item.get("unit", "PCS")

        for col_i in range(1, 6):
            c_let = get_column_letter(col_i)
            ws[f"{c_let}{row_idx}"].border = thin_border
            ws[f"{c_let}{row_idx}"].font = Font(name="Calibri", size=9)
            if col_i in [1, 4, 5]:
                ws[f"{c_let}{row_idx}"].alignment = Alignment(horizontal="center", vertical="center")

        c_pos = 6
        lowest_s_idx = item.get("lowest_price_supplier")
        for s_idx, s in enumerate(suppliers):
            offers = item.get("supplier_offers", {})
            off = offers.get(s_idx) or offers.get(str(s_idx))

            c_unit = get_column_letter(c_pos)
            c_tot = get_column_letter(c_pos + 1)
            c_lead = get_column_letter(c_pos + 2)
            c_cond = get_column_letter(c_pos + 3)

            if off:
                u_p = float(off.get("unit_price_converted") or 0.0)
                t_p = float(off.get("total_price_converted") or 0.0)
                lead_t = off.get("lead_time", "TBA")
                cond = off.get("condition", "Unknown")

                ws[f"{c_unit}{row_idx}"] = u_p
                ws[f"{c_unit}{row_idx}"].number_format = '#,##0.00'
                ws[f"{c_tot}{row_idx}"] = t_p
                ws[f"{c_tot}{row_idx}"].number_format = '#,##0.00'
                ws[f"{c_lead}{row_idx}"] = lead_t
                ws[f"{c_cond}{row_idx}"] = cond

                if s_idx == lowest_s_idx and u_p > 0:
                    ws[f"{c_unit}{row_idx}"].fill = PatternFill(start_color=GREEN_LIGHT, end_color=GREEN_LIGHT, fill_type="solid")
                    ws[f"{c_unit}{row_idx}"].font = Font(name="Calibri", size=9, bold=True, color=GREEN_DARK)
                else:
                    ws[f"{c_unit}{row_idx}"].font = Font(name="Calibri", size=9)

                if cond == 'Original':
                    ws[f"{c_cond}{row_idx}"].fill = PatternFill(start_color=GREEN_LIGHT, end_color=GREEN_LIGHT, fill_type="solid")
                    ws[f"{c_cond}{row_idx}"].font = Font(name="Calibri", size=9, bold=True, color=GREEN_DARK)
                elif cond == 'OEM':
                    ws[f"{c_cond}{row_idx}"].fill = PatternFill(start_color=PURPLE_LIGHT, end_color=PURPLE_LIGHT, fill_type="solid")
                    ws[f"{c_cond}{row_idx}"].font = Font(name="Calibri", size=9, bold=True, color=PURPLE_DARK)
                elif cond == 'Replacement':
                    ws[f"{c_cond}{row_idx}"].fill = PatternFill(start_color=AMBER_LIGHT, end_color=AMBER_LIGHT, fill_type="solid")
                    ws[f"{c_cond}{row_idx}"].font = Font(name="Calibri", size=9, bold=True, color=AMBER_DARK)
                else:
                    ws[f"{c_cond}{row_idx}"].font = Font(name="Calibri", size=9)
            else:
                ws[f"{c_unit}{row_idx}"] = "Not Quoted"
                ws[f"{c_unit}{row_idx}"].font = Font(name="Calibri", size=9, italic=True, color="94A3B8")
                ws[f"{c_tot}{row_idx}"] = "-"
                ws[f"{c_lead}{row_idx}"] = "-"
                ws[f"{c_cond}{row_idx}"] = "-"

            for c_x in [c_unit, c_tot, c_lead, c_cond]:
                ws[f"{c_x}{row_idx}"].border = thin_border
                if c_x in [c_unit, c_tot, c_lead, c_cond]:
                    ws[f"{c_x}{row_idx}"].alignment = Alignment(horizontal="center", vertical="center")

            c_pos += 4

    # 5. Total Row
    summary_row = start_data_row + len(matrix) + 1
    ws.row_dimensions[summary_row].height = 24
    ws[f"C{summary_row}"] = "TOTAL QUOTED AMOUNT"
    ws[f"C{summary_row}"].font = Font(name="Calibri", size=10, bold=True)
    ws[f"C{summary_row}"].alignment = Alignment(horizontal="right", vertical="center")

    c_pos = 6
    for s_idx, s in enumerate(suppliers):
        c_tot = get_column_letter(c_pos + 1)
        tot_val = s.get("total_converted", 0.0)
        ws[f"{c_tot}{summary_row}"] = tot_val
        ws[f"{c_tot}{summary_row}"].number_format = '#,##0.00'
        ws[f"{c_tot}{summary_row}"].font = Font(name="Calibri", size=10, bold=True, color=WHITE)
        color = SUPPLIER_COLORS[s_idx % len(SUPPLIER_COLORS)]
        ws[f"{c_tot}{summary_row}"].fill = PatternFill(start_color=color, end_color=color, fill_type="solid")
        ws[f"{c_tot}{summary_row}"].border = thin_border
        c_pos += 4

    for col in ws.columns:
        max_len = 0
        col_letter = get_column_letter(col[0].column)
        for cell in col:
            val = str(cell.value or '')
            if cell.row in [1, 2, 4]:
                continue
            if len(val) > max_len:
                max_len = len(val)
        ws.column_dimensions[col_letter].width = max(max_len + 4, 11)
    
    ws.column_dimensions['C'].width = 36

    output = io.BytesIO()
    wb.save(output)
    output.seek(0)
    return output.getvalue()
