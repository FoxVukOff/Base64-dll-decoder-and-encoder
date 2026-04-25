const fs = require('fs');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function encodeContent(content) {
  return Buffer.from(content).toString('base64');
}

function decodeContent(content) {
  return Buffer.from(content, 'base64').toString('utf-8');
}

function saveDll(name, content) {
  const filePath = `${name}.dll`;
  fs.writeFile(filePath, content, (err) => {
    if (err) {
      console.error('Ошибка при сохранении dll файла:', err);
      rl.close();
      return;
    }

    console.log(`DLL файл "${name}.dll" успешно сохранен.`);
    rl.close();
  });
}

// Запрос на выбор режима (кодирование или декодирование)
rl.question('Выберите режим: Кодирование (1) или Декодирование (2): ', (mode) => {
  if (mode === '1') {
    // Запрос на ввод имени dll
    rl.question('Введите имя dll: ', (name) => {
      // Запрос на ввод содержания dll
      rl.question('Введите содержание dll: ', (content) => {
        const encodedContent = encodeContent(content);
        saveDll(name, encodedContent);
      });
    });
  } else if (mode === '2') {
    // Запрос на ввод имени декодируемого dll
    rl.question('Введите имя декодируемого dll: ', (name) => {
      const filePath = `${name}.dll`;

      // Попытка чтения содержимого dll файла
      fs.readFile(filePath, 'utf-8', (err, data) => {
        if (err) {
          console.error('Ошибка при чтении dll файла:', err);
          rl.close();
          return;
        }

        // Декодирование содержания dll
        const decodedContent = decodeContent(data);
        
        // Сохранение декодированного содержания в файл с расширением .txt
        const txtFilePath = `${name}.txt`;
        fs.writeFile(txtFilePath, decodedContent, (err) => {
          if (err) {
            console.error('Ошибка при сохранении txt файла:', err);
            rl.close();
            return;
          }

          console.log(`Декодированное содержание dll "${name}.dll" успешно сохранено в файле "${name}.txt".`);
          rl.close();
        });
      });
    });
  } else {
    console.log('Неверный выбор режима.');
    rl.close();
  }
});
