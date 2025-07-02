import { useEffect, useState } from "react";

const API_URL = "https://taxi-despachos-sv.onrender.com";

export default function ConsultaPanel() {
  const [aeropuerto, setAeropuerto] = useState([]);
  const [cataratas, setCataratas] = useState([]);
  const [cincoEsquinas, setCincoEsquinas] = useState([]);
  const [despachos, setDespachos] = useState(0);

  useEffect(() => {
    const cargarDatos = async () => {
      const taxisRes = await fetch(`${API_URL}/taxis`);
      const taxis = await taxisRes.json();

      setAeropuerto(
        taxis
          .filter((t) => t.parada === "aeropuerto")
          .sort((a, b) => a.orden - b.orden)
      );
      setCataratas(
        taxis
          .filter((t) => t.parada === "cataratas")
          .sort((a, b) => a.orden - b.orden)
      );
      setCincoEsquinas(
        taxis
          .filter((t) => t.parada === "cinco_esquinas")
          .sort((a, b) => a.orden - b.orden)
      );

      const statsRes = await fetch(`${API_URL}/stats`);
      const stats = await statsRes.json();
      setDespachos(stats.despachos);
    };

    cargarDatos();
  }, []);

  const obtenerColorEstado = (estado) => {
    return estado === "disponible"
      ? "bg-green-200 text-green-900"
      : "bg-red-200 text-red-900";
  };

  const renderParada = (titulo, lista) => (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold mt-4">{titulo}</h2>
      {lista.length === 0 && <p className="text-gray-600">No hay taxis.</p>}
      {lista.map((taxi) => (
        <div
          key={taxi.id}
          className={`p-2 rounded shadow ${obtenerColorEstado(taxi.estado)}`}
          title={`Tabela Baja: ${taxi.TB ? "Sí" : "No"}`}
        >
          <strong>{taxi.id}</strong> — {taxi.estado}
          {taxi.TB && <em className="text-sm text-purple-800"> (TB)</em>}
        </div>
      ))}
    </div>
  );

  return (
    <div className="max-w-xl mx-auto p-4 space-y-4">
      <h1 className="text-2xl font-bold">Consulta de Taxis</h1>

      <div className="text-sm text-gray-600">
        Total de despachos reales:{" "}
        <span className="font-semibold text-black">{despachos}</span>
      </div>

      {renderParada("✈️ Aeropuerto", aeropuerto)}
      {renderParada("🛣️ Cinco Esquinas", cincoEsquinas)}
      {renderParada("🌊 Cataratas", cataratas)}
    </div>
  );
}
