import React, { useMemo, useRef, useState } from "react";
import { fillTemplate, casLabel } from "./fillTemplate";

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

const fmtTime = (min) =>
  `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;

/* ---------------------------------------------------------
   COMPONENTE
--------------------------------------------------------- */

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  const [textEntrada, setTextEntrada] = useState("");
  const [textSalida, setTextSalida] = useState("");
  const [fecha, setFecha] = useState(todayISO());
  const [supervisor, setSupervisor] = useState("DIAZ ANDRES");
  const [observaciones, setObservaciones] = useState(".");
  const [generated, setGenerated] = useState(false);

  const [template, setTemplate] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef(null);

  const parsed = useMemo(() => {
    const e = parseText(textEntrada, "entrada");
    const s = parseText(textSalida, "salida");

    return {
      entradaEntries: e.entries,
      salidaEntries: s.entries,
      errors: [...e.errors, ...s.errors],
    };
  }, [textEntrada, textSalida]);

  const sections = useMemo(
    () => buildSections(parsed.entradaEntries, parsed.salidaEntries),
    [parsed]
  );

  const total = parsed.entradaEntries.length + parsed.salidaEntries.length;

  const previewRows = useMemo(() => {
    const out = [];

    const push = (seccion, lugar, rows) =>
      rows.forEach((r) => out.push({ seccion, lugar, ...r }));

    push("ENTRADA", "Corredor", sections.entrada.corredor);

    sections.entrada.blocks.forEach((b) =>
      push("ENTRADA", casLabel(b.cas), b.rows)
    );

    push("ENTRADA", "Micro", sections.entrada.micro);

    sections.salida.blocks.forEach((b) =>
      push("SALIDA", casLabel(b.cas), b.rows)
    );

    return out;
  }, [sections]);

  function onTemplate(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = ""; // permite volver a elegir el mismo archivo

    if (!file) return;

    if (!/\.xlsx$/i.test(file.name)) {
      setError("La plantilla debe ser un archivo .xlsx.");
      return;
    }

    setTemplate(file);
    setError("");
    setGenerated(false);
  }

  async function generateExcel() {
    setError("");

    if (!total) {
      setError("No se encontraron datos válidos para generar el Excel.");
      return;
    }

    if (!template) {
      setError("Adjuntá primero la plantilla .xlsx.");
      return;
    }

    try {
      setBusy(true);

      const { start, end } = datesFrom(fecha);

      const blob = await fillTemplate(template, {
        sections,
        dateText: `${fmtDMY(start, "/")} AL ${fmtDMY(end, "/")}`,
        supervisor: supervisor.trim().toUpperCase(),
        observaciones: observaciones.trim(),
      });

      downloadBlob(blob, fileNameFor(fecha));
      setGenerated(true);
    } catch (err) {
      setGenerated(false);
      setError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  function clearAll() {
    setTextEntrada("");
    setTextSalida("");
    setGenerated(false);
    setError("");
  }

  function loadExample() {
    setTextEntrada(EXAMPLE_ENTRADA);
    setTextSalida(EXAMPLE_SALIDA);
    setGenerated(false);
  }

  const onText = (setter) => (e) => {
    setter(e.target.value);
    setGenerated(false);
  };

  const canGenerate = total > 0 && !!template && !busy;

  return (
    <div
      style={{
        maxWidth: 1000,
        margin: "40px auto",
        padding: "0 20px",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <h1 style={{ marginBottom: 8 }}>Texto → Planilla E/S</h1>

      <p style={{ color: "#666", marginTop: 0 }}>
        Adjuntá la plantilla de Excel, pegá la planificación de cada grupo y
        se completarán los datos en el archivo. Formato:{" "}
        <code>NombreCAS8 23:00-0:48 / CAS3 05:00-06:00</code>. Destinos
        especiales: <code>SALIDA [CAS n]</code>, <code>CORREDOR</code>,{" "}
        <code>MICRO</code>.
      </p>

      {/* ---- Plantilla ---- */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          padding: 12,
          marginBottom: 16,
          border: "1px dashed #aaa",
          borderRadius: 8,
        }}
      >
        <button
          onClick={() => fileRef.current && fileRef.current.click()}
          style={{ padding: "8px 12px", cursor: "pointer" }}
        >
          {template ? "Cambiar plantilla" : "Adjuntar plantilla (.xlsx)"}
        </button>

        <span style={{ color: template ? "#111" : "#888" }}>
          {template ? `📎 ${template.name}` : "Ningún archivo adjunto"}
        </span>

        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={onTemplate}
          style={{ display: "none" }}
        />
      </div>

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
            onChange={(e) => setFecha(e.target.value)}
            style={inputStyle}
          />
        </label>

        <label>
          Supervisor TN{" "}
          <input
            value={supervisor}
            onChange={(e) => setSupervisor(e.target.value)}
            style={inputStyle}
          />
        </label>

        <label>
          Observaciones{" "}
          <input
            value={observaciones}
            onChange={(e) => setObservaciones(e.target.value)}
            style={inputStyle}
          />
        </label>
      </div>

      <div style={{ marginBottom: 12 }}>
        <button
          onClick={loadExample}
          style={{ padding: "8px 12px", marginRight: 8, cursor: "pointer" }}
        >
          Cargar ejemplo
        </button>

        <button
          onClick={clearAll}
          style={{ padding: "8px 12px", cursor: "pointer" }}
        >
          Limpiar
        </button>
      </div>

      <h3 style={{ marginBottom: 6 }}>Inspectores ENTRADA</h3>

      <textarea
        value={textEntrada}
        onChange={onText(setTextEntrada)}
        placeholder={EXAMPLE_ENTRADA}
        style={box}
      />

      <h3 style={{ marginBottom: 6 }}>Inspectores SALIDA</h3>

      <textarea
        value={textSalida}
        onChange={onText(setTextSalida)}
        placeholder={EXAMPLE_SALIDA}
        style={box}
      />

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 14,
          marginBottom: 14,
        }}
      >
        <div>
          <strong>{total}</strong> tramos detectados
          {parsed.errors.length > 0 && (
            <span style={{ color: "#b45309", marginLeft: 12 }}>
              {parsed.errors.length} problema(s)
            </span>
          )}
        </div>

        <button
          onClick={generateExcel}
          disabled={!canGenerate}
          style={{
            padding: "11px 20px",
            border: "none",
            borderRadius: 8,
            background: canGenerate ? "#111" : "#aaa",
            color: "#fff",
            cursor: canGenerate ? "pointer" : "not-allowed",
            fontWeight: "bold",
          }}
        >
          {busy ? "Generando…" : "Generar Excel"}
        </button>
      </div>

      {error && (
        <div
          style={{
            padding: 12,
            marginBottom: 16,
            borderRadius: 8,
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#991b1b",
            whiteSpace: "pre-wrap",
          }}
        >
          {error}
        </div>
      )}

      {generated && (
        <div
          style={{
            padding: 12,
            marginBottom: 16,
            borderRadius: 8,
            background: "#ecfdf5",
            border: "1px solid #a7f3d0",
          }}
        >
          ✓ Excel generado correctamente ({fileNameFor(fecha)}).
        </div>
      )}

      {previewRows.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 14,
            }}
          >
            <thead>
              <tr>
                {["Sección", "Casilla", "Agente", "Entrada", "Salida"].map(
                  (c) => (
                    <th
                      key={c}
                      style={{
                        textAlign: "left",
                        padding: 10,
                        borderBottom: "2px solid #222",
                      }}
                    >
                      {c}
                    </th>
                  )
                )}
              </tr>
            </thead>

            <tbody>
              {previewRows.map((r, i) => (
                <tr key={i}>
                  {[
                    r.seccion,
                    r.lugar,
                    r.name,
                    fmtTime(r.start),
                    fmtTime(r.end),
                  ].map((v, j) => (
                    <td
                      key={j}
                      style={{
                        padding: 10,
                        borderBottom: "1px solid #ddd",
                      }}
                    >
                      {v}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {parsed.errors.length > 0 && (
        <details style={{ marginTop: 24 }} open>
          <summary
            style={{
              cursor: "pointer",
              color: "#b45309",
              fontWeight: "bold",
            }}
          >
            Ver líneas que no pudieron interpretarse
          </summary>

          <div style={{ marginTop: 10 }}>
            {parsed.errors.map((e, i) => (
              <div
                key={i}
                style={{
                  padding: 10,
                  marginBottom: 6,
                  background: "#fffbeb",
                  border: "1px solid #fde68a",
                  borderRadius: 6,
                }}
              >
                <strong>
                  {e.seccion.toUpperCase()} · línea {e.linea}:
                </strong>{" "}
                {e.motivo}
                <div style={{ marginTop: 4, fontFamily: "monospace" }}>
                  {e.texto}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
