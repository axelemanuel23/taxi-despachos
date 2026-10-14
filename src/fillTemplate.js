/* =========================================================
   Rellena una plantilla .xlsx existente SIN reconstruirla.

   Se abre el .xlsx como ZIP y se modifican solamente los
   valores de las celdas en el XML de la primera hoja. Todo
   lo demás (estilos, bordes, combinaciones, área de impresión,
   segunda hoja, etc.) queda exactamente como estaba.

   Requiere:  npm install jszip
   ========================================================= */

import JSZip from "jszip";

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const R_NS =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const XML_NS = "http://www.w3.org/XML/1998/namespace";

/* Columnas (número): E F G | H I J | K L M */
const BLOCK_COLS = [
  [5, 6, 7],
  [8, 9, 10],
  [11, 12, 13],
];
const COL_AGENTS = 3; // C
const COL_HOURS = 4; // D (HS)
const COL_DATE = 10; // J

export const casLabel = (cas) =>
  cas == null ? "CASILLA ?" : `CASILLA ${String(cas).padStart(2, "0")}`;

/* ---------------------------------------------------------
   Utilidades XML
--------------------------------------------------------- */

const colNum = (letters) =>
  letters
    .toUpperCase()
    .split("")
    .reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);

function colLetters(n) {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function parseRef(ref) {
  const m = /^([A-Z]+)(\d+)$/i.exec(ref);
  return { c: colNum(m[1]), r: parseInt(m[2], 10) };
}

const elems = (node, name) =>
  Array.from(node.childNodes).filter(
    (n) => n.nodeType === 1 && n.localName === name
  );

function parseXml(str, what) {
  const doc = new DOMParser().parseFromString(str, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) {
    throw new Error(`No se pudo leer ${what} dentro del Excel.`);
  }
  return doc;
}

function serialize(doc) {
  let out = new XMLSerializer().serializeToString(doc);
  if (!out.startsWith("<?xml")) {
    out = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + out;
  }
  return out;
}

/* ---------------------------------------------------------
   Estilos: solo se usa para dar formato h:mm a las horas
   cuando la celda de la plantilla no tiene formato propio.
--------------------------------------------------------- */

class Styles {
  constructor(doc) {
    this.doc = doc;
    this.xfs = doc ? doc.getElementsByTagNameNS(NS, "cellXfs")[0] : null;
    this.cache = new Map();
  }

  timeXf(idx) {
    if (!this.xfs) return idx;
    if (this.cache.has(idx)) return this.cache.get(idx);

    const list = elems(this.xfs, "xf");
    const xf = list[idx] || list[0];
    let out = idx;

    if (xf) {
      const nf = parseInt(xf.getAttribute("numFmtId") || "0", 10);

      // Formato "General": se clona el estilo con h:mm (id 20).
      if (nf === 0) {
        const clone = xf.cloneNode(true);
        clone.setAttribute("numFmtId", "20");
        clone.setAttribute("applyNumberFormat", "1");
        this.xfs.appendChild(clone);
        out = list.length;
        this.xfs.setAttribute("count", String(list.length + 1));
      }
    }

    this.cache.set(idx, out);
    return out;
  }
}

/* ---------------------------------------------------------
   Hoja
--------------------------------------------------------- */

class Sheet {
  constructor(doc, shared) {
    this.doc = doc;
    this.shared = shared;
    this.sheetData = doc.getElementsByTagNameNS(NS, "sheetData")[0];
    this.rows = new Map();

    elems(this.sheetData, "row").forEach((row) => {
      this.rows.set(parseInt(row.getAttribute("r"), 10), row);
    });
  }

  getRow(r, create) {
    let row = this.rows.get(r);
    if (row || !create) return row || null;

    row = this.doc.createElementNS(NS, "row");
    row.setAttribute("r", String(r));

    const next = elems(this.sheetData, "row").find(
      (x) => parseInt(x.getAttribute("r"), 10) > r
    );

    this.sheetData.insertBefore(row, next || null);
    this.rows.set(r, row);
    return row;
  }

  getCell(r, c, create) {
    const row = this.getRow(r, create);
    if (!row) return null;

    for (const el of elems(row, "c")) {
      const cc = parseRef(el.getAttribute("r")).c;
      if (cc === c) return el;
      if (cc > c) return create ? this.insertCell(row, r, c, el) : null;
    }

    return create ? this.insertCell(row, r, c, null) : null;
  }

  insertCell(row, r, c, before) {
    const el = this.doc.createElementNS(NS, "c");
    el.setAttribute("r", colLetters(c) + r);
    row.insertBefore(el, before);
    row.removeAttribute("spans");
    return el;
  }

  text(r, c) {
    const el = this.getCell(r, c, false);
    if (!el) return "";

    const t = el.getAttribute("t");

    if (t === "inlineStr") {
      return Array.from(el.getElementsByTagNameNS(NS, "t"))
        .map((x) => x.textContent)
        .join("");
    }

    const v = elems(el, "v")[0];
    if (!v) return "";

    return t === "s"
      ? this.shared[parseInt(v.textContent, 10)] || ""
      : v.textContent;
  }

  allCells() {
    const out = [];

    for (const [r, row] of this.rows) {
      elems(row, "c").forEach((el) => {
        const c = parseRef(el.getAttribute("r")).c;
        const text = this.text(r, c);
        if (text !== "") out.push({ r, c, text });
      });
    }

    return out.sort((a, b) => a.r - b.r || a.c - b.c);
  }

  styleOf(r, c) {
    const el = this.getCell(r, c, false);
    return el ? el.getAttribute("s") : null;
  }

  /* Vacía el valor pero conserva el estilo de la celda. */
  clearCell(r, c) {
    const el = this.getCell(r, c, false);
    if (!el) return;
    Array.from(el.childNodes).forEach((n) => el.removeChild(n));
    el.removeAttribute("t");
  }

  prep(r, c, refStyle) {
    const el = this.getCell(r, c, true);
    Array.from(el.childNodes).forEach((n) => el.removeChild(n));
    el.removeAttribute("t");

    if (!el.getAttribute("s") && refStyle != null) {
      el.setAttribute("s", refStyle);
    }

    return el;
  }

  setText(r, c, str, refStyle = null) {
    const el = this.prep(r, c, refStyle);
    if (str == null || str === "") return;

    el.setAttribute("t", "inlineStr");

    const is = this.doc.createElementNS(NS, "is");
    const t = this.doc.createElementNS(NS, "t");
    t.setAttributeNS(XML_NS, "xml:space", "preserve");
    t.appendChild(this.doc.createTextNode(String(str)));
    is.appendChild(t);
    el.appendChild(is);
  }

  setFormula(r, c, formula, refStyle, styles) {
    const el = this.prep(r, c, refStyle);
    const base = parseInt(el.getAttribute("s") || "0", 10);
    el.setAttribute("s", String(styles.timeXf(base)));

    const f = this.doc.createElementNS(NS, "f");
    f.appendChild(this.doc.createTextNode(formula));
    el.appendChild(f);
  }

  setTime(r, c, minutes, refStyle, styles) {
    const el = this.prep(r, c, refStyle);
    const base = parseInt(el.getAttribute("s") || "0", 10);
    el.setAttribute("s", String(styles.timeXf(base)));

    const v = this.doc.createElementNS(NS, "v");
    v.appendChild(this.doc.createTextNode(String(minutes / 1440)));
    el.appendChild(v);
  }
}

/* ---------------------------------------------------------
   Ubicar la estructura en la plantilla (por textos)
--------------------------------------------------------- */

function locate(sheet) {
  const cells = sheet.allCells();
  const up = (s) => s.toUpperCase();

  const titleE = cells.find((x) => /RELEVOS.*ENTRADA/.test(up(x.text)));
  const titleS = cells.find((x) => /RELEVOS.*SALIDA/.test(up(x.text)));

  if (!titleE || !titleS || titleE.r >= titleS.r) {
    throw new Error(
      'No encontré los títulos "RELEVOS GUARDIA NOCTURNA - ENTRADA" y "... - SALIDA" (en ese orden) en la primera hoja de la plantilla.'
    );
  }

  const sups = cells.filter((x) => /^SUPERVISOR\s*TN/i.test(x.text.trim()));
  const supE = sups.find((x) => x.r > titleE.r && x.r < titleS.r);
  const supS = sups.find((x) => x.r > titleS.r);

  if (!supE || !supS) {
    throw new Error(
      'No encontré las filas "SUPERVISOR TN: ..." de ENTRADA y SALIDA en la plantilla.'
    );
  }

  const obsE = cells.find(
    (x) =>
      /^OBSERVACIONES/i.test(x.text.trim()) && x.r > titleE.r && x.r < titleS.r
  );

  const micro = cells.find(
    (x) =>
      up(x.text.trim()) === "MICRO" && x.r > titleE.r && x.r < supE.r
  );

  if (!micro) {
    throw new Error('No encontré la etiqueta "MICRO" en la sección ENTRADA.');
  }

  const labelRows = [
    ...new Set(
      cells
        .filter(
          (x) =>
            [5, 8, 11].includes(x.c) &&
            /^CASILLA(\s|$)/i.test(x.text.trim()) &&
            x.r > titleS.r &&
            x.r < supS.r
        )
        .map((x) => x.r)
    ),
  ].sort((a, b) => a - b);

  if (!labelRows.length) {
    throw new Error(
      'No encontré filas "CASILLA ..." en la sección SALIDA de la plantilla.'
    );
  }

  return { titleE, titleS, supE, supS, obsE, micro, labelRows };
}

/* ---------------------------------------------------------
   Escritura de datos
--------------------------------------------------------- */

function clearArea(sheet, cols, from, to) {
  for (let r = from; r <= to; r++) cols.forEach((c) => sheet.clearCell(r, c));
}

function writeRows(ctx, cols, from, to, rows, label) {
  const { sheet, styles, problems } = ctx;
  const cap = Math.max(0, to - from + 1);

  clearArea(sheet, cols, from, to);

  if (rows.length > cap) {
    problems.push(
      `${label}: hay ${rows.length} tramos y la plantilla tiene lugar para ${cap}.`
    );
  }

  const refs = cols.map((c) => sheet.styleOf(from, c));

  rows.slice(0, cap).forEach((row, i) => {
    const r = from + i;
    sheet.setText(r, cols[0], row.name, refs[0]);
    sheet.setTime(r, cols[1], row.start, refs[1], styles);
    sheet.setTime(r, cols[2], row.end, refs[2], styles);
  });
}

/*
 * Horas trabajadas de un agente (columna D). Equivale a:
 *   =(SUMAR.SI(E:E;C6;G:G)-SUMAR.SI(E:E;C6;F:F))+ ... (H/I/J) ... + ... (K/L/M)
 * En el archivo las fórmulas van en inglés y con comas; Excel las muestra
 * traducidas. Se suma un día por cada tramo que cruza la medianoche
 * (fin < inicio, ej. 23:00-0:48), que de otro modo restaría negativo.
 */
function hoursFormula(r) {
  const blocks = [
    ["E", "F", "G"],
    ["H", "I", "J"],
    ["K", "L", "M"],
  ];

  const diff = blocks
    .map(
      ([n, s, e]) =>
        `(SUMIF(${n}:${n},C${r},${e}:${e})-SUMIF(${n}:${n},C${r},${s}:${s}))`
    )
    .join("+");

  const wrap = blocks
    .map(
      ([n, s, e]) =>
        `SUMPRODUCT((${n}$1:${n}$300=C${r})*(${e}$1:${e}$300<${s}$1:${s}$300))`
    )
    .join("+");

  return `${diff}+${wrap}`;
}

function writeAgents(ctx, from, to, agents, label) {
  const { sheet, styles, problems } = ctx;
  const cap = Math.max(0, to - from + 1);

  clearArea(sheet, [COL_AGENTS, COL_HOURS], from, to);

  if (agents.length > cap) {
    problems.push(
      `${label}: hay ${agents.length} agentes y la plantilla tiene lugar para ${cap}.`
    );
  }

  const ref = sheet.styleOf(from, COL_AGENTS);
  const refHs = sheet.styleOf(from, COL_HOURS);

  agents.slice(0, cap).forEach((name, i) => {
    const r = from + i;
    sheet.setText(r, COL_AGENTS, name, ref);
    sheet.setFormula(r, COL_HOURS, hoursFormula(r), refHs, styles);
  });
}

function writeBlock(ctx, cols, labelRow, from, to, block, label) {
  ctx.sheet.setText(labelRow, cols[0], block ? casLabel(block.cas) : "CASILLA");

  const name = block ? casLabel(block.cas) : "casilla vacía";
  writeRows(ctx, cols, from, to, block ? block.rows : [], `${label} · ${name}`);
}

function fillEntrada(ctx, sec, a, meta) {
  const { sheet, problems } = ctx;

  const bodyStart = a.titleE.r + 3;
  const labelRow = a.titleE.r + 1;
  const microRow = a.micro.r;
  const supRow = a.supE.r;

  sheet.setText(a.titleE.r, COL_DATE, meta.dateText, sheet.styleOf(a.titleE.r, COL_DATE));

  writeAgents(ctx, bodyStart, supRow - 1, sec.agents, "ENTRADA · agentes");

  writeRows(
    ctx,
    BLOCK_COLS[0],
    bodyStart,
    microRow - 1,
    sec.corredor,
    "ENTRADA · A cargo de corredor"
  );

  writeRows(
    ctx,
    BLOCK_COLS[0],
    microRow + 1,
    supRow - 1,
    sec.micro,
    "ENTRADA · MICRO"
  );

  const slots = [BLOCK_COLS[1], BLOCK_COLS[2]];

  if (sec.blocks.length > slots.length) {
    problems.push(
      `ENTRADA: hay ${sec.blocks.length} casillas y la plantilla tiene lugar para ${slots.length} (además de corredor y micro).`
    );
  }

  slots.forEach((cols, i) =>
    writeBlock(ctx, cols, labelRow, bodyStart, microRow, sec.blocks[i], "ENTRADA")
  );

  sheet.setText(
    a.supE.r,
    a.supE.c,
    `SUPERVISOR TN: ${meta.supervisor}`,
    sheet.styleOf(a.supE.r, a.supE.c)
  );

  if (a.obsE) {
    sheet.setText(
      a.obsE.r,
      a.obsE.c,
      `OBSERVACIONES: ${meta.observaciones}`,
      sheet.styleOf(a.obsE.r, a.obsE.c)
    );
  }
}

function fillSalida(ctx, sec, a, meta) {
  const { sheet, problems } = ctx;
  const { labelRows } = a;

  sheet.setText(a.titleS.r, COL_DATE, meta.dateText, sheet.styleOf(a.titleS.r, COL_DATE));

  writeAgents(
    ctx,
    labelRows[0] + 2,
    a.supS.r - 1,
    sec.agents,
    "SALIDA · agentes"
  );

  const slots = [];

  labelRows.forEach((lr, k) => {
    const from = lr + 2;
    const to = k + 1 < labelRows.length ? labelRows[k + 1] - 1 : a.supS.r - 1;
    BLOCK_COLS.forEach((cols) => slots.push({ cols, labelRow: lr, from, to }));
  });

  if (sec.blocks.length > slots.length) {
    problems.push(
      `SALIDA: hay ${sec.blocks.length} casillas y la plantilla tiene lugar para ${slots.length}.`
    );
  }

  slots.forEach((s, i) =>
    writeBlock(ctx, s.cols, s.labelRow, s.from, s.to, sec.blocks[i], "SALIDA")
  );

  sheet.setText(
    a.supS.r,
    a.supS.c,
    `SUPERVISOR TN: ${meta.supervisor}`,
    sheet.styleOf(a.supS.r, a.supS.c)
  );
}

/* ---------------------------------------------------------
   API pública
--------------------------------------------------------- */

/**
 * @param file  File | Blob | ArrayBuffer | Uint8Array  (plantilla .xlsx)
 * @param opts  { sections, dateText, supervisor, observaciones, outputType? }
 * @returns     Blob (o el tipo indicado en outputType)
 */
export async function fillTemplate(file, opts) {
  const { sections, dateText, supervisor, observaciones } = opts;

  const buf =
    file instanceof ArrayBuffer || ArrayBuffer.isView(file)
      ? file
      : await file.arrayBuffer();

  let zip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    throw new Error("El archivo adjunto no es un .xlsx válido.");
  }

  const read = async (path) => {
    const f = zip.file(path);
    return f ? f.async("string") : null;
  };

  /* --- Primera hoja del libro --- */

  const wbXml = await read("xl/workbook.xml");
  const relsXml = await read("xl/_rels/workbook.xml.rels");

  if (!wbXml || !relsXml) {
    throw new Error("El archivo adjunto no parece ser un libro de Excel.");
  }

  const wbDoc = parseXml(wbXml, "workbook.xml");
  const sheetEl = wbDoc.getElementsByTagNameNS(NS, "sheet")[0];
  const rid = sheetEl.getAttributeNS(R_NS, "id");

  const rel = Array.from(
    parseXml(relsXml, "workbook.xml.rels").getElementsByTagName("Relationship")
  ).find((x) => x.getAttribute("Id") === rid);

  let target = rel.getAttribute("Target");
  target = target.startsWith("/") ? target.slice(1) : "xl/" + target;

  /* --- Textos compartidos --- */

  const ssXml = await read("xl/sharedStrings.xml");
  const shared = ssXml
    ? Array.from(
        parseXml(ssXml, "sharedStrings.xml").getElementsByTagNameNS(NS, "si")
      ).map((si) =>
        Array.from(si.getElementsByTagNameNS(NS, "t"))
          .filter((t) => t.parentNode.localName !== "rPh")
          .map((t) => t.textContent)
          .join("")
      )
    : [];

  /* --- Hoja y estilos --- */

  const sheetDoc = parseXml(await read(target), target);
  const sheet = new Sheet(sheetDoc, shared);

  const stXml = await read("xl/styles.xml");
  const stDoc = stXml ? parseXml(stXml, "styles.xml") : null;
  const styles = new Styles(stDoc);

  /* --- Rellenar --- */

  const anchors = locate(sheet);
  const problems = [];
  const ctx = { sheet, styles, problems };
  const meta = { dateText, supervisor, observaciones };

  fillEntrada(ctx, sections.entrada, anchors, meta);
  fillSalida(ctx, sections.salida, anchors, meta);

  if (problems.length) {
    throw new Error(
      "La plantilla no tiene espacio suficiente:\n• " + problems.join("\n• ")
    );
  }

  /* --- Guardar --- */

  // Obliga a Excel a calcular las fórmulas nuevas al abrir el archivo.
  const calcWb = /<calcPr\b/.test(wbXml)
    ? wbXml.replace(/<calcPr\b([^>]*?)(\/?)>/, (m, attrs, slash) =>
        `<calcPr${attrs.replace(/\sfullCalcOnLoad="[^"]*"/, "")} fullCalcOnLoad="1"${slash}>`
      )
    : wbXml.replace(
        /(<oleSize\b|<customWorkbookViews\b|<pivotCaches\b|<extLst\b|<\/workbook>)/,
        '<calcPr fullCalcOnLoad="1"/>$1'
      );
  zip.file("xl/workbook.xml", calcWb);

  zip.file(target, serialize(sheetDoc));
  if (stDoc) zip.file("xl/styles.xml", serialize(stDoc));

  // La cadena de cálculo puede quedar desactualizada: Excel la regenera.
  if (zip.file("xl/calcChain.xml")) {
    zip.remove("xl/calcChain.xml");

    const ct = await read("[Content_Types].xml");
    if (ct) {
      zip.file(
        "[Content_Types].xml",
        ct.replace(/<Override[^>]*calcChain[^>]*\/>/g, "")
      );
    }

    zip.file(
      "xl/_rels/workbook.xml.rels",
      relsXml.replace(/<Relationship\s[^>]*calcChain[^>]*\/>/g, "")
    );
  }

  return zip.generateAsync({
    type: opts.outputType || "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    compression: "DEFLATE",
  });
}
