const fs = require('fs/promises');
const readline = require('readline/promises');
const path = require('path');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const c = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  red: "\x1b[31m"
};

function cleanPath(p) {
  if (!p) return p;
  return p.replace(/^["']|["']$/g, '').trim();
}

function encodeContent(content) {
  return Buffer.from(content, 'utf-8').toString('base64');
}

function decodeContent(content) {
  return Buffer.from(content, 'base64').toString('utf-8');
}

function formatBytes(bytes, decimals = 2) {
  if (!+bytes) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.clear();
  console.log(`${c.cyan}${c.bright}================================================${c.reset}`);
  console.log(`${c.bright}${c.cyan}      BASE64 DLL ENCODER & DECODER v0.0.4     ${c.reset}`);
  console.log(`${c.cyan}${c.bright}================================================${c.reset}\n`);
  
  while (true) {
    try {
      const menu = `${c.bright}Выберите режим:\n${c.reset}` +
        `${c.cyan}[1]${c.reset} Текст -> DLL (классическое кодирование)\n` +
        `${c.cyan}[2]${c.reset} DLL -> Текст (создание .txt из dll)\n` +
        `${c.cyan}[3]${c.reset} Файл -> DLL (любой формат в .dll)\n` +
        `${c.cyan}[4]${c.reset} DLL -> Файл (раскодировать .dll в исходный формат)\n` +
        `${c.cyan}[5]${c.reset} Инфо о DLL (информация о файле)\n` +
        `${c.cyan}[0]${c.reset} Выход из программы\n\n` +
        `${c.cyan}> ${c.reset}`;
        
      const mode = await rl.question(menu);

      if (mode.trim() === '0') {
        console.log(`\n${c.green}Спасибо за использование! До свидания.${c.reset}`);
        break;
      } else if (mode.trim() === '1') {
      console.log(`\n${c.cyan}--- ТЕКСТ В DLL ---${c.reset}`);
      let name = cleanPath(await rl.question(`${c.bright}Введите имя файла (без .dll): ${c.reset}`));
      const content = await rl.question(`${c.bright}Введите содержание (текст): ${c.reset}`);
      
      process.stdout.write(`\n${c.dim}Кодирование...${c.reset}`);
      await sleep(400); // Небольшая задержка для эффекта
      
      const encodedContent = encodeContent(content);
      await fs.writeFile(`${name}.dll`, encodedContent);
      
      console.log(`\r${c.green}${c.bright}УСПЕХ! Текст зашифрован и сохранен в "${name}.dll".${c.reset}\n`);

    } else if (mode.trim() === '2') {
      console.log(`\n${c.cyan}--- DLL В ТЕКСТ ---${c.reset}`);
      let name = cleanPath(await rl.question(`${c.bright}Введите полное имя файла (с .dll) или только имя: ${c.reset}`));
      let fileName = name.toLowerCase().endsWith('.dll') ? name : `${name}.dll`;
      let outName = name.toLowerCase().endsWith('.dll') ? name.slice(0, -4) : name;
      
      process.stdout.write(`\n${c.dim}Чтение и декодирование...${c.reset}`);
      await sleep(400);

      try {
        const data = await fs.readFile(fileName, 'utf-8');
        const decodedContent = decodeContent(data);
        await fs.writeFile(`${outName}.txt`, decodedContent);
        console.log(`\r${c.green}${c.bright}УСПЕХ! Файл "${fileName}" декодирован в "${outName}.txt".${c.reset}\n`);
      } catch (e) {
        if (e.code === 'ENOENT') {
          console.log(`\r${c.red}${c.bright}ОШИБКА: Файл "${fileName}" не найден в папке с программой!${c.reset}\n`);
        } else {
          console.log(`\r${c.red}${c.bright}ОШИБКА: ${e.message}${c.reset}\n`);
        }
      }

    } else if (mode.trim() === '3') {
      console.log(`\n${c.cyan}--- ЛЮБОЙ ФАЙЛ В BASE64 DLL ---${c.reset}`);
      let filePath = cleanPath(await rl.question(`${c.bright}Введите путь или имя исходного файла (можно перетащить в окно): ${c.reset}`));
      
      try {
        const stats = await fs.stat(filePath);
        process.stdout.write(`\n${c.dim}Чтение файла (${formatBytes(stats.size)})...${c.reset}`);
        
        const fileBuffer = await fs.readFile(filePath);
        
        process.stdout.write(`\r${c.dim}Кодирование данных в Base64...${c.reset}               `);
        await sleep(500);
        
        const base64Data = fileBuffer.toString('base64');
        const outFileName = `${path.basename(filePath)}.dll`;
        
        await fs.writeFile(outFileName, base64Data);
        
        console.log(`\r${c.green}${c.bright}УСПЕХ! Файл "${path.basename(filePath)}" превращен в "${outFileName}".${c.reset} \n${c.dim}Размер DLL: ${formatBytes(base64Data.length)}${c.reset}\n`);
      } catch (e) {
        if (e.code === 'ENOENT') {
          console.log(`\r${c.red}${c.bright}ОШИБКА: Файл "${filePath}" не найден!${c.reset}\n`);
        } else {
          console.log(`\r${c.red}${c.bright}ОШИБКА: ${e.message}${c.reset}\n`);
        }
      }

    } else if (mode.trim() === '4') {
      console.log(`\n${c.cyan}--- DLL В ИСХОДНЫЙ ФОРМАТ ---${c.reset}`);
      let filePath = cleanPath(await rl.question(`${c.bright}Введите имя .dll файла (можно перетащить в окно): ${c.reset}`));
      if (!filePath.toLowerCase().endsWith('.dll')) {
        try { await fs.access(filePath); } catch { filePath += '.dll'; }
      }
      
      try {
        process.stdout.write(`\n${c.dim}Чтение закодированных данных...${c.reset}`);
        
        const base64Data = await fs.readFile(filePath, 'utf-8');
        
        process.stdout.write(`\r${c.dim}Декодирование и восстановление файла...${c.reset}        `);
        await sleep(500);
        
        const originalBuffer = Buffer.from(base64Data, 'base64');
        
        // Попытка восстановить оригинальное имя.
        // Если файл называется "video.mp4.dll", он станет "video.mp4". 
        // Иначе добавим приписку "_decoded".
        let outFileName = filePath;
        if (outFileName.toLowerCase().endsWith('.dll')) {
            outFileName = outFileName.slice(0, -4);
        } else {
            outFileName += "_decoded";
        }
        
        // Если пользователь переименовал dll и обрезал формат, мы не сможем его магически узнать
        await fs.writeFile(outFileName, originalBuffer);
        
        console.log(`\r${c.green}${c.bright}УСПЕХ! DLL декодирован обратно в файл "${outFileName}".${c.reset} \n${c.dim}Восстановленный размер: ${formatBytes(originalBuffer.length)}${c.reset}\n`);
      } catch (e) {
        if (e.code === 'ENOENT') {
          console.log(`\r${c.red}${c.bright}ОШИБКА: Файл "${filePath}" не найден!${c.reset}\n`);
        } else {
          console.log(`\r${c.red}${c.bright}ОШИБКА: ${e.message}${c.reset}\n`);
        }
      }

    } else if (mode.trim() === '5') {
      console.log(`\n${c.cyan}--- ИНФО О DLL ---${c.reset}`);
      let filePath = cleanPath(await rl.question(`${c.bright}Введите путь или имя .dll файла: ${c.reset}`));
      if (!filePath.toLowerCase().endsWith('.dll')) {
        try { await fs.access(filePath); } catch { filePath += '.dll'; }
      }
      
      try {
        const stats = await fs.stat(filePath);
        const fd = await fs.open(filePath, 'r');
        const buffer = Buffer.alloc(100);
        await fd.read(buffer, 0, 100, 0);
        await fd.close();
        
        console.log(`\n${c.cyan}${c.bright}>>> ДЕТАЛИ ФАЙЛА <<<${c.reset}`);
        console.log(`${c.bright}• Имя файла: ${c.reset}${path.basename(filePath)}`);
        console.log(`${c.bright}• Размер на диске: ${c.reset}${formatBytes(stats.size)}`);
        
        const originalSizeApprox = Math.floor((stats.size / 4) * 3);
        console.log(`${c.bright}• Ожидаемый размер после декода: ${c.reset}~${formatBytes(originalSizeApprox)}`);
        
        const prefixStr = buffer.toString('utf-8').replace(/[^a-zA-Z0-9+/=]/g, '').substring(0, 40);
        console.log(`${c.bright}• Фрагмент кода (сигнатура): ${c.reset}${prefixStr}...`);
        
        const decodedPrefix = Buffer.from(prefixStr, 'base64').toString('ascii').replace(/[\x00-\x1F\x7F-\x9F]/g, '.');
        console.log(`${c.bright}• Анализ заголовка (hex/ascii): ${c.reset}${decodedPrefix}`);
        console.log();
        
      } catch (e) {
        console.log(`\n${c.red}${c.bright}ОШИБКА чтения: ${e.message}${c.reset}\n`);
      }

    } else {
      console.log(`\n${c.red}${c.bright}ОШИБКА: Неверный выбор. Введите число от 0 до 5.${c.reset}\n`);
    }

    await rl.question(`\n${c.dim}Нажмите Enter для продолжения...${c.reset}`);
    console.clear();
  } catch (err) {
    console.log(`\n${c.red}${c.bright}КРИТИЧЕСКАЯ ОШИБКА:${c.reset} ${err.message}\n`);
    await rl.question(`\n${c.dim}Нажмите Enter для продолжения...${c.reset}`);
    console.clear();
  } 
  }
  
  rl.close();
}

main();