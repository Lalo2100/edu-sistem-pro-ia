export default function handler(req, res) {
  // Verificamos que sea una petición GET (puedes ajustarlo según tu lógica)
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }

  // Devolvemos los datos de la cuenta en formato JSON
  return res.status(200).json({
    email: "correualejandro484@gmail.com",
    plan: "Gratis",
    generacionesUsadas: 0,
    generacionesDisponibles: 5
  });
}
