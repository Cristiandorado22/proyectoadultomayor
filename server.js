require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const pool = require('./db');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const CARPETA_IMAGENES = path.join(__dirname, 'public', 'imagenes');
const EXTENSIONES_VALIDAS = ['.jpg', '.jpeg', '.png', '.gif', '.bmp'];
const CANTIDAD_IMAGENES = 5;

// ------------------------------------------------------------
// Configuracion general
// ------------------------------------------------------------
let secreto = process.env.SESSION_SECRET;
if (!secreto || secreto.startsWith('cambie_esto')) {
  secreto = crypto.randomBytes(32).toString('hex');
  console.warn('AVISO: defina SESSION_SECRET en el archivo .env (las sesiones se perderan al reiniciar).');
}

app.use(express.json({ limit: '100kb' }));
app.use(session({
  secret: secreto,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production', // en produccion use HTTPS
    maxAge: 1000 * 60 * 60 * 8                      // 8 horas
  }
}));
app.use(express.static(path.join(__dirname, 'public')));

// ------------------------------------------------------------
// Utilidades
// ------------------------------------------------------------
function texto(valor, max) {
  return typeof valor === 'string' ? valor.trim().slice(0, max) : '';
}

function requiereSesion(req, res, next) {
  if (!req.session.usuario) {
    return res.status(401).json({ error: 'Debe iniciar sesión.' });
  }
  next();
}

function listarImagenes() {
  if (!fs.existsSync(CARPETA_IMAGENES)) return [];
  return fs.readdirSync(CARPETA_IMAGENES).filter(nombre =>
    EXTENSIONES_VALIDAS.includes(path.extname(nombre).toLowerCase())
  );
}

function mezclar(lista) {
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

function guardarSesion(req, usuario) {
  return new Promise((resolve, reject) => {
    // regenerate evita el robo de sesion (session fixation)
    req.session.regenerate(err => {
      if (err) return reject(err);
      req.session.usuario = usuario;
      req.session.save(err2 => (err2 ? reject(err2) : resolve()));
    });
  });
}

// ------------------------------------------------------------
// Cuentas: registro, login, logout
// ------------------------------------------------------------
app.post('/api/registro', async (req, res, next) => {
  try {
    const nombre = texto(req.body.nombreResponsable, 100);
    const usuario = texto(req.body.usuario, 50);
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const confirmar = typeof req.body.confirmar === 'string' ? req.body.confirmar : '';

    if (!nombre || !usuario || !password) {
      return res.status(400).json({ error: 'Complete todos los campos.' });
    }
    if (password.length < 4) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres.' });
    }
    if (password.length > 72) {
      return res.status(400).json({ error: 'La contraseña es demasiado larga (máximo 72).' });
    }
    if (password !== confirmar) {
      return res.status(400).json({ error: 'Las contraseñas no coinciden.' });
    }

    const hash = await bcrypt.hash(password, 10);
    try {
      await pool.execute(
        'INSERT INTO usuarios (usuario, password_hash, nombre_responsable) VALUES (?, ?, ?)',
        [usuario, hash, nombre]
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({ error: 'Ese usuario ya existe. Elija otro.' });
      }
      throw err;
    }
    res.status(201).json({ ok: true, usuario });
  } catch (err) { next(err); }
});

app.post('/api/login', async (req, res, next) => {
  try {
    const usuario = texto(req.body.usuario, 50);
    const password = typeof req.body.password === 'string' ? req.body.password : '';

    if (!usuario || !password) {
      return res.status(400).json({ error: 'Ingrese usuario y contraseña.' });
    }

    const [filas] = await pool.execute(
      'SELECT id, usuario, password_hash, nombre_responsable FROM usuarios WHERE usuario = ?',
      [usuario]
    );
    const fila = filas[0];
    const valido = fila && await bcrypt.compare(password, fila.password_hash);
    if (!valido) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    }

    const datos = { id: fila.id, usuario: fila.usuario, nombreResponsable: fila.nombre_responsable };
    await guardarSesion(req, datos);
    res.json(datos);
  } catch (err) { next(err); }
});

app.post('/api/logout', (req, res, next) => {
  req.session.destroy(err => {
    if (err) return next(err);
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

app.get('/api/yo', (req, res) => {
  res.json({ usuario: req.session.usuario || null });
});

// ------------------------------------------------------------
// Juego de Recuerdos
// ------------------------------------------------------------

// Elige 5 imagenes al azar de la carpeta public/imagenes
app.get('/api/imagenes/aleatorias', requiereSesion, (req, res) => {
  const disponibles = listarImagenes();
  if (disponibles.length < CANTIDAD_IMAGENES) {
    return res.status(500).json({
      error: `Se necesitan al menos ${CANTIDAD_IMAGENES} imágenes en la carpeta public/imagenes. Encontradas: ${disponibles.length}.`
    });
  }
  res.json({ imagenes: mezclar(disponibles).slice(0, CANTIDAD_IMAGENES) });
});

// Guarda una partida completa (equivale al antiguo Resultado_*.txt)
app.post('/api/partidas', requiereSesion, async (req, res, next) => {
  let conexion;
  try {
    const nombrePaciente = texto(req.body.nombrePaciente, 100);
    const respuestas = req.body.respuestas;

    if (!nombrePaciente) {
      return res.status(400).json({ error: 'Falta el nombre del adulto mayor.' });
    }
    if (!Array.isArray(respuestas) || respuestas.length !== CANTIDAD_IMAGENES) {
      return res.status(400).json({ error: `Se esperaban ${CANTIDAD_IMAGENES} respuestas.` });
    }

    const permitidas = new Set(listarImagenes());
    const filas = [];
    for (let i = 0; i < respuestas.length; i++) {
      const imagen = texto(respuestas[i] && respuestas[i].imagen, 255);
      const respuesta = texto(respuestas[i] && respuestas[i].respuesta, 2000);
      if (!permitidas.has(imagen)) {
        return res.status(400).json({ error: 'Imagen no válida en la partida.' });
      }
      filas.push([i + 1, imagen, respuesta]);
    }

    conexion = await pool.getConnection();
    await conexion.beginTransaction();

    const [resultado] = await conexion.execute(
      'INSERT INTO partidas (usuario_id, nombre_paciente) VALUES (?, ?)',
      [req.session.usuario.id, nombrePaciente]
    );
    const partidaId = resultado.insertId;

    await conexion.query(
      'INSERT INTO respuestas (partida_id, orden, imagen, respuesta) VALUES ?',
      [filas.map(f => [partidaId, ...f])]
    );

    await conexion.commit();
    res.status(201).json({ ok: true, partidaId });
  } catch (err) {
    if (conexion) await conexion.rollback().catch(() => {});
    next(err);
  } finally {
    if (conexion) conexion.release();
  }
});

// Historial del responsable que inicio sesion
app.get('/api/partidas', requiereSesion, async (req, res, next) => {
  try {
    const [filas] = await pool.execute(
      `SELECT id, nombre_paciente AS nombrePaciente, fecha
         FROM partidas
        WHERE usuario_id = ?
        ORDER BY fecha DESC, id DESC
        LIMIT 100`,
      [req.session.usuario.id]
    );
    res.json({ partidas: filas });
  } catch (err) { next(err); }
});

app.get('/api/partidas/:id', requiereSesion, async (req, res, next) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'Identificador no válido.' });
    }

    const [partidas] = await pool.execute(
      `SELECT id, nombre_paciente AS nombrePaciente, fecha
         FROM partidas WHERE id = ? AND usuario_id = ?`,
      [id, req.session.usuario.id]
    );
    if (!partidas.length) {
      return res.status(404).json({ error: 'Partida no encontrada.' });
    }

    const [respuestas] = await pool.execute(
      'SELECT orden, imagen, respuesta FROM respuestas WHERE partida_id = ? ORDER BY orden',
      [id]
    );
    res.json({ partida: partidas[0], respuestas });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------
// Juego de Parejas
// ------------------------------------------------------------
const PAREJAS_TOTAL = 4; // con 4 parejas, el minimo posible de intentos es 4

app.post('/api/parejas', requiereSesion, async (req, res, next) => {
  try {
    const nombrePaciente = texto(req.body.nombrePaciente, 100);
    const { intentos, duracionSeg } = req.body;

    if (!nombrePaciente) {
      return res.status(400).json({ error: 'Falta el nombre del adulto mayor.' });
    }
    if (!Number.isInteger(intentos) || intentos < PAREJAS_TOTAL || intentos > 999 ||
        !Number.isInteger(duracionSeg) || duracionSeg < 0 || duracionSeg > 60000) {
      return res.status(400).json({ error: 'Datos de la partida no válidos.' });
    }

    const [r] = await pool.execute(
      `INSERT INTO partidas_parejas (usuario_id, nombre_paciente, intentos, duracion_seg)
       VALUES (?, ?, ?, ?)`,
      [req.session.usuario.id, nombrePaciente, intentos, duracionSeg]
    );
    res.status(201).json({ ok: true, partidaId: r.insertId });
  } catch (err) { next(err); }
});

app.get('/api/parejas', requiereSesion, async (req, res, next) => {
  try {
    const [filas] = await pool.execute(
      `SELECT id, nombre_paciente AS nombrePaciente, intentos,
              duracion_seg AS duracionSeg, fecha
         FROM partidas_parejas
        WHERE usuario_id = ?
        ORDER BY fecha DESC, id DESC
        LIMIT 100`,
      [req.session.usuario.id]
    );
    res.json({ partidas: filas });
  } catch (err) { next(err); }
});

// ------------------------------------------------------------
// Errores
// ------------------------------------------------------------
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Error del servidor. Intente de nuevo.' });
});

// Verifica la conexion a MySQL al arrancar
pool.query('SELECT 1')
  .then(() => {
    app.listen(PORT, () => console.log(`Servidor listo en http://localhost:${PORT}`));
  })
  .catch(err => {
    console.error('No se pudo conectar a MySQL:', err.message);
    console.error('Revise el archivo .env y que el servidor MySQL esté encendido.');
    process.exit(1);
  });
