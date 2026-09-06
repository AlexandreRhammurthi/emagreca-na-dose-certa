import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;

const publicDir = path.join(__dirname, 'public');
if (fs.existsSync(publicDir)) {
  app.use(express.static(publicDir));
}

app.use(express.static(__dirname));

app.use((req, res, next) => {
  if (req.method === 'GET') {
    const target = fs.existsSync(path.join(publicDir, 'index.html'))
      ? path.join(publicDir, 'index.html')
      : path.join(__dirname, 'index.html');
    return res.sendFile(target);
  }
  next();
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
});
