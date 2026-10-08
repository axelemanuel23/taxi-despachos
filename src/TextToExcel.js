import React, { useMemo, useState } from "react";
import * as XLSX from "xlsx";

const EXAMPLE_TEXT = `00:00-01:40 -> Ag1 - E16 | Ag2 - E12
01:40-03:07 -> Ag3 - E16
03:07-04:34 -> Ag4 - E16
04:34-05:00 -> Ag5 - E16
05:00-06:00 -> Ag5 - S7 | Ag6 - S8`;

function parseText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const rows = [];
  const errors = [];

  lines.forEach((line, index) => {
    /*
      Detecta horarios como:
      00:00-01:40
      00:00 - 01:40
      00:00/01:40
      00:00 → 01:40
    */
    const timeMatch = line.match(
      /(\d{1,2}:\d{2})\s*(?:-|–|—|\/|→|->)\s*(\d{1,2}:\d{2})/
    );

    if (!timeMatch) {
      errors.push({
        linea: index + 1,
        texto: line,
        motivo: "No se encontró un horario válido.",
      });
      return;
    }

    const inicio = timeMatch[1].padStart(5, "0");
    const fin = timeMatch[2].padStart(5, "0");

    // Todo lo que queda después del horario.
    const dataPart = line
      .replace(timeMatch[0], "")
      .replace(/^\s*(?:->|→|:|-)\s*/, "")
      .trim();

    /*
      Separamos agentes/casillas cuando hay "|"

      Ejemplo:
      Ag1 - E16 | Ag2 - E12
    */
    const assignments = dataPart
      .split("|")
      .map((item) => item.trim())
      .filter(Boolean);

    if (!assignments.length) {
      errors.push({
        linea: index + 1,
        texto: line,
        motivo: "No se encontraron asignaciones.",
      });
      return;
    }

    assignments.forEach((assignment) => {
      /*
        Acepta:
        Ag1 - E16
        Ag1 | E16
        Ag1: E16
        Ag1 E16

        Casillas esperadas:
        E1 ... E16
        S1 ... S11
      */
      const casillaMatch = assignment.match(/\b([ES]\d{1,2})\b/i);

      if (!casillaMatch) {
        errors.push({
          linea: index + 1,
          texto: assignment,
          motivo: "No se encontró una casilla E/S.",
        });
        return;
      }

      const casilla = casillaMatch[1].toUpperCase();

      let agente = assignment
        .replace(casillaMatch[0], "")
        .replace(/[-:>]+/g, " ")
        .trim();

      /*
        Si viene "Ag1" lo dejamos como está.
        También acepta "Agente 1".
      */
      agente = agente.replace(/\s+/g, " ");

      rows.push({
        Inicio: inicio,
        Fin: fin,
        Agente: agente,
        Casilla: casilla,
      });
    });
  });

  return { rows, errors };
}

export default function TextToExcel() {
  const [text, setText] = useState("");
  const [generated, setGenerated] = useState(false);

  const { rows, errors } = useMemo(() => {
    return parseText(text);
  }, [text]);

  function generateExcel() {
    if (!rows.length) {
      alert("No se encontraron datos válidos para generar el Excel.");
      return;
    }

    const worksheet = XLSX.utils.json_to_sheet(rows);

    // Ancho de columnas
    worksheet["!cols"] = [
      { wch: 12 },
      { wch: 12 },
      { wch: 18 },
      { wch: 12 },
    ];

    const workbook = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(
      workbook,
      worksheet,
      "Planificación"
    );

    XLSX.writeFile(workbook, "guardia_nocturna.xlsx");

    setGenerated(true);
  }

  function clearAll() {
    setText("");
    setGenerated(false);
  }

  function loadExample() {
    setText(EXAMPLE_TEXT);
    setGenerated(false);
  }

  return (
    <div
      style={{
        maxWidth: 1000,
        margin: "40px auto",
        padding: "0 20px",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <h1 style={{ marginBottom: 8 }}>
        Texto → Excel
      </h1>

      <p style={{ color: "#666", marginTop: 0 }}>
        Pegá la planificación y generá un archivo Excel automáticamente.
      </p>

      <div style={{ marginBottom: 12 }}>
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

      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setGenerated(false);
        }}
        placeholder={`Pegá acá el texto...

Ejemplo:

00:00-01:40 -> Ag1 - E16 | Ag2 - E12
01:40-03:07 -> Ag3 - E16
03:07-04:34 -> Ag4 - E16
04:34-05:00 -> Ag5 - E16
05:00-06:00 -> Ag5 - S7 | Ag6 - S8`}
        style={{
          width: "100%",
          minHeight: 260,
          padding: 14,
          boxSizing: "border-box",
          resize: "vertical",
          fontFamily: "monospace",
          fontSize: 14,
          border: "1px solid #ccc",
          borderRadius: 8,
          outline: "none",
        }}
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
          <strong>{rows.length}</strong> registros detectados

          {errors.length > 0 && (
            <span style={{ color: "#b45309", marginLeft: 12 }}>
              {errors.length} línea(s) con problemas
            </span>
          )}
        </div>

        <button
          onClick={generateExcel}
          disabled={!rows.length}
          style={{
            padding: "11px 20px",
            border: "none",
            borderRadius: 8,
            background: rows.length ? "#111" : "#aaa",
            color: "#fff",
            cursor: rows.length ? "pointer" : "not-allowed",
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
            border: "1px solid #a7f3d0",
          }}
        >
          ✓ Excel generado correctamente.
        </div>
      )}

      {rows.length > 0 && (
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
                {Object.keys(rows[0]).map((column) => (
                  <th
                    key={column}
                    style={{
                      textAlign: "left",
                      padding: 10,
                      borderBottom: "2px solid #222",
                    }}
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  {Object.values(row).map((value, cellIndex) => (
                    <td
                      key={cellIndex}
                      style={{
                        padding: 10,
                        borderBottom: "1px solid #ddd",
                      }}
                    >
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {errors.length > 0 && (
        <details style={{ marginTop: 24 }}>
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
            {errors.map((error, index) => (
              <div
                key={index}
                style={{
                  padding: 10,
                  marginBottom: 6,
                  background: "#fffbeb",
                  border: "1px solid #fde68a",
                  borderRadius: 6,
                }}
              >
                <strong>Línea {error.linea}:</strong>{" "}
                {error.motivo}

                <div
                  style={{
                    marginTop: 4,
                    fontFamily: "monospace",
                  }}
                >
                  {error.texto}
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}