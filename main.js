const fs = require('fs/promises');
const readline = require('readline/promises');

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
  magenta: "\x1b[35m",
  yellow: "\x1b[33m",
  red: "\x1b[31m"
};

function encodeContent(content) {
  return Buffer.from(content, 'utf-8').toString('base64');
}

function decodeContent(content) {
  return Buffer.from(content, 'base64').toString('utf-8');
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.clear();
  console.log(`${c.cyan}${c.bright}================================================${c.reset}`);
  console.log(`${c.bright}${c.green}      BASE64 DLL ENCODER & DECODER v2.0       ${c.reset}`);
  console.log(`${c.cyan}${c.bright}================================================${c.reset}\n`);
  
  try {
    const mode = await rl.question(`${c.yellow}Выберите режим:\n${c.reset}[1] ${c.cyan}Кодирование (текст -> dll)${c.reset}\n[2] ${c.magenta}Декодирование (dll -> txt)${c.reset}\n\n${c.bright}> ${c.reset}`);

    if (mode.trim() === '1') {
      console.log(`\n${c.cyan}--- РЕЖИМ КОДИРОВАНИЯ ---${c.reset}`);
      const name = await rl.question(`${c.bright}Введите имя файла (без .dll): ${c.reset}`);
      const content = await rl.question(`${c.bright}Введите содержание (текст): ${c.reset}`);
      
      process.stdout.write(`\n${c.dim}Кодирование...${c.reset}`);
      await sleep(400); // Небольшая задержка для эффекта
      
      const encodedContent = encodeContent(content);
      await fs.writeFile(`${name}.dll`, encodedContent);
      
      console.log(`\r${c.green}${c.bright}УСПЕХ! Данные зашифрованы и сохранены в "${name}.dll".${c.reset}\n`);

    } else if (mode.trim() === '2') {
      console.log(`\n${c.magenta}--- РЕЖИМ ДЕКОДИРОВАНИЯ ---${c.reset}`);
      const name = await rl.question(`${c.bright}Введите имя файла (без .dll): ${c.reset}`);
      
      process.stdout.write(`\n${c.dim}Чтение и декодирование...${c.reset}`);
      await sleep(400);

      try {
        const data = await fs.readFile(`${name}.dll`, 'utf-8');
        const decodedContent = decodeContent(data);
        await fs.writeFile(`${name}.txt`, decodedContent);
        console.log(`\r${c.green}${c.bright}УСПЕХ! Файл "${name}.dll" декодирован в "${name}.txt".${c.reset}\n`);
      } catch (e) {
        if (e.code === 'ENOENT') {
          console.log(`\r${c.red}${c.bright}ОШИБКА: Файл "${name}.dll" не найден в папке с программой!${c.reset}\n`);
        } else {
          console.log(`\r${c.red}${c.bright}ОШИБКА: ${e.message}${c.reset}\n`);
        }
      }

    } else {
      console.log(`\n${c.red}${c.bright}ОШИБКА: Неверный режим. Пожалуйста, введите 1 или 2.${c.reset}\n`);
    }
  } catch (err) {
    console.log(`\n${c.red}${c.bright}КРИТИЧЕСКАЯ ОШИБКА:${c.reset} ${err.message}\n`);
  } finally {
    await rl.question(`\n${c.dim}Нажмите Enter для выхода...${c.reset}`);
    rl.close();
  }
}

main();
