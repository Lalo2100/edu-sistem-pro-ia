const fs = require('fs');
const path = require('path');

module.exports = (req, res) => {
  try {
    const file = path.join(process.cwd(), 'biblioteca.json');

    if (!fs.existsSync(file)) {
      return res.status(404).json({
        error: 'No se encontró biblioteca.json'
      });
    }

    const biblioteca = JSON.parse(
      fs.readFileSync(file, 'utf8')
    );

    return res.status(200).json(biblioteca);

  } catch (error) {
    console.error('Error leyendo biblioteca:', error);

    return res.status(500).json({
      error: 'No se pudo cargar la biblioteca.'
    });
  }
};
