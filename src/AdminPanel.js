import { useEffect, useState } from "react";
import { useWindowSize } from "@uidotdev/usehooks";

const API_URL = "http://localhost:3001";

const Button = ({ children, ...props }) => (
  <button
    className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold shadow"
    {...props}
  >
    {children}
  </button>
);

const Input = (props) => (
  <input
    className="border border-gray-300 px-2 py-1 rounded w-full"
    {...props}
  />
);

export default function AdminPanel() {
  const [lista, setLista] = useState([]);
  const [nuevoId, setNuevoId] = useState("");
  const [contadorDespachos, setContadorDespachos] = useState(0);

  const size = useWindowSize();
  const columnas =
    size.width >= 1024 ? 4 : size.width >= 768 ? 3 : size.width >= 480 ? 2 : 1;

  useEffect(() => {
    const cargarDatos = async () => {
      const resTaxis = await fetch(`${API_URL}/taxis`);
      const taxis = await resTaxis.json();
      setLista(taxis);

      const resStats = await fetch(`${API_URL}/stats`);
      const stats = await resStats.json();
      setContadorDespachos(stats.despachos);
    };

    cargarDatos();
  }, []);

  const actualizarEnDB = async (taxi) => {
    await fetch(`${API_URL}/taxis/${taxi.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(taxi),
    });
  };

  const agregarTaxi = async () => {
    if (nuevoId.trim() === "") return;
    const nuevoTaxi = {
      id: nuevoId.trim(),
      estado: "no disponible",
      TB: false,
      orden: lista.filter((t) => t.parada === "aeropuerto").length,
      parada: "aeropuerto", // <- esto es clave
    };

    try {
      const res = await fetch(`${API_URL}/taxis`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nuevoTaxi),
      });

      if (!res.ok) {
        const { mensaje } = await res.json();
        alert(mensaje || "Error al agregar taxi.");
        return;
      }

      const taxiCreado = await res.json();
      setLista((prev) => [...prev, taxiCreado]);
      setNuevoId("");
    } catch (error) {
      console.error("Error al agregar taxi:", error);
      alert("Hubo un error al conectar con el servidor.");
    }
  };

  const cambiarEstado = async (id) => {
    // Solo cambia estado para taxis en aeropuerto
    const nuevaLista = lista.map((taxi) =>
      taxi.id === id && taxi.parada === "aeropuerto"
        ? {
            ...taxi,
            estado:
              taxi.estado === "no disponible" ? "disponible" : "no disponible",
          }
        : taxi
    );
    setLista(nuevaLista);
    const taxiActualizado = nuevaLista.find((t) => t.id === id);
    await actualizarEnDB(taxiActualizado);
  };

  const despachar = async () => {
    // Filtrar disponibles sólo en aeropuerto
    const disponiblesAeropuerto = lista.filter(
      (t) => t.estado === "disponible" && t.parada === "aeropuerto"
    );
    if (disponiblesAeropuerto.length === 0) {
      alert("No hay taxis disponibles para despachar en aeropuerto.");
      return;
    }

    const indexDisponible = lista.findIndex(
      (taxi) => taxi.estado === "disponible" && taxi.parada === "aeropuerto"
    );

    const taxiDespachado = lista[indexDisponible];
    alert(`Despachado taxi: ${taxiDespachado.id}`);

    const penalizados = lista
      .slice(0, indexDisponible)
      .filter(
        (taxi) =>
          taxi.estado === "no disponible" && taxi.parada === "aeropuerto"
      );

    // Reconstruir lista afectando sólo aeropuerto
    const nuevaLista = [
      ...lista
        .slice(indexDisponible + 1)
        .filter(
          (t) =>
            !penalizados.some((p) => p.id === t.id) && t.parada === "aeropuerto"
        ),
      { ...taxiDespachado, estado: "no disponible" },
      ...penalizados,
      ...lista.filter((t) => t.parada !== "aeropuerto"), // taxis en otras paradas sin cambio
    ];

    // Reasignar orden sólo a taxis en aeropuerto
    const aeropuertoActualizados = nuevaLista
      .filter((t) => t.parada === "aeropuerto")
      .map((t, i) => ({ ...t, orden: i }));

    // Combinar con taxis de otras paradas
    const finalLista = [
      ...aeropuertoActualizados,
      ...nuevaLista.filter((t) => t.parada !== "aeropuerto"),
    ];

    setLista(finalLista);

    for (const taxi of aeropuertoActualizados) {
      await actualizarEnDB(taxi);
    }

    await fetch(`${API_URL}/stats/incrementar`, { method: "POST" });
    setContadorDespachos((prev) => prev + 1);
  };

  const tabelaBaja = async () => {
    const disponibleReversa = [...lista]
      .reverse()
      .find(
        (taxi) =>
          taxi.estado === "disponible" &&
          !taxi.TB &&
          taxi.parada === "aeropuerto"
      );

    if (!disponibleReversa) {
      alert("No hay taxis disponibles para tabela baja en aeropuerto.");
      return;
    }

    const nuevoEstado = lista.map((taxi) =>
      taxi.id === disponibleReversa.id
        ? { ...taxi, estado: "no disponible", TB: true }
        : taxi
    );
    setLista(nuevoEstado);
    await actualizarEnDB({
      ...disponibleReversa,
      estado: "no disponible",
      TB: true,
    });
    alert(`Taxi ${disponibleReversa.id} hizo tabela baja`);
  };

  const cerrarDia = async () => {
    try {
      const res = await fetch(`${API_URL}/taxis`);
      const taxisDB = await res.json();
  
      if (!taxisDB.length) {
        alert("No hay taxis para cerrar el día.");
        return;
      }
  
      // Clasificar taxis por parada
      const cincoEsquinas = taxisDB
        .filter((t) => t.parada === "cinco_esquinas")
        .sort((a, b) => a.orden - b.orden);
  
      const cataratas = taxisDB
        .filter((t) => t.parada === "cataratas")
        .sort((a, b) => a.orden - b.orden);
  
      const aeropuerto = taxisDB
        .filter((t) => t.parada === "aeropuerto")
        .sort((a, b) => a.orden - b.orden);
  
        const remanentesAeropuerto = aeropuerto;
  
      // Armar nueva lista completa en el orden correcto
      const nuevaLista = [
        ...cincoEsquinas,
        ...cataratas,
        ...aeropuerto
      ].map((taxi, index) => ({
        ...taxi,
        parada: "aeropuerto",
        orden: index
      }));
  
      // Guardar taxis actualizados
      for (const taxi of nuevaLista) {
        await fetch(`${API_URL}/taxis/${taxi.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(taxi)
        });
      }
  
      // Reset contador de despachos
      await fetch(`${API_URL}/stats/reset`, { method: "POST" });
      setContadorDespachos(0);
  
      // Refrescar lista
      setLista(nuevaLista);
  
      alert("Día cerrado correctamente. Todos los taxis fueron reasignados a Aeropuerto.");
    } catch (err) {
      console.error("Error al cerrar el día:", err);
      alert("Ocurrió un error al cerrar el día.");
    }
  };
  
  

  const obtenerColorEstado = (estado) => {
    return estado === "disponible"
      ? "bg-green-200 text-green-900"
      : "bg-red-200 text-red-900";
  };

  const reorganizarPorColumnasPrimero = (lista, columnas) => {
    const ordenada = [...lista].sort((a, b) => a.orden - b.orden);
    const total = ordenada.length;
    const baseFilas = Math.floor(total / columnas);
    const columnasConFilaExtra = total % columnas;

    const columnasArray = [];
    let index = 0;

    for (let col = 0; col < columnas; col++) {
      const filasEnCol = baseFilas + (col < columnasConFilaExtra ? 1 : 0);
      const colData = [];
      for (let i = 0; i < filasEnCol; i++) {
        if (index < total) {
          colData.push(ordenada[index++]);
        }
      }
      columnasArray.push(colData);
    }

    const resultado = [];
    const maxFilas = Math.max(...columnasArray.map((c) => c.length));
    for (let fila = 0; fila < maxFilas; fila++) {
      for (let col = 0; col < columnas; col++) {
        const item = columnasArray[col][fila];
        if (item) resultado.push(item);
      }
    }

    return resultado;
  };

  // Solo ordenamos la lista de aeropuerto para visualización
  const listaAeropuerto = lista.filter((t) => t.parada === "aeropuerto");
  const listaOrdenada = reorganizarPorColumnasPrimero(
    listaAeropuerto,
    columnas
  );

  // Listas para cataratas y cinco esquinas (orden simple asc por orden)
  const listaCataratas = lista
    .filter((t) => t.parada === "cataratas")
    .sort((a, b) => a.orden - b.orden);
  const listaCincoEsquinas = lista
    .filter((t) => t.parada === "cinco_esquinas")
    .sort((a, b) => a.orden - b.orden);

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4">
      <h1 className="text-2xl font-bold">Panel de Administración</h1>

      <div className="flex gap-2 flex-wrap">
        <div className="flex gap-2">
          <Input
            placeholder="ID Taxi"
            value={nuevoId}
            onChange={(e) => setNuevoId(e.target.value)}
          />
          <Button onClick={agregarTaxi}>Agregar</Button>
        </div>
        <div className="flex gap-2 flex-col sm:flex-row">
  <Button className="w-full" onClick={despachar}>
    Despachar siguiente taxi disponible
  </Button>

  <Button className="w-full bg-purple-600 hover:bg-purple-700" onClick={tabelaBaja}>
    Tabela baja
  </Button>

  <Button className="w-full bg-red-600 hover:bg-red-700" onClick={cerrarDia}>
    Cerrar día y reasignar taxis
  </Button>
</div>
        <div className="flex flex-wrap gap-4">
          {/* Aeropuerto */}
          <div className="flex-1 min-w-[280px]">
            <h2 className="font-semibold mb-2">✈️ Aeropuerto</h2>
            <div
              className={`grid gap-3`}
              style={{ gridTemplateColumns: `repeat(${columnas}, 1fr)` }}
            >
              {listaOrdenada.length === 0 ? (
                <p className="text-gray-600">No hay taxis en aeropuerto.</p>
              ) : (
                listaOrdenada.map((taxi) => (
                  <div
                    key={taxi.id}
                    onClick={() => cambiarEstado(taxi.id)}
                    className={`cursor-pointer p-3 rounded shadow text-center transition hover:scale-105 duration-200 ${obtenerColorEstado(
                      taxi.estado
                    )}`}
                    title="Click para cambiar estado"
                  >
                    <span className="font-semibold text-lg">{taxi.id}</span>{" "}
                    {taxi.TB && (
                      <em className="block text-sm text-purple-800">(TB)</em>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Cinco Esquinas */}
          <div className="flex-1 min-w-[280px]">
            <h2 className="text-lg font-semibold mb-2">🛣️ Cinco Esquinas</h2>
            {lista.filter((t) => t.parada === "cinco_esquinas").length === 0 ? (
              <p className="text-gray-600">No hay taxis en cinco esquinas.</p>
            ) : (
              lista
                .filter((t) => t.parada === "cinco_esquinas")
                .sort((a, b) => a.orden - b.orden)
                .map((taxi) => (
                  <div
                    key={taxi.id}
                    className={`p-2 rounded shadow ${obtenerColorEstado(
                      taxi.estado
                    )}`}
                    title={`Tabela Baja: ${taxi.TB ? "Sí" : "No"}`}
                  >
                    <strong>{taxi.id}</strong> — {taxi.estado}{" "}
                    {taxi.TB && (
                      <em className="text-sm text-purple-800">(TB)</em>
                    )}
                  </div>
                ))
            )}
          </div>

          {/* Cataratas */}
          <div className="flex-1 min-w-[280px]">
            <h2 className="text-lg font-semibold mb-2">🌊 Cataratas</h2>
            {lista.filter((t) => t.parada === "cataratas").length === 0 ? (
              <p className="text-gray-600">No hay taxis en cataratas.</p>
            ) : (
              lista
                .filter((t) => t.parada === "cataratas")
                .sort((a, b) => a.orden - b.orden)
                .map((taxi) => (
                  <div
                    key={taxi.id}
                    className={`p-2 rounded shadow ${obtenerColorEstado(
                      taxi.estado
                    )}`}
                    title={`Tabela Baja: ${taxi.TB ? "Sí" : "No"}`}
                  >
                    <strong>{taxi.id}</strong> — {taxi.estado}{" "}
                    {taxi.TB && (
                      <em className="text-sm text-purple-800">(TB)</em>
                    )}
                  </div>
                ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
