import React, { useMemo, useState } from "react";
import * as XLSX from "xlsx";

/* =========================================================
   FORMATO DE ENTRADA
   ========================================================= */

const EXAMPLE_ENTRADA = `DiegoCAS8 23:00-0:48 / CORREDOR 05:00-06:00
MauroCAS8 0:48-2:36
MarianaCAS8 2:36-3:24 / 05:00-06:00
AnibalCAS8 3:24-4:12 / CAS3 05:00-06:00
AxelCAS8 4:12-5:00 / SALIDA CAS6 05:00-06:00`;

const EXAMPLE_SALIDA = `De Moraiz MaraCAS11 23:00-0:00 / CAS12 1:48-2:12 / CAS7 05:00-06:00
Bordon IvanCAS12 23:00-1:24
Leon JorgeCAS16 23:00-1:00 / CAS12 1:24-1:48
Gomez EstebanCAS12 2:12-3:36
Irala LuisCAS12 3:36-5:00 / CAS8 05:00-06:00`;

/* ---------------------------------------------------------
   PARSER
--------------------------------------------------------- */

const DEST_RE =
  /cas\s*(\d{1,2})(?![\d:])|salida(?:\s*cas\s*(\d{1,2})(?![\d:]))?|corredor|micro/i;

const TIME_RE =
  /(\d{1,3}):(\d{2})(?:\s*(?:-|–|—|→|->)\s*|\s+a\s+)(\d{1,3}):(\d{2})/i;

function destFrom(match) {
  const txt = match[0].toLowerCase();

  if (txt.startsWith("cas")) {
    return {
      type: "cas",
      cas: parseInt(match[1], 10),
    };
  }

  if (txt.startsWith("salida")) {
    return {
      type: "salida",
      cas: match[2] ? parseInt(match[2], 10) : null,
    };
  }

  if (txt.startsWith("corredor")) {
    return { type: "corredor" };
  }

  return { type: "micro" };
}

function cleanName(raw) {
  return raw
    .replace(/[\s\-–—:>|,]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

export function parseText(text, origin = "entrada") {
  const entries = [];
  const errors = [];

  text.split(/\r?\n/).forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) return;

    const err = (motivo, texto = line) =>
      errors.push({
        seccion: origin,
        linea: idx + 1,
        texto,
        motivo,
      });

    const segments = line
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean);

    const firstMatch = segments[0].match(DEST_RE);

    if (!firstMatch) {
      err('No se encontró "CAS n" en la línea.');
      return;
    }

    const name = cleanName(segments[0].slice(0, firstMatch.index));

    if (!name) {
      err("No se encontró el nombre del agente antes de la casilla.");
      return;
    }

    let prevDest = null;

    segments.forEach((seg) => {
      const m = seg.match(DEST_RE);
      const dest = m ? destFrom(m) : prevDest;

      prevDest = dest;

      if (!dest) {
        err('Tramo sin casilla ("CAS n").', seg);
        return;
      }

      const tm = seg.match(TIME_RE);

      if (!tm) {
        err(
          "No se encontró un horario válido (ej. 23:00-0:48).",
          seg
        );
        return;
      }

      const [h1, m1, h2, m2] = tm.slice(1).map(Number);

      const badTime = [
        [h1, m1, `${tm[1]}:${tm[2]}`],
        [h2, m2, `${tm[3]}:${tm[4]}`],
      ].find(([h, mm]) => h > 23 || mm > 59);

      if (badTime) {
        err(`Hora inválida: ${badTime[2]}`, seg);
        return;
      }

      const start = h1 * 60 + m1;
      const end = h2 * 60 + m2;

      if (start === end) {
        err("El inicio y el fin son iguales.", seg);
        return;
      }

      entries.push({
        name,
        dest,
        start,
        end,
        origin,
      });
    });
  });

  return { entries, errors };
}

/* ---------------------------------------------------------
   MODELO
--------------------------------------------------------- */

const nightKey = (min) =>
  min >= 12 * 60 ? min : min + 24 * 60;

const byStart = (a, b) =>
  nightKey(a.start) - nightKey(b.start);

export function buildSections(entradaEntries, salidaEntries) {
  const sections = {
    entrada: {
      agents: [],
      map: new Map(),
      corredor: [],
      micro: [],
    },
    salida: {
      agents: [],
      map: new Map(),
      corredor: [],
      micro: [],
    },
  };

  const addToBlock = (sec, cas, row) => {
    const key = cas == null ? "?" : cas;

    if (!sections[sec].map.has(key)) {
      sections[sec].map.set(key, []);
    }

    sections[sec].map.get(key).push(row);
  };

  [
    ["entrada", entradaEntries],
    ["salida", salidaEntries],
  ].forEach(([origin, list]) => {
    list.forEach((e) => {
      if (!sections[origin].agents.includes(e.name)) {
        sections[origin].agents.push(e.name);
      }

      const row = {
        name: e.name,
        start: e.start,
        end: e.end,
      };

      if (e.dest.type === "cas") {
        addToBlock(origin, e.dest.cas, row);
      } else if (e.dest.type === "salida") {
        addToBlock("salida", e.dest.cas, row);
      } else if (e.dest.type === "corredor") {
        sections.entrada.corredor.push(row);
      } else if (e.dest.type === "micro") {
        sections.entrada.micro.push(row);
      }
    });
  });

  Object.values(sections).forEach((sec) => {
    sec.blocks = [...sec.map.entries()]
      .map(([key, rows]) => ({
        cas: key === "?" ? null : key,
        rows: rows.sort(byStart),
      }))
      .sort((a, b) => {
        const d =
          nightKey(a.rows[0].start) -
          nightKey(b.rows[0].start);

        if (d !== 0) return d;

        return (a.cas ?? 999) - (b.cas ?? 999);
      });

    sec.corredor.sort(byStart);
    sec.micro.sort(byStart);
  });

  return sections;
}

/* ---------------------------------------------------------
   EXCEL CON XLSX / SHEETJS
--------------------------------------------------------- */

const FONT = "Calibri";

const YELLOW = "FFFFFF00";
const GREEN = "FFC6E0B4";
const GRAY = "FFBFBFBF";

const COL_WIDTHS = {
  A: 5.43,
  B: 6.14,
  C: 30.14,
  D: 7.71,
  E: 26.57,
  F: 7.71,
  G: 8,
  H: 24.57,
  I: 7.71,
  J: 7.43,
  K: 24.43,
  L: 7.71,
  M: 8,
};

const BLOCK_COLS = [
  ["E", "F", "G"],
  ["H", "I", "J"],
  ["K", "L", "M"],
];

const FIRST_COL = 3;
const LAST_COL = 13;

const ROW_H = 16.5;

const fmtTime = (min) =>
  `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;

const casLabel = (cas) =>
  cas == null
    ? "CASILLA ?"
    : `CASILLA ${String(cas).padStart(2, "0")}`;

const COL_INDEX = {
  A: 0,
  B: 1,
  C: 2,
  D: 3,
  E: 4,
  F: 5,
  G: 6,
  H: 7,
  I: 8,
  J: 9,
  K: 10,
  L: 11,
  M: 12,
};

function excelAddress(col, row) {
  return `${col}${row}`;
}

function ensureCell(ws, address) {
  if (!ws[address]) {
    ws[address] = {};
  }

  return ws[address];
}

function put(ws, addr, value, o = {}) {
  const c = ensureCell(ws, addr);

  c.v = value;

  if (typeof value === "number") {
    c.t = "n";
  } else {
    c.t = "s";
  }

  c.s = {
    font: {
      name: FONT,
      sz: o.size || 12,
      bold: !!o.bold,
    },
    alignment: {
      horizontal: o.h || "left",
      vertical: "center",
      wrapText: !!o.wrap,
      shrinkToFit: !!o.shrink,
      indent: o.indent || 0,
    },
  };

  if (o.fill) {
    c.s.fill = {
      patternType: "solid",
      fgColor: {
        rgb: o.fill,
      },
    };
  }

  if (o.fmt) {
    c.z = o.fmt;
  }

  return c;
}

function mergeCells(ws, start, end) {
  if (!ws["!merges"]) {
    ws["!merges"] = [];
  }

  const range = XLSX.utils.decode_range(`${start}:${end}`);

  ws["!merges"].push(range);
}

function mergedLabel(ws, row, cols, text, o = {}) {
  put(
    ws,
    `${cols[0]}${row}`,
    text,
    {
      bold: true,
      fill: YELLOW,
      h: "center",
      wrap: true,
      ...o,
    }
  );

  mergeCells(
    ws,
    `${cols[0]}${row}`,
    `${cols[2]}${row}`
  );
}

function columnHeaders(ws, row, cols) {
  ["AGENTES", "ENTRADA", "SALIDA"].forEach(
    (t, i) => {
      put(
        ws,
        `${cols[i]}${row}`,
        t,
        {
          size: 9,
          bold: true,
          fill: GRAY,
          h: "center",
        }
      );
    }
  );
}

function blockRows(ws, cols, startRow, rows) {
  rows.forEach((r, i) => {
    const row = startRow + i;

    put(
      ws,
      `${cols[0]}${row}`,
      r.name,
      {
        shrink: true,
        indent: 1,
      }
    );

    put(
      ws,
      `${cols[1]}${row}`,
      r.start / 1440,
      {
        h: "center",
        fmt: "h:mm",
      }
    );

    put(
      ws,
      `${cols[2]}${row}`,
      r.end / 1440,
      {
        h: "center",
        fmt: "h:mm",
      }
    );
  });
}

function chunkBands(blocks, firstSlots) {
  const bands = [
    blocks.slice(0, firstSlots),
  ];

  for (
    let i = firstSlots;
    i < blocks.length;
    i += 3
  ) {
    bands.push(blocks.slice(i, i + 3));
  }

  return bands;
}

/*
 * En SheetJS no usamos getRow/getCell.
 * Las alturas se guardan en !rows.
 */
function setRowHeight(ws, row, height) {
  if (!ws["!rows"]) {
    ws["!rows"] = [];
  }

  if (!ws["!rows"][row - 1]) {
    ws["!rows"][row - 1] = {};
  }

  ws["!rows"][row - 1].hpt = height;
}

function drawSection(ws, o) {
  const {
    kind,
    top,
    sec,
    title,
    leftTitle,
    dateText,
    supervisor,
    observaciones,
  } = o;

  const isEntrada = kind === "entrada";

  let r = top;

  /* ---- Título + fecha ---- */

  setRowHeight(ws, r, 28);

  put(
    ws,
    `C${r}`,
    title,
    {
      size: 22,
      bold: true,
      fill: GREEN,
      h: "center",
    }
  );

  mergeCells(ws, `C${r}`, `I${r}`);

  put(
    ws,
    `J${r}`,
    dateText,
    {
      size: 16,
      bold: true,
      fill: GREEN,
      h: "center",
    }
  );

  mergeCells(ws, `J${r}`, `M${r}`);

  const titleRow = r;

  /* ---- Encabezado amarillo ---- */

  r++;

  const headRow = r;

  setRowHeight(
    ws,
    r,
    isEntrada ? 34.5 : 40.5
  );

  put(
    ws,
    `C${r}`,
    leftTitle,
    {
      size: 16,
      bold: true,
      fill: YELLOW,
      h: "center",
      wrap: true,
    }
  );

  mergeCells(ws, `C${r}`, `D${r}`);

  const bands = chunkBands(
    sec.blocks,
    isEntrada ? 2 : 3
  );

  const band1 = bands[0];

  const slots = isEntrada
    ? [
        { special: true },
        band1[0] || null,
        band1[1] || null,
      ]
    : [
        band1[0] || null,
        band1[1] || null,
        band1[2] || null,
      ];

  slots.forEach((slot, i) => {
    const label = !slot
      ? "CASILLA"
      : slot.special
      ? "A cargo de corredor ENTRADA"
      : casLabel(slot.cas);

    mergedLabel(
      ws,
      r,
      BLOCK_COLS[i],
      label,
      { size: 16 }
    );
  });

  /* ---- Encabezado columnas ---- */

  r++;

  setRowHeight(ws, r, 15);

  put(ws, `C${r}`, "AGENTES", {
    size: 9,
    bold: true,
    fill: GRAY,
    h: "center",
  });

  put(ws, `D${r}`, "HS", {
    size: 9,
    bold: true,
    fill: GRAY,
    h: "center",
  });

  BLOCK_COLS.forEach((cols) =>
    columnHeaders(ws, r, cols)
  );

  /* ---- Cuerpo primera franja ---- */

  const bodyStart = r + 1;

  const casMax = Math.max(
    0,
    ...band1.map((b) => b.rows.length)
  );

  const R1 = isEntrada
    ? Math.max(
        6,
        sec.agents.length,
        casMax,
        sec.corredor.length + 1
      )
    : Math.max(
        6,
        sec.agents.length,
        casMax
      );

  const bodyEnd = bodyStart + R1 - 1;

  for (
    let i = bodyStart;
    i <= bodyEnd;
    i++
  ) {
    setRowHeight(ws, i, ROW_H);
  }

  sec.agents.forEach((name, i) => {
    put(
      ws,
      `C${bodyStart + i}`,
      name,
      {
        shrink: true,
        indent: 1,
      }
    );
  });

  if (isEntrada) {
    blockRows(
      ws,
      BLOCK_COLS[0],
      bodyStart,
      sec.corredor
    );

    band1.forEach((b, i) =>
      blockRows(
        ws,
        BLOCK_COLS[i + 1],
        bodyStart,
        b.rows
      )
    );
  } else {
    band1.forEach((b, i) =>
      blockRows(
        ws,
        BLOCK_COLS[i],
        bodyStart,
        b.rows
      )
    );
  }

  r = bodyEnd;

  /* ---- ENTRADA: MICRO ---- */

  if (isEntrada) {
    setRowHeight(ws, bodyEnd, 21);

    mergedLabel(
      ws,
      bodyEnd,
      BLOCK_COLS[0],
      "MICRO",
      { size: 16 }
    );

    const microRows = Math.max(
      2,
      sec.micro.length
    );

    for (
      let i = 1;
      i <= microRows;
      i++
    ) {
      setRowHeight(
        ws,
        bodyEnd + i,
        ROW_H
      );
    }

    blockRows(
      ws,
      BLOCK_COLS[0],
      bodyEnd + 1,
      sec.micro
    );

    r = bodyEnd + microRows;
  }

  /* ---- SALIDA: franjas siguientes ---- */

  if (!isEntrada) {
    bands.slice(1).forEach((band) => {
      r++;

      setRowHeight(ws, r, 20);

      [0, 1, 2].forEach((i) => {
        const b = band[i];

        mergedLabel(
          ws,
          r,
          BLOCK_COLS[i],
          b
            ? casLabel(b.cas)
            : "CASILLA",
          { size: 14 }
        );
      });

      r++;

      setRowHeight(ws, r, 15);

      BLOCK_COLS.forEach((cols) =>
        columnHeaders(ws, r, cols)
      );

      const n = Math.max(
        4,
        ...band.map(
          (b) => b.rows.length
        )
      );

      for (
        let i = 1;
        i <= n;
        i++
      ) {
        setRowHeight(
          ws,
          r + i,
          ROW_H
        );
      }

      band.forEach((b, i) =>
        blockRows(
          ws,
          BLOCK_COLS[i],
          r + 1,
          b.rows
        )
      );

      r += n;
    });
  }

  /* ---- Supervisor ---- */

  r++;

  setRowHeight(ws, r, 18);

  put(
    ws,
    `E${r}`,
    `SUPERVISOR TN: ${supervisor}`,
    { bold: true }
  );

  mergeCells(ws, `E${r}`, `M${r}`);

  /* ---- Observaciones ---- */

  if (isEntrada) {
    r++;

    setRowHeight(ws, r, 21);

    put(
      ws,
      `E${r}`,
      `OBSERVACIONES: ${observaciones}`,
      { bold: true }
    );

    mergeCells(ws, `E${r}`, `M${r}`);
  }

  return r;
}

/* ---------------------------------------------------------
   FECHAS
--------------------------------------------------------- */

const pad2 = (n) =>
  String(n).padStart(2, "0");

const fmtDMY = (d, sep) =>
  `${pad2(d.getDate())}${sep}${pad2(
    d.getMonth() + 1
  )}${sep}${d.getFullYear()}`;

function datesFrom(fechaISO) {
  const [y, m, d] =
    fechaISO.split("-").map(Number);

  return {
    start: new Date(y, m - 1, d),
    end: new Date(y, m - 1, d + 1),
  };
}

export function fileNameFor(fechaISO) {
  const { start } = datesFrom(fechaISO);

  return `PLANILLA_E-S_${fmtDMY(
    start,
    "-"
  )}_-_NOCHE.xlsx`;
}

/* ---------------------------------------------------------
   GENERAR WORKBOOK CON XLSX
--------------------------------------------------------- */

export function buildWorkbook({
  entradaEntries,
  salidaEntries,
  fecha,
  supervisor,
  observaciones,
}) {
  const sections = buildSections(
    entradaEntries,
    salidaEntries
  );

  const { start, end } =
    datesFrom(fecha);

  const dateText =
    `${fmtDMY(start, "/")} AL ${fmtDMY(
      end,
      "/"
    )}`;

  /*
   * SheetJS:
   * Creamos un worksheet vacío y vamos
   * agregando las celdas manualmente.
   */
  const ws = {};

  const entradaLast = drawSection(ws, {
    kind: "entrada",
    top: 3,
    sec: sections.entrada,
    title:
      "RELEVOS GUARDIA NOCTURNA - ENTRADA",
    leftTitle:
      "INSPECTORES 20:45 HS ENTRADA",
    dateText,
    supervisor,
    observaciones,
  });

  const salidaLast = drawSection(ws, {
    kind: "salida",
    top: entradaLast + 2,
    sec: sections.salida,
    title:
      "RELEVOS GUARDIA NOCTURNA - SALIDA",
    leftTitle:
      "INSPECTORES 20:45 HS SALIDA",
    dateText,
    supervisor,
    observaciones,
  });

  /*
   * Rango utilizado por la hoja.
   */
  ws["!ref"] = `C3:M${salidaLast}`;

  /*
   * Anchos de columnas.
   */
  ws["!cols"] = Object.entries(
    COL_WIDTHS
  ).map(([col, width]) => ({
    wch: width,
  }));

  /*
   * Segunda hoja.
   */
  const ws2 = {};

  put(
    ws2,
    "B6",
    "SUPERVISION SALIDA",
    {
      size: 22,
      bold: true,
      h: "center",
    }
  );

  mergeCells(
    ws2,
    "B6",
    "E9"
  );

  ws2["!ref"] = "B6:E9";

  /*
   * Workbook SheetJS.
   */
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(
    wb,
    ws,
    "Hoja1"
  );

  XLSX.utils.book_append_sheet(
    wb,
    ws2,
    "Hoja2"
  );

  /*
   * Configuración de impresión.
   *
   * SheetJS no tiene una API idéntica
   * a ExcelJS para pageSetup. Algunas
   * propiedades se agregan directamente
   * al worksheet.
   */
  ws["!print_area"] = [
    "C3:M" + salidaLast,
  ];

  return wb;
}

/* ---------------------------------------------------------
   COMPONENTE
--------------------------------------------------------- */

function todayISO() {
  const d = new Date();

  return `${d.getFullYear()}-${pad2(
    d.getMonth() + 1
  )}-${pad2(d.getDate())}`;
}

const box = {
  width: "100%",
  minHeight: 170,
  padding: 14,
  boxSizing: "border-box",
  resize: "vertical",
  fontFamily: "monospace",
  fontSize: 14,
  border: "1px solid #ccc",
  borderRadius: 8,
  outline: "none",
};

const inputStyle = {
  padding: "8px 10px",
  border: "1px solid #ccc",
  borderRadius: 6,
  fontSize: 14,
};

export default function TextToExcel() {
  const [textEntrada, setTextEntrada] =
    useState("");

  const [textSalida, setTextSalida] =
    useState("");

  const [fecha, setFecha] =
    useState(todayISO());

  const [supervisor, setSupervisor] =
    useState("DIAZ ANDRES");

  const [observaciones, setObservaciones] =
    useState(".");

  const [generated, setGenerated] =
    useState(false);

  const parsed = useMemo(() => {
    const e = parseText(
      textEntrada,
      "entrada"
    );

    const s = parseText(
      textSalida,
      "salida"
    );

    return {
      entradaEntries: e.entries,
      salidaEntries: s.entries,
      errors: [
        ...e.errors,
        ...s.errors,
      ],
    };
  }, [textEntrada, textSalida]);

  const sections = useMemo(
    () =>
      buildSections(
        parsed.entradaEntries,
        parsed.salidaEntries
      ),
    [parsed]
  );

  const total =
    parsed.entradaEntries.length +
    parsed.salidaEntries.length;

  const previewRows = useMemo(() => {
    const out = [];

    const push = (
      seccion,
      lugar,
      rows
    ) =>
      rows.forEach((r) =>
        out.push({
          seccion,
          lugar,
          ...r,
        })
      );

    push(
      "ENTRADA",
      "Corredor",
      sections.entrada.corredor
    );

    sections.entrada.blocks.forEach(
      (b) =>
        push(
          "ENTRADA",
          casLabel(b.cas),
          b.rows
        )
    );

    push(
      "ENTRADA",
      "Micro",
      sections.entrada.micro
    );

    sections.salida.blocks.forEach(
      (b) =>
        push(
          "SALIDA",
          casLabel(b.cas),
          b.rows
        )
    );

    return out;
  }, [sections]);

  async function generateExcel() {
    if (!total) {
      alert(
        "No se encontraron datos válidos para generar el Excel."
      );

      return;
    }

    const wb = buildWorkbook({
      entradaEntries:
        parsed.entradaEntries,

      salidaEntries:
        parsed.salidaEntries,

      fecha,

      supervisor:
        supervisor
          .trim()
          .toUpperCase(),

      observaciones:
        observaciones.trim(),
    });

    /*
     * SheetJS genera directamente el
     * archivo XLSX.
     */
    XLSX.writeFile(
      wb,
      fileNameFor(fecha)
    );

    setGenerated(true);
  }

  function clearAll() {
    setTextEntrada("");
    setTextSalida("");
    setGenerated(false);
  }

  function loadExample() {
    setTextEntrada(
      EXAMPLE_ENTRADA
    );

    setTextSalida(
      EXAMPLE_SALIDA
    );

    setGenerated(false);
  }

  const onText =
    (setter) => (e) => {
      setter(e.target.value);
      setGenerated(false);
    };

  return (
    <div
      style={{
        maxWidth: 1000,
        margin: "40px auto",
        padding: "0 20px",
        fontFamily:
          "Arial, sans-serif",
      }}
    >
      <h1 style={{ marginBottom: 8 }}>
        Texto → Planilla E/S
      </h1>

      <p
        style={{
          color: "#666",
          marginTop: 0,
        }}
      >
        Pegá la planificación de cada
        grupo y generá la planilla de
        relevos en Excel. Formato:
        {" "}
        <code>
          NombreCAS8 23:00-0:48 /
          CAS3 05:00-06:00
        </code>
        . Destinos especiales:
        {" "}
        <code>SALIDA [CAS n]</code>,
        {" "}
        <code>CORREDOR</code>,
        {" "}
        <code>MICRO</code>.
      </p>

      <div
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <label>
          Fecha de inicio{" "}
          <input
            type="date"
            value={fecha}
            onChange={(e) =>
              setFecha(e.target.value)
            }
            style={inputStyle}
          />
        </label>

        <label>
          Supervisor TN{" "}
          <input
            value={supervisor}
            onChange={(e) =>
              setSupervisor(
                e.target.value
              )
            }
            style={inputStyle}
          />
        </label>

        <label>
          Observaciones{" "}
          <input
            value={observaciones}
            onChange={(e) =>
              setObservaciones(
                e.target.value
              )
            }
            style={inputStyle}
          />
        </label>
      </div>

      <div
        style={{ marginBottom: 12 }}
      >
        <button
          onClick={loadExample}
          style={{
            padding: "8px 12px",
            marginRight: 8,
            cursor: "pointer",
          }}
        >
          Cargar ejemplo
        </button>

        <button
          onClick={clearAll}
          style={{
            padding: "8px 12px",
            cursor: "pointer",
          }}
        >
          Limpiar
        </button>
      </div>

      <h3
        style={{ marginBottom: 6 }}
      >
        Inspectores ENTRADA
      </h3>

      <textarea
        value={textEntrada}
        onChange={onText(
          setTextEntrada
        )}
        placeholder={EXAMPLE_ENTRADA}
        style={box}
      />

      <h3
        style={{ marginBottom: 6 }}
      >
        Inspectores SALIDA
      </h3>

      <textarea
        value={textSalida}
        onChange={onText(
          setTextSalida
        )}
        placeholder={EXAMPLE_SALIDA}
        style={box}
      />

      <div
        style={{
          display: "flex",
          justifyContent:
            "space-between",
          alignItems: "center",
          marginTop: 14,
          marginBottom: 14,
        }}
      >
        <div>
          <strong>{total}</strong>{" "}
          tramos detectados

          {parsed.errors.length >
            0 && (
            <span
              style={{
                color: "#b45309",
                marginLeft: 12,
              }}
            >
              {
                parsed.errors.length
              }{" "}
              problema(s)
            </span>
          )}
        </div>

        <button
          onClick={generateExcel}
          disabled={!total}
          style={{
            padding: "11px 20px",
            border: "none",
            borderRadius: 8,
            background: total
              ? "#111"
              : "#aaa",
            color: "#fff",
            cursor: total
              ? "pointer"
              : "not-allowed",
            fontWeight: "bold",
          }}
        >
          Generar Excel
        </button>
      </div>

      {generated && (
        <div
          style={{
            padding: 12,
            marginBottom: 16,
            borderRadius: 8,
            background: "#ecfdf5",
            border:
              "1px solid #a7f3d0",
          }}
        >
          ✓ Excel generado
          correctamente (
          {fileNameFor(fecha)}).
        </div>
      )}

      {previewRows.length > 0 && (
        <div
          style={{
            overflowX: "auto",
          }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse:
                "collapse",
              fontSize: 14,
            }}
          >
            <thead>
              <tr>
                {[
                  "Sección",
                  "Casilla",
                  "Agente",
                  "Entrada",
                  "Salida",
                ].map((c) => (
                  <th
                    key={c}
                    style={{
                      textAlign: "left",
                      padding: 10,
                      borderBottom:
                        "2px solid #222",
                    }}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {previewRows.map(
                (r, i) => (
                  <tr key={i}>
                    {[
                      r.seccion,
                      r.lugar,
                      r.name,
                      fmtTime(r.start),
                      fmtTime(r.end),
                    ].map(
                      (v, j) => (
                        <td
                          key={j}
                          style={{
                            padding: 10,
                            borderBottom:
                              "1px solid #ddd",
                          }}
                        >
                          {v}
                        </td>
                      )
                    )}
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}

      {parsed.errors.length >
        0 && (
        <details
          style={{ marginTop: 24 }}
          open
        >
          <summary
            style={{
              cursor: "pointer",
              color: "#b45309",
              fontWeight: "bold",
            }}
          >
            Ver líneas que no
            pudieron interpretarse
          </summary>

          <div
            style={{ marginTop: 10 }}
          >
            {parsed.errors.map(
              (error, index) => (
                <div
                  key={index}
                  style={{
                    padding: 10,
                    marginBottom: 6,
                    background:
                      "#fffbeb",
                    border:
                      "1px solid #fde68a",
                    borderRadius: 6,
                  }}
                >
                  <strong>
                    {error.seccion.toUpperCase()}{" "}
                    · línea{" "}
                    {error.linea}:
                  </strong>{" "}
                  {error.motivo}

                  <div
                    style={{
                      marginTop: 4,
                      fontFamily:
                        "monospace",
                    }}
                  >
                    {error.texto}
                  </div>
                </div>
              )
            )}
          </div>
        </details>
      )}
    </div>
  );
}
