const http = require('http');

const server = http.createServer((req, res) => {
  res.end('ok');
});

server.listen(3001, '0.0.0.0', () => {
  console.log('TEST SERVER RUNNING ON 3001');
});