  console.clear();
  const express = require('express');
  const http = require('http');
  const { Server } = require('socket.io');
  const path = require('path');
  const cors = require('cors');
  const fs = require('fs');
  const { exec, spawn } = require('child_process');
  const { randomUUID } = require('crypto');
  const os = require('os');

  const isWin = process.platform === 'win32';

  // === Configuración de rutas ===
  const tempDir = path.join(__dirname, "temp");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

  const carpetaEjercicios = "C:/Users/valed/Desktop/Repositorios/Algoritmos-Y-Estructuras-De-Datos/Ejercicios";
  const MAX_OUTPUT_LENGTH = 100 * 1024;
  const archivoProgreso = path.join(__dirname, 'progreso-usuarios.json');

  // === Sistema de progreso por correo ===
  // Función para leer el archivo de progreso
  function leerProgreso() {
    try {
      if (fs.existsSync(archivoProgreso)) {
        const contenido = fs.readFileSync(archivoProgreso, 'utf8');
        return JSON.parse(contenido);
      }
    } catch (error) {
      console.error('Error al leer el archivo de progreso:', error);
    }
    return {};
  }

  // Función para guardar el progreso
  function guardarProgreso(progreso) {
    try {
      fs.writeFileSync(archivoProgreso, JSON.stringify(progreso, null, 2), 'utf8');
      return true;
    } catch (error) {
      console.error('Error al guardar el archivo de progreso:', error);
      return false;
    }
  }

  // Función para obtener el índice de ejercicio de un correo y archivo específico
  function obtenerIndiceEjercicio(correo, nombreArchivo) {
    const progreso = leerProgreso();
    if (!progreso[correo]) return 0;
    if (!nombreArchivo) {
      // Si no se proporciona nombreArchivo, mantener compatibilidad con formato anterior
      // Buscar si hay un formato antiguo (solo número)
      if (typeof progreso[correo] === 'number') {
        return progreso[correo];
      }
      // Si es objeto pero no hay nombreArchivo, retornar 0
      return 0;
    }
    return progreso[correo][nombreArchivo] !== undefined ? progreso[correo][nombreArchivo] : 0;
  }

  // Función para actualizar el índice de ejercicio de un correo y archivo específico
  function actualizarIndiceEjercicio(correo, indice, nombreArchivo) {
    const progreso = leerProgreso();
    if (!progreso[correo]) {
      progreso[correo] = {};
    }
    // Si el valor anterior era un número (formato antiguo), convertirlo a objeto
    if (typeof progreso[correo] === 'number') {
      const indiceAntiguo = progreso[correo];
      progreso[correo] = {};
      // Opcionalmente, podrías migrar el índice antiguo al primer archivo que se use
    }
    if (nombreArchivo) {
      progreso[correo][nombreArchivo] = indice;
      guardarProgreso(progreso);
      console.log(`📝 Progreso actualizado: ${correo} -> archivo ${nombreArchivo} -> ejercicio ${indice}`);
    } else {
      // Si no se proporciona nombreArchivo, mantener compatibilidad con formato anterior
      if (typeof progreso[correo] === 'object' && Object.keys(progreso[correo]).length === 0) {
        // Si es un objeto vacío, convertir a número (formato antiguo para compatibilidad)
        progreso[correo] = indice;
      } else {
        // Si ya tiene archivos, no hacer nada (necesitamos nombreArchivo)
        console.log(`⚠️ No se puede actualizar índice sin nombreArchivo para ${correo}`);
        return;
      }
      guardarProgreso(progreso);
      console.log(`📝 Progreso actualizado (formato antiguo): ${correo} -> ejercicio ${indice}`);
    }
  }

  // Función para obtener la IP local (se usa en múltiples servidores)
  function obtenerIPLocal() {
    const interfaces = os.networkInterfaces();
    
    for (const nombreInterfaz of Object.keys(interfaces)) {
      const direcciones = interfaces[nombreInterfaz];
      for (const direccion of direcciones) {
        // Filtrar direcciones IPv4 no internas
        if (direccion.family === 'IPv4' && !direccion.internal) {
          return direccion.address;
        }
      }
    }
    return 'localhost';
  }

  // === Servidor 1: Compilador (Puerto 4000) ===
  const appCompilador = express();

  // Configurar CORS para permitir todas las conexiones (importante para acceso desde red)
  appCompilador.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }));

  // Manejar preflight requests
  appCompilador.options('*', cors());

  appCompilador.use(express.json());

  // Middleware para loggear todas las peticiones
  appCompilador.use((req, res, next) => {
    console.log(`📨 ${req.method} ${req.path} desde ${req.ip || req.connection.remoteAddress}`);
    next();
  });

  appCompilador.post("/compile", (req, res) => {
    console.log('📥 Petición de compilación recibida desde:', req.ip || req.connection.remoteAddress);
    console.log('   Headers:', {
      origin: req.headers.origin,
      host: req.headers.host,
      'user-agent': req.headers['user-agent']
    });
    
    const { code, input } = req.body;
    const id = randomUUID();
    const cppPath = path.join(tempDir, `temp_${id}.cpp`);
    const binPath = path.join(tempDir, `temp_${id}`);
    const outputBinary = isWin ? `${binPath}.exe` : binPath;
    const execFile = isWin ? outputBinary : `./${binPath}`;

    if (!code) {
      console.error('❌ Error: No se recibió código para compilar');
      return res.status(400).json({ output: 'Error: No se recibió código para compilar' });
    }

    console.log(`📝 Compilando código (${code.length} caracteres)...`);
    fs.writeFileSync(cppPath, code);

    exec(`g++ "${cppPath}" -o "${outputBinary}"`, (compileErr, stdout, stderr) => {
      if (compileErr) {
        console.log('❌ Error de compilación');
        const humanizado = humanizarErrores(stderr);
        limpiarArchivos(cppPath, outputBinary);
        return res.json({
          output: `${humanizado}\n\nMensaje original del compilador:\n${stderr}`
        });
      }

      console.log('✅ Compilación exitosa, ejecutando...');

      const proceso = spawn(execFile);
      let output = "";
      let error = "";
      let outputTruncado = false;
      let finalizadoPorTimeout = false;

      if (input) proceso.stdin.write(input);
      proceso.stdin.end();

      proceso.stdout.on("data", data => {
        if (output.length < MAX_OUTPUT_LENGTH) {
          output += data.toString();
          if (output.length >= MAX_OUTPUT_LENGTH) outputTruncado = true;
        }
      });

      proceso.stderr.on("data", data => {
        error += data.toString();
      });

      const timeout = setTimeout(() => {
        finalizadoPorTimeout = true;
        proceso.kill("SIGTERM");
      }, 5000);

      proceso.on("close", code => {
        clearTimeout(timeout);
        limpiarArchivos(cppPath, outputBinary);
        let resultado = error || output;
        if (outputTruncado) resultado += "\n\n⚠️ Salida truncada (más de 100 KB)";
        if (finalizadoPorTimeout) resultado += "\n\n⏱️ Proceso detenido por exceder el tiempo límite (5s)";
        console.log(`✅ Compilación y ejecución completada. Código de salida: ${code}`);
        res.json({ output: resultado });
      });

      proceso.on("error", err => {
        clearTimeout(timeout);
        console.error('❌ Error al ejecutar:', err.message);
        limpiarArchivos(cppPath, outputBinary);
        res.json({ output: `❌ Error al ejecutar: ${err.message}` });
      });
    });
  });

  function limpiarArchivos(...archs) {
    for (const file of archs) {
      fs.unlink(file, err => {
        if (err && err.code !== 'ENOENT') {
          console.error(`Error al borrar ${file}:`, err.message);
        }
      });
    }
  }

  function humanizarErrores(stderr) {
    const errores = [];
    if (/expected.*;/.test(stderr)) {
      const match = stderr.match(/(\d+):\d+: error: expected .+?;/);
      if (match) errores.push(`🚫 Te falta un punto y coma en la línea ${match[1]}.`);
    }
    if (/was not declared in this scope/.test(stderr)) {
      const match = stderr.match(/'(.+?)' was not declared in this scope/);
      if (match) errores.push(`🔍 La variable o función '${match[1]}' no está declarada.`);
    }
    return errores.length ? errores.join("\n") : "❗ Error de compilación.";
  }

  const PORT_COMPILADOR = 4000;
  const HOST_COMPILADOR = '0.0.0.0'; // Escuchar en todas las interfaces de red

  appCompilador.listen(PORT_COMPILADOR, HOST_COMPILADOR, () => {
    const ipLocal = obtenerIPLocal();
    console.log("🛠️  Servidor compilador escuchando:");
    console.log(`   📍 Local:    http://localhost:${PORT_COMPILADOR}`);
    console.log(`   🌐 Red:      http://${ipLocal}:${PORT_COMPILADOR}`);
  });

  // === Servidor 2: Archivos estáticos (Puerto 4001) ===
  const appEstaticos = express();

  // Configurar CORS para permitir todas las conexiones
  appEstaticos.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  }));

  // Manejar preflight requests
  appEstaticos.options('*', cors());

  appEstaticos.use(express.static(carpetaEjercicios));

  // Endpoint para listar archivos .js en la carpeta de ejercicios
  appEstaticos.get('/listar-archivos', (req, res) => {
    try {
      const archivos = fs.readdirSync(carpetaEjercicios);
      const archivosJS = archivos.filter(archivo => archivo.endsWith('.js'));
      res.json({ archivos: archivosJS });
    } catch (error) {
      console.error('Error al listar archivos:', error);
      res.status(500).json({ error: 'Error al listar archivos' });
    }
  });

  const PORT_ESTATICOS = 4001;
  const HOST_ESTATICOS = '0.0.0.0'; // Escuchar en todas las interfaces de red

  appEstaticos.listen(PORT_ESTATICOS, HOST_ESTATICOS, () => {
    const ipLocal = obtenerIPLocal();
    console.log("📂 Servidor de archivos escuchando:");
    console.log(`   📍 Local:    http://localhost:${PORT_ESTATICOS}`);
    console.log(`   🌐 Red:      http://${ipLocal}:${PORT_ESTATICOS}`);
  });

  // === Servidor 3: Editor colaborativo (Puerto 4002) ===
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  // Almacenar múltiples documentos (pestañas) y usuarios conectados
  let documentos = new Map(); // tabId -> {codigo, nombre, usuariosActivos: Set}
  let usuariosConectados = new Map(); // socketId -> {username, color, pestañaActiva, nombreArchivo, indiceEjercicio}
  let posicionesCursor = new Map(); // socketId -> {tabId, line, ch} - Posiciones actuales de cursor por usuario
  let contadorTabs = 0; // Contador para IDs únicos de pestañas

  // Estado de la pizarra colaborativa (strokes para sincronizar)
  let pizarraStrokes = [];

  // Servir archivos estáticos
  app.use(express.static(__dirname));

  // Ruta principal
  app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
  });

  // Endpoint para obtener lista de correos registrados
  app.get('/correos-registrados', (req, res) => {
    try {
      const progreso = leerProgreso();
      const correos = Object.keys(progreso);
      res.json({ correos: correos });
    } catch (error) {
      console.error('Error al obtener correos registrados:', error);
      res.status(500).json({ error: 'Error al obtener correos registrados' });
    }
  });

  // Manejo de conexiones Socket.io
  io.on('connection', (socket) => {
    console.log('Usuario conectado:', socket.id);

    // Cuando un usuario se une (con correo+nombre o como profesor)
    socket.on('usuario-join', (data) => {
      const { username, displayName, nombreArchivo, isProfesor } = data;
      
      // Restricción: solo un profesor conectado a la vez
      if (isProfesor) {
        const yaHayProfesor = Array.from(usuariosConectados.values()).some(u => u.isProfesor);
        if (yaHayProfesor) {
          socket.emit('usuario-rechazado', { mensaje: 'El profesor ya está conectado. Solo se permite uno.' });
          return;
        }
      }
      
      const color = generarColorAleatorio();
      const nombreParaLista = displayName != null ? displayName : (username || 'Usuario');
      
      // Profesor no guarda progreso en progreso-usuarios.json; alumnos sí (por correo)
      const indiceEjercicio = isProfesor ? 0 : obtenerIndiceEjercicio(username, nombreArchivo);
      
      usuariosConectados.set(socket.id, { 
        username, 
        displayName: nombreParaLista,
        isProfesor: !!isProfesor,
        color, 
        pestañaActiva: null,
        nombreArchivo: nombreArchivo || null,
        indiceEjercicio: indiceEjercicio || 0
      });
      
      const listaDocumentos = Array.from(documentos.entries()).map(([tabId, doc]) => ({
        tabId,
        nombre: doc.nombre,
        codigo: doc.codigo,
        usuariosActivos: Array.from(doc.usuariosActivos).length,
        creadorSocketId: doc.creadorSocketId
      }));

      socket.emit('usuario-confirmado', {
        username,
        displayName: nombreParaLista,
        isProfesor: !!isProfesor,
        color,
        documentos: listaDocumentos,
        indiceEjercicio,
        nombreArchivo: nombreArchivo || null
      });

      socket.broadcast.emit('usuario-conectado', {
        username,
        displayName: nombreParaLista,
        color,
        socketId: socket.id,
        nombreArchivo: nombreArchivo || null,
        indiceEjercicio: indiceEjercicio || 0
      });

      const usuarios = Array.from(usuariosConectados.entries()).map(([socketId, usuario]) => ({
        socketId: socketId,
        username: usuario.username,
        displayName: usuario.displayName != null ? usuario.displayName : usuario.username,
        color: usuario.color,
        pestañaActiva: usuario.pestañaActiva,
        nombreArchivo: usuario.nombreArchivo || null,
        indiceEjercicio: usuario.indiceEjercicio || 0
      }));
      io.emit('usuarios-actualizados', usuarios);

      console.log(`Usuario ${nombreParaLista} (${socket.id}) se unió al editor`);
    });

    // Cuando un usuario crea una nueva pestaña
    socket.on('crear-pestaña', (data) => {
      const { nombre } = data;
      const tabId = `tab_${++contadorTabs}_${Date.now()}`;
      const nombreTab = nombre || `Pestaña ${contadorTabs}`;
      
      documentos.set(tabId, {
        codigo: '',
        nombre: nombreTab,
        usuariosActivos: new Set(),
        creadorSocketId: socket.id
      });

      // Notificar a todos los usuarios, incluyendo quién la creó
      io.emit('pestaña-creada', {
        tabId,
        nombre: nombreTab,
        codigo: '',
        creadorSocketId: socket.id // Incluir el socketId del creador
      });

      console.log(`Nueva pestaña creada: ${nombreTab} (${tabId}) por usuario ${socket.id}`);
    });

    // Cuando un usuario se une a una pestaña
    socket.on('unirse-pestaña', (data) => {
      const { tabId } = data;
      const usuario = usuariosConectados.get(socket.id);
      
      if (!usuario) return;

      // Salir de la pestaña anterior si existe
      if (usuario.pestañaActiva && usuario.pestañaActiva !== tabId) {
        const tabIdAnterior = usuario.pestañaActiva;
        const docAnterior = documentos.get(tabIdAnterior);
        if (docAnterior) {
          docAnterior.usuariosActivos.delete(socket.id);
        }
        
        // Limpiar posición de cursor de la pestaña anterior
        const posicionCursor = posicionesCursor.get(socket.id);
        if (posicionCursor && posicionCursor.tabId === tabIdAnterior) {
          posicionesCursor.delete(socket.id);
        }
        
        // IMPORTANTE: Notificar a TODOS los usuarios que este usuario salió de la pestaña anterior
        // Esto asegura que el cursor se elimine en todas las pestañas, no solo en la anterior
        io.emit('usuario-salio-pestaña', {
          tabId: tabIdAnterior,
          socketId: socket.id,
          usuario: usuario.displayName != null ? usuario.displayName : usuario.username
        });
      }

      // Unirse a la nueva pestaña
      usuario.pestañaActiva = tabId;
      const documento = documentos.get(tabId);
      
      if (!documento) {
        socket.emit('error', { mensaje: 'Pestaña no encontrada' });
        return;
      }

      documento.usuariosActivos.add(socket.id);

      // Enviar código actual de la pestaña
      socket.emit('codigo-actual', {
        tabId,
        codigo: documento.codigo
      });

      // Enviar posiciones de cursor de otros usuarios que ya están en esta pestaña
      // Solo enviar si tienen una posición válida (no 0,0 a menos que realmente esté ahí)
      documento.usuariosActivos.forEach(userSocketId => {
        if (userSocketId !== socket.id) {
          const posicionCursor = posicionesCursor.get(userSocketId);
          if (posicionCursor && posicionCursor.tabId === tabId && 
              posicionCursor.line !== undefined && posicionCursor.ch !== undefined &&
              posicionCursor.line !== null && posicionCursor.ch !== null) {
            // Enviar la posición de cursor de este usuario al nuevo usuario
            socket.emit('cursor-actualizado', {
              tabId: tabId,
              usuario: posicionCursor.usuario,
              color: usuariosConectados.get(userSocketId).color,
              line: posicionCursor.line,
              ch: posicionCursor.ch,
              socketId: userSocketId
            });
          }
        }
      });

      // Notificar a otros usuarios en esta pestaña
      documento.usuariosActivos.forEach(userSocketId => {
        if (userSocketId !== socket.id) {
          io.to(userSocketId).emit('usuario-unido-pestaña', {
            tabId,
            usuario: usuario.displayName != null ? usuario.displayName : usuario.username,
            color: usuario.color,
            socketId: socket.id
          });
        }
      });

      // Actualizar lista de documentos
      const listaDocumentos = Array.from(documentos.entries()).map(([id, doc]) => ({
        tabId: id,
        nombre: doc.nombre,
        codigo: doc.codigo,
        usuariosActivos: Array.from(doc.usuariosActivos).length,
        creadorSocketId: doc.creadorSocketId
      }));
      io.emit('documentos-actualizados', listaDocumentos);
      
      const usuariosActualizados = Array.from(usuariosConectados.entries()).map(([socketId, usuarioData]) => ({
        socketId: socketId,
        username: usuarioData.username,
        displayName: usuarioData.displayName != null ? usuarioData.displayName : usuarioData.username,
        color: usuarioData.color,
        pestañaActiva: usuarioData.pestañaActiva,
        nombreArchivo: usuarioData.nombreArchivo || null,
        indiceEjercicio: usuarioData.indiceEjercicio || 0
      }));
      io.emit('usuarios-actualizados', usuariosActualizados);
    });

    // Cuando un usuario edita el código
    socket.on('cambio-codigo', (data) => {
      const { cambios, usuario, tabId } = data;
      const documento = documentos.get(tabId);
      
      if (!documento) return;

      documento.codigo = cambios.codigo;
      
      // Detectar si se insertó una línea nueva (Enter)
      let lineaInsercion = null;
      let lineasInsertadas = 0;
      // Detectar si se borraron líneas (Backspace/Delete sobre varias líneas)
      let lineaBorrado = null;
      let lineasBorradas = 0;

      if (cambios.from && cambios.text) {
        // Contar cuántas líneas nuevas se insertaron
        const textoInsertado = Array.isArray(cambios.text) ? cambios.text.join('\n') : cambios.text;
        lineasInsertadas = (textoInsertado.match(/\n/g) || []).length;
        
        // Si se insertó al menos una línea nueva
        if (lineasInsertadas > 0) {
          // La línea donde se insertó es cambios.from.line
          lineaInsercion = cambios.from.line;
          
          // Ajustar cursores de usuarios que están por debajo de la línea de inserción
          posicionesCursor.forEach((posicion, userSocketId) => {
            // Solo ajustar si el usuario está en la misma pestaña y no es el que hizo el cambio
            if (posicion.tabId === tabId && userSocketId !== socket.id && 
                posicion.line !== undefined && posicion.line !== null) {
              
              // Si el cursor del usuario está en o por debajo de la línea donde se insertó
              if (posicion.line > lineaInsercion) {
                // Mover el cursor una línea más abajo por cada línea insertada
                const nuevaLinea = posicion.line + lineasInsertadas;
                
                // Actualizar la posición del cursor
                posicionesCursor.set(userSocketId, {
                  ...posicion,
                  line: nuevaLinea
                });
                
                // Enviar actualización de cursor al usuario afectado
                const usuarioAfectado = usuariosConectados.get(userSocketId);
                if (usuarioAfectado) {
                  io.to(userSocketId).emit('cursor-actualizado', {
                    tabId: tabId,
                    usuario: posicion.usuario,
                    color: posicion.color,
                    line: nuevaLinea,
                    ch: posicion.ch,
                    socketId: userSocketId,
                    ajustadoPorInsercion: true // Flag para indicar que fue ajustado automáticamente
                  });
                }
              }
            }
          });
        }
      }

      // Detectar si se borraron líneas (from/to con to.line > from.line = borrado de líneas)
      if (cambios.from && cambios.to && cambios.to.line > cambios.from.line) {
        lineasBorradas = cambios.to.line - cambios.from.line;
        lineaBorrado = cambios.from.line;
        // Ajustar cursores de usuarios que están por debajo de la zona borrada
        posicionesCursor.forEach((posicion, userSocketId) => {
          if (posicion.tabId === tabId && userSocketId !== socket.id &&
              posicion.line !== undefined && posicion.line !== null) {
            // Si el cursor está por debajo de la última línea borrada, subirlo
            if (posicion.line > lineaBorrado) {
              const nuevaLinea = Math.max(lineaBorrado, posicion.line - lineasBorradas);
              posicionesCursor.set(userSocketId, {
                ...posicion,
                line: nuevaLinea
              });
              const usuarioAfectado = usuariosConectados.get(userSocketId);
              if (usuarioAfectado) {
                io.to(userSocketId).emit('cursor-actualizado', {
                  tabId: tabId,
                  usuario: posicion.usuario,
                  color: posicion.color,
                  line: nuevaLinea,
                  ch: posicion.ch,
                  socketId: userSocketId,
                  ajustadoPorBorrado: true
                });
              }
            }
          }
        });
      }
      
      // Reenviar a todos los demás usuarios en esta pestaña
      documento.usuariosActivos.forEach(userSocketId => {
        if (userSocketId !== socket.id) {
          io.to(userSocketId).emit('codigo-actualizado', {
            cambios,
            usuario,
            tabId,
            socketId: socket.id,
            lineaInsercion: lineaInsercion,
            lineasInsertadas: lineasInsertadas,
            lineaBorrado: lineaBorrado,
            lineasBorradas: lineasBorradas
          });
        }
      });
    });

    // Cuando un usuario cambia la posición del cursor
    socket.on('cursor-cambio', (data) => {
      const { tabId } = data;
      const documento = documentos.get(tabId);
      const usuario = usuariosConectados.get(socket.id);
      
      if (!documento || !usuario) return;
      
      // Solo procesar si el usuario está realmente en esta pestaña
      if (usuario.pestañaActiva !== tabId) return;

      // Guardar la posición del cursor para este usuario
      posicionesCursor.set(socket.id, {
        tabId: tabId,
        line: data.line,
        ch: data.ch,
        usuario: data.usuario,
        color: data.color
      });

      // Reenviar solo a usuarios en la misma pestaña
      documento.usuariosActivos.forEach(userSocketId => {
        if (userSocketId !== socket.id) {
          io.to(userSocketId).emit('cursor-actualizado', {
            ...data,
            socketId: socket.id
          });
        }
      });
    });

    // Cuando un usuario invita a otro usuario específico a su posición
    socket.on('invitar-a-mi-posicion', (data) => {
      const { tabId, line, ch, usuario, color, socketIdDestino } = data;
      const usuarioInfo = usuariosConectados.get(socket.id);
      
      if (!usuarioInfo) return;
      
      // Verificar que el usuario está realmente en esta pestaña
      if (usuarioInfo.pestañaActiva !== tabId) return;
      
      // Verificar que el usuario destino existe
      if (!socketIdDestino || !usuariosConectados.has(socketIdDestino)) {
        console.log(`Usuario destino ${socketIdDestino} no encontrado`);
        return;
      }
      
      // Enviar la invitación solo al usuario específico
      io.to(socketIdDestino).emit('invitacion-posicion', {
        tabId: tabId,
        line: line,
        ch: ch,
        usuario: usuario,
        color: color,
        socketId: socket.id
      });
      
      const usuarioDestino = usuariosConectados.get(socketIdDestino);
      console.log(`Usuario ${usuario} (${socket.id}) invitó a ${usuarioDestino.username} (${socketIdDestino}) a su posición en pestaña ${tabId}, línea ${line}`);
    });

    // Función para calcular la contraseña de colaboración
    function calcularContraseñaColaboracion() {
      const ahora = new Date();
      const hora = ahora.getHours();
      const minutos = ahora.getMinutes();
      const dia = ahora.getDate();
      const mes = ahora.getMonth() + 1; // getMonth() devuelve 0-11, sumamos 1
      
      // Obtener último dígito de cada valor
      const ultimoDigitoHora = hora % 10;
      const ultimoDigitoMinutos = minutos % 10;
      const ultimoDigitoDia = dia % 10;
      const ultimoDigitoMes = mes % 10;
      
      // Formar la contraseña: hora, minutos, día, mes
      return `${ultimoDigitoHora}${ultimoDigitoMinutos}${ultimoDigitoDia}${ultimoDigitoMes}`;
    }

    // Cuando un usuario verifica la contraseña para activar colaboración
    socket.on('verificar-contraseña-colaboracion', (data) => {
      const { contraseñaIngresada } = data;
      const contraseñaCorrecta = calcularContraseñaColaboracion();
      
      if (contraseñaIngresada === contraseñaCorrecta) {
        socket.emit('contraseña-verificada', { valida: true });
      } else {
        socket.emit('contraseña-verificada', { valida: false });
      }
    });

    // Cuando un usuario desactiva la colaboración globalmente
    socket.on('desactivar-colaboracion-global', () => {
      const usuarioInfo = usuariosConectados.get(socket.id);
      if (!usuarioInfo) return;
      
      // Reenviar a todos los demás usuarios para que desactiven su colaboración
      socket.broadcast.emit('colaboracion-desactivada-global');
      
      console.log(`Usuario ${usuarioInfo.username} (${socket.id}) desactivó la colaboración globalmente`);
    });

    // Cuando un usuario actualiza su índice de ejercicio (no se guarda para modo profesor)
    socket.on('actualizar-indice-ejercicio', (data) => {
      const usuarioInfo = usuariosConectados.get(socket.id);
      if (!usuarioInfo) return;
      if (usuarioInfo.isProfesor) return; // Profesor no se persiste en progreso-usuarios.json
      
      const { indice, nombreArchivo } = data;
      const correo = usuarioInfo.username;
      
      if (typeof indice === 'number' && indice >= 0) {
        actualizarIndiceEjercicio(correo, indice, nombreArchivo);
        
        usuarioInfo.nombreArchivo = nombreArchivo || null;
        usuarioInfo.indiceEjercicio = indice;
        usuariosConectados.set(socket.id, usuarioInfo);
        
        const usuarios = Array.from(usuariosConectados.entries()).map(([socketId, usuario]) => ({
          socketId: socketId,
          username: usuario.username,
          displayName: usuario.displayName != null ? usuario.displayName : usuario.username,
          color: usuario.color,
          pestañaActiva: usuario.pestañaActiva,
          nombreArchivo: usuario.nombreArchivo || null,
          indiceEjercicio: usuario.indiceEjercicio || 0
        }));
        io.emit('usuarios-actualizados', usuarios);
        
        socket.emit('indice-actualizado', { indice, correo, nombreArchivo });
      }
    });

    // Cuando un usuario elimina una pestaña
    socket.on('eliminar-pestaña', (data) => {
      const { tabId } = data;
      const documento = documentos.get(tabId);
      
      if (!documento) {
        console.log(`Intento de eliminar pestaña inexistente: ${tabId}`);
        return;
      }

      // Eliminar el documento del servidor
      documentos.delete(tabId);

      // Limpiar usuarios activos de esta pestaña
      documento.usuariosActivos.forEach(userSocketId => {
        const usuario = usuariosConectados.get(userSocketId);
        if (usuario && usuario.pestañaActiva === tabId) {
          usuario.pestañaActiva = null;
        }
        // Limpiar posición de cursor si está en esta pestaña
        const posicionCursor = posicionesCursor.get(userSocketId);
        if (posicionCursor && posicionCursor.tabId === tabId) {
          posicionesCursor.delete(userSocketId);
        }
      });

      // Notificar a todos los usuarios EXCEPTO al que la eliminó (él ya la eliminó localmente)
      socket.broadcast.emit('pestaña-eliminada', { tabId });

      const listaDocumentos = Array.from(documentos.entries()).map(([id, doc]) => ({
        tabId: id,
        nombre: doc.nombre,
        codigo: doc.codigo,
        usuariosActivos: Array.from(doc.usuariosActivos).length,
        creadorSocketId: doc.creadorSocketId
      }));
      io.emit('documentos-actualizados', listaDocumentos);

      console.log(`Pestaña ${tabId} eliminada por usuario ${socket.id}`);
    });

    // Renombrar pestaña
    socket.on('renombrar-pestaña', (data) => {
      const { tabId, nombre } = data;
      const documento = documentos.get(tabId);
      if (!documento || !nombre || typeof nombre !== 'string') return;
      const nombreTrim = nombre.trim() || 'Sin título';
      documento.nombre = nombreTrim;
      const listaDocumentos = Array.from(documentos.entries()).map(([id, doc]) => ({
        tabId: id,
        nombre: doc.nombre,
        codigo: doc.codigo,
        usuariosActivos: Array.from(doc.usuariosActivos).length,
        creadorSocketId: doc.creadorSocketId
      }));
      io.emit('documentos-actualizados', listaDocumentos);
    });

    // --- Pizarra colaborativa ---
    socket.on('pizarra-join', () => {
      socket.join('pizarra');
      socket.emit('pizarra-state', { strokes: pizarraStrokes });
    });

    socket.on('pizarra-leave', () => {
      socket.leave('pizarra');
    });

    socket.on('pizarra-stroke', (data) => {
      pizarraStrokes.push(data);
      if (pizarraStrokes.length > 500) pizarraStrokes = pizarraStrokes.slice(-400);
      socket.to('pizarra').emit('pizarra-stroke', data);
    });

    socket.on('pizarra-clear', () => {
      pizarraStrokes = [];
      io.to('pizarra').emit('pizarra-clear');
    });

    socket.on('pizarra-undo', () => {
      if (pizarraStrokes.length > 0) {
        pizarraStrokes.pop();
        socket.to('pizarra').emit('pizarra-undo');
      }
    });

    // --- Modo profesor ---
    socket.on('profesor-pizarra-abrir', () => {
      io.emit('profesor-pizarra-abrir');
    });
    socket.on('profesor-pizarra-cerrar', () => {
      io.emit('profesor-pizarra-cerrar');
    });
    socket.on('profesor-abrir-link', (data) => {
      const { targetSocketId, url, blank } = data || {};
      if (targetSocketId && url) {
        io.to(targetSocketId).emit('profesor-abrir-link', { url, blank: blank !== false });
      }
    });
    socket.on('profesor-forzar-archivo-indice', (data) => {
      const { targetSocketId, nombreArchivo, indice } = data || {};
      if (targetSocketId && nombreArchivo !== undefined) {
        io.to(targetSocketId).emit('profesor-forzar-archivo-indice', { 
          nombreArchivo, 
          indice: typeof indice === 'number' ? indice : 0 
        });
      }
    });

    // Cuando un usuario se desconecta
    socket.on('disconnect', () => {
      const usuario = usuariosConectados.get(socket.id);
      if (usuario) {
        console.log(`Usuario ${usuario.username} (${socket.id}) se desconectó`);
        
        // Salir de la pestaña activa
        if (usuario.pestañaActiva) {
          const documento = documentos.get(usuario.pestañaActiva);
          if (documento) {
            documento.usuariosActivos.delete(socket.id);
          }
        }

        usuariosConectados.delete(socket.id);
        posicionesCursor.delete(socket.id); // Limpiar posición de cursor
        
        // Notificar a los demás
        socket.broadcast.emit('usuario-desconectado', {
          socketId: socket.id,
          username: usuario.username
        });

        const usuarios = Array.from(usuariosConectados.entries()).map(([socketId, usuario]) => ({
          socketId: socketId,
          username: usuario.username,
          displayName: usuario.displayName != null ? usuario.displayName : usuario.username,
          color: usuario.color,
          pestañaActiva: usuario.pestañaActiva,
          nombreArchivo: usuario.nombreArchivo || null,
          indiceEjercicio: usuario.indiceEjercicio || 0
        }));
        io.emit('usuarios-actualizados', usuarios);

        // Actualizar lista de documentos (incluir creadorSocketId para que los clientes no pierdan el dato)
        const listaDocumentos = Array.from(documentos.entries()).map(([id, doc]) => ({
          tabId: id,
          nombre: doc.nombre,
          codigo: doc.codigo,
          usuariosActivos: Array.from(doc.usuariosActivos).length,
          creadorSocketId: doc.creadorSocketId
        }));
        io.emit('documentos-actualizados', listaDocumentos);
      }
    });
  });

  // Función para generar un color aleatorio para cada usuario
  function generarColorAleatorio() {
    const colores = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
      '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B739', '#52BE80'
    ];
    return colores[Math.floor(Math.random() * colores.length)];
  }

  const PORT = process.env.PORT || 4002;
  const HOST = '0.0.0.0'; // Escuchar en todas las interfaces de red

  server.listen(PORT, HOST, () => {
    const ipLocal = obtenerIPLocal();
    console.log('='.repeat(60));
    console.log(`✅ Todos los servidores están corriendo:`);
    console.log(`\n🛠️  Servidor Compilador:`);
    console.log(`   📍 Local:    http://localhost:4000`);
    console.log(`   🌐 Red:      http://${ipLocal}:4000`);
    console.log(`\n📂 Servidor de Archivos Estáticos:`);
    console.log(`   📍 Local:    http://localhost:4001`);
    console.log(`   🌐 Red:      http://${ipLocal}:4001`);
    console.log(`\n👥 Servidor Editor Colaborativo:`);
    console.log(`   📍 Local:    http://localhost:${PORT}`);
    console.log(`   🌐 Red:      http://${ipLocal}:${PORT}`);
    console.log('='.repeat(60));
    console.log(`\n💡 Para acceder desde otra computadora en tu red, usa las URLs de Red mostradas arriba.\n`);
    
    // Abrir Chrome automáticamente
    const url = `http://localhost:${PORT}`;
    setTimeout(() => {
      if (isWin) {
        // Windows: usar start para abrir Chrome
        exec(`start chrome "${url}"`, (error) => {
          if (error) {
            // Si falla, intentar con la ruta completa
            exec(`"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" "${url}"`, (error2) => {
              if (error2) {
                exec(`"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe" "${url}"`, (error3) => {
                  if (!error3) {
                    console.log(`🌐 Abriendo Chrome en ${url}...`);
                  }
                });
              } else {
                console.log(`🌐 Abriendo Chrome en ${url}...`);
              }
            });
          } else {
            console.log(`🌐 Abriendo Chrome en ${url}...`);
          }
        });
      } else {
        // Linux/Mac
        exec(`google-chrome "${url}" || chromium-browser "${url}" || open -a "Google Chrome" "${url}"`, (error) => {
          if (!error) {
            console.log(`🌐 Abriendo Chrome en ${url}...`);
          }
        });
      }
    }, 1000); // Esperar 1 segundo para asegurar que el servidor esté completamente listo
  });

