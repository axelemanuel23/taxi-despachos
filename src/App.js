import { useState } from "react";
import TaxiDespacho from "./AdminPanel"; // el que ya tenés
import ConsultaPanel from "./ConsultaPanel";

export default function App() {
  const [modo, setModo] = useState("admin"); // o "consulta"
  const [listaTaxis, setListaTaxis] = useState([]);

  return (
    <div className="p-4">
      <div className="mb-4 flex gap-2">
        <button
          className="px-3 py-1 bg-blue-500 text-white rounded"
          onClick={() => setModo("admin")}
        >
          Modo Administrador
        </button>
        <button
          className="px-3 py-1 bg-gray-500 text-white rounded"
          onClick={() => setModo("consulta")}
        >
          Modo Consulta
        </button>
      </div>

      {modo === "admin" ? (
        <TaxiDespacho lista={listaTaxis} setLista={setListaTaxis} />
      ) : (
        <ConsultaPanel lista={listaTaxis} />
      )}
    </div>
  );
}
