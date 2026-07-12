const fs = require('fs/promises');
const fsSync = require('fs');
const readline = require('readline/promises');
const path = require('path');
const crypto = require('crypto');
const { exec } = require('child_process');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

const APP_VERSION = '0.0.8';
const META_TAG = '\n//_B64DLL_TOOL_SIG_//';
const HASH_TAG = '\n//_B64DLL_HASH_//';
const PWD_TAG = '\n//_B64DLL_PWD_//';
const DEFAULT_OVERWRITE_MODE = 'ask'; // ask | overwrite | rename | cancel

const c = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m"
};

// ─── ШИФРОВАНИЕ ПАРОЛЕМ (AES-256-CBC) ───────────────────────────────

function deriveKey(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha512');
}

function encryptWithPassword(data, password) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(16);
  const key = deriveKey(password, salt);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  // Формат: salt(16) + iv(16) + encrypted_data
  return Buffer.concat([salt, iv, encrypted]);
}

function decryptWithPassword(encryptedData, password) {
  const salt = encryptedData.subarray(0, 16);
  const iv = encryptedData.subarray(16, 32);
  const data = encryptedData.subarray(32);
  const key = deriveKey(password, salt);
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}

// ─── ХЕШИРОВАНИЕ (MD5 + SHA256) ─────────────────────────────────────

function computeHashes(buffer) {
  const md5 = crypto.createHash('md5').update(buffer).digest('hex');
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  return { md5, sha256 };
}

function encodeHashTag(hashes) {
  return `${hashes.md5}|${hashes.sha256}`;
}

function decodeHashTag(tagContent) {
  const parts = tagContent.split('|');
  if (parts.length === 2) return { md5: parts[0], sha256: parts[1] };
  return null;
}

// ─── ПРОГРЕСС-БАР (стилизованный) ───────────────────────────────────

function drawProgressBar(label, processed, total) {
  const percent = total ? Math.min(100, Math.floor((processed / total) * 100)) : 0;
  const barWidth = 30;
  const filled = Math.floor((percent / 100) * barWidth);
  const empty = barWidth - filled;

  // Уникальный символ "проглатывания" — como пакман
  const head = filled > 0 ? 'ᗧ' : '';
  const body = 'ᗣ'.repeat(Math.max(0, filled - 1));
  const trail = '·'.repeat(empty);

  const bar = `${c.green}${head}${body}${c.dim}${trail}${c.reset}`;
  const pct = `${c.cyan}${String(percent).padStart(3)}%${c.reset}`;
  const size = `${c.dim}${formatBytes(processed)} / ${formatBytes(total)}${c.reset}`;

  process.stdout.write(`\r  ${bar} ${pct}  ${size}        `);
}

// ─── УТИЛИТЫ ────────────────────────────────────────────────────────

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

function copyToClipboard(text) {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      const proc = exec('clip', (err) => resolve(!err));
      proc.stdin.write(text);
      proc.stdin.end();
      setTimeout(() => resolve(false), 1500);
    } else {
      resolve(false);
    }
  });
}

// Безопасная атомарная запись файла
async function safeWriteFile(filePath, data) {
  const tempPath = `${filePath}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(tempPath, data);
    await fs.rename(tempPath, filePath);
  } catch (err) {
    try { await fs.unlink(tempPath); } catch (e) {}
    throw err;
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function createUniquePath(filePath) {
  const parsed = path.parse(filePath);
  let counter = 1;
  let candidate;
  do {
    candidate = path.join(parsed.dir, `${parsed.name}_${counter}${parsed.ext}`);
    counter += 1;
  } while (await fileExists(candidate));
  return candidate;
}

async function resolveOutputPath(filePath, rl, overwriteMode = DEFAULT_OVERWRITE_MODE) {
  if (!(await fileExists(filePath))) return filePath;

  if (overwriteMode === 'overwrite') return filePath;
  if (overwriteMode === 'rename') return createUniquePath(filePath);
  if (overwriteMode === 'cancel') return null;

  while (true) {
    const answer = (await rl.question(
      `${c.red}${c.bright}Файл "${filePath}" уже существует.${c.reset}\n` +
      `${c.cyan}[1]${c.reset} Перезаписать\n` +
      `${c.cyan}[2]${c.reset} Создать новое имя автоматически\n` +
      `${c.cyan}[3]${c.reset} Ввести другое имя вручную\n` +
      `${c.cyan}[0]${c.reset} Отменить операцию\n` +
      `${c.cyan}> ${c.reset}`
    )).trim();

    if (answer === '1') return filePath;
    if (answer === '2') return createUniquePath(filePath);
    if (answer === '3') {
      const customPath = cleanPath(await rl.question(`${c.bright}Введите новое имя/путь результата: ${c.reset}`));
      if (!customPath) continue;
      if (!(await fileExists(customPath))) return customPath;
      filePath = customPath;
    }
    if (answer === '0') return null;
  }
}

// ─── ПОТОКОВОЕ КОДИРОВАНИЕ/ДЕКОДИРОВАНИЕ (worker) ───────────────────

function reportProgress(processed, total) {
  if (!parentPort || !total) return;
  parentPort.postMessage({ type: 'progress', processed, total });
}

async function encodeFileStream(inPath, outPath, password) {
  const tempPath = `${outPath}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  let processed = 0;
  const total = (await fs.stat(inPath)).size;
  const originalBuffer = await fs.readFile(inPath);

  // Вычисляем хеш оригинального файла
  const hashes = computeHashes(originalBuffer);
  const hashTagContent = encodeHashTag(hashes);

  // Шифруем данные если есть пароль
  let dataToEncode;
  if (password) {
    dataToEncode = encryptWithPassword(originalBuffer, password);
  } else {
    dataToEncode = originalBuffer;
  }

  // Кодируем в Base64 потоково из буфера (не из файла, т.к. данные могут быть зашифрованы)
  await new Promise((resolve, reject) => {
    const totalToEncode = dataToEncode.length;
    const chunkSize = 64 * 1024;
    let offset = 0;
    const ws = fsSync.createWriteStream(tempPath);
    let leftover = Buffer.alloc(0);

    function readNextChunk() {
      while (offset < totalToEncode) {
        const end = Math.min(offset + chunkSize, totalToEncode);
        const chunk = dataToEncode.subarray(offset, end);
        offset = end;
        processed = offset;

        const combined = Buffer.concat([leftover, chunk]);
        const remainder = combined.length % 3;
        const toEncode = combined.subarray(0, combined.length - remainder);
        leftover = combined.subarray(combined.length - remainder);
        if (toEncode.length > 0) {
          if (!ws.write(toEncode.toString('base64'))) {
            ws.once('drain', readNextChunk);
            return;
          }
        }
        reportProgress(processed, totalToEncode);
      }
      // Все данные прочитаны
      if (leftover.length > 0) {
        ws.write(leftover.toString('base64'));
      }
      if (password) {
        ws.write(PWD_TAG);
      }
      ws.write(`${HASH_TAG}${hashTagContent}${HASH_TAG}`);
      ws.write(META_TAG);
      ws.end();
    }

    ws.on('finish', resolve);
    ws.on('error', err => { ws.end(); reject(err); });

    readNextChunk();
  });
  await fs.rename(tempPath, outPath);
}

async function decodeFileStream(inPath, currentOutFileName, password) {
  const tempPath = `${currentOutFileName}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  let processed = 0;
  const total = (await fs.stat(inPath)).size;

  // Читаем конец оригинального файла ДО стриминга чтобы определить теги
  const probeSize = Math.min(2048, total);
  const probeBuf = Buffer.alloc(probeSize);
  const probeFd = await fs.open(inPath, 'r');
  await probeFd.read(probeBuf, 0, probeSize, Math.max(0, total - probeSize));
  await probeFd.close();
  const probeText = probeBuf.toString('utf-8');
  const hasPwdTag = probeText.includes('//_B64DLL_PWD_//');
  const hasHashTag = probeText.includes('//_B64DLL_HASH_//');

  // Если есть тег пароля но пароль не передан — сразу сообщаем
  if (hasPwdTag && !password) {
    throw new Error('PASSWORD_REQUIRED');
  }

  // Стриминговое декодирование
  await new Promise((resolve, reject) => {
    const rs = fsSync.createReadStream(inPath, { encoding: 'utf8', highWaterMark: 64 * 1024 });
    const ws = fsSync.createWriteStream(tempPath);
    let b64Leftover = '';
    let signatureFound = false;

    rs.on('data', chunk => {
      processed += Buffer.byteLength(chunk, 'utf8');
      if (signatureFound) {
        reportProgress(processed, total);
        return;
      }

      let text = b64Leftover + chunk;

      // Удаляем все теги ДО фильтрации base64
      // (PWD и HASH теги содержат валидные base64 символы: B, 6, 4, D, L)
      text = text.replace(/\/\/_B64DLL_PWD_\/\//g, '');
      text = text.replace(/\/\/_B64DLL_HASH_\/\/[^/]*\/\/_B64DLL_HASH_\/\//g, '');

      const sigIndex = text.indexOf('//_B64DLL_TOOL_SIG_//');
      if (sigIndex !== -1) {
        text = text.slice(0, sigIndex);
        signatureFound = true;
      }
      text = text.replace(/[^A-Za-z0-9+/=]/g, '');

      const remainder = text.length % 4;
      const toDecode = text.slice(0, text.length - remainder);
      b64Leftover = signatureFound ? '' : text.slice(text.length - remainder);

      if (toDecode.length > 0) {
        ws.write(Buffer.from(toDecode, 'base64'));
      }
      reportProgress(processed, total);
    });

    rs.on('end', () => {
      let tail = b64Leftover;
      tail = tail.replace(/\/\/_B64DLL_PWD_\/\//g, '');
      tail = tail.replace(/\/\/_B64DLL_HASH_\/\/[^/]*\/\/_B64DLL_HASH_\/\//g, '');
      const sigIndex = tail.indexOf('//_B64DLL_TOOL_SIG_//');
      if (sigIndex !== -1) tail = tail.slice(0, sigIndex);
      tail = tail.replace(/[^A-Za-z0-9+/=]/g, '');
      if (tail.length > 0) ws.write(Buffer.from(tail, 'base64'));
      ws.end();
    });

    ws.on('finish', resolve);
    rs.on('error', err => { ws.end(); fsSync.unlink(tempPath, ()=>{}); reject(err); });
    ws.on('error', err => { rs.destroy(); fsSync.unlink(tempPath, ()=>{}); reject(err); });
  });

  // Читаем декодированные данные
  let decodedBuffer = await fs.readFile(tempPath);

  // Извлекаем хеш из оригинального файла (теги уже были удалены в стриме)
  let storedHashes = null;
  if (hasHashTag) {
    const hashProbe = probeText.match(/\/\/_B64DLL_HASH_\/\/(.*?)\/\/_B64DLL_HASH_\/\//);
    if (hashProbe) storedHashes = decodeHashTag(hashProbe[1]);
  }

  // Если был пароль — расшифровываем
  if (hasPwdTag && password) {
    try {
      decodedBuffer = decryptWithPassword(decodedBuffer, password);
    } catch (err) {
      try { await fs.unlink(tempPath); } catch(e) {}
      throw new Error('DECRYPTION_FAILED');
    }
  }

  // Записываем финальный результат
  await fs.writeFile(tempPath, decodedBuffer);

  let finalOutFileName = currentOutFileName;
  if (!finalOutFileName.includes('.') || finalOutFileName.endsWith('_decoded')) {
      const fd = await fs.open(tempPath, 'r');
      const peakBuf = Buffer.alloc(560);
      const bytesRead = (await fd.read(peakBuf, 0, 560, 0)).bytesRead;
      await fd.close();
      if (bytesRead > 0) {
          const detectedExt = detectSignature(peakBuf.subarray(0, bytesRead));
          if (detectedExt) finalOutFileName += detectedExt;
      }
  }
  if (finalOutFileName !== currentOutFileName && await fileExists(finalOutFileName)) {
      finalOutFileName = await createUniquePath(finalOutFileName);
  }
  await fs.rename(tempPath, finalOutFileName);

  // Проверяем целостность
  let integrityResult = null;
  if (storedHashes) {
    const currentHashes = computeHashes(decodedBuffer);
    integrityResult = {
      stored: storedHashes,
      computed: currentHashes,
      match: storedHashes.md5 === currentHashes.md5 && storedHashes.sha256 === currentHashes.sha256
    };
  }

  return { outPath: finalOutFileName, integrity: integrityResult };
}

// ─── ДЕТЕКЦИЯ ФОРМАТОВ ──────────────────────────────────────────────

function detectZipBasedFormat(buffer) {
  const text = buffer.toString('latin1');
  if (text.includes('word/')) return '.docx';
  if (text.includes('xl/')) return '.xlsx';
  if (text.includes('ppt/')) return '.pptx';
  if (text.includes('AndroidManifest.xml')) return '.apk';
  if (text.includes('META-INF/MANIFEST.MF')) return '.jar';
  return '.zip';
}

function detectTextFormat(buffer) {
  const text = buffer.toString('utf8').trimStart();
  if (!text) return null;
  if (text.startsWith('{') || text.startsWith('[')) return '.json';
  if (text.startsWith('<?xml') || text.startsWith('<svg') || text.startsWith('<')) return '.xml';
  const printable = buffer.filter(byte => byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126)).length;
  if (printable / buffer.length > 0.9) return '.txt';
  return null;
}

function detectSignature(buffer) {
  if (buffer.length < 2) return null;
  const hex = buffer.toString('hex', 0, Math.min(buffer.length, 12)).toUpperCase();
  if (hex.startsWith('89504E47')) return '.png';
  if (hex.startsWith('FFD8FF')) return '.jpg';
  if (hex.startsWith('47494638')) return '.gif';
  if (hex.startsWith('424D')) return '.bmp';
  if (hex.startsWith('00000100')) return '.ico';
  if (hex.startsWith('25504446')) return '.pdf';
  if (hex.startsWith('504B0304') || hex.startsWith('504B0506') || hex.startsWith('504B0708')) return detectZipBasedFormat(buffer);
  if (hex.startsWith('377ABCAF271C')) return '.7z';
  if (hex.startsWith('1F8B08')) return '.gz';
  if (hex.startsWith('52617221')) return '.rar';
  if (hex.startsWith('4D5A')) return '.exe';
  if (hex.startsWith('494433') || hex.startsWith('FFFB')) return '.mp3';
  if (hex.startsWith('4F676753')) return '.ogg';
  if (hex.startsWith('664C6143')) return '.flac';
  if (hex.startsWith('D0CF11E0')) return '.doc';
  if (hex.startsWith('52494646') && buffer.length >= 12) {
    const format = buffer.toString('ascii', 8, 12);
    if (format === 'WEBP') return '.webp';
    if (format === 'WAVE') return '.wav';
    if (format === 'AVI ') return '.avi';
  }
  if (buffer.length >= 262 && buffer.toString('ascii', 257, 262) === 'ustar') return '.tar';
  if (hex.startsWith('000000') && buffer.length >= 8) {
    const ftyp = buffer.toString('ascii', 4, 8);
    if (ftyp === 'ftyp') return '.mp4';
  }
  return detectTextFormat(buffer);
}

// ─── WORKER ─────────────────────────────────────────────────────────

function runFileWorker(action, inPath, outPath, password, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(__filename, { workerData: { action, inPath, outPath, password } });
    worker.on('message', message => {
      if (message.type === 'progress') onProgress(message.processed, message.total);
      if (message.type === 'done') resolve(message);
      if (message.type === 'error') reject(new Error(message.message));
    });
    worker.on('error', reject);
    worker.on('exit', code => {
      if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
    });
  });
}

async function runWorkerMode() {
  try {
    if (workerData.action === 'encode') {
      await encodeFileStream(workerData.inPath, workerData.outPath, workerData.password);
      parentPort.postMessage({ type: 'done', outPath: workerData.outPath });
    } else if (workerData.action === 'decode') {
      const result = await decodeFileStream(workerData.inPath, workerData.outPath, workerData.password);
      parentPort.postMessage({ type: 'done', outPath: result.outPath, integrity: result.integrity });
    }
  } catch (err) {
    parentPort.postMessage({ type: 'error', message: err.message });
  }
}

// ─── ЭКСПОРТ ИНФОРМАЦИИ ────────────────────────────────────────────

async function exportInfo(infoData, filePath, rl) {
  const answer = (await rl.question(
    `${c.cyan}Сохранить информацию в файл? (y/n): ${c.reset}`
  )).trim().toLowerCase();

  if (answer !== 'y' && answer !== 'н') return;

  const exportFormat = (await rl.question(
    `${c.cyan}[1]${c.reset} JSON\n` +
    `${c.cyan}[2]${c.reset} Текстовый файл\n` +
    `${c.cyan}> ${c.reset}`
  )).trim();

  const baseName = path.basename(filePath, path.extname(filePath));
  let exportPath;
  let content;

  if (exportFormat === '1') {
    exportPath = `${baseName}_info.json`;
    content = JSON.stringify(infoData, null, 2);
  } else {
    exportPath = `${baseName}_info.txt`;
    content = Object.entries(infoData)
      .map(([key, val]) => `${key}: ${val}`)
      .join('\n');
  }

  exportPath = await resolveOutputPath(exportPath, rl);
  if (exportPath) {
    await safeWriteFile(exportPath, content);
    console.log(`${c.green}Информация сохранена в "${exportPath}"${c.reset}\n`);
  }
}

// ─── MAIN ───────────────────────────────────────────────────────────

if (!isMainThread) {
  runWorkerMode();
} else {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  async function main() {
    console.clear();
    const logo = `
${c.bright}${c.cyan} ____                 __   _  _        ____  _     _
| __ )  __ _ ___  ___/ /_ | || |      |  _ \\| |   | |
|  _ \\ / _\` / __|/ _ \\ '_ \\| || |_     | | | | |   | |
| |_) | (_| \\__ \\  __/ (_) |__   _|    | |_| | |___| |___
|____/ \\__,_|___/\\___|\\___/   |_|      |____/|_____|_____|${c.reset}
`;
    console.log(logo);
    console.log(`${c.cyan}${c.bright}==========================================================${c.reset}`);
    console.log(`${c.bright}${c.cyan}           BASE64 DLL ENCODER & DECODER v${APP_VERSION}          ${c.reset}`);
    console.log(`${c.cyan}${c.bright}==========================================================${c.reset}\n`);

    while (true) {
      try {
        const menu = `${c.bright}Выберите режим:\n${c.reset}` +
          `${c.cyan}[1]${c.reset} Текст -> DLL (классическое кодирование)\n` +
          `${c.cyan}[2]${c.reset} DLL -> Текст (создание .txt из dll)\n` +
          `${c.cyan}[3]${c.reset} Файл -> DLL (любой формат в .dll)\n` +
          `${c.cyan}[4]${c.reset} DLL -> Файл (раскодировать .dll в исходный формат)\n` +
          `${c.cyan}[5]${c.reset} Инфо о DLL (проверка, сигнатура и предполагаемый формат)\n` +
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

        // Спрашиваем про пароль (опционально)
        const usePassword1 = (await rl.question(`${c.cyan}Задать пароль? (y/n): ${c.reset}`)).trim().toLowerCase();
        let password1 = null;
        if (usePassword1 === 'y' || usePassword1 === 'н') {
          password1 = await rl.question(`${c.bright}Введите пароль: ${c.reset}`);
        }

        const outPath = await resolveOutputPath(`${name}.dll`, rl);
        if (!outPath) {
          console.log(`${c.red}Операция отменена.${c.reset}\n`);
        } else {
          process.stdout.write(`\n${c.dim}Кодирование...${c.reset}`);
          await sleep(400);
          let encodedContent = encodeContent(content);

          // Если пароль — шифруем
          if (password1) {
            const encrypted = encryptWithPassword(Buffer.from(content, 'utf-8'), password1);
            encodedContent = encrypted.toString('base64');
          }

          const hashBuf = Buffer.from(content, 'utf-8');
          const hashes = computeHashes(hashBuf);
          const hashTag = `${HASH_TAG}${encodeHashTag(hashes)}${HASH_TAG}`;
          const pwdTag = password1 ? PWD_TAG : '';
          const finalContent = encodedContent + pwdTag + hashTag + META_TAG;

          await safeWriteFile(outPath, finalContent);
          console.log(`\r${c.green}${c.bright}УСПЕХ! Текст зашифрован и сохранен в "${outPath}".${c.reset}`);
          if (password1) console.log(`${c.yellow}Файл зашифрован паролем.${c.reset}`);
          console.log(`${c.dim}Целостность: MD5=${hashes.md5.substring(0,16)}... SHA256=${hashes.sha256.substring(0,16)}...${c.reset}\n`);
        }

      } else if (mode.trim() === '2') {
        console.log(`\n${c.cyan}--- DLL В ТЕКСТ ---${c.reset}`);
        let name = cleanPath(await rl.question(`${c.bright}Введите полное имя файла (с .dll) или только имя: ${c.reset}`));
        let fileName = name.toLowerCase().endsWith('.dll') ? name : `${name}.dll`;
        let outName = name.toLowerCase().endsWith('.dll') ? name.slice(0, -4) : name;
        const outPath = await resolveOutputPath(`${outName}.txt`, rl);
        if (!outPath) {
          console.log(`${c.red}Операция отменена.${c.reset}\n`);
        } else {
          process.stdout.write(`\n${c.dim}Чтение и декодирование...${c.reset}`);
          await sleep(400);

          try {
            let rawData = await fs.readFile(fileName, 'utf-8');

            // Проверяем наличие тега пароля
            const hasPwd = rawData.includes('//_B64DLL_PWD_//');
            let password2 = null;
            if (hasPwd) {
              password2 = await rl.question(`${c.yellow}Файл зашифрован паролем. Введите пароль: ${c.reset}`);
            }

            // Проверяем наличие тега хеша
            let storedHashes = null;
            const hashMatch = rawData.match(/\/\/_B64DLL_HASH_\/\/(.*?)\/\/_B64DLL_HASH_\/\//);
            if (hashMatch) {
              storedHashes = decodeHashTag(hashMatch[1]);
            }

            if (rawData.includes('//_B64DLL_TOOL_SIG_//')) {
                 rawData = rawData.replace('//_B64DLL_TOOL_SIG_//', '');
            }
            if (rawData.includes('//_B64DLL_PWD_//')) {
                 rawData = rawData.replace('//_B64DLL_PWD_//', '');
            }
            if (hashMatch) {
              rawData = rawData.replace(/\/\/_B64DLL_HASH_\/\/.*?\/\/_B64DLL_HASH_\/\//, '');
            }

            let decodedBuffer = Buffer.from(rawData.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');

            // Расшифровываем если был пароль
            if (hasPwd && password2) {
              try {
                decodedBuffer = decryptWithPassword(decodedBuffer, password2);
              } catch (err) {
                console.log(`\r${c.red}${c.bright}ОШИБКА: Неверный пароль или поврежденные данные.${c.reset}\n`);
                continue;
              }
            }

            const decodedContent = decodedBuffer.toString('utf-8');
            await safeWriteFile(outPath, decodedContent);
            console.log(`\r${c.green}${c.bright}УСПЕХ! Файл "${fileName}" декодирован в "${outPath}".${c.reset}`);

            // Проверка целостности
            if (storedHashes) {
              const currentHashes = computeHashes(decodedBuffer);
              const match = storedHashes.md5 === currentHashes.md5 && storedHashes.sha256 === currentHashes.sha256;
              if (match) {
                console.log(`${c.green}${c.bright}Целостность подтверждена: хеш совпадает.${c.reset}`);
              } else {
                console.log(`${c.red}${c.bright}ВНИМАНИЕ: хеш не совпадает! Файл мог быть поврежден.${c.reset}`);
                console.log(`${c.dim}Ожидалось: MD5=${storedHashes.md5.substring(0,16)}...${c.reset}`);
                console.log(`${c.dim}Получено:  MD5=${currentHashes.md5.substring(0,16)}...${c.reset}`);
              }
            }

            const answer = await rl.question(`${c.cyan}Скопировать текст в буфер обмена? (y/n): ${c.reset}`);
            if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'н') {
                 const copied = await copyToClipboard(decodedContent);
                 console.log(copied ? `${c.green}Текст успешно скопирован в буфер обмена!${c.reset}\n` : `${c.red}Не удалось скопировать текст в буфер обмена.${c.reset}\n`);
            } else {
                 console.log();
            }
          } catch (e) {
            if (e.code === 'ENOENT') {
              console.log(`\r${c.red}${c.bright}ОШИБКА: Файл "${fileName}" не найден в папке с программой!${c.reset}\n`);
            } else {
              console.log(`\r${c.red}${c.bright}ОШИБКА: ${e.message}${c.reset}\n`);
            }
          }
        }

      } else if (mode.trim() === '3') {
        console.log(`\n${c.cyan}--- ЛЮБОЙ ФАЙЛ В BASE64 DLL ---${c.reset}`);
        let filePath = cleanPath(await rl.question(`${c.bright}Введите путь или имя исходного файла (можно перетащить в окно): ${c.reset}`));

        try {
          const stats = await fs.stat(filePath);

          // Спрашиваем про пароль (опционально)
          const usePassword3 = (await rl.question(`${c.cyan}Задать пароль? (y/n): ${c.reset}`)).trim().toLowerCase();
          let password3 = null;
          if (usePassword3 === 'y' || usePassword3 === 'н') {
            password3 = await rl.question(`${c.bright}Введите пароль: ${c.reset}`);
          }

          let outFileName = `${path.basename(filePath)}.dll`;
          outFileName = await resolveOutputPath(outFileName, rl);
          if (!outFileName) {
            console.log(`${c.red}Операция отменена.${c.reset}\n`);
          } else {
            console.log(`\n${c.dim}Чтение файла (${formatBytes(stats.size)})...${c.reset}`);
            const result = await runFileWorker('encode', filePath, outFileName, password3, (processed, total) => drawProgressBar('Кодирование', processed, total));
            const outStats = await fs.stat(result.outPath);
            console.log(`\r${c.green}${c.bright}УСПЕХ! Файл "${path.basename(filePath)}" превращен в "${result.outPath}".${c.reset} \n${c.dim}Размер DLL: ${formatBytes(outStats.size)}${c.reset}`);
            if (password3) console.log(`${c.yellow}Файл зашифрован паролем.${c.reset}`);
            console.log();
          }
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

        // Проверяем есть ли пароль в файле
        let needPassword = false;
        try {
          const probeData = await fs.readFile(filePath, 'utf-8');
          needPassword = probeData.includes('//_B64DLL_PWD_//');
        } catch(e) {}

        let password4 = null;
        if (needPassword) {
          password4 = await rl.question(`${c.yellow}Файл зашифрован паролем. Введите пароль: ${c.reset}`);
        }

        try {
          let outFileName = filePath;
          if (outFileName.toLowerCase().endsWith('.dll')) {
              outFileName = outFileName.slice(0, -4);
          } else {
              outFileName += "_decoded";
          }
          outFileName = await resolveOutputPath(outFileName, rl);
          if (!outFileName) {
            console.log(`${c.red}Операция отменена.${c.reset}\n`);
          } else {
            console.log(`\n${c.dim}Чтение закодированных данных...${c.reset}`);
            const result = await runFileWorker('decode', filePath, outFileName, password4, (processed, total) => drawProgressBar('Декодирование', processed, total));
            const outStats = await fs.stat(result.outPath);
            console.log(`\r${c.green}${c.bright}УСПЕХ! DLL декодирован обратно в файл "${result.outPath}".${c.reset} \n${c.dim}Восстановленный размер: ${formatBytes(outStats.size)}${c.reset}`);

            // Проверка целостности
            if (result.integrity) {
              if (result.integrity.match) {
                console.log(`${c.green}${c.bright}Целостность подтверждена: хеш совпадает.${c.reset}`);
              } else {
                console.log(`${c.red}${c.bright}ВНИМАНИЕ: хеш не совпадает! Файл мог быть поврежден.${c.reset}`);
                console.log(`${c.dim}Ожидалось: MD5=${result.integrity.stored.md5.substring(0,16)}...${c.reset}`);
                console.log(`${c.dim}Получено:  MD5=${result.integrity.computed.md5.substring(0,16)}...${c.reset}`);
              }
            }
            console.log();
          }
        } catch (e) {
          if (e.message === 'PASSWORD_REQUIRED') {
            console.log(`\r${c.red}${c.bright}ОШИБКА: Файл зашифрован, но пароль не был введен!${c.reset}\n`);
          } else if (e.message === 'DECRYPTION_FAILED') {
            console.log(`\r${c.red}${c.bright}ОШИБКА: Неверный пароль или поврежденные данные.${c.reset}\n`);
          } else if (e.code === 'ENOENT') {
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
          const buffer = Buffer.alloc(Math.min(1024, stats.size));
          await fd.read(buffer, 0, buffer.length, 0);

          const tailBuf = Buffer.alloc(Math.min(1024, stats.size));
          const readEndPos = Math.max(0, stats.size - tailBuf.length);
          await fd.read(tailBuf, 0, tailBuf.length, readEndPos);
          await fd.close();

          const tailText = tailBuf.toString('utf-8');
          const isSigned = tailText.includes('//_B64DLL_TOOL_SIG_//');
          const hasPassword = tailText.includes('//_B64DLL_PWD_//');
          const hasHash = tailText.includes('//_B64DLL_HASH_//');
          const rawPrefix = buffer.toString('utf-8').replace(/[^a-zA-Z0-9+/=]/g, '').substring(0, 768);
          const decodedPrefixBuffer = Buffer.from(rawPrefix, 'base64');
          const detectedExt = detectSignature(decodedPrefixBuffer);
          const looksLikeBase64 = rawPrefix.length > 0 && rawPrefix.length % 4 === 0;

          console.log(`\n${c.cyan}${c.bright}>>> ДЕТАЛИ ФАЙЛА <<<${c.reset}`);
          console.log(`${c.bright}• Имя файла: ${c.reset}${path.basename(filePath)}`);
          console.log(`${c.bright}• Размер на диске: ${c.reset}${formatBytes(stats.size)}`);
          console.log(`${c.bright}• Проверка Base64: ${c.reset}${looksLikeBase64 ? 'похоже на корректный Base64-поток' : 'есть признаки нестандартного/поврежденного Base64'}`);

          if (isSigned) {
              console.log(`${c.green}${c.bright}• Подтверждено: закодировано через Base64 DLL Tool (метка найдена)${c.reset}`);
          } else {
              console.log(`${c.red}${c.bright}• Метка Base64 DLL Tool не найдена${c.reset}`);
          }

          if (hasPassword) {
              console.log(`${c.yellow}${c.bright}• Защита: файл зашифрован паролем${c.reset}`);
          } else {
              console.log(`${c.dim}• Защита: без пароля${c.reset}`);
          }

          if (hasHash) {
              console.log(`${c.green}${c.bright}• Целостность: хеш сохранен (MD5 + SHA256)${c.reset}`);
          } else {
              console.log(`${c.dim}• Целостность: хеш не записан${c.reset}`);
          }

          const originalSizeApprox = Math.floor((stats.size / 4) * 3);
          console.log(`${c.bright}• Ожидаемый размер после декода: ${c.reset}~${formatBytes(originalSizeApprox)}`);
          console.log(`${c.bright}• Предполагаемый формат после декода: ${c.reset}${detectedExt || 'не определен'}`);
          console.log(`${c.bright}• Фрагмент кода (сигнатура): ${c.reset}${rawPrefix.substring(0, 40)}...`);

          const decodedPrefix = decodedPrefixBuffer.toString('ascii').replace(/[\x00-\x1F\x7F-\x9F]/g, '.').substring(0, 60);
          console.log(`${c.bright}• Анализ заголовка (ascii): ${c.reset}${decodedPrefix}`);
          console.log();

          // Экспорт информации
          const infoData = {
            fileName: path.basename(filePath),
            fileSize: formatBytes(stats.size),
            fileSizeBytes: stats.size,
            base64Valid: looksLikeBase64,
            signedByTool: isSigned,
            passwordProtected: hasPassword,
            hashStored: hasHash,
            estimatedDecodedSize: `~${formatBytes(originalSizeApprox)}`,
            estimatedDecodedSizeBytes: Math.floor((stats.size / 4) * 3),
            predictedFormat: detectedExt || 'не определен',
            codeSignature: rawPrefix.substring(0, 40) + '...',
            headerAnalysis: decodedPrefix
          };
          await exportInfo(infoData, filePath, rl);

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
}
