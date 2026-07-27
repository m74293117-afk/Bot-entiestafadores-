// Bot de Telegram para reportar y consultar estafadores
// Requiere: Node.js 18+, token de BotFather, y Supabase

const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');

const TOKEN = process.env.TELEGRAM_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ADMIN_ID = process.env.ADMIN_ID; // tu chat_id de Telegram (ver instrucciones abajo)

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const bot = new TelegramBot(TOKEN, { polling: true });

console.log('Bot de Telegram corriendo...');

// ---- Comando de utilidad: para que descubras tu chat_id la primera vez ----
bot.onText(/\/miid/, (msg) => {
  bot.sendMessage(msg.chat.id, `Tu chat_id es: ${msg.chat.id}`);
});

// ---- Comando /start ----
bot.onText(/\/start/, (msg) => {
  manejarMenu(msg.chat.id);
});

// ---- Mensajes normales ----
bot.on('message', async (msg) => {
  const text = (msg.text || '').trim();
  if (text.startsWith('/')) return; // los comandos ya se manejan arriba

  const chatId = msg.chat.id;

  try {
    await manejarMensaje(chatId, text);
  } catch (err) {
    console.error('Error manejando mensaje:', err);
  }
});

// ---- Lógica conversacional ----
async function manejarMensaje(chatId, text) {
  const { data: estadoRow } = await supabase
    .from('bot_estado')
    .select('*')
    .eq('telefono', String(chatId))
    .maybeSingle();

  const estado = estadoRow?.estado || 'menu';
  const datos = estadoRow?.datos_temporales || {};
  const textoLower = text.toLowerCase();
  const esAdmin = String(chatId) === String(ADMIN_ID);

  if (textoLower === 'menu' || estado === 'menu') {
    if (esAdmin && (textoLower.includes('1') || textoLower.includes('reportar'))) {
      await guardarEstado(chatId, 'reportar_telefono', {});
      return bot.sendMessage(chatId,
        'Vamos a registrar un reporte. Envía el número de teléfono del estafador (con código de país, ej: +5355555555).');
    }
    if (textoLower.includes('2') || textoLower.includes('consultar') || (!esAdmin && textoLower.includes('1'))) {
      await guardarEstado(chatId, 'consultar_telefono', {});
      return bot.sendMessage(chatId, 'Envía el número de teléfono que quieres consultar.');
    }
    await guardarEstado(chatId, 'menu', {});
    return manejarMenu(chatId, esAdmin);
  }

  if (estado.startsWith('reportar_') && !esAdmin) {
    await guardarEstado(chatId, 'menu', {});
    return bot.sendMessage(chatId, 'Solo el administrador puede agregar reportes. Escribe "menu" para consultar un número.');
  }

  if (estado === 'reportar_telefono') {
    await guardarEstado(chatId, 'reportar_nombre', { telefono_estafador: text });
    return bot.sendMessage(chatId, 'Nombre del estafador (si no lo sabes, escribe "N/A").');
  }

  if (estado === 'reportar_nombre') {
    await guardarEstado(chatId, 'reportar_descripcion', { ...datos, nombre_estafador: text });
    return bot.sendMessage(chatId, 'Describe brevemente cómo ocurrió la estafa.');
  }

  if (estado === 'reportar_descripcion') {
    await supabase.from('reportes_estafas').insert({
      telefono_estafador: datos.telefono_estafador,
      nombre_estafador: datos.nombre_estafador,
      descripcion: text,
      telefono_reportante: String(chatId),
    });
    await guardarEstado(chatId, 'menu', {});
    return bot.sendMessage(chatId,
      '✅ Reporte guardado. Gracias por ayudar a proteger a la comunidad.\n\nEscribe "menu" para volver al inicio.');
  }

  if (estado === 'consultar_telefono') {
    const { data: reportes } = await supabase
      .from('reportes_estafas')
      .select('descripcion, created_at, verificado')
      .eq('telefono_estafador', text)
      .order('created_at', { ascending: false });

    await guardarEstado(chatId, 'menu', {});

    if (!reportes || reportes.length === 0) {
      return bot.sendMessage(chatId,
        `No se encontraron reportes para ${text}. Eso no garantiza que sea seguro, solo que nadie lo ha reportado aún.\n\nEscribe "menu" para volver al inicio.`);
    }

    const resumen = reportes.slice(0, 3)
      .map((r, i) => `${i + 1}. ${r.descripcion.slice(0, 100)}`)
      .join('\n');

    return bot.sendMessage(chatId,
      `⚠️ ${text} tiene ${reportes.length} reporte(s):\n\n${resumen}\n\n` +
      'Nota: los reportes son enviados por usuarios y no están verificados. Úsalos como referencia, no como prueba definitiva.\n\n' +
      'Escribe "menu" para volver al inicio.');
  }
}

function manejarMenu(chatId, esAdmin) {
  const opciones = esAdmin
    ? '1️⃣ Reportar un estafador\n2️⃣ Consultar un número\n\nResponde con 1 o 2.'
    : '1️⃣ Consultar un número\n\nResponde con 1.';
  return bot.sendMessage(chatId,
    `👋 Bienvenido al bot de reportes de estafadores.\n\n${opciones}`);
}

async function guardarEstado(chatId, estado, datos) {
  await supabase.from('bot_estado').upsert({
    telefono: String(chatId),
    estado,
    datos_temporales: datos,
    updated_at: new Date().toISOString(),
  });
}
