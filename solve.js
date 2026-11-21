// Fast drop-in for csv-reader 1.0.0 (make.fun's own reference program).
// Same answers as vendor csv-reader readCsv on every input, but instead of
// walking the text one character at a time and building each field with
// `value += c`, this parser jumps between delimiters with native indexOf and
// cuts fields out with slice. The only character loops left are the rare
// slow paths: a segment holding a stray CR, or a quoted segment holding a
// line break (both need per-break work the reference does too).
//
// Semantics, copied from the reference (see baselines/csv-reader/
// vendor/csv-reader/index.js in the kit):
//  - U+FEFF at the very start is dropped.
//  - A record ends at LF or CRLF; a line left with no characters is no record.
//  - Outside quotes a CR not followed by LF is dropped (error stray_cr).
//  - A field opening with a quote runs to the next quote that is not doubled;
//    "" inside it is one quote; CRLF / lone CR inside it reads as LF.
//    What follows its closing quote, up to the next comma or line break, is
//    appended as it stands (error quote_junk when the field ends, if anything
//    was appended). A quote that never closes is a literal character and the
//    text after it is read again as unquoted (error unterminated_quote).
//  - A quote inside an unquoted field is a literal character.
//  - Fields stay strings, never trimmed or converted.
//  - columns is the first record when header is true, else null; rows are the
//    records after it (every record when header is false), each padded with ""
//    (short_row, with fields: its field count) or cut (long_row, with extra:
//    the cut fields) to the first record's width.
//  - Each error is {code, line, row}, in the order met; line is the 1-based
//    line its record starts on (every LF, CRLF and lone CR inside a quoted
//    field counted), row its record's index in rows, null for the header.
//    A record's short_row / long_row is reported when the record ends.

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0;
  let line = 1;
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // Quoted segment [a, b): CRLF and lone CR become LF, line counts each
  // break. Fast path (no CR/LF in the segment) is a plain slice.
  // Mutates the outer `line`; callers that may discard the segment (an
  // unterminated quote) reset `line` themselves.
  function quotedSeg(a, b) {
    let hasBreak = false;
    for (let i = a; i < b; i++) {
      const c = text.charCodeAt(i);
      if (c === 10 || c === 13) { hasBreak = true; break; }
    }
    if (!hasBreak) return text.slice(a, b);
    let out = '';
    let i = a;
    for (;;) {
      const nli = text.indexOf('\n', i);
      const cri = text.indexOf('\r', i);
      let br = -1;
      let isCR = false;
      if (cri !== -1 && cri < b && (nli === -1 || nli >= b || cri < nli)) { br = cri; isCR = true; }
      else if (nli !== -1 && nli < b) { br = nli; }
      else break;
      out += text.slice(i, br);
      out += '\n';
      line += 1;
      // A CR followed by LF inside the segment is one break, not two.
      i = isCR && br + 1 < b && text.charCodeAt(br + 1) === 10 ? br + 2 : br + 1;
    }
    out += text.slice(i, b);
    return out;
  }

  // Unquoted run starting at `start` with the string `init` already in the
  // field. Returns [value, ended, added, nextPos] where ended is
  // 0 = comma, 1 = line break, 2 = end of text, and added counts the
  // characters kept after `init` (only used for quote_junk). Stray-CR errors
  // are pushed with the given recordLine / recordRow as they are met.
  // The common case (no CR in the run) is three native indexOf calls and a
  // slice; the CR case splits on CRs and drops the lone ones.
  function readUnquoted(start, init, recordLine, recordRow) {
    const comma = text.indexOf(',', start);
    const lf = text.indexOf('\n', start);
    let end;
    let ended;
    if (comma !== -1 && (lf === -1 || comma < lf)) { end = comma; ended = 0; }
    else if (lf !== -1) { end = lf; ended = 1; }
    else { end = n; ended = 2; }
    // Find a CR inside the segment only: the segment is one field long,
    // while indexOf('\r') would scan on to the next CR anywhere in the file.
    let cr = -1;
    for (let i = start; i < end; i++) {
      if (text.charCodeAt(i) === 13) { cr = i; break; }
    }
    if (cr === -1) {
      const value = end === start ? init : init + text.slice(start, end);
      return [value, ended, end - start, end + (ended === 2 ? 0 : 1)];
    }
    // The run holds a CR. If the only one is the trailing CR of a CRLF
    // line break, it is just the terminator.
    if (ended === 1 && cr === end - 1) {
      const value = end - 1 === start ? init : init + text.slice(start, end - 1);
      return [value, ended, end - 1 - start, end + 1];
    }
    // Generic: lone CRs are dropped (each an error); a trailing CRLF is
    // the terminator, never a stray CR.
    const parts = [init];
    let added = 0;
    let i = start;
    for (;;) {
      const r = text.indexOf('\r', i);
      if (r === -1 || r >= end) break;
      if (r === end - 1 && ended === 1) break; // trailing CRLF
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      if (r > i) { parts.push(text.slice(i, r)); added += r - i; }
      i = r + 1;
    }
    let tailEnd = end;
    if (ended === 1 && end > i && text.charCodeAt(end - 1) === 13) tailEnd = end - 1;
    if (tailEnd > i) { parts.push(text.slice(i, tailEnd)); added += tailEnd - i; }
    return [parts.join(''), ended, added, end + (ended === 2 ? 0 : 1)];
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos += 1; line += 1; }
      else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;

    const recordLine = line;
    const recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let ended;
    let quoted = false;

    do {
      quoted = text.charCodeAt(pos) === 34;
      let value;
      if (!quoted) {
        const r = readUnquoted(pos, '', recordLine, recordRow);
        value = r[0];
        ended = r[1];
        pos = r[3];
        if (ended === 1) line += 1;
      } else {
        // Quoted field: find the closing quote, honouring "" escapes.
        const open = pos;
        const openLine = line;
        let segStart = pos + 1;
        let cur = segStart;
        let parts = null;
        let closedQ = -1;
        for (;;) {
          const q = text.indexOf('"', cur);
          if (q === -1) break;
          if (text.charCodeAt(q + 1) === 34) {
            if (parts === null) parts = [];
            parts.push(quotedSeg(segStart, q));
            parts.push('"');
            cur = q + 2;
            segStart = q + 2;
            continue;
          }
          closedQ = q;
          break;
        }
        if (closedQ === -1) {
          // The quote never closes: it is a literal character, and the
          // text after it is read again as unquoted. Line counting inside
          // the failed quoted scan is discarded.
          line = openLine;
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          const r = readUnquoted(open + 1, '"', recordLine, recordRow);
          value = r[0];
          ended = r[1];
          pos = r[3];
          if (ended === 1) line += 1;
        } else {
          if (parts === null) value = quotedSeg(segStart, closedQ);
          else { parts.push(quotedSeg(segStart, closedQ)); value = parts.join(''); }
          pos = closedQ + 1;
          if (pos >= n) {
            ended = 2;
          } else {
            const c = text.charCodeAt(pos);
            if (c === 44) { pos += 1; ended = 0; }
            else if (c === 10) { pos += 1; line += 1; ended = 1; }
            else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; ended = 1; }
            else {
              // What follows the closing quote is appended as it stands,
              // up to the next comma or line break.
              const r = readUnquoted(pos, value, recordLine, recordRow);
              value = r[0];
              ended = r[1];
              if (r[2] > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
              pos = r[3];
              if (ended === 1) line += 1;
            }
          }
        }
      }
      fields.push(value);
    } while (ended === 0);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
