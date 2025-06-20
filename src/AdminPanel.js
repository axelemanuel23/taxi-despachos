import { useEffect, useState } from "react";

const API_URL = "https://taxi-despachos-sv.onrender.com:3001/taxi";

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

  useEffect(() => {
    const cargarDatos = async () => {
      const resTaxis = await fetch(`${API_URL}/taxis`);
      const taxis = await resTaxis.json();
      setLista(taxis.sort((a, b) => a.orden - b.orden));

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
      orden: lista.length,
    };
    await fetch(`${API_URL}/taxis`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nuevoTaxi),
    });
    setLista([...lista, nuevoTaxi]);
    setNuevoId("");
  };

  const cambiarEstado = async (id) => {
    const nuevaLista = lista.map((taxi) =>
      taxi.id === id
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
    const indexDisponible = lista.findIndex(
      (taxi) => taxi.estado === "disponible"
    );
    if (indexDisponible === -1) {
      alert("No hay taxis disponibles para despachar.");
      return;
    }

    const taxiDespachado = lista[indexDisponible];
    alert(`Despachado taxi: ${taxiDespachado.id}`);

    const penalizados = lista
      .slice(0, indexDisponible)
      .filter((taxi) => taxi.estado === "no disponible");

    const nuevaLista = [
      ...lista
        .slice(indexDisponible + 1)
        .filter((t) => !penalizados.some((p) => p.id === t.id)),
      { ...taxiDespachado, estado: "no disponible" },
      ...penalizados,
    ];

    const listaConOrden = nuevaLista.map((taxi, i) => ({ ...taxi, orden: i }));
    setLista(listaConOrden);

    for (const taxi of listaConOrden) {
      await actualizarEnDB(taxi);
    }

    await fetch(`${API_URL}/stats/incrementar`, { method: "POST" });
    setContadorDespachos((prev) => prev + 1);
  };

  const tabelaBaja = async () => {
    const disponibleReversa = [...lista]
      .reverse()
      .find((taxi) => taxi.estado === "disponible" && !taxi.TB);
    if (!disponibleReversa) {
      alert("No hay taxis disponibles para tabela baja.");
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

  const obtenerColorEstado = (estado) => {
    return estado === "disponible"
      ? "bg-green-200 text-green-900"
      : "bg-red-200 text-red-900";
  };

  return (
    <div className="max-w-xl mx-auto p-4 space-y-4">
      <h1 className="text-2xl font-bold">Panel de Administración</h1>

      <div className="flex gap-2">
        <Input
          placeholder="ID Taxi"
          value={nuevoId}
          onChange={(e) => setNuevoId(e.target.value)}
        />
        <Button onClick={agregarTaxi}>Agregar</Button>
      </div>

      <div className="flex gap-2">
        <Button className="w-full" onClick={despachar}>
          Despachar siguiente taxi disponible
        </Button>
        <Button className="w-full bg-purple-600 hover:bg-purple-700" onClick={tabelaBaja}>
          Tabela baja
        </Button>
      </div>

      <div className="text-sm text-gray-600">
        Total despachos reales: <span className="font-semibold text-black">{contadorDespachos}</span>
      </div>

      <div className="space-y-2">
        {lista.length === 0 && <p className="text-gray-600">No hay taxis en la lista.</p>}
        {lista
          .sort((a, b) => a.orden - b.orden)
          .map((taxi) => (
            <div
              key={taxi.id}
              onClick={() => cambiarEstado(taxi.id)}
              className={`cursor-pointer p-2 rounded shadow ${obtenerColorEstado(taxi.estado)}`}
              title="Click para cambiar estado"
            >
              {taxi.id} {taxi.TB && <em className="text-sm text-purple-800">(TB)</em>}
            </div>
          ))}
      </div>
    </div>
  );
}
