/**
 * AP Merin Services - In-Browser Intelligent Procurement Matcher
 * 100% equivalent to Python matcher.py, running directly in JavaScript on Netlify.
 */

function normalizeText(text) {
  if (!text) return "";
  return String(text).toLowerCase().replace(/[\s\-_/\\,.:;()]+/g, '').trim();
}

/**
 * Calculates string similarity ratio between 0.0 and 1.0 (Levenshtein-based)
 */
function stringSimilarity(s1, s2) {
  if (!s1 || !s2) return 0.0;
  const a = String(s1).toLowerCase().trim();
  const b = String(s2).toLowerCase().trim();
  if (a === b) return 1.0;
  if (a.length === 0 || b.length === 0) return 0.0;

  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  const distance = matrix[b.length][a.length];
  const maxLen = Math.max(a.length, b.length);
  return 1.0 - (distance / maxLen);
}

function tokenSimilarity(s1, s2) {
  if (!s1 || !s2) return 0.0;
  const stopwords = new Set(['the', 'for', 'and', 'in', 'of', 'to', 'a', 'an', 'with', 'set', 'pcs', 'pce', 'ea', 'no', 'part']);
  const getTokens = (str) => {
    const matches = String(str).toLowerCase().match(/[a-z0-9]+/g);
    if (!matches) return new Set();
    return new Set(matches.filter(w => !stopwords.has(w)));
  };
  const set1 = getTokens(s1);
  const set2 = getTokens(s2);
  if (set1.size === 0 || set2.size === 0) return 0.0;
  let inter = 0;
  set1.forEach(w => {
    if (set2.has(w)) inter++;
  });
  const union = new Set([...set1, ...set2]).size;
  return union > 0 ? inter / union : 0.0;
}

function combinedStringSimilarity(s1, s2) {
  if (!s1 || !s2) return 0.0;
  if (String(s1).trim().toLowerCase() === String(s2).trim().toLowerCase()) return 1.0;
  const tokSim = tokenSimilarity(s1, s2);
  const seqSim = stringSimilarity(s1, s2);
  return 0.6 * tokSim + 0.4 * seqSim;
}

function applyPriceRounding(amount, roundMode = "none") {
  if (isNaN(amount) || amount === 0) return 0.0;
  const num = Number(amount);

  switch (roundMode) {
    case 'round_1': // Round to nearest 1.00
      return Math.round(num);
    case 'ceil_1': // Round UP to next 1.00
      return Math.ceil(num);
    case 'floor_1': // Round DOWN to whole 1.00
      return Math.floor(num);
    case 'round_5': // Round to nearest 5.00
      return Math.round(num / 5.0) * 5.0;
    case 'ceil_5': // Round UP to next 5.00
      return Math.ceil(num / 5.0) * 5.0;
    case 'round_10': // Round to nearest 10.00
      return Math.round(num / 10.0) * 10.0;
    case 'ceil_10': // Round UP to next 10.00
      return Math.ceil(num / 10.0) * 10.0;
    case 'round_50c': // Round to nearest 0.50
      return Math.round(num * 2.0) / 2.0;
    case 'none':
    default:
      return parseFloat(num.toFixed(2));
  }
}

/**
 * Matches Client RFQ / PO items against Supplier Quotation items.
 * Strictly adheres to RFQ items count and client product descriptions.
 * Detects replacement and OEM parts and marks them as #OFFER.
 */
function matchRfqAndQuotation(rfqItems, quoteItems, fxRate = 1.0, markupPercent = 25.0, supplierCurrency = "MYR", targetCurrency = "MYR", mode = "quotation", roundMode = "none") {
  const matchedResults = [];

  // Standalone mode: If no RFQ items were provided at all, supplier quote items form the grid
  if (!rfqItems || rfqItems.length === 0) {
    (quoteItems || []).forEach((quote, qIdx) => {
      const unitCost = parseFloat(quote.unit_price) || 0.0;
      const costTarget = unitCost * fxRate;
      const rowMarkup = (mode === "po") ? 0.0 : markupPercent;
      const rawPrice = costTarget * (1.0 + rowMarkup / 100.0);
      const priceTarget = applyPriceRounding(rawPrice, roundMode);
      const itemCode = quote.item_code || quote.part_no || `ITEM-${qIdx + 1}`;
      const desc = quote.description || '';
      const qRemarks = String(quote.remarks || '').trim();

      const cleanQDesc = desc.replace(/^(?:#?OFFER\s*[:\-]?\s*)+/i, '').trim();
      const extraQRem = (qRemarks && !cleanQDesc.toLowerCase().includes(qRemarks.toLowerCase())) ? `- (${qRemarks.replace(/^-\s*/, '').trim()})` : '';
      const showQRem = Boolean(extraQRem);
      const finalQDesc = (showQRem && extraQRem) ? `${cleanQDesc}\n\n${extraQRem}`.trim() : cleanQDesc;

      let unit = (quote.unit || 'PCS').toUpperCase();
      if (['ST', 'SET', 'SETS'].includes(unit)) unit = 'SET';
      else if (['PC', 'PCS', 'PCE', 'PIECE', 'PIECES'].includes(unit)) unit = 'PCS';

      const rawIdentifiers = {
        'auto': itemCode,
        'part_no': quote.part_no || quote.item_code || itemCode,
        'item_code': quote.item_code || quote.part_no || itemCode,
        'maker_no': quote.maker_no || quote.part_no || itemCode,
        'impa_code': quote.impa_code || quote.part_no || itemCode,
        'ref_no': quote.ref_no || String(qIdx + 1)
      };

      matchedResults.push({
        row_id: qIdx + 1,
        item_code: itemCode,
        part_no: quote.part_no || quote.item_code || itemCode,
        maker_no: quote.maker_no || "",
        impa_code: quote.impa_code || "",
        ref_no: quote.ref_no || "",
        raw_identifiers: rawIdentifiers,
        supplier_part: quote.part_no || quote.item_code || "",
        client_description: "",
        clean_description: cleanQDesc,
        extra_remarks: extraQRem,
        show_remarks: showQRem,
        description: finalQDesc,
        is_offer: Boolean(quote.is_offer),
        offer_text: quote.offer_text || "",
        quantity: parseFloat(quote.quantity) || 1,
        unit: unit,
        supplier_currency: supplierCurrency,
        target_currency: targetCurrency,
        list_unit_price: parseFloat(quote.list_unit_price) || unitCost,
        discount_percent: parseFloat(quote.discount_percent) || 0.0,
        has_supplier_discount: (parseFloat(quote.discount_percent) || 0.0) > 0,
        supplier_cost: unitCost,
        cost_target: costTarget,
        cost_myr: costTarget,
        fx_rate: fxRate,
        adjustment_type: 'percent',
        markup_percent: rowMarkup,
        markup_amount: Math.round((priceTarget - costTarget) * 100) / 100,
        round_mode: roundMode,
        raw_price: rawPrice,
        price_target: priceTarget,
        price_myr: priceTarget,
        formatted_price: priceTarget.toFixed(2),
        matched_quote: quote,
        match_type: "standalone_supplier_item",
        is_custom_price: false,
        mode: mode
      });
    });
    return matchedResults;
  }

  const isGenericCode = (c) => !c || /^(item-?\d+|\d|none|null|na|unknown|part|parts|pcs|pce|set)$/i.test(String(c).trim());

  // Pre-extract candidate codes for RFQ items
  const rfqData = rfqItems.map((rfq, rfqIdx) => {
    const rfqCode = String(rfq.item_code || '').trim();
    const rfqPart = String(rfq.part_no || '').trim();
    const rfqDesc = String(rfq.description || '').trim();
    const rfqRemarks = String(rfq.remarks || '').trim();
    const rfqMaker = String(rfq.maker_no || '').trim();
    const rfqImpa = String(rfq.impa_code || '').trim();
    const rfqRef = String(rfq.ref_no || '').trim();

    let rfqExtractedPart = "";
    const mRfqPart = `${rfqDesc} ${rfqRemarks}`.match(/(?:Part\s*(?:Number|No|#)|P\/N)\s*[:=\s]*([A-Za-z0-9\-\./]+)/i);
    if (mRfqPart && mRfqPart[1]) {
      const cand = mRfqPart[1].trim();
      if (cand.length >= 3 && !/^(none|null|parts?)$/i.test(cand)) {
        rfqExtractedPart = cand;
      }
    }

    const effectivePart = rfqPart || rfqExtractedPart;
    const candidateCodes = [
      normalizeText(rfqCode),
      normalizeText(effectivePart),
      normalizeText(rfqMaker),
      normalizeText(rfqImpa),
      normalizeText(rfqRef)
    ].filter(c => c && c.length >= 3 && !isGenericCode(c));

    return {
      idx: rfqIdx,
      rfq,
      code: rfqCode,
      part: effectivePart,
      desc: rfqDesc,
      rem: rfqRemarks,
      maker: rfqMaker,
      impa: rfqImpa,
      ref: rfqRef,
      candidateCodes: new Set(candidateCodes)
    };
  });

  // Pre-extract candidate codes for Quote items
  const qData = (quoteItems || []).map((quote, qIdx) => {
    const qCode = String(quote.item_code || '').trim();
    const qPart = String(quote.part_no || '').trim();
    const qDesc = String(quote.description || '').trim();
    const qRemarks = String(quote.remarks || '').trim();
    const qMaker = String(quote.maker_no || '').trim();
    const qImpa = String(quote.impa_code || '').trim();
    const qRef = String(quote.ref_no || '').trim();

    let qExtractedPart = "";
    const mQPart = `${qDesc} ${qRemarks}`.match(/(?:Part\s*(?:Number|No|#)|P\/N)\s*[:=\s]*([A-Za-z0-9\-\./]+)/i);
    if (mQPart && mQPart[1]) {
      const qCand = mQPart[1].trim();
      if (qCand.length >= 3 && !/^(none|null|parts?)$/i.test(qCand)) {
        qExtractedPart = qCand;
      }
    }

    const effectiveQPart = qPart || qExtractedPart;
    const candidateCodes = [
      normalizeText(qCode),
      normalizeText(effectiveQPart),
      normalizeText(qMaker),
      normalizeText(qImpa),
      normalizeText(qRef)
    ].filter(c => c && c.length >= 3 && !isGenericCode(c));

    const combinedQText = `${qDesc} ${qRemarks}`.toUpperCase();
    const hasOfferKw = Boolean(quote.is_offer) || [
      '#OFFER', 'OFFER:', 'OFFER ', 'ALT:', 'ALT.', 'ALTERNATIVE',
      'REPLACEMENT', 'AFTERMARKET', 'NON-GENUINE', 'EQUIVALENT', 'SUBSTITUTE',
      'OEM SPEC', 'OEM SPECIFICATION', 'OEM PART', 'OEM QUALITY', 'REPLACED BY', '(='
    ].some(kw => combinedQText.includes(kw));

    return {
      idx: qIdx,
      quote,
      code: qCode,
      part: effectiveQPart,
      desc: qDesc,
      rem: qRemarks,
      maker: qMaker,
      impa: qImpa,
      ref: qRef,
      candidateCodes: new Set(candidateCodes),
      hasOfferKw
    };
  });

  const candidates = [];

  rfqData.forEach(rd => {
    const rIdx = rd.idx;
    const rPartNorm = normalizeText(rd.part);

    qData.forEach(qd => {
      const qIdx = qd.idx;
      const qPartNorm = normalizeText(qd.part);

      // 1. Exact Part Number / Code Intersection
      let hasCommonCode = false;
      for (const rc of rd.candidateCodes) {
        if (qd.candidateCodes.has(rc)) {
          hasCommonCode = true;
          break;
        }
      }

      if (hasCommonCode) {
        const isOff = qd.hasOfferKw;
        const offText = isOff ? `${qd.part} ${qd.desc}`.trim() : "";
        candidates.push({ score: 1.0, rIdx, qIdx, mType: "exact_code", isOff, offText });
        return;
      }

      // 2. Substring or Cross-Reference Matching (Replacement / OEM)
      let crossRefMatch = false;
      for (const rc of rd.candidateCodes) {
        if (rc.length >= 5) {
          for (const qc of qd.candidateCodes) {
            if (qc.length >= 5 && (rc.includes(qc) || qc.includes(rc))) {
              crossRefMatch = true;
              break;
            }
          }
          if (crossRefMatch) break;
          const normQDesc = normalizeText(qd.desc);
          const normQRem = normalizeText(qd.rem);
          if (normQDesc.includes(rc) || normQRem.includes(rc)) {
            crossRefMatch = true;
            break;
          }
        }
      }

      if (crossRefMatch) {
        const codesDiffer = Boolean(rPartNorm && qPartNorm && rPartNorm !== qPartNorm && !qPartNorm.includes(rPartNorm) && !rPartNorm.includes(qPartNorm));
        const isOff = qd.hasOfferKw || codesDiffer;
        const offText = `${qd.part} ${qd.desc}`.trim();
        candidates.push({ score: 0.92, rIdx, qIdx, mType: "replacement_code", isOff, offText });
        return;
      }

      // 3. Description Similarity
      const sim = combinedStringSimilarity(rd.desc, qd.desc);
      const posBonus = (rd.rfq.item_no == qd.quote.item_no && rd.rfq.item_no !== null && sim >= 0.60) ? 0.05 : 0.0;

      if (qd.hasOfferKw && sim >= 0.45) {
        const offText = `${qd.part} ${qd.desc}`.trim();
        const score = Math.min(0.90, 0.75 + (sim * 0.15) + posBonus);
        candidates.push({ score, rIdx, qIdx, mType: "replacement_desc", isOff: true, offText });
      } else if (sim >= 0.65) {
        const codesDiffer = Boolean(rPartNorm && qPartNorm && rPartNorm !== qPartNorm);
        const isOff = qd.hasOfferKw || codesDiffer;
        const offText = `${qd.part} ${qd.desc}`.trim();
        const score = Math.min(0.88, sim + posBonus);
        candidates.push({ score, rIdx, qIdx, mType: "desc_similarity", isOff, offText });
      }
    });
  });

  // Sort candidate matches by score descending
  candidates.sort((a, b) => b.score - a.score);

  const assignedRfq = new Map();
  const usedQuoteIndices = new Set();

  for (const cand of candidates) {
    if (assignedRfq.has(cand.rIdx)) continue;
    if (usedQuoteIndices.has(cand.qIdx)) continue;
    assignedRfq.set(cand.rIdx, cand);
    usedQuoteIndices.add(cand.qIdx);
  }

  // Build final rows strictly adhering to RFQ items (count == rfqItems.length)
  rfqData.forEach((rd, rfqIdx) => {
    const rfq = rd.rfq;
    const rfqDesc = rd.desc;
    const rfqCode = rd.code;
    const rfqPart = rd.part;
    const rfqMaker = rd.maker;
    const rfqImpa = rd.impa;
    const rfqRef = rd.ref;

    const matchInfo = assignedRfq.get(rfqIdx);
    let quoteMatch = null;
    let unitCost = 0.0;
    let listUnitPrice = 0.0;
    let discountPercent = 0.0;
    let hasSupplierDiscount = false;
    let supplierPart = "";
    let supplierDesc = "";
    let supplierRemarks = "";
    let isOffer = false;
    let offerText = "";
    let matchType = "unmatched";

    if (matchInfo) {
      matchType = matchInfo.mType;
      isOffer = matchInfo.isOff;
      offerText = matchInfo.offText;
      quoteMatch = (quoteItems || [])[matchInfo.qIdx];
      if (quoteMatch) {
        unitCost = parseFloat(quoteMatch.unit_price) || 0.0;
        listUnitPrice = parseFloat(quoteMatch.list_unit_price) || unitCost;
        discountPercent = parseFloat(quoteMatch.discount_percent) || 0.0;
        hasSupplierDiscount = discountPercent > 0;
        supplierPart = String(quoteMatch.part_no || quoteMatch.item_code || '').trim();
        supplierDesc = String(quoteMatch.description || '').trim();
        supplierRemarks = String(quoteMatch.remarks || '').trim();

        if (isOffer && !offerText) {
          offerText = quoteMatch.offer_text || `${supplierPart} ${supplierDesc}`.trim();
          offerText = offerText.replace(/^(?:#?OFFER\s*[:\-]?\s*)+/gi, '').trim();
        }
      }
    }

    // Item code determination: strictly prioritize RFQ item code / part number
    let itemCode = "";
    if (rfqCode && !isGenericCode(rfqCode)) {
      itemCode = rfqCode;
    } else if (rfqPart && !isGenericCode(rfqPart)) {
      itemCode = rfqPart;
    } else if (supplierPart && !isGenericCode(supplierPart)) {
      itemCode = supplierPart;
    }

    // Base description: strictly from RFQ in Quotation Mode
    let rawBase = (mode === "po" && supplierDesc) ? supplierDesc.trim() : rfqDesc.trim();
    const cleanDesc = rawBase.replace(/^(?:#?OFFER\s*[:\-]?\s*)+/gi, '').trim();

    // Remarks construction
    const remarksParts = [];
    if (isOffer) {
      let offerClean = offerText ? offerText.trim() : (quoteMatch ? `${supplierPart} ${supplierDesc}`.trim() : "");
      offerClean = offerClean.replace(/^(?:#?OFFER\s*[:\-]?\s*)+/gi, '').trim();
      if (offerClean && offerClean.toLowerCase() !== cleanDesc.toLowerCase()) {
        remarksParts.push(`#OFFER\n${offerClean}`);
      } else {
        remarksParts.push('#OFFER');
      }
    }

    const makerStr = String(rfqMaker || (quoteMatch && quoteMatch.maker_no) || '').trim();
    if (makerStr && !isGenericCode(makerStr) && !cleanDesc.toLowerCase().includes(makerStr.toLowerCase())) {
      remarksParts.push(`Maker: ${makerStr}`);
    }

    if (quoteMatch) {
      const combinedText = `${supplierDesc} ${supplierRemarks}`;
      const inclMatch = combinedText.match(/(-\s*INCLUDED\s+IN\s+ITEM\s*(?:NO\.?)?\s*\d+|INCLUDED\s+IN\s+ITEM\s*(?:NO\.?)?\s*\d+|INCLUDED\s+IN\s+SET)/i);
      if (inclMatch) {
        const remarkText = inclMatch[1].replace(/^-\s*/, '').trim();
        if (!cleanDesc.toLowerCase().includes(remarkText.toLowerCase()) && !remarksParts.some(p => p.toLowerCase().includes(remarkText.toLowerCase()))) {
          remarksParts.push(`- (${remarkText})`);
        }
      } else if (supplierRemarks && !cleanDesc.toLowerCase().includes(supplierRemarks.toLowerCase()) && supplierRemarks.length <= 120) {
        const sRem = supplierRemarks.replace(/^-\s*/, '').trim();
        if (!remarksParts.some(p => p.toLowerCase().includes(sRem.toLowerCase()))) {
          remarksParts.push(`- (${sRem})`);
        }
      }
    }

    const rfqNotes = String(rfq.remarks || '').trim();
    if (rfqNotes && !cleanDesc.toLowerCase().includes(rfqNotes.toLowerCase()) && rfqNotes.length <= 120) {
      if (!remarksParts.some(p => p.toLowerCase().includes(rfqNotes.toLowerCase()))) {
        remarksParts.push(rfqNotes);
      }
    }

    const extraRemarks = remarksParts.join('\n\n').trim();
    const showRemarks = Boolean(extraRemarks);
    const finalDescription = (showRemarks && extraRemarks) ? `${cleanDesc}\n\n${extraRemarks}`.trim() : cleanDesc;

    const qty = parseFloat(rfq.quantity) || 1;
    let unit = (rfq.unit || 'PCS').toUpperCase();
    if (['ST', 'SET', 'SETS'].includes(unit)) unit = 'SET';
    else if (['PC', 'PCS', 'PCE', 'PIECE', 'PIECES'].includes(unit)) unit = 'PCS';
    else if (['EA', 'EACH'].includes(unit)) unit = 'EA';

    const costTarget = unitCost * fxRate;
    let rowMarkup = (mode === "po") ? (markupPercent === 25.0 ? 0.0 : markupPercent) : markupPercent;
    let rawPrice = unitCost > 0 ? (costTarget * (1.0 + rowMarkup / 100.0)) : 0.0;
    const priceTarget = applyPriceRounding(rawPrice, roundMode);

    const partNoVal = String(rfqPart || (quoteMatch && (quoteMatch.part_no || quoteMatch.item_code)) || '').trim();
    const itemCodeVal = String(rfqCode || (quoteMatch && (quoteMatch.item_code || quoteMatch.part_no)) || '').trim();
    const makerNoVal = String(rfqMaker || (quoteMatch && quoteMatch.maker_no) || '').trim();
    const impaCodeVal = String(rfqImpa || (quoteMatch && quoteMatch.impa_code) || '').trim();
    const refNoVal = String(rfqRef || (quoteMatch && quoteMatch.ref_no) || '').trim();

    const rawIdentifiers = {
      'auto': itemCode,
      'part_no': partNoVal || itemCode,
      'item_code': itemCodeVal || itemCode,
      'maker_no': makerNoVal || partNoVal || itemCode,
      'impa_code': impaCodeVal || partNoVal || itemCode,
      'ref_no': refNoVal || String(rfqIdx + 1)
    };

    matchedResults.push({
      row_id: rfqIdx + 1,
      item_code: itemCode,
      part_no: partNoVal,
      maker_no: makerNoVal,
      impa_code: impaCodeVal,
      ref_no: refNoVal,
      raw_identifiers: rawIdentifiers,
      supplier_part: supplierPart,
      client_description: rfqDesc,
      clean_description: cleanDesc,
      extra_remarks: extraRemarks,
      show_remarks: showRemarks,
      description: finalDescription,
      is_offer: isOffer,
      offer_text: offerText,
      quantity: qty,
      unit: unit,
      supplier_currency: supplierCurrency,
      target_currency: targetCurrency,
      list_unit_price: listUnitPrice,
      discount_percent: discountPercent,
      has_supplier_discount: hasSupplierDiscount,
      supplier_cost: unitCost,
      cost_target: costTarget,
      cost_myr: costTarget,
      fx_rate: fxRate,
      adjustment_type: 'percent',
      markup_percent: rowMarkup,
      markup_amount: Math.round((priceTarget - costTarget) * 100) / 100,
      round_mode: roundMode,
      raw_price: rawPrice,
      price_target: priceTarget,
      price_myr: priceTarget,
      formatted_price: priceTarget.toFixed(2),
      matched_quote: quoteMatch,
      match_type: matchType,
      is_custom_price: false,
      mode: mode
    });
  });

  return matchedResults;
}

/**
 * Recalculates prices when FX rate, target currency, markups, or rounding mode change.
 * Supports both percentage (%) and fixed price amount adjustments.
 */
function recalculateMatchedItems(items, newFxRate, globalMarkup, targetCurr, mode = "quotation", roundMode = "none", globalAdjustmentType = "percent", globalMarkupAmount = null) {
  return items.map(item => {
    const unitCost = parseFloat(item.supplier_cost) || 0.0;
    const costTarget = unitCost * newFxRate;

    let adjType = item.adjustment_type || 'percent';

    if (!item.is_custom_price) {
      if (globalAdjustmentType === 'price' && globalMarkupAmount !== null) {
        adjType = 'price';
        item.markup_amount = parseFloat(globalMarkupAmount);
      } else if (globalMarkup !== null) {
        adjType = 'percent';
        item.markup_percent = (mode === "po" && globalMarkup === 25.0) ? 0.0 : globalMarkup;
      }
    }

    let rawPrice;
    let priceTarget;
    let rowMarkup;
    let markupAmount;

    if (adjType === 'price') {
      markupAmount = item.markup_amount !== undefined ? parseFloat(item.markup_amount) : 0.0;
      rawPrice = costTarget + markupAmount;
      priceTarget = applyPriceRounding(rawPrice, roundMode);
      rowMarkup = costTarget > 0 ? ((rawPrice / costTarget) - 1.0) * 100.0 : 0.0;
    } else {
      rowMarkup = item.is_custom_price ? parseFloat(item.markup_percent) : globalMarkup;
      if (mode === "po" && !item.is_custom_price && globalMarkup === 25.0) {
        rowMarkup = 0.0;
      }
      rawPrice = costTarget * (1.0 + rowMarkup / 100.0);
      priceTarget = applyPriceRounding(rawPrice, roundMode);
      markupAmount = rawPrice - costTarget;
    }

    if (item.is_custom_price && item.price_target !== undefined && !item.markup_percent_modified && !item.markup_amount_modified) {
      priceTarget = parseFloat(item.price_target);
      markupAmount = priceTarget - costTarget;
      rowMarkup = costTarget > 0 ? ((priceTarget / costTarget) - 1.0) * 100.0 : 0.0;
    }

    return {
      ...item,
      target_currency: targetCurr,
      fx_rate: newFxRate,
      cost_target: costTarget,
      cost_myr: costTarget,
      adjustment_type: adjType,
      markup_percent: rowMarkup,
      markup_amount: Math.round(markupAmount * 100) / 100,
      round_mode: roundMode,
      raw_price: rawPrice,
      price_target: priceTarget,
      price_myr: priceTarget,
      formatted_price: priceTarget.toFixed(2),
      mode: mode
    };
  });
}
