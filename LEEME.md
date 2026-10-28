# Juegos de memoria – versión web con MySQL

Contiene el **menú** para escoger entre:

- **Juego de Parejas**: el responsable inicia sesión, escribe el nombre del adulto mayor y juega.
  Al terminar se guardan los **intentos** y el **tiempo** de la partida.
- **Juego de Recuerdos**: inicio de sesión, 5 imágenes al azar y respuestas escritas o por voz.

Ambos guardan en **MySQL** y tienen su pantalla "Ver partidas guardadas".
La sesión se comparte: si ya inició sesión en un juego, el otro no se la vuelve a pedir.

## Requisitos

- [Node.js](https://nodejs.org) 18 o superior
- MySQL 8 (o MariaDB 10.4+) encendido
- Visual Studio Code

## Puesta en marcha (en VS Code)

1. **Archivo → Abrir carpeta…** y elija esta carpeta (`JuegosWeb`).
2. Abra la terminal (**Terminal → Nueva terminal**) e instale las dependencias:
   ```
   npm install
   ```
3. Cree la base de datos. Lo más fácil: abra `database/schema.sql` en MySQL Workbench
   (File → Open SQL Script) y presione el rayo ⚡.
   En la terminal de VS Code (PowerShell) sería:
   ```
   cmd /c "mysql -u root -p < database\schema.sql"
   ```
   > **Si ya había creado la base de datos antes**, no necesita volver a crearla: ejecute solo
   > `database/migracion_parejas.sql`, que agrega la tabla nueva del Juego de Parejas.
4. Copie `.env.example` y llámela `.env`. Complete `DB_USER`, `DB_PASSWORD` y cambie `SESSION_SECRET`.
5. (Opcional) Pase las cuentas del antiguo `usuarios.txt` a la base de datos:
   ```
   npm run importar-usuarios
   ```
   Las claves se guardan cifradas (bcrypt). Usa `scripts/usuarios.txt`; para otro archivo:
   `npm run importar-usuarios -- ruta/archivo.txt`
6. Inicie el servidor:
   ```
   npm start
   ```
7. Abra **http://localhost:3000** en el navegador.

> No use la extensión "Live Server": esta aplicación necesita el servidor de Node para funcionar.

## Estructura

```
server.js                 Servidor Express y API
db.js                     Conexión a MySQL
database/schema.sql       Tablas: usuarios, partidas, respuestas, partidas_parejas
database/migracion_parejas.sql  Solo la tabla nueva (si ya tenía la base creada)
scripts/                  Importador de usuarios.txt
public/index.html         Pantallas de la aplicación
public/css/estilos.css    Estilos
public/js/                parejas.js, recuerdos.js, sesion.js, main.js, api.js, nav.js
public/imagenes/          Imágenes del Juego de Recuerdos
```

## Qué se guarda en la base de datos

| Antes (Java)                          | Ahora (MySQL)                              |
|---------------------------------------|--------------------------------------------|
| `usuarios.txt`                        | tabla `usuarios` (clave con hash bcrypt)   |
| `Resultado_<nombre>_<fecha>.txt`      | tabla `partidas` (responsable, adulto mayor, fecha) |
| Las 5 imágenes y respuestas del .txt  | tabla `respuestas` (orden, imagen, respuesta) |
| (nuevo) Juego de Parejas              | tabla `partidas_parejas` (adulto mayor, intentos, tiempo, fecha) |

En el Juego de Parejas el mínimo posible es 4 intentos (una pareja por intento). El tiempo
cuenta desde la primera tarjeta que se voltea hasta encontrar la última pareja. Si se
reinicia o se abandona una partida, no se guarda.

## Para agregar o cambiar imágenes

Ponga archivos `.jpg`, `.jpeg`, `.png`, `.gif` o `.bmp` en `public/imagenes/`
(mínimo 5). No hay que reiniciar el servidor.

## Notas

- **Voz:** el modo de voz usa el reconocimiento del navegador (Chrome o Edge) en lugar de Vosk.
  Necesita internet y permiso de micrófono. Si no está disponible, se puede escribir la respuesta.
- Los archivos `Resultado_*.txt` anteriores no se migran automáticamente.
- Para publicarlo en internet use HTTPS y `NODE_ENV=production`.
