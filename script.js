import('./src/main.js').catch((error) => {
console.error('Failed to bootstrap application modules:', error);
alert('Ошибка загрузки модулей приложения. Откройте консоль для деталей.');
});
