const express = require('express');
const { Telegraf, Markup } = require('telegraf');
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = process.env.BOT_TOKEN;            // @BotFather bergan token
const ADMINS = (process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean); // Telegram ID lar
const PORT = process.env.PORT || 3000;
const FILE = path.join(process.env.DATA_DIR || __dirname, 'menu.json');

if (!BOT_TOKEN) { console.error('BOT_TOKEN topilmadi'); process.exit(1); }
const bot = new Telegraf(BOT_TOKEN);
const app = express();

const read = () => { 
  try { 
    const data = fs.readFileSync(FILE, 'utf8');
    console.log('✅ menu.json o\'qildi. Fayl:', FILE, '| Uzunligi:', data.length);
    return JSON.parse(data); 
  } catch (e) { 
    console.error('❌ menu.json o\'qishda xato:', e.message);
    console.error('❌ Qidirilgan manzil:', FILE);
    return []; 
  } 
};

const write = d => { fs.writeFileSync(FILE + '.tmp', JSON.stringify(d, null, 2)); fs.renameSync(FILE + '.tmp', FILE); };
const price = s => parseInt(String(s).replace(/\D/g, ''), 10);
const som = n => n ? Number(n).toLocaleString('ru-RU') + " so'm" : "narxi yo'q";
const arg = ctx => ctx.message.text.split(/\s+/).slice(1).join(' ').trim();
const find = (menu, q) => /^\d+$/.test(q) ? menu.find(f => f.id === +q)
  : menu.find(f => f.name.toLowerCase().includes(q.toLowerCase()));

// ---- Sayt uchun API ----
app.use(express.static(__dirname));
app.get('/api/menu', (req, res) => { res.set('Cache-Control', 'no-store'); res.json(read()); });

// Stollar ro'yxatini o'qish
const TABLES_FILE = path.join(process.env.DATA_DIR || __dirname, 'tables.json');
const readTables = () => { try { return JSON.parse(fs.readFileSync(TABLES_FILE, 'utf8')); } catch { return []; } };
const writeTables = d => { fs.writeFileSync(TABLES_FILE + '.tmp', JSON.stringify(d, null, 2)); fs.renameSync(TABLES_FILE + '.tmp', TABLES_FILE); };

app.get('/api/tables', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(readTables());
});

// Stol band qilish
app.post('/api/reserve', express.json(), (req, res) => {
  try {
    const { tableId, who } = req.body;
    const tables = readTables();
    const table = tables.find(t => t.id === tableId);
    if (!table) return res.status(404).json({ ok: false, error: 'Stol topilmadi' });
    if (table.available === false) return res.status(400).json({ ok: false, error: 'Bu stol allaqachon band' });
    
    table.available = false;
    table.reservedBy = who;
    table.reservedAt = new Date().toISOString();
    writeTables(tables);
    
    // Adminga xabar yuborish
    const txt = `🪑 Stol band qilindi!\n\n📍 ${table.name} (${table.capacity} kishilik)\n👤 Mijoz: ${who}`;
    for (const adminId of ADMINS) {
      bot.telegram.sendMessage(adminId, txt).catch(e => console.error('Xabar yuborilmadi:', e));
    }
    
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false });
  }
});

// Buyurtmani qabul qilish
app.use(express.json());
app.post('/api/order', async (req, res) => {
  try {
    const { who, how, items, total } = req.body;
    let txt = `🔔 Yangi buyurtma!\n\n👤 Mijoz: ${who}\n🍽 Qanday: ${how}\n\n`;
    items.forEach(i => {
      txt += `• ${i.name} × ${i.qty}` + (i.price ? ` — ${i.price * i.qty} so'm` : '') + `\n`;
    });
    if (total) txt += `\n💰 Jami: ${total} so'm`;
    
    // Barcha adminlarga yuborish
    for (const adminId of ADMINS) {
      await bot.telegram.sendMessage(adminId, txt).catch(e => console.error('Xabar yuborilmadi:', e));
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false });
  }
});

// ---- Bot: faqat adminlar ----
bot.command('id', ctx => ctx.reply('Sizning Telegram ID raqamingiz: ' + ctx.from.id));
bot.use((ctx, next) => {
  if (!ADMINS.includes(String(ctx.from && ctx.from.id))) {
    return ctx.reply("Bu bot faqat oshxona egasi uchun. ID ni bilish: /id");
  }
  return next();
});

const HELP = `Sepki Cafe menyu boti

/menyu — taomlar ro'yxati; tugmaga bossangiz ✅ bor / ❌ tugadi almashadi
/tugadi osh — taom tugadi
/bor osh — taom yana bor
/narx osh 25000 — narxni o'zgartirish
/add toifa | Nomi | Ta'rifi | Narxi — yangi taom
/ochir 5 — taomni o'chirish (raqami /menyu da)

Toifalar: mangal, issiq, xamir
Masalan: /add xamir | Chuchvara | Qaynoq, qatiq bilan | 20000`;

bot.start(ctx => ctx.reply(HELP));
bot.help(ctx => ctx.reply(HELP));

const keyboard = menu => Markup.inlineKeyboard(
  menu.map(f => [Markup.button.callback((f.available === false ? '❌ ' : '✅ ') + f.name + ' — ' + som(f.price), 't:' + f.id)])
);

bot.command('menyu', ctx => {
  const m = read();
  if (!m.length) return ctx.reply("Menyu bo'sh. /add bilan taom qo'shing.");
  ctx.reply('Taomlar (bosib almashtiring):', keyboard(m));
});

bot.action(/^t:(\d+)$/, async ctx => {
  const m = read(), f = m.find(x => x.id === +ctx.match[1]);
  if (!f) return ctx.answerCbQuery('Topilmadi');
  f.available = f.available === false;
  write(m);
  await ctx.answerCbQuery(f.name + (f.available ? ': bor ✅' : ': tugadi ❌'));
  await ctx.editMessageReplyMarkup(keyboard(m).reply_markup).catch(() => {});
});

const setAvail = (value) => ctx => {
  const q = arg(ctx); if (!q) return ctx.reply('Taom nomini yozing. Masalan: /tugadi osh');
  const m = read(), f = find(m, q);
  if (!f) return ctx.reply('Topilmadi. /menyu ni tekshiring.');
  f.available = value; write(m);
  ctx.reply(`${f.name}: ${value ? 'bor ✅' : 'tugadi ❌'}`);
};
bot.command('tugadi', setAvail(false));
bot.command('bor', setAvail(true));

bot.command('narx', ctx => {
  const parts = arg(ctx).split(/\s+/), p = price(parts.pop());
  if (!parts.length || isNaN(p)) return ctx.reply('Format: /narx osh 25000');
  const m = read(), f = find(m, parts.join(' '));
  if (!f) return ctx.reply('Topilmadi. /menyu ni tekshiring.');
  f.price = p; write(m);
  ctx.reply(`${f.name}: yangi narx ${som(p)}`);
});

bot.command('add', ctx => {
  const p = arg(ctx).split('|').map(s => s.trim());
  if (p.length < 4) return ctx.reply("Format: /add toifa | Nomi | Ta'rifi | Narxi\nMasalan: /add xamir | Chuchvara | Qaynoq | 20000");
  const [category, name, desc, pr] = p, n = price(pr);
  if (!['mangal', 'issiq', 'xamir'].includes(category.toLowerCase())) return ctx.reply('Toifa: mangal, issiq yoki xamir');
  if (!name || isNaN(n)) return ctx.reply("Nom va narx to'g'ri yozilganini tekshiring.");
  const m = read();
  m.push({ id: m.length ? Math.max(...m.map(f => f.id)) + 1 : 1, name, desc, price: n, category: category.toLowerCase(), available: true });
  write(m);
  ctx.reply(`✅ "${name}" — ${som(n)} qo'shildi. Saytda 30 soniya ichida ko'rinadi.`);
});

bot.command('ochir', ctx => {
  const q = arg(ctx); const m = read(), f = find(m, q);
  if (!f) return ctx.reply('Topilmadi. Format: /ochir 5');
  write(m.filter(x => x.id !== f.id));
  ctx.reply(`🗑 "${f.name}" o'chirildi.`);
});

bot.catch(err => console.error('Bot xatosi:', err));
bot.launch().then(() => console.log('Bot ishga tushdi')).catch(e => console.error('Bot ishga tushmadi:', e));
app.listen(PORT, () => console.log('Sayt: http://localhost:' + PORT));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
