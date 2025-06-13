import { useState } from "react";

const Button = ({ children, ...props }) => (
  <button
    className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm"
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

export default function TaxiDespacho() {
  const [lista, setLista] = useState([]);
  const [nuevoId, setNuevoId] = useState("");

  const agregarTaxi = () => {
    if (nuevoId.trim() === "") return;
    setLista([...lista, { id: nuevoId.trim(), estado: "no disponible" }]);
    setNuevoId("");
  };

  const cambiarEstado = (id) => {
    setLista((prev) =>
      prev.map((taxi) =>
        taxi.id === id
          ? { ...taxi, estado: taxi.estado === "no disponible" ? "disponible" : "no disponible" }
          : taxi
      )
    );
  };

  const despachar = () => {
    if (lista.length === 0) return;

    const indexDisponible = lista.findIndex((taxi) => taxi.estado === "disponible");
    if (indexDisponible === -1) {
      alert("No hay taxis disponibles para despachar.");
      return;
    }

    const taxiDespachado = lista[indexDisponible];
    alert(`Despachado taxi: ${taxiDespachado.id}`);

    const penalizados = lista.slice(0, indexDisponible).filter((taxi) => taxi.estado === "no disponible");

    const nuevaLista = lista.filter(
      (taxi) =>
        taxi.id !== taxiDespachado.id &&
        !penalizados.some((p) => p.id === taxi.id)
    );

    const taxiReingresado = { ...taxiDespachado, estado: "no disponible" };
    nuevaLista.push(taxiReingresado);
    penalizados.forEach((p) => {
      nuevaLista.push({ ...p, estado: "no disponible" });
    });

    setLista(nuevaLista);
  };

  const obtenerColorEstado = (estado) => {
    return estado === "disponible"
      ? "bg-green-200 text-green-900"
      : "bg-red-200 text-red-900";
  };

  return (
    <div className="max-w-xl mx-auto p-4 space-y-4">
      <h1 className="text-2xl font-bold">Control de Desembarco de Taxis</h1>

      <div className="flex gap-2">
        <Input
          placeholder="ID Taxi"
          value={nuevoId}
          onChange={(e) => setNuevoId(e.target.value)}
        />
        <Button onClick={agregarTaxi}>Agregar</Button>
      </div>

      <Button className="w-full" onClick={despachar}>
        Despachar siguiente taxi disponible
      </Button>

      <div className="space-y-2">
        {lista.length === 0 && <p className="text-gray-600">No hay taxis en la lista.</p>}
        {lista.map((taxi) => (
          <div
            key={taxi.id}
            onClick={() => cambiarEstado(taxi.id)}
            className={`cursor-pointer p-2 rounded shadow ${obtenerColorEstado(
              taxi.estado
            )}`}
            title="Click para cambiar estado"
          >
            {taxi.id}
          </div>
        ))}
      </div>
    </div>
  );
}
