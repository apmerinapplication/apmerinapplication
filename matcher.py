import re
from difflib import SequenceMatcher

def normalize(text):
    if not text:
        return ""
    text = str(text).lower()
    text = re.sub(r'[\s\-_/\\,.:;()]+', '', text)
    return text.strip()

def token_similarity(s1, s2):
    if not s1 or not s2:
        return 0.0
    stopwords = {'the', 'for', 'and', 'in', 'of', 'to', 'a', 'an', 'with', 'set', 'pcs', 'pce', 'ea', 'no', 'part'}
    words1 = set(re.findall(r'[a-z0-9]+', str(s1).lower())) - stopwords
    words2 = set(re.findall(r'[a-z0-9]+', str(s2).lower())) - stopwords
    if not words1 or not words2:
        return 0.0
    inter = len(words1 & words2)
    union = len(words1 | words2)
    return inter / union if union > 0 else 0.0

def combined_text_similarity(s1, s2):
    if not s1 or not s2:
        return 0.0
    if str(s1).strip().lower() == str(s2).strip().lower():
        return 1.0
    tok = token_similarity(s1, s2)
    seq = SequenceMatcher(None, str(s1).lower().strip(), str(s2).lower().strip()).ratio()
    return 0.6 * tok + 0.4 * seq
def apply_price_rounding(amount, round_mode="none"):
    if not amount or amount == 0:
        return 0.0
    import math
    num = float(amount)
    if round_mode == 'round_1':
        return float(round(num))
    elif round_mode == 'ceil_1':
        return float(math.ceil(num))
    elif round_mode == 'floor_1':
        return float(math.floor(num))
    elif round_mode == 'round_5':
        return float(round(num / 5.0) * 5.0)
    elif round_mode == 'ceil_5':
        return float(math.ceil(num / 5.0) * 5.0)
    elif round_mode == 'round_10':
        return float(round(num / 10.0) * 10.0)
    elif round_mode == 'ceil_10':
        return float(math.ceil(num / 10.0) * 10.0)
    elif round_mode == 'round_50c':
        return float(round(num * 2.0) / 2.0)
    else:
        return round(num, 2)

def match_rfq_and_quotation(rfq_items, quote_items, fx_rate=1.0, markup_percent=25.0, supplier_currency="MYR", target_currency="MYR", mode="quotation", round_mode="none"):
    """
    Intelligently matches client RFQ / PO items with supplier Quotation items.
    
    Strict Rules:
    1. Strictly follows the number of items and item names from the RFQ when RFQ items are present.
    2. Identifies matching items across supplier quote, including OEM and replacement parts (#OFFER).
    3. Never appends extraneous unmatched supplier items to the client RFQ grid.
    """
    matched_results = []
    
    # Standalone mode: If no RFQ items were provided at all, supplier quote items form the grid
    if not rfq_items:
        for q_idx, quote in enumerate(quote_items):
            unit_cost = float(quote.get('unit_price', 0.0))
            cost_target = unit_cost * fx_rate
            row_markup = markup_percent if mode != "po" else 0.0
            raw_price = cost_target * (1.0 + row_markup / 100.0) if unit_cost > 0 else 0.0
            price_target = apply_price_rounding(raw_price, round_mode)
            item_code = quote.get('item_code') or quote.get('part_no') or f"ITEM-{q_idx+1}"
            desc = quote.get('description', '')
            q_remarks = str(quote.get('remarks', '')).strip()

            clean_q_desc = re.sub(r'^(?:#?OFFER\s*[:\-]?\s*)+', '', desc, flags=re.IGNORECASE).strip()
            extra_q_rem = f"- ({q_remarks.lstrip('-').strip()})" if q_remarks and q_remarks.lower() not in clean_q_desc.lower() else ""
            show_q_rem = bool(extra_q_rem)
            final_q_desc = f"{clean_q_desc}\n\n{extra_q_rem}".strip() if (show_q_rem and extra_q_rem) else clean_q_desc

            unit = quote.get('unit') or 'PCS'
            if unit.upper() in ['ST', 'SET', 'SETS']:
                unit = 'SET'
            elif unit.upper() in ['PC', 'PCS', 'PCE', 'PIECE', 'PIECES']:
                unit = 'PCS'
            else:
                unit = unit.upper()

            raw_identifiers = {
                'auto': item_code,
                'part_no': str(quote.get('part_no', '') or item_code).strip(),
                'item_code': str(quote.get('item_code', '') or item_code).strip(),
                'maker_no': str(quote.get('maker_no', '') or quote.get('part_no', '') or item_code).strip(),
                'impa_code': str(quote.get('impa_code', '') or quote.get('part_no', '') or item_code).strip(),
                'ref_no': str(quote.get('ref_no', '') or f"ITEM-{q_idx+1}").strip()
            }

            matched_results.append({
                'row_id': q_idx + 1,
                'item_code': item_code,
                'part_no': raw_identifiers['part_no'],
                'maker_no': raw_identifiers['maker_no'],
                'impa_code': raw_identifiers['impa_code'],
                'ref_no': raw_identifiers['ref_no'],
                'raw_identifiers': raw_identifiers,
                'supplier_part': str(quote.get('part_no', '') or quote.get('item_code', '')).strip(),
                'client_description': '',
                'clean_description': clean_q_desc,
                'extra_remarks': extra_q_rem,
                'show_remarks': show_q_rem,
                'description': final_q_desc,
                'is_offer': False,
                'offer_text': '',
                'quantity': float(quote.get('quantity', 1)),
                'unit': unit,
                'supplier_currency': supplier_currency,
                'target_currency': target_currency,
                'list_unit_price': float(quote.get('list_unit_price', 0.0)) or unit_cost,
                'discount_percent': float(quote.get('discount_percent', 0.0)),
                'has_supplier_discount': float(quote.get('discount_percent', 0.0)) > 0,
                'supplier_cost': unit_cost,
                'cost_target': cost_target,
                'cost_myr': cost_target,
                'fx_rate': fx_rate,
                'adjustment_type': 'percent',
                'markup_percent': row_markup,
                'markup_amount': round(price_target - cost_target, 2),
                'round_mode': round_mode,
                'raw_price': raw_price,
                'price_target': price_target,
                'price_myr': price_target,
                'formatted_price': f"{price_target:.2f}",
                'matched_quote': quote,
                'match_type': "standalone_supplier_item",
                'is_custom_price': False,
                'mode': mode
            })
        return matched_results

    def is_generic_code(c):
        return not c or bool(re.match(r'^(item-?\d+|\d|none|null|na|unknown|part|parts|pcs|pce|set)$', str(c).strip(), re.IGNORECASE))

    # Pre-extract structured data for RFQ items
    rfq_data = []
    for rfq_idx, rfq in enumerate(rfq_items):
        r_code = str(rfq.get('item_code', '')).strip()
        r_part = str(rfq.get('part_no', '')).strip()
        r_desc = str(rfq.get('description', '')).strip()
        r_rem = str(rfq.get('remarks', '')).strip()
        r_maker = str(rfq.get('maker_no', '')).strip()
        r_impa = str(rfq.get('impa_code', '')).strip()
        r_ref = str(rfq.get('ref_no', '')).strip()

        # Check for nested Part Number in description or remarks
        r_ext_part = ""
        m_rfq_p = re.search(r'(?:Part\s*(?:Number|No|#)|P/N)\s*[:=\s]*([A-Za-z0-9\-\./]+)', f"{r_desc} {r_rem}", re.IGNORECASE)
        if m_rfq_p:
            cand = m_rfq_p.group(1).strip()
            if len(cand) >= 3 and cand.lower() not in ['none', 'null', 'part', 'parts']:
                r_ext_part = cand

        effective_part = r_part or r_ext_part
        candidate_codes = [normalize(c) for c in [r_code, effective_part, r_maker, r_impa, r_ref] if c and len(c) >= 3 and not is_generic_code(c)]

        rfq_data.append({
            'idx': rfq_idx,
            'rfq': rfq,
            'code': r_code,
            'part': effective_part,
            'desc': r_desc,
            'rem': r_rem,
            'maker': r_maker,
            'impa': r_impa,
            'ref': r_ref,
            'candidate_codes': set(candidate_codes)
        })

    # Pre-extract structured data for Quote items
    q_data = []
    for q_idx, quote in enumerate(quote_items):
        q_code = str(quote.get('item_code', '')).strip()
        q_part = str(quote.get('part_no', '')).strip()
        q_desc = str(quote.get('description', '')).strip()
        q_rem = str(quote.get('remarks', '')).strip()
        q_maker = str(quote.get('maker_no', '')).strip()
        q_impa = str(quote.get('impa_code', '')).strip()
        q_ref = str(quote.get('ref_no', '')).strip()

        q_ext_part = ""
        m_q_p = re.search(r'(?:Part\s*(?:Number|No|#)|P/N)\s*[:=\s]*([A-Za-z0-9\-\./]+)', f"{q_desc} {q_rem}", re.IGNORECASE)
        if m_q_p:
            cand = m_q_p.group(1).strip()
            if len(cand) >= 3 and cand.lower() not in ['none', 'null', 'part', 'parts']:
                q_ext_part = cand

        effective_q_part = q_part or q_ext_part
        candidate_codes = [normalize(c) for c in [q_code, effective_q_part, q_maker, q_impa, q_ref] if c and len(c) >= 3 and not is_generic_code(c)]

        has_offer_kw = bool(quote.get('is_offer', False)) or any(kw in f"{q_desc} {q_rem}".upper() for kw in [
            '#OFFER', 'OFFER:', 'OFFER ', 'ALT:', 'ALT.', 'ALTERNATIVE',
            'REPLACEMENT', 'AFTERMARKET', 'NON-GENUINE', 'EQUIVALENT', 'SUBSTITUTE',
            'OEM SPEC', 'OEM SPECIFICATION', 'OEM PART', 'OEM QUALITY', 'REPLACED BY', '(= '
        ])

        q_data.append({
            'idx': q_idx,
            'quote': quote,
            'code': q_code,
            'part': effective_q_part,
            'desc': q_desc,
            'rem': q_rem,
            'maker': q_maker,
            'impa': q_impa,
            'ref': q_ref,
            'candidate_codes': set(candidate_codes),
            'has_offer_kw': has_offer_kw
        })

    # Candidate matches: list of tuples (score, rfq_idx, q_idx, match_type, is_offer, offer_text)
    candidates = []

    for rd in rfq_data:
        r_idx = rd['idx']
        r_part_norm = normalize(rd['part'])
        r_code_norm = normalize(rd['code'])

        for qd in q_data:
            q_idx = qd['idx']
            q_part_norm = normalize(qd['part'])
            q_code_norm = normalize(qd['code'])

            # 1. Exact Part Number / Code Intersection
            common_codes = rd['candidate_codes'] & qd['candidate_codes']
            if common_codes:
                is_off = qd['has_offer_kw']
                off_text = f"{qd['part']} {qd['desc']}".strip() if is_off else ""
                candidates.append((1.0, r_idx, q_idx, "exact_code", is_off, off_text))
                continue

            # 2. Substring or Cross-Reference Matching (Replacement / OEM)
            cross_ref_match = False
            for rc in rd['candidate_codes']:
                if len(rc) >= 5:
                    for qc in qd['candidate_codes']:
                        if len(qc) >= 5 and (rc in qc or qc in rc):
                            cross_ref_match = True
                            break
                    if cross_ref_match:
                        break
                    # Also check if quote description/remarks mentions client's part number
                    if rc in normalize(qd['desc']) or rc in normalize(qd['rem']):
                        cross_ref_match = True
                        break

            if cross_ref_match:
                codes_differ = bool(r_part_norm and q_part_norm and r_part_norm != q_part_norm and r_part_norm not in q_part_norm and q_part_norm not in r_part_norm)
                is_off = qd['has_offer_kw'] or codes_differ
                off_text = f"{qd['part']} {qd['desc']}".strip() if is_off else ""
                candidates.append((0.92, r_idx, q_idx, "replacement_code", is_off, off_text))
                continue

            # 3. Description Similarity
            sim = combined_text_similarity(rd['desc'], qd['desc'])

            # Position alignment tie-breaker: only if similarity is already substantial
            pos_bonus = 0.05 if (rd['rfq'].get('item_no') == qd['quote'].get('item_no') and sim >= 0.60) else 0.0

            if qd['has_offer_kw'] and sim >= 0.45:
                # Replacement / OEM part offered with matching description
                off_text = f"{qd['part']} {qd['desc']}".strip()
                score = min(0.90, 0.75 + (sim * 0.15) + pos_bonus)
                candidates.append((score, r_idx, q_idx, "replacement_desc", True, off_text))
            elif sim >= 0.65:
                # Strong description match
                codes_differ = bool(r_part_norm and q_part_norm and r_part_norm != q_part_norm)
                is_off = qd['has_offer_kw'] or codes_differ
                off_text = f"{qd['part']} {qd['desc']}".strip() if is_off else ""
                score = min(0.88, sim + pos_bonus)
                candidates.append((score, r_idx, q_idx, "desc_similarity", is_off, off_text))

    # Sort candidates by score descending for global highest-confidence assignment
    candidates.sort(key=lambda x: x[0], reverse=True)

    assigned_rfq = {}
    used_quote_indices = set()

    for score, r_idx, q_idx, m_type, is_off, off_text in candidates:
        if r_idx in assigned_rfq:
            continue
        if q_idx in used_quote_indices:
            continue
        assigned_rfq[r_idx] = (score, q_idx, m_type, is_off, off_text)
        used_quote_indices.add(q_idx)

    # Build final rows STRICTLY following the RFQ items list
    for rfq_idx, rd in enumerate(rfq_data):
        rfq = rd['rfq']
        rfq_desc = rd['desc']
        rfq_code = rd['code']
        rfq_part = rd['part']
        rfq_maker = rd['maker']
        rfq_impa = rd['impa']
        rfq_ref = rd['ref']

        match_info = assigned_rfq.get(rfq_idx)
        quote_match = None
        unit_cost = 0.0
        list_unit_price = 0.0
        discount_percent = 0.0
        has_supplier_discount = False
        supplier_part = ""
        supplier_desc = ""
        supplier_remarks = ""
        is_offer = False
        offer_text = ""
        match_type = "unmatched"

        if match_info:
            score, q_idx, match_type, is_offer, offer_text = match_info
            quote_match = quote_items[q_idx]
            unit_cost = float(quote_match.get('unit_price', 0.0))
            list_unit_price = float(quote_match.get('list_unit_price', 0.0)) or unit_cost
            discount_percent = float(quote_match.get('discount_percent', 0.0))
            has_supplier_discount = discount_percent > 0
            supplier_part = str(quote_match.get('part_no', '') or quote_match.get('item_code', '')).strip()
            supplier_desc = quote_match.get('description', '')
            supplier_remarks = quote_match.get('remarks', '')

            # Check explicit offer text if not already populated
            if is_offer and not offer_text:
                offer_text = quote_match.get('offer_text', '') or f"{supplier_part} {supplier_desc}".strip()
                offer_text = re.sub(r'^(?:#?OFFER\s*[:\-]?\s*)+', '', offer_text, flags=re.IGNORECASE).strip()

        # Item code determination: Strictly prioritize RFQ item code / part number
        if rfq_code and not is_generic_code(rfq_code):
            item_code = rfq_code
        elif rfq_part and not is_generic_code(rfq_part):
            item_code = rfq_part
        elif supplier_part and not is_generic_code(supplier_part):
            item_code = supplier_part
        else:
            item_code = ""

        # Description: In quotation mode, STRICTLY preserve the RFQ description requested by the client!
        if mode == "po":
            raw_base = supplier_desc.strip() if supplier_desc else rfq_desc.strip()
        else:
            raw_base = rfq_desc.strip()

        clean_desc = re.sub(r'^(?:#?OFFER\s*[:\-]?\s*)+', '', raw_base, flags=re.IGNORECASE).strip()

        # Build structured extra remarks sub-block
        remarks_parts = []

        # 1. Offer tag and alternative offer specifications
        if is_offer:
            offer_clean = offer_text.strip() if offer_text else (f"{supplier_part} {supplier_desc}".strip() if quote_match else "")
            offer_clean = re.sub(r'^(?:#?OFFER\s*[:\-]?\s*)+', '', offer_clean, flags=re.IGNORECASE).strip()
            if offer_clean and offer_clean.lower() != clean_desc.lower():
                remarks_parts.append(f"#OFFER\n{offer_clean}")
            else:
                remarks_parts.append("#OFFER")

        # 2. Maker Name & Model (if available and not already in clean title)
        maker_str = str(rfq_maker or (quote_match and quote_match.get('maker_no', '')) or '').strip()
        if maker_str and not is_generic_code(maker_str):
            if maker_str.lower() not in clean_desc.lower():
                remarks_parts.append(f"Maker: {maker_str}")

        # 3. Item remarks like "- INCLUDED IN ITEM NO.4" or technical notes
        if quote_match:
            combined_text = f"{supplier_desc} {supplier_remarks}"
            included_match = re.search(r'(-\s*INCLUDED\s+IN\s+ITEM\s*(?:NO\.?)?\s*\d+|INCLUDED\s+IN\s+ITEM\s*(?:NO\.?)?\s*\d+|INCLUDED\s+IN\s+SET)', combined_text, re.IGNORECASE)
            if included_match:
                remark_text = included_match.group(1).lstrip('-').strip()
                if remark_text.lower() not in clean_desc.lower() and not any(remark_text.lower() in p.lower() for p in remarks_parts):
                    remarks_parts.append(f"- ({remark_text})")
            elif supplier_remarks and supplier_remarks.lower() not in clean_desc.lower() and len(supplier_remarks) <= 120:
                s_rem = supplier_remarks.lstrip('-').strip()
                if not any(s_rem.lower() in p.lower() for p in remarks_parts):
                    remarks_parts.append(f"- ({s_rem})")

        # 4. RFQ remarks if present
        rfq_notes = str(rfq.get('remarks', '')).strip()
        if rfq_notes and rfq_notes.lower() not in clean_desc.lower() and len(rfq_notes) <= 120:
            if not any(rfq_notes.lower() in p.lower() for p in remarks_parts):
                remarks_parts.append(rfq_notes)

        extra_remarks = "\n\n".join(remarks_parts).strip()
        show_remarks = bool(extra_remarks)
        final_description = f"{clean_desc}\n\n{extra_remarks}".strip() if (show_remarks and extra_remarks) else clean_desc

        qty = float(rfq.get('quantity', 1))
        unit = rfq.get('unit') or 'PCS'
        if unit.upper() in ['ST', 'SET', 'SETS']:
            unit = 'SET'
        elif unit.upper() in ['PC', 'PCS', 'PCE', 'PIECE', 'PIECES']:
            unit = 'PCS'
        elif unit.upper() in ['EA', 'EACH']:
            unit = 'EA'
        else:
            unit = unit.upper()

        cost_target = unit_cost * fx_rate
        if mode == "po":
            row_markup = 0.0 if markup_percent == 25.0 else markup_percent
            raw_price = cost_target * (1.0 + row_markup / 100.0) if unit_cost > 0 else 0.0
            price_target = apply_price_rounding(raw_price, round_mode)
        else:
            row_markup = markup_percent
            raw_price = cost_target * (1.0 + row_markup / 100.0) if unit_cost > 0 else 0.0
            price_target = apply_price_rounding(raw_price, round_mode)

        part_no_val = str(rfq_part or (quote_match and (quote_match.get('part_no', '') or quote_match.get('item_code', ''))) or '').strip()
        item_code_val = str(rfq_code or (quote_match and (quote_match.get('item_code', '') or quote_match.get('part_no', ''))) or '').strip()
        maker_no_val = str(rfq_maker or (quote_match and quote_match.get('maker_no', '')) or '').strip()
        impa_code_val = str(rfq_impa or (quote_match and quote_match.get('impa_code', '')) or '').strip()
        ref_no_val = str(rfq_ref or (quote_match and quote_match.get('ref_no', '')) or '').strip()

        raw_identifiers = {
            'auto': item_code,
            'part_no': part_no_val or item_code,
            'item_code': item_code_val or item_code,
            'maker_no': maker_no_val or part_no_val or item_code,
            'impa_code': impa_code_val or part_no_val or item_code,
            'ref_no': ref_no_val or str(rfq_idx + 1)
        }

        matched_results.append({
            'row_id': rfq_idx + 1,
            'item_code': item_code,
            'part_no': part_no_val,
            'maker_no': maker_no_val,
            'impa_code': impa_code_val,
            'ref_no': ref_no_val,
            'raw_identifiers': raw_identifiers,
            'supplier_part': supplier_part,
            'client_description': rfq_desc,
            'clean_description': clean_desc,
            'extra_remarks': extra_remarks,
            'show_remarks': show_remarks,
            'description': final_description,
            'is_offer': is_offer,
            'offer_text': offer_text,
            'quantity': qty,
            'unit': unit,
            'supplier_currency': supplier_currency,
            'target_currency': target_currency,
            'list_unit_price': list_unit_price,
            'discount_percent': discount_percent,
            'has_supplier_discount': has_supplier_discount,
            'supplier_cost': unit_cost,
            'cost_target': cost_target,
            'cost_myr': cost_target,
            'fx_rate': fx_rate,
            'adjustment_type': 'percent',
            'markup_percent': row_markup,
            'markup_amount': round(price_target - cost_target, 2),
            'round_mode': round_mode,
            'raw_price': raw_price,
            'price_target': price_target,
            'price_myr': price_target,
            'formatted_price': f"{price_target:.2f}",
            'matched_quote': quote_match,
            'match_type': match_type,
            'is_custom_price': False,
            'mode': mode
        })

    return matched_results

def recalculate_prices(items, fx_rate=1.0, global_markup=None, target_currency="MYR", mode="quotation", round_mode="none", global_adjustment_type="percent", global_markup_amount=None):
    """
    Recalculates prices dynamically when FX rate, Markup %/Price, Target Currency, or Round Mode is updated.
    Supports both percentage adjustments and fixed price adjustments (markup/discount).
    """
    for item in items:
        supplier_cost = float(item.get('supplier_cost', 0.0))
        cost_target = supplier_cost * fx_rate
        
        # Apply global adjustment if specified and item is not custom
        if not item.get('is_custom_price', False):
            if global_adjustment_type == "price" and global_markup_amount is not None:
                item['adjustment_type'] = 'price'
                item['markup_amount'] = float(global_markup_amount)
            elif global_markup is not None:
                item['adjustment_type'] = 'percent'
                item['markup_percent'] = float(global_markup)
                
        adj_type = item.get('adjustment_type', 'percent')
        
        if adj_type == 'price':
            markup_amount = float(item.get('markup_amount', 0.0))
            raw_price = cost_target + markup_amount
            price_target = apply_price_rounding(raw_price, round_mode)
            markup_percent = round(((raw_price / cost_target) - 1.0) * 100.0, 2) if cost_target > 0 else 0.0
        else:
            markup_percent = float(item.get('markup_percent', 0.0 if mode == "po" else 25.0))
            raw_price = cost_target * (1.0 + markup_percent / 100.0)
            price_target = apply_price_rounding(raw_price, round_mode)
            markup_amount = raw_price - cost_target
            
        item['fx_rate'] = fx_rate
        item['cost_target'] = cost_target
        item['cost_myr'] = cost_target
        item['adjustment_type'] = adj_type
        item['markup_percent'] = round(markup_percent, 2)
        item['markup_amount'] = round(markup_amount, 2)
        item['round_mode'] = round_mode
        item['raw_price'] = raw_price
        item['price_target'] = price_target
        item['price_myr'] = price_target
        item['target_currency'] = target_currency
        item['formatted_price'] = f"{price_target:.2f}"
        item['mode'] = mode
        
    return items

def generate_accounting_tsv(items, target_currency="MYR", mode="quotation", format_mode="biztory_single"):
    """
    Generates Tab-Separated Values (TSV) for direct paste into cloud accounting software.
    Format: Item Code \t Description \t Quantity \t Unit \t Price / Cost
    format_mode options:
      - 'biztory_single': Converts newlines into ' // ' so descriptions remain strictly on 1 line per item, preventing Biztory row breakage.
      - 'biztory_soft': Replaces newlines with Unicode line separator '\\u2028', rendering line breaks in browsers without splitting TSV rows.
      - 'tsv_multiline': Quotes cells containing newlines using standard RFC 4180 format for Excel/Xero.
      - 'clean_only': Uses clean product titles only without any remarks.
    """
    lines = []
    for item in items:
        item_code = (item.get('item_code') or '').strip()
        quantity = item.get('quantity', 1)
        unit = (item.get('unit') or 'PCS').strip().upper()
        
        raw_price = item.get('price_target', item.get('price_myr', 0.0))
        clean_price = float(str(raw_price).replace(',', '')) if raw_price else 0.0
        price_str = f"{clean_price:.2f}"
        
        raw_desc = (item.get('description') or '').strip()
        
        if format_mode == "clean_only":
            desc = (item.get('clean_description') or raw_desc).strip()
            desc = re.sub(r'[\r\n]+', ' ', desc).strip()
            desc = desc.replace('\t', ' ')
        elif format_mode == "biztory_soft":
            desc = re.sub(r'\r\n|\r|\n', '\u2028', raw_desc)
            desc = desc.replace('\t', ' ')
        elif format_mode == "tsv_multiline":
            desc = raw_desc
            if any(c in desc for c in ['\n', '\r', '\t', '"']):
                escaped_desc = desc.replace('"', '""')
                desc = f'"{escaped_desc}"'
        else: # Default: 'biztory_single' (safest for Biztory)
            desc = re.sub(r'[\r\n]+', ' // ', raw_desc).strip()
            desc = re.sub(r'\s{2,}', ' ', desc)
            desc = desc.replace('\t', ' ')
            
        line = f"{item_code}\t{desc}\t{quantity}\t{unit}\t{price_str}"
        lines.append(line)
        
    return "\r\n".join(lines)
