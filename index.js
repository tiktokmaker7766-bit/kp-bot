const { Telegraf, Markup, Scenes, session } = require('telegraf');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const BOT_TOKEN = '8613377134:AAHWZQ3E8-SHOZJ1-Pa9HRPwAKjeUCLiwzg';

if (!BOT_TOKEN || BOT_TOKEN === 'YOUR_TELEGRAM_BOT_TOKEN_HERE') {
  console.error('Ошибка: Укажите ваш BOT_TOKEN!');
  process.exit(1);
}

// ==========================================
// ФУНКЦИИ ВАЛИДАЦИИ И РЕКВИЗИТОВ
// ==========================================

function validateCapitalNames(input) {
  const words = input.trim().split(/\s+/);
  if (words.length < 2) {
    return { valid: false, error: '⚠️ Введите и Имя, и Фамилию через пробел.' };
  }
  for (const word of words) {
    const firstChar = word.charAt(0);
    if (firstChar !== firstChar.toUpperCase() || firstChar === firstChar.toLowerCase()) {
      return { valid: false, error: '⚠️ Имя и Фамилия должны начинаться с заглавной буквы! (Например: Muhammet Orunov)' };
    }
  }
  return { valid: true };
}

function validateUAEPhone(input) {
  const cleanPhone = input.trim().replace(/[\s\-\(\)]/g, '');
  if (!cleanPhone.startsWith('+971')) {
    return { valid: false, error: '⚠️ Номер телефона должен начинаться с кода ОАЭ: **+971** (например: +971550000000)' };
  }
  const digitsAfterCode = cleanPhone.slice(4);
  if (!/^\d{8,9}$/.test(digitsAfterCode)) {
    return { valid: false, error: '⚠️ После +971 должно идти 8–9 цифр.' };
  }
  return { valid: true, formatted: cleanPhone };
}

function validateTRN(input) {
  const cleanTRN = input.trim().replace(/\s/g, '');
  if (cleanTRN === '-' || cleanTRN.toLowerCase() === 'без trn' || cleanTRN.toLowerCase() === 'нет') {
    return { valid: true, formatted: '-' };
  }
  if (!/^\d{15}$/.test(cleanTRN)) {
    return { valid: false, error: '⚠️ Налоговый номер TRN должен состоять из 15 цифр.' };
  }
  if (!cleanTRN.startsWith('100') && !cleanTRN.startsWith('104')) {
    return { valid: false, error: '⚠️ Номер TRN должен начинаться с 100 или 104.' };
  }
  return { valid: true, formatted: cleanTRN };
}

function getFormattedPrefixDate() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

// Единицы измерения для гибкого выбора
const UNITS_CONFIG = {
  sqm: { ru: 'м²', en: 'sqm' },
  lm: { ru: 'м.п.', en: 'lm' },
  pcs: { ru: 'шт', en: 'pcs' },
  set: { ru: 'компл.', en: 'set' }
};

// ==========================================
// ДЕРЕВО УСЛУГ И КАТЕГОРИЙ
// ==========================================
const SERVICES_DATA = {
  restoration: {
    title: 'Реставрационные работы',
    items: {
      marble: {
        title: 'Мрамор и камень',
        tasks: [
          { id: 'm_chips', nameRu: 'Устранение сколов и трещин', nameEn: 'Repairing chips and cracks' },
          { id: 'm_polish', nameRu: 'Шлифовка и переполировка', nameEn: 'Grinding and repolishing' },
          { id: 'm_seams', nameRu: 'Выравнивание и замена швов', nameEn: 'Grout joint alignment and replacement' },
          { id: 'm_film', nameRu: 'Нанесение защитной пленки', nameEn: 'Protective film application' }
        ]
      },
      tile: {
        title: 'Керамогранит и плитка',
        tasks: [
          { id: 't_chips', nameRu: 'Реставрация сколов и царапин плитки', nameEn: 'Tile chip and scratch restoration' },
          { id: 't_grout', nameRu: 'Замена плиточной затирки', nameEn: 'Tile grout replacement' },
          { id: 't_polish', nameRu: 'Алмазная полировка и лощение', nameEn: 'Diamond polishing and buffing' }
        ]
      },
      metal: {
        title: 'Металл (Латунь/Сталь)',
        tasks: [
          { id: 'mt_scratches', nameRu: 'Устранение царапин и потертостей', nameEn: 'Scratch and scuff removal' },
          { id: 'mt_patina', nameRu: 'Патинирование и сатинирование', nameEn: 'Patination and satin finishing' },
          { id: 'mt_lacquer', nameRu: 'Нанесение защитного лака', nameEn: 'Protective lacquer coating' }
        ]
      },
      glass: {
        title: 'Стекло и зеркала',
        tasks: [
          { id: 'g_polish', nameRu: 'Полировка царапин на стекле', nameEn: 'Glass scratch polishing' },
          { id: 'g_edge', nameRu: 'Реставрация фацета и кромки', nameEn: 'Bevel and edge restoration' }
        ]
      },
      wood: {
        title: 'Дерево и мебель',
        tasks: [
          { id: 'w_wax', nameRu: 'Заделка вмятин и сколов воском', nameEn: 'Wax filling for dents and chips' },
          { id: 'w_paint', nameRu: 'Локальная подкраска текстуры', nameEn: 'Local grain paint retouching' },
          { id: 'w_varnish', nameRu: 'Обновление и нанесение лака (Лаковое покрытие)', nameEn: 'Varnish coating & refinishing' },
          { id: 'w_oil', nameRu: 'Нанесение и обработка маслом (Масляное покрытие)', nameEn: 'Oil coating & finishing' }
        ]
      }
    }
  },
  parquet: {
    title: 'Паркетные работы',
    items: {
      installation: {
        title: 'Укладка и рисунки',
        tasks: [
          { id: 'pq_herringbone', nameRu: 'Укладка паркета: «Ёлка»', nameEn: 'Installation: Herringbone pattern' },
          { id: 'pq_deck', nameRu: 'Укладка паркета: Прямая палуба', nameEn: 'Installation: Straight deck pattern' },
          { id: 'pq_art', nameRu: 'Укладка художественного/модульного паркета', nameEn: 'Installation: Modular artistic pattern' }
        ]
      },
      renovation: {
        title: 'Реставрация и циклевка',
        tasks: [
          { id: 'pq_lacquer', nameRu: 'Циклевка + покрытие лаком', nameEn: 'Sanding + Lacquer coating' },
          { id: 'pq_oil', nameRu: 'Циклевка + покрытие маслом', nameEn: 'Sanding + Oil coating' },
          { id: 'pq_tint', nameRu: 'Тонирование и морение древесины', nameEn: 'Wood tinting and staining' }
        ]
      },
      repair: {
        title: 'Ремонт паркета',
        tasks: [
          { id: 'pq_squeak', nameRu: 'Устранение скрипа и переклейка', nameEn: 'Squeak elimination and regluing' },
          { id: 'pq_plank', nameRu: 'Замена поврежденных плашек', nameEn: 'Damaged plank replacement' }
        ]
      }
    }
  },
  repair: {
    title: 'Отделка и ремонты',
    items: {
      prep: {
        title: 'Демонтаж и защита',
        tasks: [
          { id: 'rp_demolition', nameRu: 'Демонтажные работы', nameEn: 'Dismantling works' },
          { id: 'rp_cover', nameRu: 'Укрытие полов защитной пленкой/оргалитом', nameEn: 'Floor protection covering' },
          { id: 'rp_trash', nameRu: 'Вывоз строительного мусора', nameEn: 'Debris removal' }
        ]
      },
      walls: {
        title: 'Стены и перегородки',
        tasks: [
          { id: 'rp_plaster', nameRu: 'Штукатурка и шпатлевка стен', nameEn: 'Plastering and puttying' },
          { id: 'rp_paint', nameRu: 'Покраска стен', nameEn: 'Wall painting' },
          { id: 'rp_decor', nameRu: 'Нанесение декоративной штукатурки', nameEn: 'Decorative plaster application' }
        ]
      },
      floors: {
        title: 'Полы и стяжка',
        tasks: [
          { id: 'rp_screed', nameRu: 'Устройство стяжки / наливного пола', nameEn: 'Floor screed and self-leveling' },
          { id: 'rp_tile_lay', nameRu: 'Укладка крупноформатной плитки', nameEn: 'Large format tile laying' },
          { id: 'rp_skirting', nameRu: 'Монтаж плинтусов', nameEn: 'Skirting board installation' }
        ]
      }
    }
  }
};

function findTaskById(taskId) {
  for (const catKey in SERVICES_DATA) {
    const category = SERVICES_DATA[catKey];
    for (const subKey in category.items) {
      const sub = category.items[subKey];
      const task = sub.tasks.find(t => t.id === taskId);
      if (task) return task;
    }
  }
  return null;
}

// Расчёт финального списка позиций с пропорциональным распределением накладных расходов
function calculateFinalCart(state, lang = 'ru') {
  const mto = state.mtoCost || 0;
  const transport = state.transportTotal || 0;
  const labor = state.laborTotal || 0;
  const marginPercent = state.marginPercent || 0;

  const overheadsWithMargin = (mto + transport + labor) * (1 + marginPercent / 100);

  let rawTotal = 0;
  state.cart.forEach(item => {
    rawTotal += item.price * item.value;
  });

  if (rawTotal === 0) return [];

  return state.cart.map(item => {
    const itemRawTotal = item.price * item.value;
    const share = itemRawTotal / rawTotal;
    const itemOverhead = overheadsWithMargin * share;
    const itemNewTotal = itemRawTotal + itemOverhead;
    const adjustedUnitPrice = itemNewTotal / item.value;

    return {
      id: item.id,
      name: lang === 'en' ? item.nameEn : item.nameRu,
      unit: lang === 'en' ? item.unitEn : item.unitRu,
      value: item.value,
      price: adjustedUnitPrice
    };
  });
}

// ==========================================
// ГЕНЕРАЦИЯ PDF INVOICE
// ==========================================
function generateInvoicePDF(data, filePath, lang = 'en') {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const writeStream = fs.createWriteStream(filePath);
    doc.pipe(writeStream);

    doc.font('Helvetica-Bold');

    let subtotalCalc = 0;
    data.cart.forEach(item => {
      subtotalCalc += item.price * item.value;
    });
    const vatCalc = subtotalCalc * 0.05;
    const grandTotal = subtotalCalc + vatCalc;

    const logoPath = path.join(__dirname, 'logo.png');
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, 40, 30, { width: 100 });
      doc.fontSize(8).fillColor('#333333').text('NXT FITOUT TECHNICAL SERVICES LLC', 40, 95);
      doc.fontSize(8).fillColor('#666666').text('www.nxt-fitout.com', 40, 107);
    } else {
      doc.fontSize(24).fillColor('#111111').text('NXT', 40, 35);
      doc.fontSize(8).fillColor('#333333').text('NXT FITOUT TECHNICAL SERVICES LLC', 40, 75);
      doc.fontSize(8).fillColor('#666666').text('www.nxt-fitout.com', 40, 87);
    }

    const datePrefix = getFormattedPrefixDate();
    const invoiceFullNumber = `INV-${datePrefix}-${data.reference}`;

    const titleText = lang === 'ru' ? 'ПРОФОРМА ИНВОЙС' : 'PROFORMA INVOICE';
    const numLabel = lang === 'ru' ? 'Номер инвойса' : 'Invoice Number';
    const dateLabel = lang === 'ru' ? 'Дата выдачи' : 'Issue Date';
    const totalLabel = lang === 'ru' ? 'Итоговая сумма' : 'Total Amount';

    doc.fontSize(16).fillColor('#000000').text(titleText, 350, 35, { align: 'right' });
    
    doc.fontSize(8).fillColor('#666666').text(numLabel, 350, 58, { align: 'right' });
    doc.fontSize(9).fillColor('#000000').text(invoiceFullNumber, 350, 68, { align: 'right' });

    doc.fontSize(8).fillColor('#666666').text(dateLabel, 350, 82, { align: 'right' });
    doc.fontSize(9).fillColor('#000000').text(data.issueDate, 350, 92, { align: 'right' });

    doc.fontSize(8).fillColor('#666666').text(totalLabel, 350, 106, { align: 'right' });
    doc.fontSize(10).fillColor('#111111').font('Helvetica-Bold').text(`AED ${grandTotal.toFixed(2)}`, 350, 116, { align: 'right' });

    doc.moveTo(40, 138).lineTo(555, 138).strokeColor('#CCCCCC').lineWidth(1).stroke();

    const fromLabel = lang === 'ru' ? 'Исполнитель' : 'From';
    const toLabel = lang === 'ru' ? 'Заказчик' : 'To';

    doc.fontSize(9).fillColor('#000000').font('Helvetica-Bold').text(fromLabel, 40, 148);
    doc.font('Helvetica').fontSize(8).fillColor('#333333');
    doc.text('NXT Technical Services LLC\nTRN: 104903846400003 Off-681-0,\nAL Yalayis Governmental Transaction Center bldg. Dubai, UAE\n+971 54 710 11 70\ninfo@nxt-fitout.com', 40, 160);

    doc.fontSize(9).fillColor('#000000').font('Helvetica-Bold').text(toLabel, 300, 148);
    doc.font('Helvetica').fontSize(8).fillColor('#333333');

    let clientText = '';
    const contactLbl = lang === 'ru' ? 'Контакт' : 'Contact';
    const phoneLbl = lang === 'ru' ? 'Тел' : 'Phone';
    const refLbl = lang === 'ru' ? 'Проект' : 'Reference';

    if (data.client.type === 'company') {
      clientText = `${data.client.companyName}\nTRN: ${data.client.trn}\n${contactLbl}: ${data.client.name}\n${phoneLbl}: ${data.client.phone}\n`;
    } else {
      const indLbl = lang === 'ru' ? 'Частное лицо' : 'Individual';
      clientText = `${indLbl}: ${data.client.name}\n${phoneLbl}: ${data.client.phone}\n`;
    }
    clientText += `${refLbl}: ${data.reference}`;

    doc.text(clientText, 300, 160);

    doc.moveTo(40, 225).lineTo(555, 225).strokeColor('#CCCCCC').lineWidth(1).stroke();

    let y = 235;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#000000');

    const colNo = '№';
    const colDesc = lang === 'ru' ? 'Наименование работ' : 'Description';
    const colUnit = lang === 'ru' ? 'Ед.изм.' : 'Meas';
    const colQty = lang === 'ru' ? 'Кол-во' : 'Quant.';
    const colPrice = lang === 'ru' ? 'Цена AED' : 'Price AED';
    const colAmt = lang === 'ru' ? 'Сумма AED' : 'Amount AED';

    doc.text(colNo, 40, y);
    doc.text(colDesc, 70, y);
    doc.text(colUnit, 290, y);
    doc.text(colQty, 340, y);
    doc.text(colPrice, 410, y, { width: 60, align: 'right' });
    doc.text(colAmt, 480, y, { width: 75, align: 'right' });

    y += 15;
    doc.moveTo(40, y).lineTo(555, y).strokeColor('#E0E0E0').lineWidth(0.5).stroke();

    doc.font('Helvetica').fontSize(8).fillColor('#333333');
    let subtotal = 0;

    data.cart.forEach((item, i) => {
      y += 12;
      const amount = item.price * item.value;
      subtotal += amount;

      doc.text(`${i + 1}`, 40, y);
      doc.text(item.name, 70, y, { width: 210 });
      doc.text(item.unit, 290, y);
      doc.text(`${item.value}`, 340, y);
      doc.text(item.price.toFixed(2), 410, y, { width: 60, align: 'right' });
      doc.text(amount.toFixed(2), 480, y, { width: 75, align: 'right' });
      y += 10;
    });

    const vat = subtotal * 0.05;
    const total = subtotal + vat;

    y += 15;
    doc.moveTo(40, y).lineTo(555, y).strokeColor('#CCCCCC').lineWidth(1).stroke();

    y += 10;
    const lblTotal = lang === 'ru' ? 'Работы:' : 'Total:';
    const lblVat = lang === 'ru' ? 'НДС / VAT (5%):' : 'Vat (5%):';
    const lblGrand = lang === 'ru' ? 'Итого к оплате:' : 'Subtotal:';

    doc.font('Helvetica-Bold').text(lblTotal, 380, y);
    doc.text(`AED ${subtotal.toFixed(2)}`, 480, y, { width: 75, align: 'right' });

    y += 12;
    doc.text(lblVat, 380, y);
    doc.text(`AED ${vat.toFixed(2)}`, 480, y, { width: 75, align: 'right' });

    y += 12;
    doc.text(lblGrand, 380, y);
    doc.text(`AED ${total.toFixed(2)}`, 480, y, { width: 75, align: 'right' });

    y += 30;
    const payTitle = lang === 'ru' ? 'Реквизиты для оплаты:' : 'Payment Details:';
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#000000').text(payTitle, 40, y);
    doc.font('Helvetica').fontSize(7.5).fillColor('#444444');
    
    const bankDetails = 'Company name: NXT Technical Services LLC\nAdress: Off-04-157, Saeed Suhail Saeed bldg., Rasl Al Khor, Dubai, UAE\nLicense No: 1478310\nBank name: Emirates Islamic Bank\nBeneficiary: NXT Technical Services LLC\nSWIFT: 84959154\nAccount: 3708495915401\nIBAN: AE 180340003708495915401';
    doc.text(bankDetails, 40, y + 12);

    const notesTitle = lang === 'ru' ? 'Условия и примечания:' : 'Notes:';
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#000000').text(notesTitle, 320, y);
    doc.font('Helvetica').fontSize(7.5).fillColor('#444444');

    const notesContent = lang === 'ru' 
      ? 'В стоимость включены все черновие и финишные материалы.\n1-й платеж - 70%: Предоплата до начала выполнения работ.\n2-й платеж - 30%: После финальной приемки выполненных работ.'
      : 'The price includes all rough and final (finishing) materials.\n1st payment - 70%: Advance payment before the start of all work.\n2nd payment - 30%: After the final acceptance of completed work.';

    doc.text(notesContent, 320, y + 12);

    doc.end();

    writeStream.on('finish', () => resolve(filePath));
    writeStream.on('error', (err) => reject(err));
  });
}

// ==========================================
// СЦЕНАРИЙ СЦЕНЫ (WIZARD SCENE)
// ==========================================
const estimatorScene = new Scenes.WizardScene(
  'ESTIMATOR_SCENE',

  // Шаг 0: Референс
  async (ctx) => {
    ctx.wizard.state.cart = [];
    ctx.wizard.state.client = {};
    ctx.wizard.state.mtoCost = 0;
    ctx.wizard.state.transportTotal = 0;
    ctx.wizard.state.laborTotal = 0;
    ctx.wizard.state.marginPercent = 0;
    ctx.wizard.state.pdfLang = 'en';

    await ctx.reply(
      '🏢 **«NXT FITOUT TECHNICAL SERVICES»**\n\n' +
      'Введите номер референса проекта (только цифры, например: *00204*):',
      { parse_mode: 'Markdown' }
    );
    return ctx.wizard.next();
  },

  // Шаг 1: Номер проекта -> Выбор типа клиента
  async (ctx) => {
    if (!ctx.message || !ctx.message.text) {
      await ctx.reply('⚠️ Пожалуйста, введите номер проекта текстом.');
      return;
    }

    const input = ctx.message.text.trim();
    if (!/^[0-9\s]+$/.test(input)) {
      await ctx.reply('❌ Ошибка! Номер проекта должен содержать **только цифры**.\n\nВведите повторно:', { parse_mode: 'Markdown' });
      return;
    }

    ctx.wizard.state.projectRef = input;

    await ctx.reply(
      '👤 **Укажите тип клиента:**',
      Markup.inlineKeyboard([
        [
          Markup.button.callback('👤 Физическое лицо', 'client_individual'),
          Markup.button.callback('🏢 Юридическое лицо', 'client_company')
        ]
      ])
    );
    return ctx.wizard.next();
  },

  // Шаг 2: Ввод данных клиента
  async (ctx) => {
    const state = ctx.wizard.state;

    if (ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;

      if (data === 'client_individual') {
        await ctx.answerCbQuery();
        state.client.type = 'individual';
        state.stepClient = 'ind_name';
        await ctx.reply('👤 Введите **Имя и Фамилию** клиента (каждое слово с заглавной буквы, например: *Muhammet Orunov*):');
        return;
      }

      if (data === 'client_company') {
        await ctx.answerCbQuery();
        state.client.type = 'company';
        state.stepClient = 'comp_name';
        await ctx.reply('🏢 Введите **Название компании** (юрлица):');
        return;
      }

      if (data === 'skip_trn' && state.stepClient === 'comp_trn') {
        await ctx.answerCbQuery();
        state.client.trn = '-';
        state.stepClient = 'comp_contact';
        await ctx.reply('👤 Введите **Имя и Фамилию** контактного лица (каждое слово с заглавной буквы, например: *Muhammet Orunov*):');
        return;
      }
    }

    if (ctx.message && ctx.message.text) {
      const text = ctx.message.text.trim();

      if (state.stepClient === 'ind_name') {
        const check = validateCapitalNames(text);
        if (!check.valid) {
          await ctx.reply(check.error);
          return;
        }
        state.client.name = text;
        state.stepClient = 'ind_phone';
        await ctx.reply('📞 Введите номер телефона клиента (Обязательно начиная с **+971**, например: *+971550000000*):', { parse_mode: 'Markdown' });
        return;
      }

      if (state.stepClient === 'ind_phone') {
        const check = validateUAEPhone(text);
        if (!check.valid) {
          await ctx.reply(check.error, { parse_mode: 'Markdown' });
          return;
        }
        state.client.phone = check.formatted;
        state.stepClient = null;
        ctx.wizard.next();
        return askMtoCost(ctx);
      }

      if (state.stepClient === 'comp_name') {
        state.client.companyName = text;
        state.stepClient = 'comp_trn';
        await ctx.reply(
          '📑 Введите 15-значный **TRN / Налоговый код** компании (например: *100257658500003*) или нажмите кнопку ниже:',
          {
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('🚫 Без TRN (поставить прочерк)', 'skip_trn')]])
          }
        );
        return;
      }

      if (state.stepClient === 'comp_trn') {
        const check = validateTRN(text);
        if (!check.valid) {
          await ctx.reply(check.error);
          return;
        }
        state.client.trn = check.formatted;
        state.stepClient = 'comp_contact';
        await ctx.reply('👤 Введите **Имя и Фамилию** контактного лица (каждое слово с заглавной буквы, например: *Muhammet Orunov*):');
        return;
      }

      if (state.stepClient === 'comp_contact') {
        const check = validateCapitalNames(text);
        if (!check.valid) {
          await ctx.reply(check.error);
          return;
        }
        state.client.name = text;
        state.stepClient = 'comp_phone';
        await ctx.reply('📞 Введите номер телефона контактного лица (Обязательно начиная с **+971**, например: *+971550000000*):', { parse_mode: 'Markdown' });
        return;
      }

      if (state.stepClient === 'comp_phone') {
        const check = validateUAEPhone(text);
        if (!check.valid) {
          await ctx.reply(check.error, { parse_mode: 'Markdown' });
          return;
        }
        state.client.phone = check.formatted;
        state.stepClient = null;
        ctx.wizard.next();
        return askMtoCost(ctx);
      }
    }
  },

  // Шаг 3: Ввод расходов (МТО, Дорога, Человеко-дни, Процент)
  async (ctx) => {
    const state = ctx.wizard.state;

    // Выбор типа транспорта по кнопкам
    if (ctx.callbackQuery && state.costSubStep === 'trans_type') {
      await ctx.answerCbQuery();
      const type = ctx.callbackQuery.data;
      if (type === 'trans_project') {
        state.transType = 'project';
        state.costSubStep = 'trans_amount';
        await ctx.reply('🚌 Введите общую стоимость транспорта на **весь проект** (в AED):');
        return;
      } else if (type === 'trans_daily') {
        state.transType = 'daily';
        state.costSubStep = 'trans_days';
        await ctx.reply('📅 Введите количество **дней** работы транспорта:');
        return;
      }
    }

    // Выбор формата ставки рабочих
    if (ctx.callbackQuery && state.costSubStep === 'labor_rate_type') {
      await ctx.answerCbQuery();
      const type = ctx.callbackQuery.data;
      if (type === 'labor_same') {
        state.costSubStep = 'labor_same_rate';
        await ctx.reply(`💰 Введите **общую единую ставку за 1 день** на 1 человека (в AED):`);
        return;
      } else if (type === 'labor_separate') {
        state.costSubStep = 'labor_worker_rate';
        state.currentWorkerIndex = 1;
        state.workerRatesSum = 0;
        await ctx.reply(`💰 Введите дневную ставку (в AED) для **Рабочего №1** (на ${state.laborDays} дн.):`);
        return;
      }
    }

    if (ctx.message && ctx.message.text) {
      const val = parseFloat(ctx.message.text.replace(',', '.').trim());

      // МТО
      if (state.costSubStep === 'mto') {
        if (isNaN(val) || val < 0) {
          await ctx.reply('⚠️ Введите корректную сумму для МТО в AED (или 0):');
          return;
        }
        state.mtoCost = val;
        state.costSubStep = 'trans_type';

        await ctx.reply(
          '🚗 **Расходы на дорогу (транспорт):**\nКак будут рассчитываться расходы?',
          Markup.inlineKeyboard([
            [
              Markup.button.callback('📦 За весь проект', 'trans_project'),
              Markup.button.callback('📅 В день (по дням)', 'trans_daily')
            ]
          ])
        );
        return;
      }

      // Дни транспорта
      if (state.costSubStep === 'trans_days') {
        if (isNaN(val) || val <= 0) {
          await ctx.reply('⚠️ Введите корректное количество дней (число больше 0):');
          return;
        }
        state.transDays = val;
        state.costSubStep = 'trans_daily_rate';
        await ctx.reply('💰 Введите стоимость транспорта **за 1 день** (в AED):');
        return;
      }

      // Ставка транспорта
      if (state.costSubStep === 'trans_daily_rate') {
        if (isNaN(val) || val < 0) {
          await ctx.reply('⚠️ Введите корректную сумму за день в AED:');
          return;
        }
        state.transportTotal = val * state.transDays;
        state.costSubStep = 'labor_days';
        await ctx.reply('📅 **Расчёт рабочих (человеко-дней):**\nСколько **дней** будут идти работы на проекте?');
        return;
      }

      // Транспорт на весь проект
      if (state.costSubStep === 'trans_amount') {
        if (isNaN(val) || val < 0) {
          await ctx.reply('⚠️ Введите корректную сумму на транспорт в AED:');
          return;
        }
        state.transportTotal = val;
        state.costSubStep = 'labor_days';
        await ctx.reply('📅 **Расчёт рабочих (человеко-дней):**\nСколько **дней** будут идти работы на проекте?');
        return;
      }

      // Дни работы людей
      if (state.costSubStep === 'labor_days') {
        if (isNaN(val) || val <= 0) {
          await ctx.reply('⚠️ Укажите корректное число дней (больше 0):');
          return;
        }
        state.laborDays = val;
        state.costSubStep = 'labor_workers';
        await ctx.reply('👷 Сколько **человек** будут работать на проекте?');
        return;
      }

      // Количество рабочих
      if (state.costSubStep === 'labor_workers') {
        if (isNaN(val) || val <= 0) {
          await ctx.reply('⚠️ Укажите корректное количество человек (больше 0):');
          return;
        }
        state.laborWorkers = val;
        state.totalManDays = state.laborDays * state.laborWorkers;

        state.costSubStep = 'labor_rate_type';
        await ctx.reply(
          `👥 Всего: **${state.laborWorkers} чел.** x **${state.laborDays} дн.** = **${state.totalManDays} человеко-дней**.\n\n` +
          `Как указываем зарплату рабочих?`,
          Markup.inlineKeyboard([
            [Markup.button.callback('💵 Одинаковая ставка для всех', 'labor_same')],
            [Markup.button.callback('📊 Разные ставки для каждого', 'labor_separate')]
          ])
        );
        return;
      }

      // Единая ставка
      if (state.costSubStep === 'labor_same_rate') {
        if (isNaN(val) || val < 0) {
          await ctx.reply('⚠️ Введите корректную ставку в AED:');
          return;
        }
        state.laborTotal = state.totalManDays * val;
        await ctx.reply(`✅ Общая стоимость рабочих: **${state.laborTotal.toFixed(2)} AED** (${state.totalManDays} чел-дней х ${val} AED)`);
        
        state.costSubStep = 'margin';
        await ctx.reply('📈 Введите **процент компании** на внутренние расходы (например: *10* или *15*):');
        return;
      }

      // Разные ставки для каждого
      if (state.costSubStep === 'labor_worker_rate') {
        if (isNaN(val) || val < 0) {
          await ctx.reply('⚠️ Введите корректную сумму для рабочего в AED:');
          return;
        }

        const workerCost = val * state.laborDays;
        state.workerRatesSum += workerCost;

        if (state.currentWorkerIndex < state.laborWorkers) {
          state.currentWorkerIndex++;
          await ctx.reply(`💰 Введите дневную ставку (в AED) для **Рабочего №${state.currentWorkerIndex}** (на ${state.laborDays} дн.):`);
          return;
        } else {
          state.laborTotal = state.workerRatesSum;
          await ctx.reply(`✅ Общая стоимость всех рабочих: **${state.laborTotal.toFixed(2)} AED**`);

          state.costSubStep = 'margin';
          await ctx.reply('📈 Введите **процент компании** на внутренние расходы (например: *10* или *15*):');
          return;
        }
      }

      // Процент компании
      if (state.costSubStep === 'margin') {
        if (isNaN(val) || val < 0) {
          await ctx.reply('⚠️ Введите корректный процент (число 0 или больше):');
          return;
        }
        state.marginPercent = val;
        state.costSubStep = null;

        ctx.wizard.next();
        return showMainMenu(ctx);
      }
    }
  },

  // Шаг 4: Выбор работ и единиц измерения
  async (ctx) => {
    // 1. Выбор единицы измерения по callback
    if (ctx.callbackQuery && ctx.callbackQuery.data.startsWith('unit_')) {
      await ctx.answerCbQuery();
      const unitKey = ctx.callbackQuery.data.replace('unit_', '');
      const selectedUnit = UNITS_CONFIG[unitKey];

      ctx.wizard.state.pendingTask.unitRu = selectedUnit.ru;
      ctx.wizard.state.pendingTask.unitEn = selectedUnit.en;
      ctx.wizard.state.pendingTask.step = 'enter_value';

      await ctx.reply(`Укажите количество / объем в **${selectedUnit.ru}**:`, { parse_mode: 'Markdown' });
      return;
    }

    // 2. Ввод числовых значений объема и цены
    if (ctx.message && ctx.message.text) {
      const text = ctx.message.text.replace(',', '.').trim();

      if (ctx.wizard.state.pendingTask && ctx.wizard.state.pendingTask.step === 'enter_value') {
        const val = parseFloat(text);
        if (isNaN(val) || val <= 0) {
          await ctx.reply('⚠️ Укажите корректный объем числом:');
          return;
        }
        ctx.wizard.state.pendingTask.value = val;
        ctx.wizard.state.pendingTask.step = 'enter_price';
        await ctx.reply(`Укажите **стоимость за единицу (AED)** за 1 ${ctx.wizard.state.pendingTask.unitRu}:`, { parse_mode: 'Markdown' });
        return;
      }

      if (ctx.wizard.state.pendingTask && ctx.wizard.state.pendingTask.step === 'enter_price') {
        const price = parseFloat(text);
        if (isNaN(price) || price < 0) {
          await ctx.reply('⚠️ Укажите корректную стоимость в AED:');
          return;
        }

        const task = ctx.wizard.state.pendingTask;
        ctx.wizard.state.cart.push({
          id: task.id,
          nameRu: task.nameRu,
          nameEn: task.nameEn,
          unitRu: task.unitRu,
          unitEn: task.unitEn,
          value: task.value,
          price: price
        });

        ctx.wizard.state.pendingTask = null;
        await ctx.reply(`✅ Добавлено: **${task.nameRu}** — ${task.value} ${task.unitRu} x ${price} AED`, { parse_mode: 'Markdown' });
        return showMainMenu(ctx);
      }
    }

    if (ctx.callbackQuery) {
      const data = ctx.callbackQuery.data;
      await ctx.answerCbQuery();

      if (data === 'menu_main') return showMainMenu(ctx);
      if (data === 'cart_view') return showCart(ctx);
      if (data === 'show_draft') return showDraft(ctx);

      if (data === 'toggle_lang') {
        ctx.wizard.state.pdfLang = ctx.wizard.state.pdfLang === 'en' ? 'ru' : 'en';
        return showDraft(ctx);
      }

      if (data === 'clear_cart') {
        ctx.wizard.state.cart = [];
        await ctx.reply('🗑 Список работ очищен.');
        return showMainMenu(ctx);
      }

      if (data === 'finish_ready') {
        if (ctx.wizard.state.cart.length === 0) {
          await ctx.reply('⚠️ Добавьте хотя бы одну работу!');
          return;
        }

        const pdfLang = ctx.wizard.state.pdfLang || 'en';
        await ctx.reply(`📄 Генерирую PDF Proforma Invoice (${pdfLang.toUpperCase()})...`);

        const finalCart = calculateFinalCart(ctx.wizard.state, pdfLang);

        const pdfPath = path.join(__dirname, `Invoice_${ctx.wizard.state.projectRef}.pdf`);
        const invoiceData = {
          issueDate: new Date().toLocaleDateString('en-GB'),
          reference: ctx.wizard.state.projectRef,
          client: ctx.wizard.state.client,
          cart: finalCart
        };

        try {
          await generateInvoicePDF(invoiceData, pdfPath, pdfLang);
          await ctx.replyWithDocument({
            source: pdfPath,
            filename: `PROFORMA_INVOICE_${ctx.wizard.state.projectRef}_${pdfLang.toUpperCase()}.pdf`
          });
          fs.unlinkSync(pdfPath);
        } catch (err) {
          console.error(err);
          await ctx.reply('❌ Ошибка при генерации PDF.');
        }

        return ctx.scene.leave();
      }

      if (SERVICES_DATA[data]) return showSubCategories(ctx, data);

      if (data.includes(':')) {
        const [catKey, subKey] = data.split(':');
        if (SERVICES_DATA[catKey] && SERVICES_DATA[catKey].items[subKey]) {
          return showTaskList(ctx, catKey, subKey);
        }
      }

      // Клик по конкретной услуге -> Выбор единицы измерения
      if (data.startsWith('task_')) {
        const taskId = data.replace('task_', '');
        const task = findTaskById(taskId);
        if (task) {
          ctx.wizard.state.pendingTask = { ...task, step: 'choose_unit' };

          await ctx.reply(
            `Вы выбрали: **${task.nameRu}**\n\n📐 **В чем будет измеряться эта работа?**`,
            {
              parse_mode: 'Markdown',
              ...Markup.inlineKeyboard([
                [
                  Markup.button.callback('📐 м² (Кв. метры)', 'unit_sqm'),
                  Markup.button.callback('📏 м.п. (Погонные м.)', 'unit_lm')
                ],
                [
                  Markup.button.callback('🪑 шт (Штуки / Столы)', 'unit_pcs'),
                  Markup.button.callback('📦 компл. (Комплект / Выезд)', 'unit_set')
                ]
              ])
            }
          );
        }
      }
    }
  }
);

// --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---

async function askMtoCost(ctx) {
  ctx.wizard.state.costSubStep = 'mto';
  await ctx.reply('🛠 Введите сумму затрат на **МТО** (материалы и инструмент) в AED (если нет, введите 0):');
}

async function showMainMenu(ctx) {
  const ref = ctx.wizard.state.projectRef || 'Не указан';
  const cartCount = ctx.wizard.state.cart ? ctx.wizard.state.cart.length : 0;

  const buttons = Object.keys(SERVICES_DATA).map(key => [
    Markup.button.callback(SERVICES_DATA[key].title, key)
  ]);

  if (cartCount > 0) {
    buttons.push([Markup.button.callback(`📋 Корзина (${cartCount})`, 'cart_view')]);
    buttons.push([Markup.button.callback('📄 Просмотр и Скачать PDF', 'show_draft')]);
  }

  const text = `📁 **Проект Reference:** ${ref}\n\nВыберите раздел работ:`;

  if (ctx.callbackQuery) {
    await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  } else {
    await ctx.reply(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  }
}

async function showSubCategories(ctx, catKey) {
  const category = SERVICES_DATA[catKey];
  const buttons = Object.keys(category.items).map(subKey => [
    Markup.button.callback(category.items[subKey].title, `${catKey}:${subKey}`)
  ]);
  buttons.push([Markup.button.callback('⬅️ Назад', 'menu_main')]);

  await ctx.editMessageText(`Раздел: **${category.title}**\nВыберите категорию:`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons)
  });
}

async function showTaskList(ctx, catKey, subKey) {
  const sub = SERVICES_DATA[catKey].items[subKey];
  const buttons = sub.tasks.map(task => [
    Markup.button.callback(`${task.nameRu}`, `task_${task.id}`)
  ]);
  buttons.push([Markup.button.callback('⬅️ Назад', catKey)]);

  await ctx.editMessageText(`Категория: **${sub.title}**\nВыберите услугу:`, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons)
  });
}

async function showCart(ctx) {
  const cart = ctx.wizard.state.cart;
  let text = `📋 **Выбранные позиции (Ref: ${ctx.wizard.state.projectRef}):**\n\n`;

  let total = 0;
  cart.forEach((item, index) => {
    const sum = item.value * item.price;
    total += sum;
    text += `${index + 1}. ${item.nameRu} — ${item.value} ${item.unitRu} x ${item.price} AED = **${sum.toFixed(2)} AED**\n`;
  });

  text += `\n**Итого (без учета внутренних расходов):** ${total.toFixed(2)} AED`;

  const buttons = [
    [Markup.button.callback('➕ Добавить еще', 'menu_main')],
    [Markup.button.callback('📄 Черновик КП / Скачать PDF', 'show_draft')]
  ];

  await ctx.editMessageText(text, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
}

async function showDraft(ctx) {
  const state = ctx.wizard.state;
  const pdfLang = state.pdfLang || 'en';
  const finalCart = calculateFinalCart(state, pdfLang);
  const ref = state.projectRef;
  const client = state.client;
  const invNumber = `INV-${getFormattedPrefixDate()}-${ref}`;

  let report = `📝 **ПРЕДВАРИТЕЛЬНЫЙ РАСЧЕТ PROFORMA INVOICE**\n\n`;
  report += `🌐 Язык генерации PDF: **${pdfLang === 'en' ? '🇬🇧 English' : '🇷🇺 Русский'}**\n`;
  report += `🏢 Company: **NXT FITOUT TECHNICAL SERVICES LLC**\n`;
  report += `📄 Invoice Number: **${invNumber}**\n`;
  report += `📍 Reference: **${ref}**\n`;

  if (client.type === 'company') {
    report += `🏛 Client: **${client.companyName}**\n`;
    report += `📑 TRN: **${client.trn}**\n`;
    report += `👤 Contact: **${client.name}** (${client.phone})\n`;
  } else {
    report += `👤 Client: **${client.name}** (${client.phone})\n`;
  }

  report += `----------------------------------------\n`;
  report += `👁 *Вид позиции в документе (${pdfLang.toUpperCase()}):*\n\n`;

  let subtotal = 0;
  finalCart.forEach((item, index) => {
    const sum = item.value * item.price;
    subtotal += sum;
    report += `${index + 1}. ${item.name}: ${item.value} ${item.unit} x ${item.price.toFixed(2)} = **${sum.toFixed(2)} AED**\n`;
  });

  const vat = subtotal * 0.05;
  const total = subtotal + vat;

  report += `\n----------------------------------------\n`;
  report += `Total: **AED ${subtotal.toFixed(2)}**\n`;
  report += `VAT (5%): **AED ${vat.toFixed(2)}**\n`;
  report += `Subtotal: **AED ${total.toFixed(2)}**\n\n`;
  report += `Вы можете сменить язык PDF кнопкой ниже перед скачиванием:`;

  const langBtnText = pdfLang === 'en' ? '🌐 Переключить на PDF (🇷🇺 RU)' : '🌐 Переключить на PDF (🇬🇧 EN)';

  const buttons = [
    [Markup.button.callback(langBtnText, 'toggle_lang')],
    [
      Markup.button.callback('✅ Всё готово (Скачать PDF)', 'finish_ready'),
      Markup.button.callback('🗑 Очистить список', 'clear_cart')
    ]
  ];

  if (ctx.callbackQuery) {
    await ctx.editMessageText(report, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  } else {
    await ctx.reply(report, { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) });
  }
}

// ==========================================
// ЗАПУСК БОТА
// ==========================================
const bot = new Telegraf(BOT_TOKEN);
const stage = new Scenes.Stage([estimatorScene]);

bot.use(session());
bot.use(stage.middleware());

bot.start((ctx) => ctx.scene.enter('ESTIMATOR_SCENE'));

bot.launch().then(() => {
  console.log('🚀 Бот запущен!');
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));

